import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { absUrl, api } from "@/lib/api";

const MEDIA_ERR = { 1: "network", 2: "network", 3: "decode", 4: "codec" };

// Some servers refuse a file when another site's page asks for it (they check the Referer; X's video.twimg.com does)
// but open it to a request without one. Such a file plays from this frame: a same-origin document of its own whose
// requests carry no Referer. The <video> inside is driven exactly like the page's own one (see the effect below).
export const NO_REFERRER_DOC = '<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">'
  + "<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}"
  + "video{display:block;width:100%;height:100%;object-fit:contain;background:#000}</style></head>"
  + '<body><video playsinline preload="auto"></video></body></html>';

// The picture only: the buttons live in PlayerControls (drawn by Stage above the guest lock), so the element never shows
// the browser's own controls. `onMedia` hands the element and the hls.js instance to whoever draws the controls.
export const HtmlPlayer = ({ video, ident, playerRef, events, onFatal, onMedia }) => {
  const ref = useRef(null);
  // The server says so ("referrer_policy"), or a plain file that failed before it ever started is tried once more
  // this way: that is how the refusal looks in a browser (it cannot see the 403 itself).
  const [noRef, setNoRef] = useState(video.referrer_policy === "no-referrer");
  const [frameEl, setFrameEl] = useState(null); // the <video> inside the no-Referer frame, once the frame is ready
  const evRef = useRef(events);
  evRef.current = events;
  const mediaCb = useRef(onMedia);
  mediaCb.current = onMedia;
  const buffering = useRef(false);
  const [src, setSrc] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const setBuf = (on) => {
    if (buffering.current === on) return;
    buffering.current = on;
    evRef.current.onBuffering?.(on);
  };

  useEffect(() => {
    let alive = true;
    setBuf(true);
    if (video.kind === "upload") {
      api.mediaUrl(video.media_id, ident).then((r) => alive && setSrc(absUrl(r.url))).catch((e) => alive && onFatal(e.code || "network"));
    } else setSrc(video.stream_url || video.url);
    return () => { alive = false; };
  }, [video.kind, video.media_id, video.stream_url, video.url, ident, onFatal, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => setBuf(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = noRef ? frameEl : ref.current;
    if (!el || !src) return undefined;
    let hls;
    let ready = false;
    let disposed = false;
    let live = false; // a live HLS stream (no end): the sync follows play/pause only, see usePlaybackSync
    let recovers = 0;
    let recoverAt = 0;
    const stalled = () => !el.ended && el.readyState < 3 && (!el.paused || el.readyState < 1);
    // A stream that stopped moving for 8 s while it should play: hls.js is asked to load again, once per stall
    // (a live stream whose loading stopped after a network hiccup; the banbansports player does the same).
    let lastT = -1;
    let stuckMs = 0;
    const tick = setInterval(() => {
      setBuf(stalled());
      if (!hls || el.paused || el.ended || Math.abs(el.currentTime - lastT) >= 0.05) stuckMs = 0;
      else if ((stuckMs += 250) === 8000) {
        try { hls.startLoad(); } catch { /* destroyed meanwhile */ }
      }
      lastT = el.currentTime;
    }, 250);
    playerRef.current = {
      get ready() { return ready; }, supportsRate: true, kind: "html",
      getTime: () => el.currentTime,
      getDuration: () => el.duration,
      isPaused: () => el.paused,
      isBuffering: () => stalled(),
      isLive: () => live || el.duration === Infinity,
      play: () => el.play(),
      pause: () => el.pause(),
      seek: (s) => { if (Number.isFinite(s)) el.currentTime = s; },
      setRate: (r) => { if (Math.abs(el.playbackRate - r) > 0.004) el.playbackRate = r; },
      setMuted: (m) => { el.muted = m; },
    };
    const on = {
      loadedmetadata: () => { ready = true; setBuf(stalled()); evRef.current.onReady?.(); },
      play: () => evRef.current.onPlay?.(),
      pause: () => { setBuf(false); evRef.current.onPause?.(); },
      seeked: () => { setBuf(stalled()); evRef.current.onSeek?.(); },
      waiting: () => setBuf(true),
      playing: () => setBuf(false),
      canplay: () => setBuf(false),
      error: () => {
        if (disposed || (!hls && !el.getAttribute("src"))) return;
        const c = el.error?.code;
        if (!noRef && !ready && video.kind === "direct" && (c === 2 || c === 4)) {
          setNoRef(true); // refused before the first frame: once more without a Referer
          return;
        }
        evRef.current.onError?.();
        if (video.kind === "upload" && (c === 2 || c === 4) && attempt < 1) setTimeout(() => setAttempt((n) => n + 1), 700);
        else onFatal(MEDIA_ERR[c] || "unsupported");
      },
    };
    Object.entries(on).forEach(([k, fn]) => el.addEventListener(k, fn));
    // Prefer hls.js wherever MSE exists (Chrome/Android WebView report "maybe" for HLS but often can't play it);
    // fall back to native HLS only where MSE is missing (older iPhone Safari / iOS WebView).
    const nativeHls = el.canPlayType("application/vnd.apple.mpegurl");
    if (video.kind === "hls" && Hls.isSupported()) {
      // Phone-friendly limits: never fetch a rendition larger than the player, keep about half a minute ahead and behind.
      // Live streams: up to 5 % faster while behind the target distance from the live edge, so every device in the
      // room settles at the same delay.
      // Mobile networks drop requests: playlists and pieces are asked again a few times before anything fails.
      hls = new Hls({ enableWorker: true, lowLatencyMode: false, capLevelToPlayerSize: true, maxBufferLength: 30, maxMaxBufferLength: 60, backBufferLength: 30, maxLiveSyncPlaybackRate: 1.05,
        manifestLoadingMaxRetry: 3, levelLoadingMaxRetry: 4, fragLoadingMaxRetry: 6, fragLoadingRetryDelay: 500 });
      hls.on(Hls.Events.LEVEL_LOADED, (_e, d) => { if (d?.details?.live) live = true; });
      let netRetries = 0;
      hls.on(Hls.Events.FRAG_LOADED, () => { netRetries = 0; });
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (!d.fatal) return;
        evRef.current.onError?.();
        // Loading stopped (the network, not the playlist): started again up to 3 times, 1 s, 2 s, 3 s apart.
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR && !d.details?.includes("manifest") && netRetries < 3) {
          netRetries += 1;
          setTimeout(() => { if (!disposed) hls.startLoad(); }, 1000 * netRetries);
          return;
        }
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
          // hls.js' own recipe: recover, then recover with the audio codec swapped, then give up. Recovering without a
          // limit froze the picture again and again on phones whose decoder cannot take the stream.
          const now = Date.now();
          if (now - recoverAt > 30000) recovers = 0;
          recoverAt = now;
          recovers += 1;
          if (recovers === 1) hls.recoverMediaError();
          else if (recovers === 2) { hls.swapAudioCodec(); hls.recoverMediaError(); }
          else onFatal("decode");
        } else onFatal(d.details?.includes("manifest") ? "manifest_invalid" : "network");
      });
      hls.loadSource(src);
      hls.attachMedia(el);
    } else if (video.kind === "hls" && !nativeHls) {
      onFatal("codec");
    } else {
      el.src = src;
      el.load();
    }
    mediaCb.current?.({ el, hls: hls || null });
    return () => {
      disposed = true;
      mediaCb.current?.(null);
      clearInterval(tick);
      Object.entries(on).forEach(([k, fn]) => el.removeEventListener(k, fn));
      hls?.destroy();
      playerRef.current = null;
      el.pause();
      el.removeAttribute("src");
      el.load();
    };
  }, [src, video.kind, playerRef, onFatal, attempt, noRef, frameEl]); // eslint-disable-line react-hooks/exhaustive-deps

  const sub = video.subtitle; // feat worker: the room's subtitle file; each viewer turns it on in the subtitles menu
  // In the frame the room's subtitle file is added by hand (React draws only the frame itself).
  useEffect(() => {
    if (!noRef || !frameEl || !sub) return undefined;
    const tr = frameEl.ownerDocument.createElement("track");
    tr.kind = "subtitles";
    tr.src = absUrl(sub.url);
    tr.label = sub.name.replace(/\.(srt|vtt)$/i, "");
    tr.srclang = "und";
    tr.setAttribute("data-room-sub", "1");
    frameEl.appendChild(tr);
    return () => tr.remove();
  }, [noRef, frameEl, sub?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (noRef) {
    return (
      <iframe
        title="video" aria-hidden="true" tabIndex={-1} className="html-video html-frame" srcDoc={NO_REFERRER_DOC}
        allow="autoplay; fullscreen; picture-in-picture" data-testid="html-video-frame"
        onLoad={(e) => setFrameEl(e.currentTarget.contentDocument?.querySelector("video") || null)}
      />
    );
  }
  return (
    <video ref={ref} playsInline preload="auto" className="html-video" data-testid="html-video-player">
      {sub && <track key={sub.id} kind="subtitles" src={absUrl(sub.url)} label={sub.name.replace(/\.(srt|vtt)$/i, "")} srcLang="und" data-room-sub="1" />}
    </video>
  );
};

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { absUrl, api } from "@/lib/api";

const MEDIA_ERR = { 1: "network", 2: "network", 3: "decode", 4: "codec" };

// The picture only: the buttons live in PlayerControls (drawn by Stage above the guest lock), so the element never shows
// the browser's own controls. `onMedia` hands the element and the hls.js instance to whoever draws the controls.
export const HtmlPlayer = ({ video, ident, playerRef, events, onFatal, onMedia }) => {
  const ref = useRef(null);
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
    const el = ref.current;
    if (!el || !src) return undefined;
    let hls;
    let ready = false;
    let disposed = false;
    let live = false; // a live HLS stream (no end): the sync follows play/pause only, see usePlaybackSync
    let recovers = 0;
    let recoverAt = 0;
    const stalled = () => !el.ended && el.readyState < 3 && (!el.paused || el.readyState < 1);
    const tick = setInterval(() => setBuf(stalled()), 250);
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
      hls = new Hls({ enableWorker: true, lowLatencyMode: false, capLevelToPlayerSize: true, maxBufferLength: 30, maxMaxBufferLength: 60, backBufferLength: 30, maxLiveSyncPlaybackRate: 1.05 });
      hls.on(Hls.Events.LEVEL_LOADED, (_e, d) => { if (d?.details?.live) live = true; });
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (!d.fatal) return;
        evRef.current.onError?.();
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
  }, [src, video.kind, playerRef, onFatal, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const sub = video.subtitle; // feat worker: the room's subtitle file; each viewer turns it on in the subtitles menu
  return (
    <video ref={ref} playsInline preload="auto" className="html-video" data-testid="html-video-player">
      {sub && <track key={sub.id} kind="subtitles" src={absUrl(sub.url)} label={sub.name.replace(/\.(srt|vtt)$/i, "")} srcLang="und" data-room-sub="1" />}
    </video>
  );
};

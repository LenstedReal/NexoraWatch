import { useEffect, useRef, useState } from "react";

// Facebook videos play in Facebook's official Embedded Video Player, driven through the JavaScript SDK
// (https://developers.facebook.com/docs/plugins/embedded-video-player/api): an fb-video element parsed by the SDK hands
// out a player instance on "xfbml.ready" with play / pause / seek / mute / unmute / getCurrentPosition / getDuration and
// the events startedPlaying, paused, finishedPlaying, startedBuffering, finishedBuffering, error.
// No app id is passed (the embed page's own SDK snippet has none). If the SDK or the player instance does not come up,
// a translated error is shown instead (a video that cannot be synced has no place in a watch-together room).
const SDK_VERSION = "v25.0";
const SDK_LOCALES = { tr: "tr_TR", en: "en_US", de: "de_DE" };
const INSTANCE_TIMEOUT_MS = 10000;
let sdk;

function loadFacebook(lang) {
  if (window.FB?.XFBML && window.FB?.Event) return Promise.resolve(window.FB);
  if (!sdk) {
    sdk = new Promise((resolve, reject) => {
      const fail = () => {
        sdk = null;
        reject(new Error("facebook_load"));
      };
      const prev = window.fbAsyncInit;
      window.fbAsyncInit = () => {
        try {
          window.FB.init({ xfbml: false, version: SDK_VERSION });
        } catch { /* already initialised */ }
        resolve(window.FB);
        if (typeof prev === "function") prev();
      };
      if (!document.getElementById("fb-root")) {
        const root = document.createElement("div");
        root.id = "fb-root";
        document.body.prepend(root);
      }
      const s = document.createElement("script");
      s.src = `https://connect.facebook.net/${SDK_LOCALES[lang] || "en_US"}/sdk.js`;
      s.async = true;
      s.defer = true;
      s.crossOrigin = "anonymous";
      s.onload = () => { if (window.FB?.XFBML) window.fbAsyncInit?.(); else setTimeout(() => (window.FB?.XFBML ? resolve(window.FB) : fail()), 3000); };
      s.onerror = fail;
      document.head.appendChild(s);
    });
  }
  return sdk;
}

let seq = 0;

// CSS zoom carries into the frame in Chrome / Android WebView 128+ (as for Twitch); elsewhere the frame is scaled.
const ZOOM = typeof window !== "undefined" && typeof window.CSS?.supports === "function" && window.CSS.supports("zoom", "0.5");
/** A CSS length in pixels ("412px", or a bare number as in width="412"); 0 for anything else (%, auto, empty). */
const px = (v) => {
  const m = /^(\d+(?:\.\d+)?)(?:px)?$/.exec(String(v ?? "").trim());
  return m ? Number(m[1]) : 0;
};
/** The scale that fits a w x h frame into a W x H area: never larger than the area; enlarged only with zoom. */
export function fbFit(W, H, w, h, zoom = ZOOM) {
  if (!(W > 0 && H > 0 && w > 0 && h > 0)) return 1;
  const s = Math.min(W / w, H / h);
  return Math.max(0.05, Math.min(zoom ? 4 : 1, s));
}

export const FacebookPlayer = ({ video, playerRef, events, onFatal, onFallback, onAspect, lang = "tr" }) => {
  const hostRef = useRef(null);
  const evRef = useRef(events);
  evRef.current = events;
  const aspectRef = useRef(onAspect);
  aspectRef.current = onAspect;
  const [fallback, setFallback] = useState(false);
  const href = video.href;

  useEffect(() => {
    if (fallback) return undefined;
    let cancelled = false;
    let FBref = null;
    let onXfbml = null;
    const tokens = [];
    const elId = `nx-fb-${++seq}`;
    const mount = document.createElement("div");
    mount.className = "fb-video";
    mount.id = elId;
    mount.setAttribute("data-href", href);
    mount.setAttribute("data-allowfullscreen", "true");
    mount.setAttribute("data-autoplay", "false");
    mount.setAttribute("data-show-text", "false");
    mount.setAttribute("data-show-captions", "false");
    // Facebook makes its player as tall as the video is for this width. A reel (9:16) gets the width that makes it
    // exactly as tall as the picture, so it shows whole and at its real size; anything else starts at the full width.
    const W = hostRef.current.clientWidth || 640;
    const H = hostRef.current.clientHeight || 360;
    const width = /\/reel\//i.test(href) ? Math.min(W, (H * 9) / 16) : W;
    mount.setAttribute("data-width", String(Math.max(220, Math.round(width))));
    hostRef.current.appendChild(mount);
    const st = { paused: true, buffering: false, waiters: [], inst: null };
    const settle = (ok) => { const w = st.waiters; st.waiters = []; w.forEach((f) => f(ok)); };
    const pos = () => {
      try {
        const v = Number(st.inst?.getCurrentPosition());
        return Number.isFinite(v) ? v : 0;
      } catch { return 0; }
    };
    const setBuffering = (on) => {
      if (st.buffering === on) return;
      st.buffering = on;
      evRef.current.onBuffering?.(on);
    };
    const giveUp = setTimeout(() => !cancelled && !st.inst && setFallback(true), INSTANCE_TIMEOUT_MS);

    const attach = (inst) => {
      st.inst = inst;
      const on = (ev, cb) => { try { const tk = inst.subscribe(ev, cb); if (tk) tokens.push(tk); } catch { /* old SDK */ } };
      on("startedPlaying", () => {
        const was = st.paused;
        st.paused = false;
        setBuffering(false);
        settle(true);
        if (was) evRef.current.onPlay?.();
      });
      on("paused", () => {
        const was = !st.paused;
        st.paused = true;
        setBuffering(false);
        if (was) evRef.current.onPause?.();
      });
      on("finishedPlaying", () => {
        st.paused = true;
        setBuffering(false);
        evRef.current.onPause?.();
      });
      on("startedBuffering", () => setBuffering(true));
      on("finishedBuffering", () => setBuffering(false));
      on("error", () => {
        if (cancelled) return;
        settle(false);
        evRef.current.onError?.();
        onFatal("facebook_embed");
      });
      playerRef.current = {
        ready: true, supportsRate: false, kind: "facebook",
        getTime: pos,
        getDuration: () => { try { return Number(inst.getDuration()) || undefined; } catch { return undefined; } },
        isPaused: () => st.paused,
        isBuffering: () => st.buffering,
        play: () => {
          if (!st.paused) return Promise.resolve();
          try { inst.play(); } catch { /* reported below as blocked */ }
          return new Promise((resolve, reject) => {
            let done = false;
            const finish = (ok) => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              if (ok) resolve();
              else reject(new Error("blocked"));
            };
            const timer = setTimeout(() => finish(!st.paused || st.buffering), 1500);
            st.waiters.push(finish);
          });
        },
        pause: () => { try { inst.pause(); } catch { /* noop */ } },
        seek: (s) => { if (Number.isFinite(s)) try { inst.seek(Math.max(0, s)); } catch { /* noop */ } },
        setRate: () => {},
        setMuted: (m) => { try { if (m) inst.mute(); else inst.unmute(); } catch { /* noop */ } },
      };
      evRef.current.onReady?.();
    };

    loadFacebook(lang)
      .then((FB) => {
        if (cancelled) return;
        FBref = FB;
        onXfbml = (msg) => {
          if (cancelled || st.inst || msg?.type !== "video" || msg?.id !== elId || !msg.instance) return;
          attach(msg.instance);
        };
        FB.Event.subscribe("xfbml.ready", onXfbml);
        FB.XFBML.parse(hostRef.current);
      })
      .catch(() => !cancelled && setFallback(true));
    return () => {
      cancelled = true;
      clearTimeout(giveUp);
      settle(false);
      tokens.forEach((tk) => { try { tk.release?.(); } catch { /* noop */ } });
      try { if (FBref && onXfbml) FBref.Event.unsubscribe("xfbml.ready", onXfbml); } catch { /* noop */ }
      if (playerRef.current?.kind === "facebook") playerRef.current = null;
      mount.remove();
    };
  }, [href, lang, fallback, playerRef, onFatal]);
  // Facebook draws its player as tall as the video is for the width it was given: a reel is almost twice as tall as wide,
  // and in a 16:9 picture only its upper part showed, enlarged. The frame is now fitted into the picture (zoom) and
  // centred, never cut (also in fullscreen and on a sideways phone), and the room learns the video's shape (a vertical
  // one gets a taller picture on an upright phone).
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return undefined;
    let shape = null;
    const fit = () => {
      const frame = host.querySelector("iframe");
      if (!frame) return;
      const w = px(frame.style.width) || px(frame.getAttribute("width"));
      const h = px(frame.style.height) || px(frame.getAttribute("height"));
      if (w < 10 || h < 10 || !host.clientWidth || !host.clientHeight) return;
      const s = fbFit(host.clientWidth, host.clientHeight, w, h);
      const z = Math.abs(s - 1) > 0.005 ? String(Math.floor(s * 1000) / 1000) : "";
      if (ZOOM) {
        if (frame.style.zoom !== z) frame.style.zoom = z;
      } else {
        const tr = z ? `scale(${z})` : "";
        if (frame.style.transform !== tr) frame.style.transform = tr;
      }
      const a = w / h;
      if (shape === null || Math.abs(a - shape) > 0.01) {
        shape = a;
        aspectRef.current?.(a);
      }
    };
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    // Facebook sets the frame's size (attributes and style) when its player knows the video.
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(fit);
    mo?.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["width", "height", "style"] });
    return () => {
      ro.disconnect();
      mo?.disconnect();
    };
  }, [fallback]);
  // Without Facebook's SDK the video could only play unsynced, which a watch-together room cannot use: show an error.
  useEffect(() => { if (fallback) { onFallback?.(); onFatal?.("facebook_sdk"); } }, [fallback, onFallback, onFatal]);
  if (fallback) return null;
  return <div ref={hostRef} className="yt-host fb-host" data-testid="facebook-player" />;
};

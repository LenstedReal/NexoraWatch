// Whether this page is out of sight: its tab is in the background, or the Nexora app itself went to the background
// (its WebView can stay "visible" there, so the app tells the page: window.__nexoraAppState, app 1.8.5+). A video in
// picture-in-picture is still in sight. usePlaybackSync needs it: when the host switches to TikTok to find the next
// video, the phone may pause the room's video, and that pause is not the host's.
let appAway = false;
let last = null;
const subs = new Set();

function inPip() {
  try {
    if (document.pictureInPictureElement) return true;
    for (const f of document.querySelectorAll("iframe")) {
      try {
        if (f.contentDocument?.pictureInPictureElement) return true; // our own no-Referer player frame
      } catch {
        /* another site's frame */
      }
    }
  } catch {
    /* no DOM */
  }
  return false;
}

export function isAway() {
  if (typeof document === "undefined") return false;
  return (document.visibilityState === "hidden" || appAway) && !inPip();
}

/** Calls fn(away) whenever the page goes out of sight or comes back. Returns the unsubscribe function. */
export function onAwayChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

function changed() {
  const now = isAway();
  if (now === last) return;
  last = now;
  subs.forEach((fn) => {
    try {
      fn(now);
    } catch {
      /* one listener must not stop the others */
    }
  });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  last = isAway();
  window.__nexoraAppState = (state) => {
    appAway = state === "background";
    changed();
  };
  document.addEventListener("visibilitychange", changed);
  document.addEventListener("enterpictureinpicture", changed, true);
  document.addEventListener("leavepictureinpicture", changed, true);
}

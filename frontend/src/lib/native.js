// Bridge to the Nexora Watch mobile app. The Android/iOS app shows this same web app in a WebView and injects
// window.__NEXORA_APP__ before the page loads; native-only features (site browser with video detection,
// screen rotation) are reached through postMessage.
export const inApp = () => typeof window !== "undefined" && !!window.__NEXORA_APP__ && !!window.ReactNativeWebView;

export const appInfo = () => (inApp() ? window.__NEXORA_APP__ : null);

export function postNative(msg) {
  if (!inApp()) return false;
  try {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

/** Opens the app's site browser. What the person picks there arrives through onNativePick. */
export const openNativeBrowser = () => postNative({ type: "open_browser", room: window.location.pathname });

/**
 * Calls `fn({url, referer, title})` for every video picked in the app's site browser. The room listens for as long as
 * it is open, not only while a button waits: a heavy site can make Android reload this page while the browser is on
 * top, and the pick made afterwards must still reach the room. "pick_ready" asks the app for a pick it could not
 * deliver, "pick_ack" tells it that one arrived (app 1.8.1+; older apps ignore both and simply call the function).
 * A pick made for another room (the person moved on meanwhile) is dropped.
 */
export function onNativePick(fn) {
  if (!inApp()) return () => {};
  const here = () => window.location.pathname.toUpperCase();
  const mine = (res) => {
    postNative({ type: "pick_ack" });
    if (!res || !res.url) return;
    if (typeof res.room === "string" && res.room && res.room.toUpperCase() !== here()) return;
    fn(res);
  };
  window.__nexoraPick = mine;
  postNative({ type: "pick_ready", room: window.location.pathname });
  return () => { if (window.__nexoraPick === mine) window.__nexoraPick = undefined; };
}

/**
 * Opens an address outside the app, in the phone's browser; in a normal browser it opens a new tab. Returns false when
 * this app version cannot do it (older versions keep our own address inside the app): the caller then offers the address
 * another way.
 */
export function openExternal(url) {
  if (!inApp()) {
    window.open(url, "_blank", "noopener");
    return true;
  }
  if (!appInfo()?.caps?.includes("open_external")) return false;
  return postNative({ type: "open_external", url });
}

export const setOrientation = (mode) => postNative({ type: "orientation", mode }); // "landscape" | "portrait"
export const setKeepAwake = (on) => postNative({ type: "keep_awake", on: !!on });

/** Asks the app for notification permission and lets it send its push token for this device. Resolves with
 * {ok, reason?}; outside the app (or an older app version without "push") resolves {ok:false, reason:"no_app"}. */
export function enableAppPush(device) {
  return new Promise((resolve) => {
    if (!appInfo()?.caps?.includes("push")) return resolve({ ok: false, reason: "no_app" });
    const prev = window.__nexoraPush;
    // An app that never answers (permission dialog dismissed, old build) must not leave the switch hanging.
    const timer = setTimeout(() => { window.__nexoraPush = prev; resolve({ ok: false, reason: "timeout" }); }, 20000);
    window.__nexoraPush = (res) => {
      clearTimeout(timer);
      window.__nexoraPush = prev;
      resolve(res || { ok: false });
    };
    if (!postNative({ type: "push_enable", device_id: device.id, key: device.key, origin: window.location.origin })) {
      window.__nexoraPush = prev;
      resolve({ ok: false, reason: "no_app" });
    }
  });
}
export const canAppPush = () => !!appInfo()?.caps?.includes("push");

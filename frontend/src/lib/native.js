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

/** App 1.8.5+ shows what became of a pick itself (in its site browser, or as a phone toast for Share → Nexora). */
export const appShowsPickResult = () => !!appInfo()?.caps?.includes("pick_result");

// Picks handled by this page, by id, for 10 minutes (sessionStorage: it outlives a reload). The app sends every pick
// it has no answer for again when the room page asks (pick_ready), and a handled one must not be added twice; what
// became of it is kept, so the app hears it again, and so is the queue item a "Play now" refers to.
const PICKS_KEY = "nx:picks";
const PICKS_MS = 10 * 60 * 1000;
const pickMem = new Map(); // the same in memory, for browsers without storage

function picksSeen() {
  const now = Date.now();
  let all = {};
  try {
    all = JSON.parse(sessionStorage.getItem(PICKS_KEY) || "{}") || {};
  } catch {
    all = {};
  }
  pickMem.forEach((v, k) => { if (!all[k]) all[k] = v; });
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v && typeof v.at === "number" && now - v.at < PICKS_MS));
}

/** What this page knows about a pick: {at, result?, item?} or null. */
export const pickMemory = (id) => (id ? picksSeen()[id] || null : null);

export function rememberPick(id, patch) {
  if (!id) return;
  const all = picksSeen();
  const next = { ...(all[id] || {}), ...patch, at: all[id]?.at || Date.now() };
  all[id] = next;
  pickMem.set(id, next);
  try {
    sessionStorage.setItem(PICKS_KEY, JSON.stringify(all));
  } catch {
    /* storage disabled: this page's memory only */
  }
}

/** Tells the app what became of the pick `id`: {ok, queued, can_play_now, title} or {ok:false, error}. */
export function reportPick(id, result) {
  if (!id) return;
  rememberPick(id, { result });
  if (appShowsPickResult()) postNative({ type: "pick_result", id, ...result });
}

/**
 * Calls `fn({id?, url, referer, title, source?})` for every video picked in the app's site browser or shared to the
 * app. The room listens for as long as it is open, not only while a button waits: a heavy site can make Android
 * reload this page while the browser is on top, and a pick made afterwards must still reach the room. "pick_ready"
 * asks the app for picks it could not deliver, "pick_ack" tells it that one arrived (app 1.8.1+; older apps ignore
 * both and simply call the function; app 1.8.5+ numbers its picks and the ack names the number). A pick made for
 * another room (the person moved on meanwhile) is dropped; one with an id seen before is not added again.
 */
export function onNativePick(fn) {
  if (!inApp()) return () => {};
  const here = () => window.location.pathname.toUpperCase();
  const mine = (res) => {
    const id = res && typeof res.id === "string" && res.id ? res.id : "";
    postNative(id ? { type: "pick_ack", id } : { type: "pick_ack" });
    if (!res || !res.url) return;
    if (typeof res.room === "string" && res.room && res.room.toUpperCase() !== here()) return;
    if (id) {
      const before = pickMemory(id);
      if (before) {
        // Handled before this page reloaded: the app hears the answer again, nothing is added twice.
        if (before.result) reportPick(id, before.result);
        return;
      }
      rememberPick(id, {});
    }
    fn(res);
  };
  window.__nexoraPick = mine;
  postNative({ type: "pick_ready", room: window.location.pathname });
  return () => { if (window.__nexoraPick === mine) window.__nexoraPick = undefined; };
}

/** App 1.8.5+: the host tapped "Şimdi oynat" on a queued pick in the app; `fn(id)` plays it and reports the result. */
export function onNativePlayNow(fn) {
  if (!inApp()) return () => {};
  const mine = (id) => { if (typeof id === "string" && id) fn(id); };
  window.__nexoraPlayNow = mine;
  return () => { if (window.__nexoraPlayNow === mine) window.__nexoraPlayNow = undefined; };
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

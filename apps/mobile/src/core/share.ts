// Share → Nexora (Android): a link shared from another app (TikTok, YouTube, X, Reddit, Facebook, Kick, Twitch…)
// reaches the app as nexora://share?text=<what was shared> (plugins/withShareIntent.js rewrites the Android intent so
// React Native's Linking delivers it). Plain helpers, no React / React Native imports: unit-tested with plain Node.

export const SHARE_LINK = "nexora://share";

/** Is this deep link a share (rather than a room link)? */
export function isShareLink(link: string | null | undefined): boolean {
  return typeof link === "string" && /^nexora:\/\/share(?:[/?#]|$)/i.test(link);
}

/** The shared text inside nexora://share?text=…, or null. */
export function shareText(link: string | null | undefined): string | null {
  if (!isShareLink(link)) return null;
  const q = String(link).split("#")[0].split("?").slice(1).join("?");
  for (const part of q.split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq) !== "text") continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).replace(/\+/g, "%20"));
    } catch {
      return null;
    }
  }
  return null;
}

/** The first web address in a shared text ("Check this out https://vm.tiktok.com/ZM…/ #fyp"), or null. */
export function firstUrl(text: string | null | undefined): string | null {
  const m = String(text || "").match(/https?:\/\/[^\s<>"'“”‘’«»]+/i);
  if (!m) return null;
  let url = m[0];
  // Punctuation that ends a sentence is not part of the address; a closing bracket only when it opens nowhere.
  for (;;) {
    const last = url.slice(-1);
    if (/[.,;:!?…]/.test(last)) url = url.slice(0, -1);
    else if (last === ")" && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) url = url.slice(0, -1);
    else break;
  }
  return /^https?:\/\/[^/?#\s]+\.[^/?#\s]+/i.test(url) ? url : null;
}

function parse(url: string): { host: string; path: string; query: string } | null {
  const m = url.match(/^https?:\/\/([^/?#:]+)(?::\d+)?([^?#]*)(\?[^#]*)?/i);
  return m ? { host: m[1].toLowerCase(), path: m[2] || "/", query: (m[3] || "").slice(1) } : null;
}

const FB_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "mbasic.facebook.com"]);

/** A link the Facebook app gives with "Copy link" / "Share": fb.watch/… or facebook.com/share/v|r/…. */
export function isFacebookShareLink(url: string | null | undefined): boolean {
  const p = parse(String(url || ""));
  if (!p) return false;
  if (p.host === "fb.watch" || p.host === "www.fb.watch") return /^\/[\w-]{4,40}\/?$/.test(p.path);
  return FB_HOSTS.has(p.host) && /^\/share\/(?:v|r)\/[A-Za-z0-9]{4,30}\/?$/.test(p.path);
}

/**
 * Where a Facebook share link led: its video's own address (watch?v=, /<page>/videos/<id>, /reel/<id>), or null.
 * A login page that names the video in ?next= counts too.
 */
export function facebookVideoUrl(url: string | null | undefined, depth = 0): string | null {
  const p = parse(String(url || ""));
  if (!p || !FB_HOSTS.has(p.host)) return null;
  const params = new Map<string, string>();
  for (const part of p.query.split("&")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    try {
      params.set(part.slice(0, eq), decodeURIComponent(part.slice(eq + 1).replace(/\+/g, "%20")));
    } catch {
      /* not a valid parameter */
    }
  }
  if (/^\/watch\/?$/.test(p.path) || /^\/video\.php$/.test(p.path)) {
    const v = params.get("v") || "";
    return /^\d{6,20}$/.test(v) ? `https://www.facebook.com/watch/?v=${v}` : null;
  }
  const vid = p.path.match(/^\/([A-Za-z0-9.-]{1,80})\/videos\/(?:[^/]{1,200}\/)?(\d{6,20})\/?$/);
  if (vid) return `https://www.facebook.com/${vid[1]}/videos/${vid[2]}/`;
  const reel = p.path.match(/^\/reel\/(\d{6,20})\/?$/);
  if (reel) return `https://www.facebook.com/reel/${reel[1]}`;
  const next = params.get("next");
  if (depth === 0 && next && /^\/(?:login|login\.php|checkpoint)\b/.test(p.path)) return facebookVideoUrl(next, 1);
  return null;
}

/**
 * The site browser presents itself as Chrome, not as an app's WebView: sites like TikTok show their "open the app"
 * walls to WebViews. Android WebView's user agent minus what only a WebView carries ("; wv", "Version/4.0") and our
 * own app token. Null when it does not look like an Android Chrome/WebView agent (then the default stays).
 */
export function cleanUserAgent(ua: string | null | undefined): string | null {
  const s = String(ua || "");
  if (!/\bChrome\/\d+/.test(s) || !/\bAndroid\b/.test(s)) return null;
  const out = s
    .replace(/;\s*wv\)/, ")")
    .replace(/\s+Version\/4\.0\b/, "")
    .replace(/\s+NexoraWatchApp\/\S*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return out || null;
}

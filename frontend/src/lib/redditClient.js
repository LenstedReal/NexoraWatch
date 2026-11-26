// Reddit sometimes refuses our server (its bot checks) a post that opens for anyone's own browser. Then this browser
// reads the post's public data itself and the room gets Reddit's own HLS playlist (v.redd.it): the same address the
// app's site browser finds on the page. Only that address goes to our server, which checks it like any other link.
const HOSTS = new Set(["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com", "m.reddit.com", "np.reddit.com"]);
const POST = /^\/(?:r\/[A-Za-z0-9_]{2,21}\/)?comments\/([a-z0-9]{4,10})(?:\/|$)/i;
const SHARE = /^\/r\/[A-Za-z0-9_]{2,21}\/s\/[A-Za-z0-9]{6,20}\/?$/;
const SHORT = /^\/([a-z0-9]{4,10})\/?$/i;
const TIMEOUT_MS = 8000;

async function get(url, json) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { credentials: "omit", redirect: "follow", signal: ctl.signal, headers: json ? { Accept: "application/json" } : undefined });
    if (!r.ok) throw new Error(`reddit_http_${r.status}`);
    return r;
  } finally {
    clearTimeout(timer);
  }
}

const idIn = (u) => (HOSTS.has(u.hostname.toLowerCase()) ? POST.exec(u.pathname)?.[1]?.toLowerCase() || null : null);

/** The post id of a Reddit link (a share link is followed to its post); null when the link is not a Reddit post. */
async function postId(link) {
  let u;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host === "redd.it" || host === "www.redd.it") return SHORT.exec(u.pathname)?.[1]?.toLowerCase() || null;
  if (!HOSTS.has(host)) return null;
  const id = idIn(u);
  if (id || !SHARE.test(u.pathname)) return id;
  const r = await get(u.href, false); // a share link (/r/<sub>/s/<code>) redirects to the post
  try {
    return idIn(new URL(r.url));
  } catch {
    return null;
  }
}

const videoOf = (d) => d?.secure_media?.reddit_video || d?.media?.reddit_video || null;

/** {hls, page, title} of a Reddit post whose video is on Reddit; throws when this browser cannot read it. */
export async function redditFromBrowser(link) {
  const id = await postId(link);
  if (!id) throw new Error("reddit_not_a_post");
  const r = await get(`https://www.reddit.com/comments/${id}.json?raw_json=1`, true);
  const data = await r.json();
  const post = Array.isArray(data) ? data[0]?.data?.children?.[0]?.data : null;
  if (!post) throw new Error("reddit_no_post");
  const cross = Array.isArray(post.crosspost_parent_list) ? post.crosspost_parent_list[0] : null;
  const hls = String(videoOf(post)?.hls_url || videoOf(cross)?.hls_url || "");
  let host = "";
  try {
    host = new URL(hls).hostname.toLowerCase();
  } catch {
    /* no playlist */
  }
  if (host !== "v.redd.it") throw new Error("reddit_no_video");
  const permalink = typeof post.permalink === "string" && post.permalink.startsWith("/") ? post.permalink : `/comments/${id}/`;
  return { hls, page: `https://www.reddit.com${permalink}`, title: typeof post.title === "string" && post.title ? post.title.slice(0, 200) : null };
}

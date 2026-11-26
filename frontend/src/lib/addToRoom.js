import { api } from "@/lib/api";
import { redditFromBrowser } from "@/lib/redditClient";

// Videos found while browsing come one after another (the app's site browser, Share → Nexora, the web's "Sitelerde
// gez"): the first one plays when the room has nothing on, the next ones wait in the queue and start by themselves
// when the video before them ends (useQueueAutoNext; one that already ended is followed within a second). The host
// can still play a queued one at once (playQueued). The link field's "Ayarla" is not this: it always plays its link.
//
// Returns {queued, canPlayNow, itemId, title, room}: room is the room after setVideo (the caller applies it).
export async function addToRoom({ code, ident, isHost, hasVideo, url, extra }) {
  const now = isHost && !hasVideo;
  const send = (u, x) => (now ? api.setVideo(code, ident, u, x) : api.queueAdd(code, ident, u, x));
  let used = url;
  let res;
  try {
    res = await send(url, extra);
  } catch (ex) {
    // Reddit refused our server this post: this browser reads it (redditClient.js) and sends Reddit's own playlist.
    if (ex?.code !== "reddit_app_only") throw ex;
    const post = await redditFromBrowser(url).catch(() => null);
    if (!post) throw ex;
    used = post.hls;
    res = await send(post.hls, { ...(extra || {}), referer: post.page, title: extra?.title || post.title || undefined });
  }
  if (now) return { queued: false, canPlayNow: false, itemId: null, title: res?.video?.title || null, room: res || null };
  const items = Array.isArray(res?.queue) ? res.queue : [];
  const item = (res?.item_id && items.find((i) => i.id === res.item_id)) || items.find((i) => i.url === used) || null;
  const itemId = res?.item_id || item?.id || null;
  return { queued: true, canPlayNow: !!isHost && !!itemId, itemId, title: item?.title || null, room: null };
}

/** Host: the queued item plays now. Returns the room; throws queue_item_not_found when it is no longer queued. */
export async function playQueued({ code, ident, itemId }) {
  const res = await api.queueNext(code, ident, { item_id: itemId });
  if (!res?.played) {
    const e = new Error("queue_item_not_found");
    e.code = "queue_item_not_found";
    throw e;
  }
  return res.room;
}

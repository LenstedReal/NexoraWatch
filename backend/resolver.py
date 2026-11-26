import asyncio
import ipaddress
import math
import re
import socket
import json
import time
from html import unescape as html_unescape
from urllib.parse import parse_qsl, quote, unquote, urlencode, urljoin, urlparse, urlunparse

import httpx

from security import ApiError
import config
import services

YT_RE = re.compile(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|live/)|youtu\.be/|youtube-nocookie\.com/embed/)([\w-]{11})")
DRIVE_RE = re.compile(r"drive\.google\.com/(?:file/d/|open\?id=|uc\?(?:.*&)?id=)([\w-]{20,})")
DIRECT_EXT = re.compile(r"\.(mp4|webm|mov|m4v)(?:$|[?#])", re.I)
HLS_EXT = re.compile(r"\.m3u8(?:$|[?#])", re.I)

FULL_CAPS = {"seek": True, "rate_correction": True, "sync": True}
# Official embedded players (YouTube, Vimeo, Twitch, TikTok, Facebook): position sync by seeking, no playback-rate nudging.
EMBED_CAPS = {"seek": True, "rate_correction": False, "sync": True}
LIVE_CAPS = {"seek": False, "rate_correction": False, "sync": False}
# Embeds without a JavaScript API (Instagram, X): everyone sees the same post, nobody can be kept in sync.
NOSYNC_CAPS = LIVE_CAPS

# --- Vimeo: official Player SDK (https://github.com/vimeo/player.js). Only URL shapes that carry the numeric id. -------
VIMEO_HOSTS = {"vimeo.com", "www.vimeo.com", "player.vimeo.com"}
VIMEO_PATH = re.compile(
    r"^/(?:video/|channels/[\w-]+/|groups/[\w-]+/videos/|album/\d+/video/|showcase/\d+/video/)?(\d{6,12})(?:/([0-9a-f]{6,16}))?/?$", re.I)
VIMEO_HASH = re.compile(r"^[0-9a-f]{6,16}$", re.I)

# --- Twitch: official interactive embed (https://dev.twitch.tv/docs/embed/video-and-clips/). ----------------------------
TWITCH_HOSTS = {"twitch.tv", "www.twitch.tv", "m.twitch.tv", "go.twitch.tv"}
TWITCH_VOD = re.compile(r"^/(?:videos|([A-Za-z0-9_]{3,25})/(?:v|video))/(\d{6,12})/?$")
TWITCH_CHANNEL = re.compile(r"^/([A-Za-z0-9][A-Za-z0-9_]{2,24})/?$")
TWITCH_CLIP = re.compile(r"^/[A-Za-z0-9_]{3,25}/clip/[\w-]+/?$")
# First path segments that are pages of the site, not channels.
TWITCH_RESERVED = {"directory", "videos", "settings", "downloads", "search", "subscriptions", "wallet", "turbo", "store", "jobs",
                   "privacy", "legal", "about", "friends", "inventory", "drops", "prime", "team", "teams", "user", "collections",
                   "popout", "moderator", "embed", "login", "signup", "following", "broadcast", "partner", "creatorcamp", "bits",
                   "payments", "messages", "activate", "annual-recap", "events", "clips", "category", "security", "safety", "ads"}

# Live channels (Twitch, Kick): everyone watches live; the room follows play / pause, each player stays at the live edge.
LIVE_SYNC_CAPS = {"seek": False, "rate_correction": False, "sync": True}

# --- Kick: a live channel, recording or clip plays the HLS playlist Kick's own player plays (Kick's site API names it),
# in Nexora's player (the room follows play / pause). When that cannot be done for a live channel (Kick refuses our
# server, or its stream server does not open the playlist to other sites) the channel plays in Kick's official embed
# (player.kick.com/<channel>, https://help.kick.com/en/articles/8010826-how-to-embed-your-kick-livestream): everyone
# watches it live and the room still follows play / pause (KickPlayer: a pause takes the stream away on every phone,
# play brings everyone back to the live edge).
KICK_HOSTS = {"kick.com", "www.kick.com", "m.kick.com"}
KICK_CHANNEL = re.compile(r"^/([A-Za-z0-9][A-Za-z0-9_-]{2,39})/?$")
KICK_VIDEO = re.compile(r"^/(?:video/|[A-Za-z0-9][A-Za-z0-9_-]{2,39}/videos?/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/?$", re.I)
KICK_CLIP_PATH = re.compile(r"^/[A-Za-z0-9][A-Za-z0-9_-]{2,39}/clips?/(clip_[A-Za-z0-9]{10,40})/?$")
KICK_CLIP_ID = re.compile(r"^clip_[A-Za-z0-9]{10,40}$")
KICK_TIMEOUT = 8
KICK_MAX_BYTES = 2 * 1024 * 1024
KICK_APP_ONLY = "Kick bu bağlantıyı sunucumuza açmıyor; yayını uygulamadaki Sitelerde gez ve video bul ile ekle"

# --- Reddit: a post's video is Reddit's own HLS playlist (v.redd.it/<id>/HLSPlaylist.m3u8), read from the post's public
# data (www.reddit.com/comments/<id>.json). There is no key to ask with: Reddit closed self-service API access in
# November 2025 and stopped taking new Data API requests on 31 October 2026. When Reddit refuses the server, the app's
# browser finds the playlist in the page itself (docs/BEKLEYENLER.md).
REDDIT_HOSTS = {"reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com", "m.reddit.com", "np.reddit.com"}
REDDIT_POST = re.compile(r"^/(?:r/[A-Za-z0-9_]{2,21}/)?comments/([a-z0-9]{4,10})(?:/|$)", re.I)
REDDIT_SHARE = re.compile(r"^/r/[A-Za-z0-9_]{2,21}/s/[A-Za-z0-9]{6,20}/?$")
REDDIT_SHORT = re.compile(r"^/([a-z0-9]{4,10})/?$", re.I)
REDDIT_TIMEOUT = 8
REDDIT_MAX_BYTES = 4 * 1024 * 1024
REDDIT_UA = "web:nexora-watch:1.8 (by /u/nexorawatch)"
REDDIT_APP_ONLY = "Reddit bu gönderinin bilgisini sunucumuza vermedi; videoyu uygulamadaki Sitelerde gez ve video bul ile ekle"

KICK_RESERVED = {"browse", "categories", "category", "following", "dashboard", "video", "videos", "clips", "search", "settings",
                 "about", "terms-of-service", "privacy-policy", "community-guidelines", "dmca-policy", "careers", "help",
                 "login", "signup", "auth", "api", "popout", "transactions", "subscriptions", "messages", "creator-program",
                 "leaderboards", "emotes", "store", "download", "apps", "mobile", "contact", "partners", "security"}

# --- Internet Archive: a details page becomes one of its video files, chosen from the item's metadata
# (https://archive.org/developers/md-read.html). Files are linked as archive.org/download/<id>/<file>: "A particular
# file can always be downloaded from" there, while the data server it redirects to "is not a permalink"
# (https://archive.org/developers/items.html).
IA_HOSTS = {"archive.org", "www.archive.org"}
IA_PAGE = re.compile(r"^/(?:details|embed)/([A-Za-z0-9][A-Za-z0-9._-]{0,99})(?:/(.+?))?/?$")
IA_VIDEO = re.compile(r"\.(mp4|m4v|webm|mov)$", re.I)
# Browser-friendly first: the archive's own H.264 copies, then MPEG-4 originals, then anything else that is a video file.
IA_FORMATS = ["h.264", "h.264 hd", "mpeg4", "h.264 ia", "512kb mpeg4", "webm"]
IA_MAX_METADATA = 4 * 1024 * 1024

# --- Dropbox: a share link becomes a direct file with raw=1 (https://help.dropbox.com/share/force-download). -----------
DROPBOX_HOSTS = {"dropbox.com", "www.dropbox.com"}
DROPBOX_PATH = re.compile(r"^/(?:s|scl/fi)/[^/]+/[^/]+", re.I)

# --- TikTok: official Embed Player, an iframe of www.tiktok.com/player/v1/<id> driven by postMessage (play / pause /
# seekTo, onCurrentTime / onStateChange events: https://developers.tiktok.com/doc/embed-player). Short share links
# (vm./vt.tiktok.com, tiktok.com/t/...) are looked up with the official oEmbed API (https://developers.tiktok.com/doc/embed-videos).
TIKTOK_HOSTS = {"tiktok.com", "www.tiktok.com", "m.tiktok.com"}
TIKTOK_SHORT_HOSTS = {"vm.tiktok.com", "vt.tiktok.com"}
# group 1: author, 2: "video" / "photo", 3: the id
TIKTOK_PATH = re.compile(r"^/(?:@([\w.-]{1,40})/(video|photo)/|embed/(?:v2/)?|player/v1/|v/)(\d{15,21})(?:\.html)?/?$")
TIKTOK_UNAVAILABLE = ("TikTok bu videonun başka yerlerde oynatılmasına izin vermiyor (gizli, silinmiş ya da paylaşımı kapalı); "
                      "başka bir video dene")
TIKTOK_PHOTO = "Bu bir TikTok fotoğraf gönderisi; TikTok'un oynatıcısı yalnızca videoları açar"
_tiktok_cache: dict = {}  # video id -> (expires at, caption or ApiError)
TIKTOK_SHORT_PATH = re.compile(r"^/(?:t/)?[A-Za-z0-9]{5,20}/?$")
TIKTOK_OEMBED = "https://www.tiktok.com/oembed?url="
TIKTOK_ID = re.compile(r"^\d{15,21}$")

# --- Instagram: official post / reel embed (www.instagram.com/p/<code>/embed). No JavaScript control: no sync. ---------
IG_HOSTS = {"instagram.com", "www.instagram.com", "m.instagram.com"}
IG_PATH = re.compile(r"^/(?:[A-Za-z0-9_.]{1,30}/)?(p|reels?|tv)/([A-Za-z0-9_-]{5,40})(?:/embed(?:/captioned)?)?/?$")

# --- X / Twitter: a post's video plays in Nexora's own player, in sync, on the web and in the app alike. X's embed cannot
# be synced; its video file is read from the data X's own embedded-post widget loads (the syndication endpoint, the
# same one Vercel's react-tweet library uses): https://cdn.syndication.twimg.com/tweet-result?id=<id>&token=<token>.
X_HOSTS = {"x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com", "m.twitter.com"}
X_PATH = re.compile(r"^/(?:[A-Za-z0-9_]{1,15}|i(?:/web)?)/status(?:es)?/(\d{5,20})(?:/(?:video|photo)/\d)?/?$")
X_SYNDICATION = "https://cdn.syndication.twimg.com/tweet-result"
X_VIDEO_HOSTS = {"video.twimg.com"}
X_MAX_BITRATE = 2_500_000  # about 720p: enough for a phone, light enough to stay in sync
X_TIMEOUT = 8
X_MAX_BYTES = 2 * 1024 * 1024
_x_cache: dict = {}  # post id -> (expires at, result or ApiError)
X_CACHE_MAX = 500

# --- Facebook: official Embedded Video Player (https://developers.facebook.com/docs/plugins/embedded-video-player/api):
# the JS SDK's fb-video with play / pause / seek / getCurrentPosition and events. Facebook's app copies share links
# (fb.watch/…, facebook.com/share/v|r|p/…): the address they lead to is asked from Facebook the way a browser opening
# the link would (its redirect, or the og:url / canonical address of the page), then the official player plays it.
FB_HOSTS = {"facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "mbasic.facebook.com"}
FB_SHORT_HOSTS = {"fb.watch", "www.fb.watch"}
FB_WATCH_PATHS = {"/watch", "/watch/", "/video.php", "/video/video.php", "/watch/live", "/watch/live/"}
FB_VIDEOS = re.compile(r"^/([A-Za-z0-9.\-]{1,80})/videos/(?:[^/]{1,200}/)?(\d{6,20})/?$")
FB_REEL = re.compile(r"^/reel/(\d{6,20})/?$")
FB_SHARE = re.compile(r"^/share/(?:v|r)/[A-Za-z0-9]{4,30}/?$")
FB_SHARE_ANY = re.compile(r"^/share/(?:v|r|p)/[A-Za-z0-9]{4,30}/?$")  # p = a post: expanded too, kept only when it is a video
FB_SHORT_TEXT = "Facebook bu paylaşım bağlantısını açmadı; videoyu Facebook'ta açıp tam bağlantısını kopyala"
FB_TAG = re.compile(r"<(?:meta|link)\b[^>]{0,600}>", re.I)
FB_ATTR = re.compile(r"""([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')""")
FB_EXPAND_TTL = 3600
FB_EXPAND_MAX = 500
_fb_cache: dict = {}  # share link -> (expires at, video address or None)


async def _assert_public(host: str):
    if not host or host.lower() in {"localhost", "metadata.google.internal"}:
        raise ApiError(400, "invalid_url", "Bu adres kullanılamaz")
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None)
    except socket.gaierror:
        raise ApiError(422, "network", "Sunucu adı çözümlenemedi")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ApiError(400, "invalid_url", "Özel ağ adresleri desteklenmez")


async def _guard(request: httpx.Request):
    await _assert_public(request.url.host)


# What a phone's browser sends when the room page plays a file (Chrome on Android): the room's viewers are asked for
# exactly like this, so a CDN that treats browsers differently from servers answers here as it will answer them.
BROWSER_UA = "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"


async def _probe(url: str, referer: str | None = None, origin: str | None = None, ranged: bool = True,
                 browser: bool = False) -> dict:
    headers = {"User-Agent": "NexoraWatch/1.0"}
    if browser:  # <video> (no CORS) or hls.js (CORS) on the room page, a cross-site request
        headers = {"User-Agent": BROWSER_UA, "Accept": "*/*", "Sec-Fetch-Site": "cross-site",
                   "Sec-Fetch-Mode": "cors" if origin else "no-cors", "Sec-Fetch-Dest": "empty" if origin else "video"}
        if not origin:
            headers["Accept-Encoding"] = "identity;q=1, *;q=0"
    if ranged:
        headers["Range"] = "bytes=0-2047"
    if referer:
        headers["Referer"] = referer
    if origin:
        headers["Origin"] = origin
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=8, max_redirects=5, event_hooks={"request": [_guard]}) as c:
            async with c.stream("GET", url, headers=headers) as r:
                head = b""
                async for chunk in r.aiter_bytes():
                    head += chunk
                    if len(head) >= 2048:
                        break
                return {"status": r.status_code, "ctype": r.headers.get("content-type", "").split(";")[0].lower(),
                        "headers": r.headers, "head": head[:2048], "final_url": str(r.url)}
    except ApiError:
        raise
    except httpx.TimeoutException:
        raise ApiError(422, "network", "Kaynak zaman aşımına uğradı")
    except httpx.HTTPError:
        raise ApiError(422, "network", "Kaynağa ulaşılamadı")


MIN_VIDEO_BYTES = 64 * 1024  # smaller "videos" are pieces of a stream (fMP4 init segments): nothing to watch


def _total_size(p: dict) -> int | None:
    """The whole file's size: from Content-Range (206), or Content-Length when the server ignored the Range (200)."""
    cr = p["headers"].get("content-range", "")
    if "/" in cr and cr.rsplit("/", 1)[1].isdigit():
        return int(cr.rsplit("/", 1)[1])
    cl = p["headers"].get("content-length", "")
    return int(cl) if p["status"] == 200 and cl.isdigit() else None


def _http_errors(p: dict):
    s = p["status"]
    if s in (401, 403):
        raise ApiError(422, "forbidden", f"Kaynak erişim izni vermiyor (HTTP {s})")
    if s in (404, 410):
        raise ApiError(422, "not_found", f"Kaynak bulunamadı (HTTP {s})")
    if s >= 400:
        raise ApiError(422, "http_error", f"Kaynak hata döndürdü (HTTP {s})")


def _classify(url: str, p: dict, provider: str) -> dict | None:
    head = p["head"].lstrip()
    if head.startswith(b"#EXTM3U") or "mpegurl" in p["ctype"]:
        if not head.startswith(b"#EXTM3U"):
            raise ApiError(422, "manifest_invalid", "HLS manifesti geçersiz")
        return {"kind": "hls", "stream_url": p["final_url"], "mime_type": "application/vnd.apple.mpegurl",
                "provider": provider, "capabilities": FULL_CAPS, "range_support": None}
    is_video = p["ctype"].startswith("video/") or (p["ctype"] in ("application/octet-stream", "binary/octet-stream") and DIRECT_EXT.search(url))
    if is_video:
        ranged = p["status"] == 206 or p["headers"].get("accept-ranges", "").lower() == "bytes"
        total = None
        cr = p["headers"].get("content-range", "")
        if "/" in cr and cr.rsplit("/", 1)[1].isdigit():
            total = int(cr.rsplit("/", 1)[1])
        return {"kind": "direct", "stream_url": p["final_url"], "mime_type": p["ctype"] or "video/mp4", "provider": provider,
                "capabilities": {**FULL_CAPS, "seek": ranged}, "range_support": ranged, "size": total,
                "warning": None if ranged else "Sunucu HTTP Range desteklemiyor; ileri/geri sarma güvenilir olmayabilir",
                "warning_code": None if ranged else "no_range"}
    return None


# --- A file found by the app's browser: can the room's other devices open it? ------------------------------------
# The phone that found it played it as the site's own page does (that site as Referer, its cookies). Everyone else
# plays it from the room page, a request from our own address:
#   MP4 (<video>, no CORS): the file must not be locked with Cross-Origin-Resource-Policy (Instagram's CDN is)
#   HLS (hls.js reads with XHR): CORS must allow us, for the playlist and for what it points to (renditions, segments)
# The server asks the same way, from another network, so a file locked to the site, to the finder's connection or to
# a short session is refused here instead of failing on everyone's screen in the room.
# Some CDNs refuse a file when another site's page asks for it (the Referer) but open it to a request without one, as
# when the address is opened directly: X's video.twimg.com does. Such a file is played from a frame that sends no
# Referer ("referrer_policy": "no-referrer", see HtmlPlayer); a file refused both ways is refused here.
SOURCE_LOCKED = "Bu site videosunu yalnızca kendi sayfasında oynatıyor; odadaki diğer cihazlar açamaz"


def _open_to_us(p: dict, cors: bool, origin: str) -> bool:
    if p["status"] >= 400:
        return False
    h = p["headers"]
    if cors:
        return h.get("access-control-allow-origin", "").strip().rstrip("/") in ("*", origin)
    return h.get("cross-origin-resource-policy", "").strip().lower() not in ("same-origin", "same-site")


def _first_uri(head: bytes, base: str) -> str | None:
    """The first rendition (master playlist) or segment (media playlist) an HLS playlist points to."""
    for line in head.decode("utf-8", "replace").splitlines()[1:]:
        line = line.strip()
        if line and not line.startswith("#"):
            u = urljoin(base, line)
            return u if urlparse(u).scheme in ("http", "https") else None
    return None


async def _room_probe(url: str, origin: str, cors: bool, referrer: bool = True) -> dict | None:
    """The request a viewer's browser makes from the room page (None: no answer in time, which refuses nothing)."""
    try:
        return await _probe(url, f"{origin}/" if referrer else None, origin=origin if cors else None,
                            ranged=not HLS_EXT.search(url), browser=True)
    except ApiError as e:
        if e.code == "network":  # a slow answer right after a good one: not a reason to refuse
            return None
        raise ApiError(422, "source_locked", SOURCE_LOCKED)


async def _assert_shareable(c: dict, referer: str | None):
    if not referer or c.get("kind") not in ("direct", "hls"):
        return
    origin = config.WEB_URL
    url = c["stream_url"]
    if c["kind"] == "hls":
        for _ in range(2):  # the playlist itself and the first thing it points to (rendition or segment)
            p = await _room_probe(url, origin, cors=True)
            if p is None:
                return
            if not _open_to_us(p, True, origin):
                raise ApiError(422, "source_locked", SOURCE_LOCKED)
            nxt = _first_uri(p["head"], p["final_url"]) if p["head"].lstrip().startswith(b"#EXTM3U") else None
            if not nxt:
                return
            url = nxt
        return
    p = await _room_probe(url, origin, cors=False)
    if p is None or _open_to_us(p, False, origin):
        return
    if p["status"] in (401, 403):  # refused to our page: opened without a Referer? (see SOURCE_LOCKED above)
        q = await _room_probe(url, origin, cors=False, referrer=False)
        if q is None or _open_to_us(q, False, origin):
            c["referrer_policy"] = "no-referrer"
            return
    raise ApiError(422, "source_locked", SOURCE_LOCKED)


def _vimeo(url: str, parsed) -> dict | None:
    """A Vimeo video page / player URL -> the official player. Other vimeo.com pages are not videos (None)."""
    if (parsed.hostname or "").lower() not in VIMEO_HOSTS:
        return None
    m = VIMEO_PATH.match(parsed.path or "")
    if not m:
        return None
    vid, h = m.group(1), m.group(2)
    if not h:  # unlisted videos carry their key as /<id>/<hash> or ?h=<hash>
        q = dict(parse_qsl(parsed.query))
        h = q.get("h") if VIMEO_HASH.match(q.get("h", "")) else None
    embed = f"https://player.vimeo.com/video/{vid}" + (f"?h={h}" if h else "")
    return {"url": url, "kind": "vimeo", "video_id": vid, "video_hash": h, "embed_url": embed, "stream_url": None,
            "title": "Vimeo", "mime_type": None, "provider": "vimeo", "capabilities": EMBED_CAPS, "warning": None}


def _twitch(url: str, parsed) -> dict | None:
    """A Twitch past broadcast (synced) or live channel (everyone watches live) -> the official player."""
    host = (parsed.hostname or "").lower()
    path = parsed.path or ""
    if host == "clips.twitch.tv" or (host in TWITCH_HOSTS and TWITCH_CLIP.match(path)):
        # Clips have no interactive embed (no position API), so they cannot be kept in sync.
        raise ApiError(422, "twitch_clip", "Twitch klipleri eşitlenemiyor; kayıtlı yayının (twitch.tv/videos/…) bağlantısını kullan")
    vid = channel = owner = None  # owner = the channel name as written in the address, for the title
    if host == "player.twitch.tv":
        q = dict(parse_qsl(parsed.query))
        v = q.get("video", "")
        if re.fullmatch(r"v?\d{6,12}", v):
            vid = v.lstrip("v")
        elif re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_]{2,24}", q.get("channel", "")):
            owner = q["channel"]
            channel = owner.lower()
        else:
            return None
    elif host in TWITCH_HOSTS:
        m = TWITCH_VOD.match(path)
        if m:
            owner, vid = m.group(1), m.group(2)
        else:
            c = TWITCH_CHANNEL.match(path)
            if not c or c.group(1).lower() in TWITCH_RESERVED:
                return None
            owner = c.group(1)
            channel = owner.lower()
    else:
        return None
    base = {"url": url, "kind": "twitch", "stream_url": None, "mime_type": None, "provider": "twitch", "warning": None}
    if vid:
        return {**base, "video_id": vid, "channel": None, "live": False, "embed_url": f"https://player.twitch.tv/?video=v{vid}",
                "title": f"Twitch · {owner}" if owner else "Twitch", "capabilities": EMBED_CAPS}
    return {**base, "video_id": None, "channel": channel, "live": True, "embed_url": f"https://player.twitch.tv/?channel={channel}",
            "title": f"Twitch · {owner}", "capabilities": LIVE_SYNC_CAPS}


async def _kick_fetch(path: str):
    """GET kick.com/<path> (Kick's own site API): (status, JSON or None). Kick may refuse servers. Tests replace this."""
    async with httpx.AsyncClient(timeout=KICK_TIMEOUT, follow_redirects=False) as c:
        async with c.stream("GET", f"https://kick.com{path}", headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0 NexoraWatch/1.0"}) as r:
            if r.status_code != 200 or "json" not in r.headers.get("content-type", ""):
                return r.status_code, None
            body = b""
            async for chunk in r.aiter_bytes():
                body += chunk
                if len(body) > KICK_MAX_BYTES:
                    return 413, None
    try:
        return 200, json.loads(body)
    except ValueError:
        return 502, None


async def _kick_json(path: str):
    try:
        status, data = await asyncio.wait_for(kick_fetch(path), KICK_TIMEOUT + 1)
    except Exception:
        raise ApiError(422, "kick_app_only", KICK_APP_ONLY)
    if status == 404:
        return None
    if status != 200 or not isinstance(data, dict):  # Cloudflare's bot check, rate limits: the app's browser can do it
        raise ApiError(422, "kick_app_only", KICK_APP_ONLY)
    return data


def _kick_embed(slug: str, url: str, title: str | None = None) -> dict:
    """A live Kick channel in Kick's official embed (see KICK_APP_ONLY above)."""
    t = " ".join(title.split())[:120] if isinstance(title, str) and title.strip() else f"Kick · {slug}"
    return {"url": url, "kind": "kick", "video_id": None, "channel": slug.lower(), "live": True,
            "embed_url": f"https://player.kick.com/{slug.lower()}", "stream_url": None, "mime_type": None, "provider": "kick",
            "title": t, "capabilities": LIVE_SYNC_CAPS, "warning": None}


def _kick_channel_of(page: str | None) -> str | None:
    """The channel of a Kick channel page (kick.com/<channel>), or None."""
    if not page:
        return None
    p = urlparse(page)
    m = KICK_CHANNEL.match(p.path or "") if (p.hostname or "").lower() in KICK_HOSTS else None
    return m.group(1) if m and m.group(1).lower() not in KICK_RESERVED else None


async def _kick(url: str, parsed) -> dict | None:
    """A Kick live channel, recorded video or clip -> the HLS playlist Kick's own player plays, in Nexora's player.
    Live channels play live for everyone (the room follows play / pause); recordings and clips are fully synced."""
    host = (parsed.hostname or "").lower()
    path = parsed.path or ""
    if host not in KICK_HOSTS and host != "player.kick.com":
        return None
    q = dict(parse_qsl(parsed.query))
    vod = KICK_VIDEO.match(path) if host in KICK_HOSTS else None
    clip = (KICK_CLIP_PATH.match(path) if host in KICK_HOSTS else None)
    clip_id = clip.group(1) if clip else (q.get("clip") if KICK_CLIP_ID.match(q.get("clip", "")) else None)
    if vod:
        data = await _kick_json(f"/api/v1/video/{vod.group(1)}")
        src = (data or {}).get("source")
        live, title = False, (((data or {}).get("livestream") or {}).get("session_title") if isinstance((data or {}).get("livestream"), dict) else None)
        if not isinstance(src, str):
            raise ApiError(422, "not_found", "Kick videosu bulunamadı")
    elif clip_id:
        data = await _kick_json(f"/api/v2/clips/{clip_id}")
        c = (data or {}).get("clip") if isinstance((data or {}).get("clip"), dict) else {}
        src = c.get("clip_url") or c.get("video_url")
        live, title = False, c.get("title")
        if not isinstance(src, str):
            raise ApiError(422, "not_found", "Kick klibi bulunamadı")
    else:
        m = KICK_CHANNEL.match(path)
        if not m or (host in KICK_HOSTS and m.group(1).lower() in KICK_RESERVED):
            return None
        try:
            data = await _kick_json(f"/api/v2/channels/{m.group(1).lower()}")
        except ApiError as e:
            if e.code == "kick_app_only":  # Kick refuses our server: the channel still plays, in Kick's embed
                return _kick_embed(m.group(1), url)
            raise
        if not data:
            raise ApiError(422, "not_found", "Kick kanalı bulunamadı")
        ls = data.get("livestream")
        src = data.get("playback_url")
        if not isinstance(ls, dict) or not isinstance(src, str):
            raise ApiError(422, "kick_offline", "Bu Kick kanalı şu an yayında değil")
        live, title = True, ls.get("session_title")
        user = data.get("user") if isinstance(data.get("user"), dict) else {}
        title = title or f"Kick · {user.get('username') or m.group(1)}"
    p = urlparse(src)
    if p.scheme != "https" or not p.hostname:
        raise ApiError(422, "not_found", "Kick videosu bulunamadı")
    try:
        res = await _media_file(src, url)
    except ApiError as e:
        # A live stream the other phones could not open (or the server could not reach): Kick's embed instead
        if live and e.code in ("source_locked", "forbidden", "http_error", "network"):
            return _kick_embed(KICK_CHANNEL.match(path).group(1), url, title)
        raise
    if not isinstance(title, str) or not title.strip():
        title = "Kick"
    return {**res, "url": url, "title": " ".join(title.split())[:120], "provider": "kick", "live": live}


# ---- Reddit
async def _reddit_fetch(post_id: str):
    """A Reddit post's public data: (status, JSON or None). Reddit may refuse servers. Tests replace this."""
    async with httpx.AsyncClient(timeout=REDDIT_TIMEOUT, follow_redirects=False) as c:
        async with c.stream("GET", f"https://www.reddit.com/comments/{post_id}.json?raw_json=1",
                            headers={"User-Agent": REDDIT_UA, "Accept": "application/json"}) as r:
            if r.status_code != 200 or "json" not in r.headers.get("content-type", ""):
                return r.status_code, None
            body = b""
            async for chunk in r.aiter_bytes():
                body += chunk
                if len(body) > REDDIT_MAX_BYTES:
                    return 413, None
    try:
        return 200, json.loads(body)
    except ValueError:
        return 502, None


async def _reddit_share(url: str) -> str | None:
    """The post a Reddit share link (reddit.com/r/<sub>/s/<code>) leads to: its redirect, the body is never read."""
    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=REDDIT_TIMEOUT, event_hooks={"request": [_guard]}) as c:
            async with c.stream("GET", url, headers={"User-Agent": REDDIT_UA}) as r:
                loc = r.headers.get("location", "")
    except (ApiError, httpx.HTTPError):
        return None
    p = urlparse(urljoin(url, loc)) if loc else None
    if not p or (p.hostname or "").lower() not in REDDIT_HOSTS:
        return None
    m = REDDIT_POST.match(p.path or "")
    return m.group(1).lower() if m else None


def _reddit_video(post: dict) -> tuple[str | None, str]:
    """The HLS playlist of a post (or of the post it crossposts) and its title."""
    for p in [post] + [x for x in (post.get("crosspost_parent_list") or []) if isinstance(x, dict)]:
        for key in ("secure_media", "media"):
            v = (p.get(key) or {}).get("reddit_video") if isinstance(p.get(key), dict) else None
            if isinstance(v, dict) and isinstance(v.get("hls_url"), str):
                return v["hls_url"], str(post.get("title") or p.get("title") or "")
    return None, str(post.get("title") or "")


async def _reddit(url: str, parsed) -> dict | None:
    """A Reddit post with a video -> Reddit's own HLS playlist of it, in Nexora's player (synced)."""
    host = (parsed.hostname or "").lower()
    path = parsed.path or ""
    if host in ("redd.it", "www.redd.it"):
        m = REDDIT_SHORT.match(path)
        post_id = m.group(1).lower() if m else None
    elif host in REDDIT_HOSTS:
        m = REDDIT_POST.match(path)
        if m:
            post_id = m.group(1).lower()
        elif REDDIT_SHARE.match(path):
            post_id = await _reddit_share(url)
            if not post_id:
                raise ApiError(422, "reddit_share", "Reddit paylaşım bağlantısı açılamadı; gönderiyi açıp tam adresini kopyala")
        else:
            if path not in ("", "/"):
                raise ApiError(422, "social_link", "Bu bağlantıda tek bir gönderi yok; gönderinin kendi bağlantısını kopyala")
            return None
    else:
        return None
    if not post_id:
        return None
    try:
        status, data = await asyncio.wait_for(reddit_fetch(post_id), REDDIT_TIMEOUT + 2)
    except Exception:
        raise ApiError(422, "reddit_app_only", REDDIT_APP_ONLY)
    if status == 404:
        raise ApiError(422, "not_found", "Reddit gönderisi bulunamadı")
    if status != 200 or not isinstance(data, list) or not data:
        raise ApiError(422, "reddit_app_only", REDDIT_APP_ONLY)
    try:
        post = data[0]["data"]["children"][0]["data"]
    except (KeyError, IndexError, TypeError):
        raise ApiError(422, "not_found", "Reddit gönderisi bulunamadı")
    hls, title = _reddit_video(post if isinstance(post, dict) else {})
    if not hls or (urlparse(hls).hostname or "").lower() != "v.redd.it":
        raise ApiError(422, "reddit_no_video", "Bu Reddit gönderisinde Reddit'e yüklenmiş bir video yok")
    res = await _media_file(hls, f"https://www.reddit.com/comments/{post_id}/")
    return {**res, "url": f"https://www.reddit.com/comments/{post_id}/", "video_id": post_id,
            "title": " ".join(title.split())[:120] or "Reddit", "provider": "reddit"}


async def _media_file(src: str, page: str) -> dict:
    """A video file a site's player plays (found by the server): checked like any other link, and it must open for the
    room's other devices exactly as it opens here (CORS / CORP, see _assert_shareable)."""
    await _assert_public(urlparse(src).hostname or "")
    p = await _probe(src, page)
    _http_errors(p)
    c = _classify(src, p, urlparse(page).hostname or "")
    if not c:
        raise ApiError(422, "unsupported", "Sitenin verdiği adres bir video değil")
    await _assert_shareable(c, page)
    return {"video_id": None, "embed_url": None, "warning": None, **c}


def _youtube(url: str) -> dict | None:
    yt = YT_RE.search(url)
    if not yt:
        return None
    vid = yt.group(1)
    return {"url": url, "kind": "youtube", "video_id": vid, "embed_url": f"https://www.youtube.com/embed/{vid}",
            "stream_url": None, "title": "YouTube", "mime_type": None, "provider": "youtube",
            "capabilities": {"seek": True, "rate_correction": False, "sync": True}, "warning": None}


async def _official(url: str, parsed) -> dict | None:
    """The site's own player for a page of a supported site (YouTube, Vimeo, Twitch, Kick, Instagram, X, Facebook, TikTok)."""
    return (_youtube(url) or _vimeo(url, parsed) or _twitch(url, parsed) or await _kick(url, parsed) or _instagram(url, parsed)
            or await _x(url, parsed) or await _facebook_link(url, parsed) or await _tiktok(url, parsed) or await _reddit(url, parsed))


def _embed_base(url: str, kind: str) -> dict:
    return {"url": url, "kind": kind, "stream_url": None, "mime_type": None, "provider": kind, "warning": None}


async def _tiktok_oembed(url: str) -> str | None:
    """The numeric id of a TikTok short link, through the official oEmbed API. None when it cannot be found out."""
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=8, max_redirects=3, event_hooks={"request": [_guard]}) as c:
            r = await c.get(TIKTOK_OEMBED + quote(url, safe=""), headers={"User-Agent": "NexoraWatch/1.0", "Accept": "application/json"})
            if r.status_code >= 400 or len(r.content) > 256 * 1024:
                return None
            data = r.json()
    except (ApiError, httpx.HTTPError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    vid = str(data.get("embed_product_id") or "")
    if not TIKTOK_ID.match(vid):
        m = re.search(r'data-video-id="(\d{15,21})"', str(data.get("html") or ""))
        vid = m.group(1) if m else ""
    if vid:  # the same answer carries the caption: kept for the room's title (_tiktok)
        title = data.get("title") if isinstance(data.get("title"), str) else ""
        name = data.get("author_name") if isinstance(data.get("author_name"), str) else ""
        caption = " ".join(title.split())[:120] or (f"TikTok · {name.strip()}"[:120] if name.strip() else None)
        if caption:
            _tiktok_cache[vid] = (time.monotonic() + 3600, caption)
    return vid or None


def _tiktok_page(path: str):
    """(video id, author or "", photo post?) of a TikTok page address, or None."""
    m = TIKTOK_PATH.match(path or "")
    return (m.group(3), m.group(1) or "", m.group(2) == "photo") if m else None


async def _tiktok_redirect(url: str):
    """The page a TikTok short link redirects to, as _tiktok_page gives it (one request, the body is never read)."""
    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=8, event_hooks={"request": [_guard]}) as c:
            async with c.stream("GET", url, headers={"User-Agent": "Mozilla/5.0 (Linux; Android 14) NexoraWatch/1.0"}) as r:
                loc = r.headers.get("location", "")
    except (ApiError, httpx.HTTPError):
        return None
    if not loc:
        return None
    p = urlparse(urljoin(url, loc))
    if (p.hostname or "").lower() not in TIKTOK_HOSTS:
        return None
    return _tiktok_page(p.path or "")


async def _tiktok_short(url: str):
    vid = await _tiktok_oembed(url)
    return (vid, "", False) if vid else await _tiktok_redirect(url)


async def _tiktok_meta_fetch(page: str):
    """TikTok's oEmbed answer for a video page: (status, JSON or None). Tests replace `tiktok_meta`."""
    async with httpx.AsyncClient(timeout=6, follow_redirects=False) as c:
        async with c.stream("GET", TIKTOK_OEMBED + quote(page, safe=""), headers={"User-Agent": "NexoraWatch/1.0", "Accept": "application/json"}) as r:
            body = b""
            async for chunk in r.aiter_bytes():
                body += chunk
                if len(body) > 256 * 1024:
                    return r.status_code, None
            status = r.status_code
    try:
        return status, json.loads(body)
    except ValueError:
        return status, None


async def _tiktok_caption(vid: str, author: str) -> str | None:
    """The caption of a TikTok video from the official oEmbed API (https://developers.tiktok.com/doc/embed-videos).
    TikTok answers 400 / 404 for a video it does not let other sites show (private, deleted, embedding turned off):
    its player would only say "Video currently unavailable" on everyone's screen, so the link is refused here, with
    the reason. No answer, or any other answer, refuses nothing: the caption is then simply not known."""
    now = time.monotonic()
    hit = _tiktok_cache.get(vid)
    if hit and hit[0] > now:
        if isinstance(hit[1], ApiError):
            raise hit[1]
        return hit[1]
    try:
        status, data = await asyncio.wait_for(tiktok_meta(f"https://www.tiktok.com/@{author}/video/{vid}"), 7)
    except Exception:
        return None
    if status in (400, 404) and isinstance(data, dict):
        res = ApiError(422, "tiktok_unavailable", TIKTOK_UNAVAILABLE)
    elif status == 200 and isinstance(data, dict):
        title = data.get("title") if isinstance(data.get("title"), str) else ""
        name = data.get("author_name") if isinstance(data.get("author_name"), str) else ""
        res = " ".join(title.split())[:120] or (f"TikTok · {name.strip()}"[:120] if name.strip() else None)
    else:
        return None
    _tiktok_cache.pop(vid, None)
    _tiktok_cache[vid] = (now + (3600 if not isinstance(res, ApiError) else 300), res)
    while len(_tiktok_cache) > 1000:
        _tiktok_cache.pop(next(iter(_tiktok_cache)))
    if isinstance(res, ApiError):
        raise res
    return res


async def _tiktok(url: str, parsed) -> dict | None:
    """A TikTok video (or a short share link to one) -> the official Embed Player (synced)."""
    host = (parsed.hostname or "").lower()
    path = parsed.path or ""
    if host in TIKTOK_HOSTS:
        found = _tiktok_page(path)
        if not found and path.startswith("/t/") and TIKTOK_SHORT_PATH.match(path):
            found = await _tiktok_short(url)
            if not found:
                raise ApiError(422, "tiktok_short", "TikTok kısa bağlantısı açılamadı; videoyu TikTok'ta açıp tam bağlantısını kopyala")
        elif not found and path.startswith("/@"):
            raise ApiError(422, "social_link", "Bu bağlantıda tek bir video yok; videonun kendi bağlantısını kopyala")
        elif not found:
            return None
    elif host in TIKTOK_SHORT_HOSTS:
        if not TIKTOK_SHORT_PATH.match(path):
            return None
        found = await _tiktok_short(url)
        if not found:
            raise ApiError(422, "tiktok_short", "TikTok kısa bağlantısı açılamadı; videoyu TikTok'ta açıp tam bağlantısını kopyala")
    else:
        return None
    vid, author, photo = found
    if photo:
        raise ApiError(422, "tiktok_photo", TIKTOK_PHOTO)
    hit = _tiktok_cache.get(vid)
    if author:
        caption = await _tiktok_caption(vid, author)
    else:  # a short link answered by oEmbed itself already said what it is called
        caption = hit[1] if hit and hit[0] > time.monotonic() and isinstance(hit[1], str) else None
    return {**_embed_base(url, "tiktok"), "video_id": vid, "embed_url": f"https://www.tiktok.com/player/v1/{vid}",
            "title": caption or (f"TikTok · @{author}" if author else "TikTok"), "capabilities": EMBED_CAPS}


def _instagram(url: str, parsed) -> dict | None:
    """An Instagram post or reel -> Instagram's own embed (no JavaScript control, no sync)."""
    if (parsed.hostname or "").lower() not in IG_HOSTS:
        return None
    m = IG_PATH.match(parsed.path or "")
    if not m:
        if (parsed.path or "/") not in ("", "/"):
            raise ApiError(422, "social_link", "Bu bağlantıda tek bir video yok; gönderinin ya da Reels videosunun bağlantısını kopyala")
        return None
    kind, code = m.group(1), m.group(2)
    seg = "reel" if kind.startswith("reel") else "p"
    return {**_embed_base(url, "instagram"), "video_id": code, "embed_url": f"https://www.instagram.com/{seg}/{code}/embed/",
            "title": "Instagram", "capabilities": NOSYNC_CAPS}


def _js_radix(value: float, radix: int = 36) -> str:
    """Number.prototype.toString(radix) of a finite double, digit for digit as V8 writes it (DoubleToRadixCString)."""
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    negative = value < 0
    value = -value if negative else value
    integer = math.floor(value)
    fraction = value - integer
    delta = max(math.nextafter(0.0, 1.0), 0.5 * (math.nextafter(value, math.inf) - value))
    frac: list[int] = []
    if fraction >= delta:
        while True:
            fraction *= radix
            delta *= radix
            digit = int(fraction)
            frac.append(digit)
            fraction -= digit
            if (fraction > 0.5 or (fraction == 0.5 and digit & 1)) and fraction + delta > 1:
                while True:  # round up, carrying over the digits already written
                    if not frac:
                        integer += 1
                        break
                    d = frac.pop()
                    if d + 1 < radix:
                        frac.append(d + 1)
                        break
                break
            if not fraction >= delta:
                break
    out = []
    integer = float(integer)
    while integer / radix >= 2.0 ** 53:  # digits below a huge number's precision are zeros
        integer /= radix
        out.append("0")
    while True:
        rem = math.fmod(integer, radix)
        out.append(chars[int(rem)])
        integer = (integer - rem) / radix
        if not integer > 0:
            break
    text = "".join(reversed(out)) + ("." + "".join(chars[d] for d in frac) if frac else "")
    return ("-" if negative else "") + text


def x_token(post_id: str) -> str:
    """The token X's embed widget sends with a post id: ((id / 1e15) * Math.PI).toString(36) without zeros and the dot."""
    return re.sub(r"(0+|\.)", "", _js_radix((int(post_id) / 1e15) * math.pi))


async def _x_fetch(post_id: str):
    """X's embed data of a post: (status, JSON or None). Tests replace this."""
    q = urlencode({"id": post_id, "lang": "en", "token": x_token(post_id)})
    async with httpx.AsyncClient(timeout=X_TIMEOUT, follow_redirects=False) as c:
        async with c.stream("GET", f"{X_SYNDICATION}?{q}", headers={"User-Agent": "Mozilla/5.0 NexoraWatch/1.0", "Accept": "application/json"}) as r:
            if r.status_code != 200:
                return r.status_code, None
            body = b""
            async for chunk in r.aiter_bytes():
                body += chunk
                if len(body) > X_MAX_BYTES:
                    return 413, None
    try:
        return 200, json.loads(body)
    except ValueError:
        return 502, None


def _x_media(post: dict) -> tuple[list[dict], dict]:
    """The video variants of a post (or of the post it quotes) and the post that carries them."""
    for p in (post, post.get("quoted_tweet")):
        if not isinstance(p, dict):
            continue
        out = []
        for m in p.get("mediaDetails") or []:
            if isinstance(m, dict) and m.get("type") in ("video", "animated_gif"):
                out += [v for v in ((m.get("video_info") or {}).get("variants") or []) if isinstance(v, dict)]
        if not out and isinstance(p.get("video"), dict):  # the newer shape: video.variants = [{type, src}]
            out = [{"content_type": v.get("type"), "url": v.get("src")} for v in p["video"].get("variants") or [] if isinstance(v, dict)]
        if out:
            return out, p
    return [], post


def _x_pick(variants: list[dict]) -> str | None:
    """The MP4 to play: the best one up to about 720p (X lists 270p to 1080p), else the lightest."""
    mp4 = []
    for v in variants:
        u = v.get("url")
        if v.get("content_type") != "video/mp4" or not isinstance(u, str):
            continue
        p = urlparse(u)
        if p.scheme != "https" or (p.hostname or "").lower() not in X_VIDEO_HOSTS:
            continue
        b = v.get("bitrate")
        mp4.append((b if isinstance(b, (int, float)) else 0, u))
    if not mp4:
        return None
    fit = [m for m in mp4 if m[0] <= X_MAX_BITRATE]
    return (max(fit) if fit else min(mp4))[1]


def _x_title(post: dict) -> str:
    text = re.sub(r"\s*https://t\.co/\w+", "", str(post.get("text") or "")).strip()
    text = " ".join(text.split())[:120]
    user = post.get("user") if isinstance(post.get("user"), dict) else {}
    name = user.get("screen_name") if isinstance(user.get("screen_name"), str) else ""
    return text or (f"X · @{name}" if name else "X")


async def _x_video(post_id: str) -> dict:
    """A post's video file and title from X's embed data; ApiError when the post has none or cannot be read."""
    now = time.monotonic()
    hit = _x_cache.get(post_id)
    if hit and hit[0] > now:
        if isinstance(hit[1], ApiError):
            raise hit[1]
        return hit[1]
    try:
        status, data = await asyncio.wait_for(x_fetch(post_id), X_TIMEOUT + 1)
    except Exception:  # network, timeout: not remembered, the next try may work
        raise ApiError(422, "network", "X'e ulaşılamadı; biraz sonra yeniden dene")
    if status == 200 and isinstance(data, dict) and data.get("__typename") != "TweetTombstone":
        variants, post = _x_media(data)
        url = _x_pick(variants)
        res = {"stream_url": url, "title": _x_title(post)} if url else ApiError(422, "x_no_video", "Bu X gönderisinde oynatılabilir bir video yok")
    elif status in (200, 404):
        res = ApiError(422, "x_unavailable", "Bu X gönderisi açılamıyor: silinmiş, gizli ya da yaş sınırlı olabilir")
    else:
        raise ApiError(422, "network", "X bu gönderiyi şu an vermiyor; biraz sonra yeniden dene")
    _x_cache.pop(post_id, None)
    _x_cache[post_id] = (now + (900 if not isinstance(res, ApiError) else 120), res)
    while len(_x_cache) > X_CACHE_MAX:
        _x_cache.pop(next(iter(_x_cache)))
    if isinstance(res, ApiError):
        raise res
    return res


async def _x(url: str, parsed) -> dict | None:
    """An X (Twitter) post -> its video file, played in sync in Nexora's own player (see X_SYNDICATION)."""
    host = (parsed.hostname or "").lower()
    vid = None
    if host == "platform.twitter.com" and (parsed.path or "").rstrip("/") in ("/embed/Tweet.html", "/embed/index.html"):
        v = dict(parse_qsl(parsed.query)).get("id", "")
        vid = v if re.fullmatch(r"\d{5,20}", v) else None
        if not vid:
            return None
    elif host in X_HOSTS:
        m = X_PATH.match(parsed.path or "")
        if not m:
            if (parsed.path or "/") not in ("", "/"):
                raise ApiError(422, "social_link", "Bu bağlantıda tek bir gönderi yok; gönderinin kendi bağlantısını kopyala")
            return None
        vid = m.group(1)
    else:
        return None
    found = await _x_video(vid)
    # The file must open for everyone in the room exactly as it opens here: checked like any other video link.
    p = await _probe(found["stream_url"])
    _http_errors(p)
    c = _classify(found["stream_url"], p, "x")
    if not c or c["kind"] != "direct":
        raise ApiError(422, "x_no_video", "Bu X gönderisinde oynatılabilir bir video yok")
    await _assert_shareable(c, f"https://x.com/i/status/{vid}")
    return {"url": f"https://x.com/i/status/{vid}", "video_id": vid, "embed_url": None, "title": found["title"], "warning": None, **c}


def _fb_video_page(u: str) -> str | None:
    """u itself when it is the address of a Facebook video or reel (what _facebook reads), else None."""
    p = urlparse(u)
    if (p.hostname or "").lower() not in FB_HOSTS:
        return None
    path = p.path or ""
    if path in FB_WATCH_PATHS:
        return u if re.fullmatch(r"\d{6,20}", dict(parse_qsl(p.query)).get("v", "")) else None
    return u if FB_VIDEOS.match(path) or FB_REEL.match(path) else None


def _fb_from_page(body: str) -> str | None:
    """The video address a Facebook page names for itself (og:url, or its canonical link)."""
    for tag in FB_TAG.findall(body):
        attrs = {k.lower(): html_unescape(a or b) for k, a, b in FB_ATTR.findall(tag)}
        if attrs.get("property") == "og:url" or attrs.get("rel") == "canonical":
            found = _fb_video_page(attrs.get("content") or attrs.get("href") or "")
            if found:
                return found
    return None


async def _fb_follow(url: str) -> str | None:
    """Where a Facebook share link leads, asked like a phone's browser opening it: Facebook's redirects (at most 5, only
    to Facebook's own hosts; a login page's "next" counts), or the og:url / canonical address of the page it answers
    with. None when Facebook does not say (a login wall) or cannot be reached. Tests replace this."""
    cur = url
    headers = {"User-Agent": BROWSER_UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.8",
               "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", "Sec-Fetch-Site": "none"}
    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=8, event_hooks={"request": [_guard]}) as c:
            for _ in range(5):
                async with c.stream("GET", cur, headers=headers) as r:
                    loc = r.headers.get("location", "")
                    if loc and 300 <= r.status_code < 400:
                        nxt = urljoin(cur, loc)
                        if _fb_video_page(nxt):
                            return nxt
                        p = urlparse(nxt)
                        if (p.hostname or "").lower() not in FB_HOSTS | FB_SHORT_HOSTS:
                            return None
                        later = dict(parse_qsl(p.query)).get("next", "")
                        if later and _fb_video_page(later):
                            return later
                        cur = nxt
                        continue
                    if r.status_code >= 400:
                        return None
                    body = b""
                    async for chunk in r.aiter_bytes():
                        body += chunk
                        if len(body) > 512 * 1024:
                            break
                    return _fb_from_page(body.decode("utf-8", "replace"))
    except (ApiError, httpx.HTTPError):
        return None
    return None


async def _fb_expand(url: str) -> str | None:
    """_fb_follow, remembered for an hour (a share link always leads to the same video)."""
    now = time.time()
    hit = _fb_cache.get(url)
    if hit and hit[0] > now:
        return hit[1]
    found = await _fb_follow(url)
    if len(_fb_cache) >= FB_EXPAND_MAX:
        _fb_cache.clear()
    _fb_cache[url] = (now + (FB_EXPAND_TTL if found else 120), found)
    return found


async def _facebook_link(url: str, parsed) -> dict | None:
    """A Facebook link as people copy it: a share link is first turned into the video's own address."""
    host = (parsed.hostname or "").lower()
    path = parsed.path or ""
    if host in FB_SHORT_HOSTS or (host in FB_HOSTS and FB_SHARE_ANY.match(path)):
        real = await _fb_expand(url)
        if real:
            return _facebook(real, urlparse(real))
        if host in FB_SHORT_HOSTS or FB_SHARE.match(path):
            raise ApiError(422, "fb_short", FB_SHORT_TEXT)
        raise ApiError(422, "social_link", "Bu bağlantıda tek bir video yok; videonun kendi bağlantısını kopyala")
    return _facebook(url, parsed)


def _facebook(url: str, parsed) -> dict | None:
    """A Facebook video / reel -> the official Embedded Video Player (synced through its JS API)."""
    host = (parsed.hostname or "").lower()
    path = parsed.path or ""
    if host in FB_SHORT_HOSTS or (host in FB_HOSTS and FB_SHARE.match(path)):
        raise ApiError(422, "fb_short", FB_SHORT_TEXT)
    if host not in FB_HOSTS:
        return None
    vid = href = None
    if path in FB_WATCH_PATHS:
        v = dict(parse_qsl(parsed.query)).get("v", "")
        if re.fullmatch(r"\d{6,20}", v):
            vid, href = v, f"https://www.facebook.com/watch/?v={v}"
    elif FB_VIDEOS.match(path):
        m = FB_VIDEOS.match(path)
        vid, href = m.group(2), f"https://www.facebook.com/{m.group(1)}/videos/{m.group(2)}/"
    elif FB_REEL.match(path):
        vid = FB_REEL.match(path).group(1)
        href = f"https://www.facebook.com/reel/{vid}"
    if not vid:
        if path not in ("", "/"):
            raise ApiError(422, "social_link", "Bu bağlantıda tek bir video yok; videonun kendi bağlantısını kopyala")
        return None
    return {**_embed_base(url, "facebook"), "video_id": vid, "href": href,
            "embed_url": "https://www.facebook.com/plugins/video.php?" + urlencode({"href": href, "show_text": "false"}),
            "title": "Facebook", "capabilities": EMBED_CAPS}

async def _ia_metadata(identifier: str) -> dict:
    """The item's public metadata (MD Read API). Size-capped; an unknown item comes back empty."""
    url = f"https://archive.org/metadata/{quote(identifier)}"
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=8, max_redirects=3, event_hooks={"request": [_guard]}) as c:
            async with c.stream("GET", url, headers={"User-Agent": "NexoraWatch/1.0", "Accept": "application/json"}) as r:
                if r.status_code >= 400:
                    _http_errors({"status": r.status_code})
                body = b""
                async for chunk in r.aiter_bytes():
                    body += chunk
                    if len(body) > IA_MAX_METADATA:
                        raise ApiError(422, "archive_no_video", "Internet Archive öğesi çok büyük; videonun kendi indirme bağlantısını kullan")
    except ApiError:
        raise
    except httpx.TimeoutException:
        raise ApiError(422, "network", "Internet Archive zaman aşımına uğradı")
    except httpx.HTTPError:
        raise ApiError(422, "network", "Internet Archive'a ulaşılamadı")
    try:
        data = json.loads(body or b"{}")
    except ValueError:
        raise ApiError(422, "network", "Internet Archive geçersiz yanıt verdi")
    return data if isinstance(data, dict) else {}


def _ia_pick(files: list, wanted: str | None) -> str | None:
    """Name of the file to play: the one in the address if it is a video, else the most browser-friendly video file."""
    videos = [f for f in files if isinstance(f, dict) and isinstance(f.get("name"), str) and IA_VIDEO.search(f["name"])
              and str(f.get("private", "")).lower() != "true"]
    if wanted:
        for f in videos:
            if f["name"] == wanted:
                return f["name"]

    def rank(f):
        fmt = str(f.get("format", "")).strip().lower()
        r = IA_FORMATS.index(fmt) if fmt in IA_FORMATS else len(IA_FORMATS) + (1 if f["name"].lower().endswith(".mov") else 0)
        return (r, f["name"])
    return min(videos, key=rank)["name"] if videos else None


async def _archive(url: str, parsed, referer: str | None) -> dict | None:
    if (parsed.hostname or "").lower() not in IA_HOSTS:
        return None
    m = IA_PAGE.match(parsed.path or "")
    if not m:
        return None
    ident, wanted = m.group(1), unquote(m.group(2) or "") or None
    meta = await _ia_metadata(ident)
    if not meta or meta.get("error"):
        raise ApiError(422, "not_found", "Internet Archive öğesi bulunamadı")
    name = None if meta.get("is_dark") else _ia_pick(meta.get("files") or [], wanted)
    if not name:
        raise ApiError(422, "archive_no_video", "Bu Internet Archive sayfasında oynatılabilir video dosyası yok")
    dl = f"https://archive.org/download/{quote(ident)}/{quote(name)}"
    p = await _probe(dl, referer)
    _http_errors(p)
    c = _classify(dl, p, "archive.org")
    if not c or c["kind"] != "direct":
        raise ApiError(422, "archive_no_video", "Bu Internet Archive sayfasında oynatılabilir video dosyası yok")
    c["stream_url"] = dl
    title = (meta.get("metadata") or {}).get("title")
    if isinstance(title, list):
        title = next((x for x in title if isinstance(x, str)), None)
    title = (title.strip() if isinstance(title, str) else "")[:120] or name.rsplit("/", 1)[-1][:120]
    return {"url": url, "video_id": ident, "embed_url": None, "title": title, "warning": None, **c}


def _dropbox_raw(parsed) -> str | None:
    """Dropbox share link of ONE file -> the same link with raw=1, which Dropbox serves as the file itself."""
    if (parsed.hostname or "").lower() not in DROPBOX_HOSTS or not DROPBOX_PATH.match(parsed.path or ""):
        return None
    q = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k.lower() not in ("dl", "raw")]
    return urlunparse(("https", "www.dropbox.com", parsed.path, "", urlencode(q + [("raw", "1")]), ""))


def _clean_referer(referer_in) -> str | None:
    if referer_in in (None, ""):
        return None
    ref = referer_in.strip() if isinstance(referer_in, str) else ""
    p = urlparse(ref)
    if not ref or len(ref) > 2000 or p.scheme not in ("http", "https") or not p.hostname:
        raise ApiError(400, "invalid_referer", "Geçersiz kaynak sayfa adresi (referer)")
    return ref


def _clean_title(title_in) -> str | None:
    t = title_in.strip() if isinstance(title_in, str) else ""
    return t[:120] or None


# --- Titles of official players -------------------------------------------------------------------------------------
# The client sends the page title it saw (document.title), which on these sites is often just "YouTube" or "KICK", or
# carries a site suffix. The real video title comes from the providers' official oEmbed endpoints
# (https://oembed.com, https://www.youtube.com/oembed, https://developer.vimeo.com/api/oembed/videos); live channels
# are named after the channel. A failed lookup never fails the resolve: it falls back to a neat provider label.
PROVIDER_LABELS = {"youtube": "YouTube", "vimeo": "Vimeo", "twitch": "Twitch", "kick": "Kick"}
GENERIC_TITLES = {"youtube", "youtube music", "youtube shorts", "shorts", "vimeo", "twitch", "kick", "google drive", "drive",
                  "video", "videos", "watch", "live", "home", "videos & movies", "videos & movies on vimeo"}
TITLE_PREFIX = re.compile(r"^\(\d+\+?\)\s*")  # "(3) Video - YouTube": unread-notification counter
TITLE_SUFFIX = re.compile(r"\s*(?:[-–—|·:]\s*(?:youtube(?: music)?|vimeo|twitch|kick)|\bon vimeo|[-–—|·]\s*videos?\s*&\s*movies)\s*$", re.I)
OEMBED_TIMEOUT = 2.5
OEMBED_MAX = 64 * 1024
_title_cache: dict = {}  # key -> (expires at, title or None); failures are remembered briefly so they are not retried at once
TITLE_CACHE_MAX = 2000


def _page_title(t: str | None) -> str | None:
    """A page title without counters and site suffixes, or None when nothing but the site's name is left."""
    if not t:
        return None
    t = TITLE_PREFIX.sub("", t)
    for _ in range(3):
        t2 = TITLE_SUFFIX.sub("", t).strip()
        if t2 == t:
            break
        t = t2
    return None if t.strip().lower() in GENERIC_TITLES else (t.strip()[:120] or None)


class OEmbedRefused(Exception):
    """The provider answered that the video cannot be shown elsewhere: 401 (private / embedding turned off) or 404."""

    def __init__(self, status: int):
        super().__init__(status)
        self.status = status


async def _fetch_oembed(url: str):
    """GET an oEmbed document (fixed provider hosts, no redirects, size-capped). Tests replace `oembed_fetch`."""
    async with httpx.AsyncClient(timeout=OEMBED_TIMEOUT, follow_redirects=False) as c:
        async with c.stream("GET", url, headers={"User-Agent": "NexoraWatch/1.0", "Accept": "application/json"}) as r:
            if r.status_code in (401, 404):
                raise OEmbedRefused(r.status_code)
            if r.status_code != 200:
                return None
            body = b""
            async for chunk in r.aiter_bytes():
                body += chunk
                if len(body) > OEMBED_MAX:
                    return None
    return json.loads(body)


oembed_fetch = _fetch_oembed
tiktok_meta = _tiktok_meta_fetch
x_fetch = _x_fetch
kick_fetch = _kick_fetch
reddit_fetch = _reddit_fetch


YT_REFUSED = {401: ("yt_embed", "YouTube bu videonun başka yerlerde oynatılmasına izin vermiyor (gizli ya da paylaşımı kapalı)"),
              404: ("yt_notfound", "YouTube videosu bulunamadı ya da kaldırılmış")}


async def _oembed_title(key: str, url: str) -> str | None:
    """The video's title from its provider's oEmbed. YouTube's 401 / 404 (private, embedding turned off, removed) refuse
    the link with the reason: its player would only say "Video unavailable" on everyone's screen. Anything else (no
    answer, a slow one) refuses nothing; the title is then simply not known."""
    now = time.monotonic()
    hit = _title_cache.get(key)
    if hit and hit[0] > now:
        if isinstance(hit[1], ApiError):
            raise hit[1]
        return hit[1]
    try:
        data = await asyncio.wait_for(oembed_fetch(url), OEMBED_TIMEOUT + 0.5)
    except OEmbedRefused as e:
        if not key.startswith("yt:") or e.status not in YT_REFUSED:
            data = None
        else:
            err = ApiError(422, *YT_REFUSED[e.status])
            _title_cache.pop(key, None)
            _title_cache[key] = (now + 300, err)
            raise err
    except Exception:  # network, timeout, bad JSON: the title is a nicety, never a reason to fail
        data = None
    raw = data.get("title") if isinstance(data, dict) else None
    t = " ".join(raw.split())[:120] if isinstance(raw, str) else ""
    t = t if t and t.lower() not in GENERIC_TITLES else None
    _title_cache.pop(key, None)
    _title_cache[key] = (now + (86400 if t else 300), t)
    while len(_title_cache) > TITLE_CACHE_MAX:
        _title_cache.pop(next(iter(_title_cache)))
    return t


async def _provider_title(res: dict, page_title: str | None) -> str:
    kind = res["kind"]
    label = PROVIDER_LABELS[kind]
    if kind == "youtube":
        watch = f"https://www.youtube.com/watch?v={res['video_id']}"
        t = await _oembed_title(f"yt:{res['video_id']}", f"https://www.youtube.com/oembed?url={quote(watch, safe='')}&format=json")
        return t or _page_title(page_title) or label
    if kind == "vimeo":
        page = f"https://vimeo.com/{res['video_id']}" + (f"/{res['video_hash']}" if res.get("video_hash") else "")
        t = await _oembed_title(f"vimeo:{res['video_id']}:{res.get('video_hash') or ''}",
                                f"https://vimeo.com/api/oembed.json?url={quote(page, safe='')}")
        return t or _page_title(page_title) or label
    if kind == "kick" and _page_title(page_title):  # the app's own title of the stream (never a bare "KICK")
        return " ".join(_page_title(page_title).split())[:120]
    if res.get("title") and res["title"] != label:  # Twitch / Kick: "Twitch · <channel>"
        return res["title"]
    p = _page_title(page_title)
    return f"{label} · {p}" if p else label


async def resolve(url_in, referer=None, title=None) -> dict:
    ref = _clean_referer(referer)
    custom_title = _clean_title(title)
    res = await _resolve(url_in, ref)
    # Nexora is a watch-together app: a source the room cannot keep together is not offered, not even "without sync"
    # (Instagram's embed, Drive's preview). Live channels (Twitch, Kick) are kept together: everyone watches live and
    # the room follows play / pause. Each refusal says why and, where there is one, what works instead.
    if (res.get("capabilities") or {}).get("sync") is False:
        kind = res.get("kind")
        if kind == "drive_embed":
            raise ApiError(422, "drive_no_stream", "Drive bu dosyayı akış olarak sunmuyor; dosyayı indirip Videoyu yükle ile ekle")
        raise ApiError(422, "no_sync_source", "Bu kaynak herkeste aynı anda oynatılamıyor, bu yüzden desteklenmiyor")
    if res.get("kind") in PROVIDER_LABELS:
        res["title"] = await _provider_title(res, custom_title)
    elif custom_title and not (res.get("provider") == "x" and res.get("title") != "X"):
        res["title"] = custom_title  # an X post keeps its own text: the page title only adds "on X: ... / X"
    if ref and res.get("kind") in ("direct", "hls"):
        res["headers"] = {"Referer": ref}
    return res


async def _resolve(url_in, referer: str | None) -> dict:
    url = url_in.strip() if isinstance(url_in, str) else ""
    if not url or len(url) > 4000:
        raise ApiError(400, "invalid_url", "Geçerli bir video adresi gerekli")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ApiError(400, "invalid_url", "Adres http(s) ile başlamalı")

    svc = services.resolve_service(url)  # rave worker: in-app subscription services (beta)
    if svc:
        if not config.SERVICES_ENABLED:
            raise ApiError(403, "drm_not_allowed", "Telif korumalı/abonelikli platformlardan içerik paylaşılamaz")
        return svc

    official = await _official(url, parsed)
    if official:
        return official

    drive = DRIVE_RE.search(url)
    if drive:
        fid = drive.group(1)
        direct = f"https://drive.google.com/uc?export=download&id={fid}"
        try:
            p = await _probe(direct, referer)
            if p["status"] < 400:
                c = _classify(direct, p, "drive")
                if c:
                    return {"url": url, "video_id": fid, "embed_url": None, "title": "Google Drive", **c}
        except ApiError:
            pass
        return {"url": url, "kind": "drive_embed", "video_id": fid, "embed_url": f"https://drive.google.com/file/d/{fid}/preview",
                "stream_url": None, "title": "Google Drive", "mime_type": None, "provider": "drive",
                "capabilities": {"seek": False, "rate_correction": False, "sync": False},
                "warning": "Drive bu dosyayı doğrudan akış olarak sunmuyor (izin, boyut veya virüs tarama sayfası). Resmî Drive oynatıcısı açılır; senkron kontrol yok.",
                "warning_code": "drive_embed"}

    ia = await _archive(url, parsed, referer)
    if ia:
        return ia

    await _assert_public(parsed.hostname)
    raw = _dropbox_raw(parsed)
    p = await _probe(raw or url, referer)
    _http_errors(p)
    c = _classify(raw or url, p, "dropbox" if raw else parsed.hostname)
    if c and c["kind"] == "direct" and (_total_size(p) or MIN_VIDEO_BYTES) < MIN_VIDEO_BYTES:
        raise ApiError(422, "too_small", "Bu dosya bir video değil, videonun yalnızca küçük bir parçası")
    if c:
        name = unquote(parsed.path.rsplit("/", 1)[-1]).strip()[:120]
        if raw and c["kind"] == "direct":
            # The address Dropbox redirects to is short-lived; the share link itself keeps working for every request.
            c["stream_url"] = raw
        elif (parsed.hostname or "").lower() in IA_HOSTS and c["kind"] == "direct":
            c["stream_url"] = url  # archive.org/download/... is the permanent address; the data server behind it is not
        try:
            await _assert_shareable(c, referer)
        except ApiError as e:
            slug = _kick_channel_of(referer) if c["kind"] == "hls" else None
            if e.code == "source_locked" and slug:  # a live Kick channel found by the app: Kick's embed instead
                return _kick_embed(slug, f"https://kick.com/{slug}")
            raise
        return {"url": url, "video_id": None, "embed_url": None, "title": name or parsed.hostname, "warning": None, **c}
    if HLS_EXT.search(url):
        raise ApiError(422, "manifest_invalid", "Adres .m3u8 ile bitiyor ama geçerli bir HLS manifesti döndürmüyor")
    if p["ctype"].startswith("text/html"):
        raise ApiError(422, "not_media", "Bu adres bir web sayfası, video dosyası değil")
    raise ApiError(422, "unsupported", f"Desteklenmeyen içerik türü: {p['ctype'] or 'bilinmiyor'}")

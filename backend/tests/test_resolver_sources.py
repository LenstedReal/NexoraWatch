"""Offline tests of the social-video sources (TikTok, Instagram, X, Facebook): only address recognition, no network.
TikTok short links go through the official oEmbed API; that call is replaced here."""
import asyncio
import os
import sys

import pytest
from urllib.parse import quote, urlparse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import resolver  # noqa: E402
from security import ApiError  # noqa: E402

REAL_FB_FOLLOW = resolver._fb_follow

SYNC = {"seek": True, "rate_correction": False, "sync": True}
NOSYNC = {"seek": False, "rate_correction": False, "sync": False}


def resolve(url):
    return asyncio.run(resolver.resolve(url))


def code_of(url):
    with pytest.raises(ApiError) as e:
        resolve(url)
    return e.value.code if hasattr(e.value, "code") else e.value.args[1]


@pytest.fixture(autouse=True)
def tiktok_meta(monkeypatch):
    """TikTok's oEmbed check of a video page (1.8.4), faked: answers[page] = (status, JSON); no answer = no network."""
    resolver._tiktok_cache.clear()
    state = {"answers": {}, "asked": []}

    async def fake(page):
        state["asked"].append(page)
        a = state["answers"].get(page)
        if a is None:
            raise OSError("offline")
        return a
    monkeypatch.setattr(resolver, "tiktok_meta", fake)
    yield state
    resolver._tiktok_cache.clear()


@pytest.fixture(autouse=True)
def fb_follow(monkeypatch):
    """Where Facebook's share links lead (1.8.5), faked: answers[link] = video address; no answer = Facebook said nothing."""
    resolver._fb_cache.clear()
    state = {"answers": {}, "asked": []}

    async def fake(url):
        state["asked"].append(url)
        return state["answers"].get(url)
    monkeypatch.setattr(resolver, "_fb_follow", fake)
    yield state
    resolver._fb_cache.clear()


@pytest.fixture
def oembed(monkeypatch):
    seen = []

    async def fake(url):
        seen.append(url)
        return "7300000000000000001" if "good" in url else None

    async def no_redirect(url):  # the second way (the short link's redirect) is tested on its own; no network here
        return None
    monkeypatch.setattr(resolver, "_tiktok_oembed", fake)
    monkeypatch.setattr(resolver, "_tiktok_redirect", no_redirect)
    return seen


@pytest.mark.parametrize("url", [
    "https://www.tiktok.com/@scout2015/video/6718335390845095173",
    "https://tiktok.com/@scout.2015/video/6718335390845095173?is_from_webapp=1&sender_device=pc",
    "https://m.tiktok.com/v/6718335390845095173.html",
    "https://www.tiktok.com/embed/v2/6718335390845095173",
    "https://www.tiktok.com/player/v1/6718335390845095173?autoplay=1",
])
def test_tiktok_video(url):
    v = resolve(url)
    assert (v["kind"], v["video_id"], v["provider"], v["capabilities"]) == ("tiktok", "6718335390845095173", "tiktok", SYNC)
    assert v["embed_url"] == "https://www.tiktok.com/player/v1/6718335390845095173"


def test_tiktok_short_links_use_oembed(oembed):
    for url in ["https://vm.tiktok.com/ZMgood123/", "https://vt.tiktok.com/ZSgood456/", "https://www.tiktok.com/t/ZTgood789/"]:
        v = resolve(url)
        assert (v["kind"], v["video_id"]) == ("tiktok", "7300000000000000001"), url
    assert oembed == ["https://vm.tiktok.com/ZMgood123/", "https://vt.tiktok.com/ZSgood456/", "https://www.tiktok.com/t/ZTgood789/"]
    assert code_of("https://vm.tiktok.com/ZMbad0001/") == "tiktok_short"


def test_tiktok_non_video_pages():
    assert code_of("https://www.tiktok.com/@scout2015") == "social_link"
    for url in ["https://www.tiktok.com.evil.example/@a/video/6718335390845095173", "https://www.tiktok.com/@a/video/123"]:
        try:
            v = resolve(url)
        except ApiError:
            continue
        assert v["kind"] != "tiktok", url


@pytest.mark.parametrize("url,embed", [
    ("https://www.instagram.com/reel/C9xYz12AbCd/", "https://www.instagram.com/reel/C9xYz12AbCd/embed/"),
    ("https://instagram.com/reels/C9xYz12AbCd?igsh=abc", "https://www.instagram.com/reel/C9xYz12AbCd/embed/"),
    ("https://www.instagram.com/p/C9xYz12AbCd/?img_index=1", "https://www.instagram.com/p/C9xYz12AbCd/embed/"),
    ("https://www.instagram.com/someone/p/C9xYz12AbCd/", "https://www.instagram.com/p/C9xYz12AbCd/embed/"),
    ("https://www.instagram.com/tv/C9xYz12AbCd/", "https://www.instagram.com/p/C9xYz12AbCd/embed/"),
    ("https://www.instagram.com/p/C9xYz12AbCd/embed/captioned/", "https://www.instagram.com/p/C9xYz12AbCd/embed/"),
])
def test_instagram(url, embed):
    # Instagram's embed has no JavaScript control and its files are locked to Instagram: it cannot play in sync for
    # everyone, so the link is refused with a clear reason (1.6.2, confirmed 1.8.1: nothing is offered "without sync")
    assert code_of(url) == "no_sync_source"
    assert resolver._instagram(url, resolver.urlparse(url))["embed_url"] == embed  # still recognised


def test_instagram_profile_is_a_clear_error():
    assert code_of("https://www.instagram.com/someone/") == "social_link"
    assert code_of("https://www.instagram.com/stories/someone/3300000000000000000/") == "social_link"


@pytest.mark.parametrize("url", [
    "https://x.com/NASA/status/1790000000000000000",
    "https://twitter.com/NASA/status/1790000000000000000?s=20",
    "https://mobile.twitter.com/NASA/status/1790000000000000000/video/1",
    "https://x.com/i/web/status/1790000000000000000",
    "https://platform.twitter.com/embed/Tweet.html?id=1790000000000000000",
])
def test_x(url, xnet):
    # 1.8.2: a pasted X post plays its video file in Nexora's own player, in sync, on the web and in the app alike
    v = resolve(url)
    assert (v["kind"], v["video_id"], v["provider"], v["capabilities"]) == ("direct", "1790000000000000000", "x", resolver.FULL_CAPS)
    assert v["stream_url"] == "https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1280x720/b.mp4?tag=12"
    assert v["url"] == "https://x.com/i/status/1790000000000000000" and v["title"] == "Launch day"
    assert xnet["fetched"] == ["1790000000000000000"]


def test_twitch_live_channels_play_live_for_everyone():
    # 1.8.3: everyone watches the channel live in Twitch's player; the room follows play / pause (no seeking live)
    t = resolve("https://m.twitch.tv/SomeChannel")
    assert (t["kind"], t["channel"], t["live"], t["capabilities"]) == ("twitch", "somechannel", True, resolver.LIVE_SYNC_CAPS)
    assert t["capabilities"]["sync"] is True and t["capabilities"]["seek"] is False
    assert code_of("https://www.twitch.tv/somechannel/clip/FunnyClip-abc") == "twitch_clip"
    assert resolve("https://www.twitch.tv/videos/2301234567")["capabilities"] == SYNC  # past broadcasts: in sync


@pytest.fixture
def kicknet(monkeypatch):
    """Kick's site API and the IVS / Kick CDN files, faked. api[path] = (status, JSON)."""
    calls = []
    api = {
        "/api/v2/channels/somestreamer": (200, {"user": {"username": "SomeStreamer"}, "livestream": {"session_title": "Gece yayını"},
                                                "playback_url": "https://abc.us-west-2.playback.live-video.net/api/video/v1/us-west-2.1.channel.x.m3u8"}),
        "/api/v2/channels/sleepy": (200, {"user": {"username": "sleepy"}, "livestream": None,
                                          "playback_url": "https://abc.us-west-2.playback.live-video.net/api/video/v1/us-west-2.1.channel.y.m3u8"}),
        "/api/v1/video/0f3a1b2c-1111-2222-3333-444455556666": (200, {"source": "https://stream.kick.com/ivs/v1/1/2026/11/20/x/media/hls/master.m3u8",
                                                                     "livestream": {"session_title": "Dünkü yayın"}}),
        "/api/v2/clips/clip_01JABCDEFGHIJ": (200, {"clip": {"title": "Gol!", "clip_url": "https://clips.kick.com/clips/ab/clip_01JABCDEFGHIJ/playlist.m3u8"}}),
    }

    async def fetch(path):
        calls.append(path)
        a = api.get(path, (404, None))
        if isinstance(a, Exception):
            raise a
        return a

    async def public(host):
        return None

    async def probe(url, referer=None, origin=None, ranged=True, browser=False):
        headers = {"content-type": "application/vnd.apple.mpegurl", "access-control-allow-origin": "*"}
        return {"status": 200, "ctype": headers["content-type"], "headers": headers, "head": b"#EXTM3U\n#EXT-X-VERSION:3\n", "final_url": url}
    monkeypatch.setattr(resolver, "kick_fetch", fetch)
    monkeypatch.setattr(resolver, "_assert_public", public)
    monkeypatch.setattr(resolver, "_probe", probe)
    return {"calls": calls, "api": api}


def test_kick_live_channel_recording_and_clip(kicknet):
    live = resolve("https://kick.com/SomeStreamer")
    assert (live["kind"], live["provider"], live["live"], live["title"]) == ("hls", "kick", True, "Gece yayını")
    assert live["stream_url"].endswith(".channel.x.m3u8") and live["capabilities"]["sync"] is True
    assert resolve("https://player.kick.com/somestreamer")["live"] is True  # Kick's embed address works too
    vod = resolve("https://kick.com/somestreamer/videos/0f3a1b2c-1111-2222-3333-444455556666")
    assert (vod["kind"], vod["live"], vod["title"]) == ("hls", False, "Dünkü yayın") and vod["stream_url"].endswith("/hls/master.m3u8")
    for url in ("https://kick.com/somestreamer?clip=clip_01JABCDEFGHIJ", "https://kick.com/somestreamer/clips/clip_01JABCDEFGHIJ"):
        c = resolve(url)
        assert (c["kind"], c["live"], c["title"]) == ("hls", False, "Gol!"), url


def test_kick_offline_missing_and_refused(kicknet):
    assert code_of("https://kick.com/sleepy") == "kick_offline"
    assert code_of("https://kick.com/nobody123") == "not_found"
    assert code_of("https://kick.com/video/0f3a1b2c-9999-2222-3333-444455556666") == "not_found"
    # 1.8.4: a live channel Kick will not tell our server about still plays, in Kick's official embed
    kicknet["api"]["/api/v2/channels/walled"] = (403, None)  # Cloudflare's bot check on the server
    w = resolve("https://kick.com/Walled")
    assert (w["kind"], w["channel"], w["live"], w["embed_url"]) == ("kick", "walled", True, "https://player.kick.com/walled")
    assert w["capabilities"] == resolver.LIVE_SYNC_CAPS  # everyone live, the room follows play / pause
    kicknet["api"]["/api/v2/channels/down"] = OSError("offline")
    assert resolve("https://kick.com/down")["kind"] == "kick"
    # recordings and clips have no such embed: the clear error stays
    kicknet["api"]["/api/v1/video/0f3a1b2c-7777-2222-3333-444455556666"] = (403, None)
    assert code_of("https://kick.com/video/0f3a1b2c-7777-2222-3333-444455556666") == "kick_app_only"
    assert asyncio.run(resolver._kick("https://kick.com/browse", resolver.urlparse("https://kick.com/browse"))) is None


def test_kick_live_stream_locked_for_other_sites_plays_in_kicks_embed(kicknet, monkeypatch):
    import config

    async def probe(url, referer=None, origin=None, ranged=True, browser=False):
        locked = browser  # the stream server answers Kick's page, not ours (no CORS for us)
        headers = {"content-type": "application/vnd.apple.mpegurl", **({} if locked else {"access-control-allow-origin": "*"})}
        return {"status": 200, "ctype": headers["content-type"], "headers": headers, "head": b"#EXTM3U\n#EXT-X-VERSION:3\n", "final_url": url}
    monkeypatch.setattr(resolver, "_probe", probe)
    live = resolve("https://kick.com/SomeStreamer")
    assert (live["kind"], live["channel"], live["title"], live["capabilities"]) == ("kick", "somestreamer", "Gece yayını", resolver.LIVE_SYNC_CAPS)
    # the app found the playlist on the channel's page: the same channel, in Kick's embed, with the app's title
    ivs = "https://abc.us-west-2.playback.live-video.net/api/video/v1/us-west-2.1.channel.x.m3u8"
    v = asyncio.run(resolver.resolve(ivs, "https://kick.com/SomeStreamer", "SomeStreamer — Gece yayını"))
    assert (v["kind"], v["channel"], v["title"]) == ("kick", "somestreamer", "SomeStreamer — Gece yayını")
    # anything else locked to its site stays refused
    with pytest.raises(ApiError) as e:
        asyncio.run(resolver.resolve(ivs, "https://kick.com/browse", "x"))
    assert e.value.code == "source_locked"
    with pytest.raises(ApiError) as e:
        asyncio.run(resolver.resolve(ivs, "https://www.reddit.com/r/a/comments/abc/x/", "x"))
    assert e.value.code == "source_locked"
    # a recording locked the same way: no embed for recordings, refused with the reason
    with pytest.raises(ApiError) as e:
        resolve("https://kick.com/somestreamer/videos/0f3a1b2c-1111-2222-3333-444455556666")
    assert e.value.code == "source_locked"
    assert config.WEB_URL


@pytest.fixture
def redditnet(monkeypatch):
    posts = {}
    calls = []

    def post(pid, data):
        posts[pid] = (200, [{"data": {"children": [{"data": data}]}}, {"data": {"children": []}}])

    async def fetch(pid):
        calls.append(pid)
        a = posts.get(pid, (404, None))
        if isinstance(a, Exception):
            raise a
        return a

    async def public(host):
        return None

    async def probe(url, referer=None, origin=None, ranged=True, browser=False):
        headers = {"content-type": "application/vnd.apple.mpegurl", "access-control-allow-origin": "*"}
        return {"status": 200, "ctype": headers["content-type"], "headers": headers, "head": b"#EXTM3U\n", "final_url": url}

    async def share(url):
        return "1abcde" if "good" in url else None
    monkeypatch.setattr(resolver, "reddit_fetch", fetch)
    monkeypatch.setattr(resolver, "_reddit_share", share)
    monkeypatch.setattr(resolver, "_assert_public", public)
    monkeypatch.setattr(resolver, "_probe", probe)
    post("1abcde", {"title": "Kedi  uçtu", "secure_media": {"reddit_video": {"hls_url": "https://v.redd.it/k1/HLSPlaylist.m3u8?a=1&v=1&f=sd",
                                                                                "fallback_url": "https://v.redd.it/k1/DASH_720.mp4"}}})
    post("2crosx", {"title": "Paylaşım", "crosspost_parent_list": [{"title": "Asıl", "media": {"reddit_video": {"hls_url": "https://v.redd.it/k2/HLSPlaylist.m3u8"}}}]})
    post("3textx", {"title": "Sadece yazı", "selftext": "..."})
    post("4ytube", {"title": "YouTube", "secure_media": {"type": "youtube.com", "oembed": {}}})
    return {"calls": calls, "posts": posts}


def test_reddit_post_video(redditnet):
    for url in ("https://www.reddit.com/r/aww/comments/1abcde/kedi_uctu/", "https://old.reddit.com/comments/1abcde",
                "https://redd.it/1abcde", "https://www.reddit.com/r/aww/s/goodShare1"):
        v = resolve(url)
        assert (v["kind"], v["provider"], v["video_id"], v["title"]) == ("hls", "reddit", "1abcde", "Kedi uçtu"), url
        assert v["stream_url"] == "https://v.redd.it/k1/HLSPlaylist.m3u8?a=1&v=1&f=sd" and v["capabilities"]["sync"] is True
    assert resolve("https://www.reddit.com/r/videos/comments/2crosx/p/")["stream_url"] == "https://v.redd.it/k2/HLSPlaylist.m3u8"


def test_reddit_errors(redditnet):
    assert code_of("https://www.reddit.com/r/videos/comments/3textx/") == "reddit_no_video"
    assert code_of("https://www.reddit.com/r/videos/comments/4ytube/") == "reddit_no_video"
    assert code_of("https://www.reddit.com/r/videos/comments/9zzzzz/") == "not_found"
    redditnet["posts"]["5block"] = (403, None)  # Reddit refusing the server
    assert code_of("https://www.reddit.com/r/videos/comments/5block/") == "reddit_app_only"
    redditnet["posts"]["6downx"] = OSError("offline")
    assert code_of("https://www.reddit.com/r/videos/comments/6downx/") == "reddit_app_only"
    assert code_of("https://www.reddit.com/r/aww/s/badShare99") == "reddit_share"
    assert code_of("https://www.reddit.com/r/aww/") == "social_link"


@pytest.fixture
def xnet(monkeypatch):
    """X's embed data and the video file, faked: posts[id] = (status, JSON); files answer like video.twimg.com."""
    resolver._x_cache.clear()
    posts = {"1790000000000000000": (200, {"__typename": "Tweet", "text": "Launch day https://t.co/AbC123",
                                           "user": {"screen_name": "NASA"}, "mediaDetails": [{"type": "video", "video_info": {"variants": [
                                               {"content_type": "application/x-mpegURL", "url": "https://video.twimg.com/ext_tw_video/1/pu/pl/b.m3u8?tag=12"},
                                               {"bitrate": 256000, "content_type": "video/mp4", "url": "https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/480x270/b.mp4?tag=12"},
                                               {"bitrate": 2176000, "content_type": "video/mp4", "url": "https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1280x720/b.mp4?tag=12"},
                                               {"bitrate": 10368000, "content_type": "video/mp4", "url": "https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1920x1080/b.mp4?tag=12"}]}}]})}
    state = {"fetched": [], "posts": posts, "file_headers": {}, "asked": [], "room_status": 206, "noref_status": 206}

    async def fetch(post_id):
        state["fetched"].append(post_id)
        a = posts.get(post_id, (404, None))
        if isinstance(a, Exception):
            raise a
        return a

    async def public(host):
        return None

    async def probe(url, referer=None, origin=None, ranged=True, browser=False):
        assert urlparse(url).hostname == "video.twimg.com", url
        state["asked"].append((browser, referer, origin))
        status = 206
        if browser:
            status = state["room_status"] if referer else state["noref_status"]
        headers = {"content-type": "video/mp4", "accept-ranges": "bytes", "content-range": "bytes 0-2047/9000000",
                   **(state["file_headers"] if browser else {})}
        return {"status": status, "ctype": "video/mp4", "headers": headers, "head": b"\x00\x00\x00\x18ftypmp42", "final_url": url}
    monkeypatch.setattr(resolver, "x_fetch", fetch)
    monkeypatch.setattr(resolver, "_assert_public", public)
    monkeypatch.setattr(resolver, "_probe", probe)
    yield state
    resolver._x_cache.clear()


def test_x_token_matches_the_embed_widget():
    # react-tweet / X's widget: ((id / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, ""), values from Node
    for post_id, token in (("1790000000000000000", "4c7g8auqyik"), ("1874511148237172937", "4jky7sbj34"), ("20", "6dq1a2xwd93"),
                           ("463440424141459456", "14fxvks611f"), ("1628832338187636740", "3y54libozsy")):
        assert resolver.x_token(post_id) == token, post_id
    assert resolver._js_radix(0.1) == "0.3lllllllllm" and resolver._js_radix(123.456) == "3f.gez4w97ry"
    assert resolver._js_radix(35.99999999999999) == "z.zzzzzzzzz" and resolver._js_radix(1e21) == "5v1j4f4ds7c000"


def test_x_quoted_video_newer_shape_and_bad_hosts(xnet):
    xnet["posts"]["1700000000000000001"] = (200, {"text": "Look", "quoted_tweet": {"text": "Original clip", "video": {"variants": [
        {"type": "application/x-mpegURL", "src": "https://video.twimg.com/amplify_video/9/pl/a.m3u8"},
        {"type": "video/mp4", "src": "https://video.twimg.com/amplify_video/9/vid/avc1/720x1280/a.mp4"}]}}})
    v = resolve("https://x.com/someone/status/1700000000000000001")
    assert v["stream_url"] == "https://video.twimg.com/amplify_video/9/vid/avc1/720x1280/a.mp4" and v["title"] == "Original clip"
    # a file anywhere but X's video host is never taken; only heavy files: the lightest one
    assert resolver._x_pick([{"content_type": "video/mp4", "bitrate": 1, "url": "https://evil.example/a.mp4"}]) is None
    assert resolver._x_pick([{"content_type": "video/mp4", "bitrate": 9e6, "url": "https://video.twimg.com/a.mp4"},
                             {"content_type": "video/mp4", "bitrate": 5e6, "url": "https://video.twimg.com/b.mp4"}]) == "https://video.twimg.com/b.mp4"


def test_x_errors_and_cache(xnet):
    xnet["posts"]["1700000000000000002"] = (200, {"text": "Only words", "mediaDetails": [{"type": "photo"}]})
    xnet["posts"]["1700000000000000003"] = (200, {"__typename": "TweetTombstone"})
    xnet["posts"]["1700000000000000004"] = (500, None)
    xnet["posts"]["1700000000000000005"] = OSError("offline")
    assert code_of("https://x.com/a/status/1700000000000000002") == "x_no_video"
    assert code_of("https://x.com/a/status/1700000000000000003") == "x_unavailable"
    assert code_of("https://x.com/a/status/1799999999999999999") == "x_unavailable"  # 404
    assert code_of("https://x.com/a/status/1700000000000000004") == "network"
    assert code_of("https://x.com/a/status/1700000000000000005") == "network"
    n = len(xnet["fetched"])
    assert code_of("https://x.com/a/status/1700000000000000002") == "x_no_video"  # remembered
    assert code_of("https://x.com/a/status/1700000000000000004") == "network"  # not remembered: tried again
    assert xnet["fetched"][n:] == ["1700000000000000004"]
    resolve("https://x.com/NASA/status/1790000000000000000")
    resolve("https://twitter.com/NASA/status/1790000000000000000")
    assert xnet["fetched"].count("1790000000000000000") == 1  # cached


def test_x_file_locked_for_other_sites_is_refused(xnet):
    xnet["file_headers"] = {"cross-origin-resource-policy": "same-site"}
    assert code_of("https://x.com/NASA/status/1790000000000000000") == "source_locked"


def test_x_file_refused_to_our_page_plays_without_referer(xnet):
    # 1.8.4: video.twimg.com answers 403 when another site's page asks (Referer) and 200 without one (the address
    # opened directly). The room then plays it from a frame that sends no Referer.
    xnet["room_status"], xnet["noref_status"] = 403, 206
    v = resolve("https://x.com/NASA/status/1790000000000000000")
    assert v["kind"] == "direct" and v["referrer_policy"] == "no-referrer"
    assert v["stream_url"] == "https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1280x720/b.mp4?tag=12"
    room = [a for a in xnet["asked"] if a[0]]
    assert room[0][1].startswith(resolver.config.WEB_URL) and room[0][2] is None  # a <video>: Referer, no Origin
    assert room[1] == (True, None, None)  # then without a Referer
    # open to our page: played as usual, no frame
    resolver._x_cache.clear()
    xnet["room_status"] = 206
    assert "referrer_policy" not in resolve("https://twitter.com/NASA/status/1790000000000000000")
    # refused both ways: refused here, not on everyone's screen
    resolver._x_cache.clear()
    xnet["room_status"], xnet["noref_status"] = 403, 403
    assert code_of("https://x.com/NASA/status/1790000000000000000") == "source_locked"


def test_x_keeps_its_own_text_over_the_page_title(xnet):
    v = asyncio.run(resolver.resolve("https://x.com/NASA/status/1790000000000000000", "https://x.com/NASA/status/1790000000000000000",
                                     'NASA on X: "Launch day" / X'))
    assert v["title"] == "Launch day"


def test_x_profile_is_a_clear_error():
    assert code_of("https://x.com/NASA") == "social_link"


@pytest.mark.parametrize("url,href", [
    ("https://www.facebook.com/watch/?v=1234567890123456", "https://www.facebook.com/watch/?v=1234567890123456"),
    ("https://m.facebook.com/watch?v=1234567890123456&ref=sharing", "https://www.facebook.com/watch/?v=1234567890123456"),
    ("https://www.facebook.com/video.php?v=1234567890123456", "https://www.facebook.com/watch/?v=1234567890123456"),
    ("https://www.facebook.com/NASA/videos/1234567890123456/", "https://www.facebook.com/NASA/videos/1234567890123456/"),
    ("https://web.facebook.com/NASA/videos/launch-day/1234567890123456", "https://www.facebook.com/NASA/videos/1234567890123456/"),
    ("https://www.facebook.com/reel/1234567890123456", "https://www.facebook.com/reel/1234567890123456"),
])
def test_facebook(url, href):
    v = resolve(url)
    assert (v["kind"], v["video_id"], v["href"], v["capabilities"]) == ("facebook", "1234567890123456", href, SYNC)
    assert v["embed_url"].startswith("https://www.facebook.com/plugins/video.php?href=")


def test_facebook_short_links_and_pages(fb_follow):
    # Facebook does not say where these lead (a login wall): the person is asked for the video's own link.
    for url in ["https://fb.watch/abcDEF123/", "https://www.facebook.com/share/v/1AbCdEfGh/", "https://www.facebook.com/share/r/1AbCdEfGh/"]:
        assert code_of(url) == "fb_short", url
    assert code_of("https://www.facebook.com/share/p/1AbCdEfGh/") == "social_link"  # a post, not known to be a video
    assert code_of("https://www.facebook.com/NASA") == "social_link"
    assert len(fb_follow["asked"]) == 4


@pytest.mark.parametrize("link,real,href", [
    ("https://www.facebook.com/share/r/1AbCdEfGh/", "https://www.facebook.com/reel/1234567890123456/?mibextid=x",
     "https://www.facebook.com/reel/1234567890123456"),
    ("https://www.facebook.com/share/v/1AbCdEfGh/", "https://www.facebook.com/NASA/videos/1234567890123456/",
     "https://www.facebook.com/NASA/videos/1234567890123456/"),
    ("https://fb.watch/abcDEF123/", "https://m.facebook.com/watch/?v=1234567890123456&ref=sharing",
     "https://www.facebook.com/watch/?v=1234567890123456"),
    ("https://www.facebook.com/share/p/1AbCdEfGh/", "https://www.facebook.com/reel/1234567890123456",
     "https://www.facebook.com/reel/1234567890123456"),
])
def test_facebook_share_links_play_through_their_video(fb_follow, link, real, href):
    """What Facebook's app copies (1.8.5): the video it leads to plays in the official player, in sync."""
    fb_follow["answers"][link] = real
    v = resolve(link)
    assert (v["kind"], v["video_id"], v["href"], v["capabilities"]) == ("facebook", "1234567890123456", href, SYNC)
    assert v["url"] == real and v["embed_url"].startswith("https://www.facebook.com/plugins/video.php?href=")
    resolve(link)  # asked once: a share link always leads to the same video
    assert fb_follow["asked"] == [link]


def test_facebook_share_link_to_a_profile_is_not_a_video(fb_follow):
    fb_follow["answers"]["https://www.facebook.com/share/v/1AbCdEfGh/"] = None
    assert code_of("https://www.facebook.com/share/v/1AbCdEfGh/") == "fb_short"


def test_fb_follow_reads_redirects_and_the_page(monkeypatch):
    """The real follower, with Facebook's answers faked: redirects (Facebook's hosts only, 5 at most), a login page's
    next=, og:url / canonical of the page; a login wall, a foreign host or an error gives None."""
    class Resp:
        def __init__(self, a):
            self.status_code, self.headers, self.body = a

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def aiter_bytes(self):
            yield self.body.encode()

    class Client:
        def __init__(self, *a, **k):
            assert k.get("follow_redirects") is False

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def stream(self, method, url, headers=None):
            assert method == "GET" and headers["User-Agent"].startswith("Mozilla/5.0")
            asked.append(url)
            return Resp(WEB[url])
    R = lambda loc: (302, {"location": loc}, "")  # noqa: E731
    P = lambda body: (200, {}, body)  # noqa: E731
    reel = "https://www.facebook.com/reel/1234567890123456/"
    WEB = {
        "https://www.facebook.com/share/r/A1/": R(reel),
        "https://fb.watch/A2/": R("https://www.facebook.com/share/v/A2b/"),
        "https://www.facebook.com/share/v/A2b/": R("/NASA/videos/1234567890123456/"),
        "https://www.facebook.com/share/v/A3/": R("https://www.facebook.com/login/?next=" + quote(reel, safe="")),
        "https://www.facebook.com/share/v/A4/": P('<html><head><meta content="https://www.facebook.com/watch/?v=1234567890123456"'
                                                   ' property="og:url"/></head></html>'),
        "https://www.facebook.com/share/v/A5/": P("<link rel='canonical' href='https://www.facebook.com/reel/1234567890123456'>"),
        "https://www.facebook.com/share/v/A6/": P('<meta property="og:url" content="https://www.facebook.com/login/">'),
        "https://www.facebook.com/share/v/A7/": R("https://evil.example/reel/1234567890123456"),
        "https://www.facebook.com/share/v/A8/": (404, {}, ""),
        "https://www.facebook.com/share/v/A9/": R("https://www.facebook.com/share/v/A9/"),  # a loop: given up after 5
    }
    asked = []
    monkeypatch.setattr(resolver.httpx, "AsyncClient", Client)
    run = lambda u: asyncio.run(REAL_FB_FOLLOW(u))  # noqa: E731
    assert run("https://www.facebook.com/share/r/A1/") == reel
    assert run("https://fb.watch/A2/") == "https://www.facebook.com/NASA/videos/1234567890123456/"
    assert run("https://www.facebook.com/share/v/A3/") == reel
    assert run("https://www.facebook.com/share/v/A4/") == "https://www.facebook.com/watch/?v=1234567890123456"
    assert run("https://www.facebook.com/share/v/A5/") == "https://www.facebook.com/reel/1234567890123456"
    assert run("https://www.facebook.com/share/v/A6/") is None
    assert run("https://www.facebook.com/share/v/A7/") is None
    assert run("https://www.facebook.com/share/v/A8/") is None
    asked.clear()
    assert run("https://www.facebook.com/share/v/A9/") is None and len(asked) == 5


def test_vimeo_still_resolves_when_pasted():
    assert resolve("https://vimeo.com/76979871")["kind"] == "vimeo"


def test_lists_offer_the_new_sites():
    import config
    import policy
    doms = [s["domain"] for s in config.ALLOWED_SITES]
    if os.environ.get("ALLOWED_SITES"):
        pytest.skip("ALLOWED_SITES is set in the environment")
    # 1.8.3: the same list on the web and in the app; Kick (live too) and Reddit are back
    assert doms == ["youtube.com", "tiktok.com", "x.com", "facebook.com", "twitch.tv", "kick.com", "reddit.com", "drive.google.com"]
    # still accepted as pages (links pasted, or a page picked in the app's browser)
    for h in ("www.twitter.com", "vm.tiktok.com", "old.reddit.com", "player.kick.com", "vimeo.com", "archive.org"):
        assert policy.is_allowed_site(h), h
    for h in ("instagram.com", "dailymotion.com", "rumble.com", "netflix.com"):  # no sync / paid player only / not offered / DRM
        assert not policy.is_allowed_site(h), h
    assert config.SERVICES_ENABLED is False or os.environ.get("SERVICES_ENABLED")  # 1.8.3: no DRM platforms


# --- Files found by the app's browser must open on the room's other devices (1.8.0) ---------------------------------
@pytest.fixture
def net(monkeypatch):
    """Fake network: answers[(kind of request)] -> (status, headers). The finder's request carries the site as Referer;
    the room's request carries our own address as Origin/Referer."""
    import config
    calls = []
    answers = {"site": (206, {}), "room": (206, {})}

    async def public(host):
        return None

    async def probe(url, referer=None, origin=None, ranged=True, browser=False):
        who = ("room" if referer else "room_noref") if browser else "site"
        if who == "room_noref" and who not in answers and (who, url) not in answers:
            who = "room"
        calls.append((who, url, ranged))
        status, extra = answers.get((who, url)) or answers[who]
        if isinstance(status, Exception):
            raise status
        hls = ".m3u8" in url
        headers = {"content-type": "application/vnd.apple.mpegurl" if hls else "video/mp4", "accept-ranges": "bytes",
                   "content-range": "bytes 0-2047/5000000", **extra}
        head = answers.get(("head", url)) or (b"#EXTM3U\n#EXT-X-VERSION:3\n" if hls else b"\x00\x00\x00\x18ftypmp42")
        return {"status": status, "ctype": headers["content-type"], "headers": headers, "head": head, "final_url": url}
    monkeypatch.setattr(resolver, "_assert_public", public)
    monkeypatch.setattr(resolver, "_probe", probe)
    return {"calls": calls, "answers": answers, "origin": config.WEB_URL}


def found(url, page):
    return asyncio.run(resolver.resolve(url, page))


def locked(url, page):
    with pytest.raises(ApiError) as e:
        found(url, page)
    return e.value.code


def test_found_hls_needs_cors_for_the_room(net):
    page, m3u8 = "https://x.com/nasa/status/1", "https://video.twimg.com/ext_tw_video/1/pu/pl/abc.m3u8?tag=12"
    net["answers"]["room"] = (200, {"access-control-allow-origin": "*"})
    v = found(m3u8, page)
    assert v["kind"] == "hls" and v["headers"] == {"Referer": page}
    assert [c[0] for c in net["calls"]] == ["site", "room"] and net["calls"][1][2] is False  # hls.js asks without Range
    net["answers"]["room"] = (200, {"access-control-allow-origin": net["origin"]})
    assert found(m3u8, page)["kind"] == "hls"
    net["answers"]["room"] = (200, {"access-control-allow-origin": "https://x.com"})
    assert locked(m3u8, page) == "source_locked"
    net["answers"]["room"] = (200, {})
    assert locked(m3u8, page) == "source_locked"


def test_found_mp4_must_not_be_hotlink_locked(net):
    page, mp4 = "https://rumble.com/v1-test.html", "https://1a-1791.com/video/s8/2/a/b/c.mp4"
    assert found(mp4, page)["kind"] == "direct"  # <video> needs no CORS
    assert net["calls"][1] == ("room", mp4, True)
    net["answers"]["room"] = (403, {})
    assert locked(mp4, page) == "source_locked"
    net["answers"]["room"] = (ApiError(422, "network", "slow"), {})
    assert found(mp4, page)["kind"] == "direct"  # a timeout right after a good answer does not refuse the file


def test_found_mp4_refused_to_our_page_plays_without_referer(net):
    page, mp4 = "https://cdn-site.example/watch/1", "https://media.example.net/v/clip.mp4"
    net["answers"]["room"] = (403, {})
    net["answers"]["room_noref"] = (206, {})
    v = found(mp4, page)
    assert v["kind"] == "direct" and v["referrer_policy"] == "no-referrer"
    assert [c[0] for c in net["calls"]] == ["site", "room", "room_noref"]
    net["answers"]["room_noref"] = (206, {"cross-origin-resource-policy": "same-site"})
    assert locked(mp4, page) == "source_locked"  # locked to its site whatever the Referer
    net["answers"]["room_noref"] = (404, {})
    assert locked(mp4, page) == "source_locked"
    net["answers"]["room"] = (500, {})
    assert locked(mp4, page) == "source_locked"  # only a refusal (401 / 403) is retried without a Referer


def test_pasted_files_are_not_asked_twice(net):
    net["answers"]["room"] = (403, {})
    assert asyncio.run(resolver.resolve("https://cdn.example.org/movie.mp4"))["kind"] == "direct"
    assert [c[0] for c in net["calls"]] == ["site"]


def test_found_mp4_locked_by_cross_origin_resource_policy(net):
    # Instagram-style CDN: the file opens on the site's own page only (CORP), so a <video> elsewhere is blocked
    page, mp4 = "https://www.reddit.com/r/videos/comments/abc/x/", "https://cdn.example.net/v/clip.mp4"
    for corp in ("same-origin", "same-site", "Same-Origin"):
        net["answers"]["room"] = (206, {"cross-origin-resource-policy": corp})
        assert locked(mp4, page) == "source_locked", corp
    net["answers"]["room"] = (206, {"cross-origin-resource-policy": "cross-origin"})
    assert found(mp4, page)["kind"] == "direct"


def test_found_hls_checks_what_the_playlist_points_to(net):
    page = "https://kick.com/somestreamer/videos/0f3a1b2c-1111-2222-3333-444455556666"
    master = "https://stream.kick.com/ivs/v1/1/2026/11/20/x/media/hls/master.m3u8"
    variant = "https://stream.kick.com/ivs/v1/1/2026/11/20/x/media/hls/720p30/playlist.m3u8"
    net["answers"][("head", master)] = b"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720\n720p30/playlist.m3u8\n"
    net["answers"]["room"] = (200, {"access-control-allow-origin": "*"})
    net["answers"][("room", variant)] = (200, {})  # the rendition is not open to us: hls.js would fail on it
    assert locked(master, page) == "source_locked"
    assert ("room", variant, False) in net["calls"]
    net["answers"][("room", variant)] = (200, {"access-control-allow-origin": "*"})
    assert found(master, page)["kind"] == "hls"


def test_tiny_mp4_is_a_piece_not_a_video(net):
    # an fMP4 init segment (X's HLS) looks like an .mp4 but has nothing to watch
    page, init = "https://x.com/nasa/status/1", "https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/720x1280/AbC.mp4"
    net["answers"]["site"] = (206, {"content-range": "bytes 0-911/912"})
    assert locked(init, page) == "too_small"
    net["answers"]["site"] = (206, {"content-range": "bytes 0-2047/2400000"})
    assert found(init, page)["kind"] == "direct"


def test_tiktok_video_the_site_does_not_let_others_show_is_refused(tiktok_meta):
    page = "https://www.tiktok.com/@someone/video/7300000000000000011"
    tiktok_meta["answers"][page] = (400, {"code": 400, "message": "Something went wrong"})
    assert code_of(page + "?is_from_webapp=1&sender_device=pc") == "tiktok_unavailable"
    assert code_of(page) == "tiktok_unavailable" and tiktok_meta["asked"] == [page]  # remembered for a while
    ok = "https://www.tiktok.com/@scout2015/video/6718335390845095173"
    tiktok_meta["answers"][ok] = (200, {"title": "  Scramble up ur name & I’ll try to guess it  ", "author_name": "Scout"})
    assert resolve(ok)["title"] == "Scramble up ur name & I’ll try to guess it"
    nocap = "https://www.tiktok.com/@quiet/video/7300000000000000012"
    tiktok_meta["answers"][nocap] = (200, {"title": "", "author_name": "Quiet One"})
    assert resolve(nocap)["title"] == "TikTok · Quiet One"
    # no answer, a server error or a refusal of our server: nothing is refused, the caption is just unknown
    assert resolve("https://www.tiktok.com/@offline/video/7300000000000000013")["title"] == "TikTok · @offline"
    busy = "https://www.tiktok.com/@busy/video/7300000000000000014"
    tiktok_meta["answers"][busy] = (403, None)
    assert resolve(busy)["kind"] == "tiktok"
    # an embed address has no author: TikTok is not asked
    n = len(tiktok_meta["asked"])
    assert resolve("https://www.tiktok.com/embed/v2/7300000000000000015")["title"] == "TikTok"
    assert len(tiktok_meta["asked"]) == n


def test_tiktok_short_link_keeps_the_caption_oembed_gave(monkeypatch):
    import json as _json

    class Resp:
        status_code = 200
        content = _json.dumps({"embed_product_id": "7300000000000000031", "title": "Kedi  dansı", "author_name": "Mia"}).encode()

        def json(self):
            return _json.loads(self.content)

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None):
            assert url.startswith(resolver.TIKTOK_OEMBED)
            return Resp()
    monkeypatch.setattr(resolver.httpx, "AsyncClient", Client)
    v = resolve("https://vt.tiktok.com/ZSmia0001/")
    assert (v["video_id"], v["title"]) == ("7300000000000000031", "Kedi dansı")


def test_youtube_video_that_cannot_play_elsewhere_is_refused(monkeypatch):
    # 1.8.4: YouTube's oEmbed answers 401 (private, embedding turned off) or 404 (removed): refused with the reason,
    # instead of "Video unavailable" on everyone's screen. Any other trouble refuses nothing.
    resolver._title_cache.clear()
    seen = []

    async def fetch(url):
        seen.append(url)
        if "AAAAAAAAAAA" in url:
            raise resolver.OEmbedRefused(401)
        if "BBBBBBBBBBB" in url:
            raise resolver.OEmbedRefused(404)
        if "CCCCCCCCCCC" in url:
            raise OSError("offline")
        return {"title": "Big Buck Bunny"}
    monkeypatch.setattr(resolver, "oembed_fetch", fetch)
    assert code_of("https://www.youtube.com/watch?v=AAAAAAAAAAA") == "yt_embed"
    assert code_of("https://youtu.be/AAAAAAAAAAA") == "yt_embed" and len(seen) == 1  # remembered for a while
    assert code_of("https://www.youtube.com/shorts/BBBBBBBBBBB") == "yt_notfound"
    assert resolve("https://www.youtube.com/watch?v=CCCCCCCCCCC")["title"] == "YouTube"
    assert resolve("https://www.youtube.com/watch?v=aqz-KE-bpKQ")["title"] == "Big Buck Bunny"
    resolver._title_cache.clear()


def test_tiktok_photo_post_is_a_clear_error(monkeypatch):
    assert code_of("https://www.tiktok.com/@someone/photo/7300000000000000021") == "tiktok_photo"

    async def no_oembed(url):
        return None

    async def redirect(url):  # a share link of a photo post (slideshow)
        return ("7300000000000000022", "someone", True)
    monkeypatch.setattr(resolver, "_tiktok_oembed", no_oembed)
    monkeypatch.setattr(resolver, "_tiktok_redirect", redirect)
    assert code_of("https://vt.tiktok.com/ZSphoto01/") == "tiktok_photo"


def test_tiktok_short_link_falls_back_to_its_redirect(monkeypatch):
    async def no_oembed(url):
        return None
    seen = []

    async def redirect(url):
        seen.append(url)
        return ("7300000000000000002", "someone", False) if "good" in url else None
    monkeypatch.setattr(resolver, "_tiktok_oembed", no_oembed)
    monkeypatch.setattr(resolver, "_tiktok_redirect", redirect)
    v = resolve("https://vm.tiktok.com/ZMgood999/")
    assert (v["kind"], v["video_id"], v["capabilities"]) == ("tiktok", "7300000000000000002", SYNC)
    assert code_of("https://vt.tiktok.com/ZSbad0002/") == "tiktok_short"
    assert seen == ["https://vm.tiktok.com/ZMgood999/", "https://vt.tiktok.com/ZSbad0002/"]


def test_tiktok_redirect_reads_only_the_location(monkeypatch):
    class Resp:
        def __init__(self, loc):
            self.headers = {"location": loc}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    class Client:
        def __init__(self, *a, **k):
            assert k.get("follow_redirects") is False

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def stream(self, method, url, headers=None):
            return Resp(LOC[url])
    LOC = {"https://vm.tiktok.com/A1/": "https://www.tiktok.com/@scout2015/video/6718335390845095173?_r=1",
           "https://vm.tiktok.com/A2/": "/@scout2015/video/6718335390845095174",
           "https://vm.tiktok.com/A3/": "https://www.tiktok.com/login?redirect=x",
           "https://vm.tiktok.com/A4/": "https://evil.example/@a/video/6718335390845095175"}
    monkeypatch.setattr(resolver.httpx, "AsyncClient", Client)
    run = lambda u: asyncio.run(resolver._tiktok_redirect(u))  # noqa: E731
    assert run("https://vm.tiktok.com/A1/") == ("6718335390845095173", "scout2015", False)
    assert run("https://vm.tiktok.com/A2/") is None  # relative: resolved against vm.tiktok.com, not a video page there
    assert run("https://vm.tiktok.com/A3/") is None
    assert run("https://vm.tiktok.com/A4/") is None

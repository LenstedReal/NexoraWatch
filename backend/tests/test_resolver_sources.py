"""Offline tests of the social-video sources (TikTok, Instagram, X, Facebook): only address recognition, no network.
TikTok short links go through the official oEmbed API; that call is replaced here."""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import resolver  # noqa: E402
from security import ApiError  # noqa: E402

SYNC = {"seek": True, "rate_correction": False, "sync": True}
NOSYNC = {"seek": False, "rate_correction": False, "sync": False}


def resolve(url):
    return asyncio.run(resolver.resolve(url))


def code_of(url):
    with pytest.raises(ApiError) as e:
        resolve(url)
    return e.value.code if hasattr(e.value, "code") else e.value.args[1]


@pytest.fixture
def oembed(monkeypatch):
    seen = []

    async def fake(url):
        seen.append(url)
        return "7300000000000000001" if "good" in url else None
    monkeypatch.setattr(resolver, "_tiktok_oembed", fake)
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
    # 1.6.2: Instagram embeds cannot play in sync for everyone, so the link is refused with a clear reason
    assert code_of(url) == "no_sync_source"


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
def test_x(url):
    # 1.6.2: X embeds cannot play in sync, refused; 1.8.0: with the way that works (the app's browser finds the file)
    assert code_of(url) == "find_in_app"


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


def test_facebook_short_links_and_pages():
    for url in ["https://fb.watch/abcDEF123/", "https://www.facebook.com/share/v/1AbCdEfGh/", "https://www.facebook.com/share/r/1AbCdEfGh/"]:
        assert code_of(url) == "fb_short", url
    assert code_of("https://www.facebook.com/NASA") == "social_link"


def test_vimeo_still_resolves_when_pasted():
    assert resolve("https://vimeo.com/76979871")["kind"] == "vimeo"


def test_lists_offer_the_new_sites():
    import config
    import policy
    doms = [s["domain"] for s in config.ALLOWED_SITES]
    if os.environ.get("ALLOWED_SITES"):
        pytest.skip("ALLOWED_SITES is set in the environment")
    # official players and the sites whose video file the app's browser finds (1.8.0: the wide list is back)
    for d in ("youtube.com", "tiktok.com", "facebook.com", "twitch.tv", "vimeo.com", "x.com", "kick.com", "dailymotion.com",
              "reddit.com", "rumble.com", "odysee.com", "streamable.com", "archive.org", "drive.google.com"):
        assert d in doms
    for d in ("instagram.com", "bilibili.tv"):  # no sync (Instagram embed) / DASH only (Bilibili): not offered
        assert d not in doms
    # still accepted as a page picked in the app's browser
    assert policy.is_allowed_site("old.reddit.com") and policy.is_allowed_site("www.twitter.com") and policy.is_allowed_site("vm.tiktok.com")
    assert not policy.is_allowed_site("instagram.com")


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

    async def probe(url, referer=None, origin=None, ranged=True):
        who = "room" if (origin or (referer or "").startswith(config.WEB_URL)) else "site"
        calls.append((who, url, ranged))
        status, extra = answers[who]
        if isinstance(status, Exception):
            raise status
        hls = ".m3u8" in url
        headers = {"content-type": "application/vnd.apple.mpegurl" if hls else "video/mp4", "accept-ranges": "bytes", **extra}
        return {"status": status, "ctype": headers["content-type"], "headers": headers,
                "head": b"#EXTM3U\n#EXT-X-VERSION:3\n" if hls else b"\x00\x00\x00\x18ftypmp42", "final_url": url}
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


def test_pasted_files_are_not_asked_twice(net):
    net["answers"]["room"] = (403, {})
    assert asyncio.run(resolver.resolve("https://cdn.example.org/movie.mp4"))["kind"] == "direct"
    assert [c[0] for c in net["calls"]] == ["site"]

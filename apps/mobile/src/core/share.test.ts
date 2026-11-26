import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanUserAgent, facebookVideoUrl, firstUrl, isFacebookShareLink, isShareLink, shareText } from "./share.ts";

test("share links are told apart from room links, and their text is read back", () => {
  const text = "Şuna bak https://vm.tiktok.com/ZMabc12/ #fyp";
  // what MainActivity builds: "nexora://share?text=" + Uri.encode(text) (spaces as %20, # as %23)
  const link = "nexora://share?text=" + encodeURIComponent(text);
  assert.equal(isShareLink(link), true);
  assert.equal(shareText(link), text);
  assert.equal(shareText("nexora://share?x=1&text=a%20b"), "a b");
  assert.equal(shareText("nexora://share?text=a+b"), "a b");
  assert.equal(shareText("nexora://share?text=%E0%A4%A"), null); // broken encoding
  assert.equal(shareText("nexora://share"), null);
  for (const l of ["nexora://room/ABC234", "https://nexora.lenstedreal.info/room/ABC234", "nexora://shared", "", null])
    assert.equal(isShareLink(l as string), false, String(l));
});

test("the first web address in a shared text", () => {
  assert.equal(firstUrl("Şuna bak https://vm.tiktok.com/ZMabc12/ #fyp"), "https://vm.tiktok.com/ZMabc12/");
  assert.equal(firstUrl("https://youtu.be/aqz-KE-bpKQ?si=Xy12"), "https://youtu.be/aqz-KE-bpKQ?si=Xy12");
  assert.equal(firstUrl("Watch: https://www.reddit.com/r/aww/s/AbCdEf12."), "https://www.reddit.com/r/aww/s/AbCdEf12");
  assert.equal(firstUrl("(https://x.com/NASA/status/1790000000000000000)"), "https://x.com/NASA/status/1790000000000000000");
  assert.equal(firstUrl("https://en.wikipedia.org/wiki/Foo_(bar)"), "https://en.wikipedia.org/wiki/Foo_(bar)");
  assert.equal(firstUrl("“https://www.facebook.com/share/r/1AbCdEf/”"), "https://www.facebook.com/share/r/1AbCdEf/");
  assert.equal(firstUrl("first https://kick.com/xqc then https://twitch.tv/x"), "https://kick.com/xqc");
  for (const t of ["", "no link here", "http://", "ftp://example.com/a", null]) assert.equal(firstUrl(t as string), null, String(t));
});

test("Facebook share links and the video they lead to", () => {
  for (const u of ["https://fb.watch/abCD12_x/", "https://www.facebook.com/share/v/1AbCdEf/", "https://m.facebook.com/share/r/1AbCdEfGh", "https://facebook.com/share/v/AbCd1234/"])
    assert.equal(isFacebookShareLink(u), true, u);
  for (const u of ["https://www.facebook.com/reel/123456789", "https://www.facebook.com/share/p/1AbCdEf/", "https://evilfacebook.com/share/v/1AbCdEf/", "https://fb.watch/", "nope"])
    assert.equal(isFacebookShareLink(u), false, u);
  assert.equal(facebookVideoUrl("https://www.facebook.com/reel/1234567890123456/?mibextid=abc"), "https://www.facebook.com/reel/1234567890123456");
  assert.equal(facebookVideoUrl("https://m.facebook.com/watch/?v=1234567890&rdid=x"), "https://www.facebook.com/watch/?v=1234567890");
  assert.equal(facebookVideoUrl("https://www.facebook.com/NASA/videos/launch-day/1234567890/"), "https://www.facebook.com/NASA/videos/1234567890/");
  assert.equal(facebookVideoUrl("https://www.facebook.com/login/?next=" + encodeURIComponent("https://www.facebook.com/reel/1234567890123456/")),
    "https://www.facebook.com/reel/1234567890123456");
  for (const u of ["https://www.facebook.com/login/", "https://www.facebook.com/share/v/1AbCdEf/", "https://www.facebook.com/NASA", "https://www.facebook.com/watch/?v=abc",
    "https://example.com/reel/1234567890", "https://www.facebook.com/login/?next=" + encodeURIComponent("https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2Freel%2F1234567890")])
    assert.equal(facebookVideoUrl(u), null, u);
});

test("the site browser's user agent looks like Chrome, not like a WebView", () => {
  const wv = "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.135 Mobile Safari/537.36 NexoraWatchApp/1.8.5";
  assert.equal(cleanUserAgent(wv), "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.135 Mobile Safari/537.36");
  const chrome = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
  assert.equal(cleanUserAgent(chrome), chrome);
  for (const u of ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148", "", null])
    assert.equal(cleanUserAgent(u as string), null, String(u));
});

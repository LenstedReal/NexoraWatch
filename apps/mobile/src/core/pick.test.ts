import { test } from "node:test";
import assert from "node:assert/strict";
import { PICK_TTL_MS, PickBox, roomPath } from "./pick.ts";

const video = { url: "https://video.twimg.com/ext_tw_video/1/pu/pl/a.m3u8", page: "https://x.com/a/status/1", title: "Clip", kind: "hls" };

test("roomPath finds the room in addresses and paths", () => {
  assert.equal(roomPath("https://nexora.lenstedreal.info/room/abc234?x=1"), "/room/ABC234");
  assert.equal(roomPath("/room/ABC234"), "/room/ABC234");
  assert.equal(roomPath("/room/ABC23"), "");
  assert.equal(roomPath("https://nexora.lenstedreal.info/"), "");
  assert.equal(roomPath(null), "");
});

test("a pick waits until the room confirms it, and is sent again after the page reloaded", () => {
  const box = new PickBox();
  box.open("/room/ABC234");
  const res = box.picked(video, 1000);
  assert.deepEqual(res, { url: video.url, referer: video.page, title: "Clip", kind: "hls", room: "/room/ABC234" });
  // the page reloaded before it got the pick: it asks again
  assert.deepEqual(box.ready("/room/abc234", 5000), res);
  box.ack();
  assert.equal(box.ready("/room/ABC234", 6000), null);
});

test("a pick is never sent to another room, and goes stale", () => {
  const box = new PickBox();
  box.open("/room/ABC234");
  box.picked(video, 0);
  assert.equal(box.ready("/room/ZZZ999", 1000), null);
  assert.equal(box.ready("/", 1000), null);
  assert.equal(box.ready("/room/ABC234", PICK_TTL_MS + 1), null);
  assert.equal(box.ready("/room/ABC234", 10), null); // dropped for good once stale
});

test("opening the browser again drops an older pick; empty titles become null", () => {
  const box = new PickBox();
  box.open("/room/ABC234");
  box.picked({ ...video, title: "" }, 0);
  box.open("/room/ABC234");
  assert.equal(box.ready("/room/ABC234", 10), null);
  assert.equal(box.picked({ ...video, title: "" }, 20).title, null);
});

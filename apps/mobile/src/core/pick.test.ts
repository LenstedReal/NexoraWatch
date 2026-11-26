import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACK_TIMEOUT_MS, PICK_TTL_MS, PickBox, PickWaiters, RESULT_TIMEOUT_MS, SHARE_TTL_MS, parsePickResult, roomPath, type PickOutcome,
} from "./pick.ts";

const video = { url: "https://video.twimg.com/ext_tw_video/1/pu/pl/a.m3u8", page: "https://x.com/a/status/1", title: "Clip", kind: "hls" };
const other = { url: "https://www.tiktok.com/@nasa/video/7300000000000000001", page: "https://www.tiktok.com/foryou", title: "Launch", kind: "tiktok" };

test("roomPath finds the room in addresses and paths", () => {
  assert.equal(roomPath("https://nexora.lenstedreal.info/room/abc234?x=1"), "/room/ABC234");
  assert.equal(roomPath("/room/ABC234"), "/room/ABC234");
  assert.equal(roomPath("/room/ABC23"), "");
  assert.equal(roomPath("https://nexora.lenstedreal.info/"), "");
  assert.equal(roomPath(null), "");
});

test("a pick carries an id and its source, and waits until the room confirms it", () => {
  const box = new PickBox();
  box.open("/room/ABC234");
  const res = box.picked(video, 1000);
  assert.match(res.id, /^p[0-9a-z]+$/);
  assert.deepEqual({ ...res, id: "x" }, { id: "x", url: video.url, referer: video.page, title: "Clip", kind: "hls", room: "/room/ABC234", source: "browser" });
  // the page reloaded before it got the pick: it asks again
  assert.deepEqual(box.ready("/room/abc234", 5000), [res]);
  assert.equal(box.ack(res.id), res.id);
  assert.deepEqual(box.ready("/room/ABC234", 6000), []);
  // the answer closes it
  assert.deepEqual(box.result(res.id), res);
  assert.equal(box.result(res.id), null);
});

test("several picks travel at once; all unconfirmed ones are sent again, oldest first", () => {
  const box = new PickBox();
  box.open("/room/ABC234");
  const a = box.picked(video, 0);
  const b = box.picked(other, 10);
  assert.notEqual(a.id, b.id);
  assert.deepEqual(box.ready("/room/ABC234", 20).map((r) => r.id), [a.id, b.id]);
  box.ack(b.id);
  assert.deepEqual(box.ready("/room/ABC234", 30).map((r) => r.id), [a.id]);
  // an old room page acks without an id: the oldest one still waiting
  assert.equal(box.ack(), a.id);
  assert.equal(box.ack(), null);
  assert.equal(box.waiting(40), 0);
});

test("a pick is never sent to another room, and goes stale", () => {
  const box = new PickBox();
  box.open("/room/ABC234");
  box.picked(video, 0);
  assert.deepEqual(box.ready("/room/ZZZ999", 1000), []);
  assert.deepEqual(box.ready("/", 1000), []);
  assert.deepEqual(box.ready("/room/ABC234", PICK_TTL_MS + 1), []);
  assert.deepEqual(box.ready("/room/ABC234", 10), []); // dropped for good once stale
});

test("opening the browser for another room drops picks for the first; the same room keeps them", () => {
  const box = new PickBox();
  box.open("/room/ABC234");
  const a = box.picked({ ...video, title: "" }, 0);
  assert.equal(a.title, null);
  box.open("/room/ABC234");
  assert.deepEqual(box.ready("/room/ABC234", 10).map((r) => r.id), [a.id]);
  box.open("/room/ZZZ999");
  assert.deepEqual(box.ready("/room/ABC234", 20), []);
  assert.deepEqual(box.ready("/room/ZZZ999", 20), []);
});

test("a share with no room open waits 10 minutes for any room", () => {
  const box = new PickBox();
  const s = box.picked({ url: "https://vm.tiktok.com/ZMabc/", page: "https://vm.tiktok.com/ZMabc/", title: "", kind: "page" }, 0, { source: "share", room: "" });
  assert.deepEqual([s.room, s.source, s.title], ["", "share", null]);
  assert.deepEqual(box.ready("/", 1000), []); // the home page is not a room
  box.open("/room/ZZZ999"); // opening the browser in a room keeps it
  assert.deepEqual(box.ready("/room/QQQ222", PICK_TTL_MS + 5).map((r) => r.id), [s.id]);
  assert.deepEqual(box.ready("/room/QQQ222", SHARE_TTL_MS + 1), []);
  // a share to the room on screen has the normal time
  const t = box.picked(video, 0, { source: "share", room: "https://nexora.lenstedreal.info/room/abc234" });
  assert.equal(t.room, "/room/ABC234");
  assert.deepEqual(box.ready("/room/ABC234", PICK_TTL_MS + 1), []);
  assert.equal(box.get(t.id), null);
});

test("drop forgets a pick", () => {
  const box = new PickBox();
  box.open("/room/ABC234");
  const a = box.picked(video, 0);
  box.drop(a.id);
  assert.deepEqual(box.ready("/room/ABC234", 1), []);
});

test("parsePickResult reads the room's answer", () => {
  assert.deepEqual(parsePickResult({ type: "pick_result", id: "p1", ok: true, queued: false, can_play_now: false, title: "Clip" }),
    { id: "p1", state: "added", canPlayNow: false, title: "Clip", error: null });
  assert.deepEqual(parsePickResult({ type: "pick_result", id: "p2", ok: true, queued: true, can_play_now: true, title: null }),
    { id: "p2", state: "queued", canPlayNow: true, title: null, error: null });
  assert.deepEqual(parsePickResult({ type: "pick_result", id: "p3", ok: false, error: "  Bu video gizli.  " }),
    { id: "p3", state: "error", canPlayNow: false, title: null, error: "Bu video gizli." });
  assert.equal(parsePickResult({ type: "pick_result", id: "p4", ok: false, error: "" })?.error, null);
  assert.equal(parsePickResult({ type: "pick_result", id: "p5", ok: true, queued: false, can_play_now: true })?.canPlayNow, false);
  for (const bad of [null, {}, { type: "pick_ack", id: "p1" }, { type: "pick_result" }, { type: "pick_result", id: 3, ok: true }])
    assert.equal(parsePickResult(bad), null);
});

function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setT: (fn: () => void, ms: number) => { const id = next++; timers.set(id, { at: now + ms, fn }); return id; },
    clearT: (id: unknown) => { timers.delete(id as number); },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) if (t.at <= now && timers.has(id)) { timers.delete(id); t.fn(); }
    },
    pending: () => timers.size,
  };
}

test("waiters: the room's answer settles the pick", async () => {
  const c = fakeClock();
  const w = new PickWaiters(c.setT, c.clearT);
  const p = w.wait("p1");
  w.ack("p1");
  const o: PickOutcome = { id: "p1", state: "queued", canPlayNow: true, title: null, error: null };
  assert.equal(w.result(o), true);
  assert.deepEqual(await p, o);
  assert.equal(c.pending(), 0);
  assert.equal(w.result(o), false); // nobody waits any more
});

test("waiters: no ack in time = the room did not answer, and the pick is given up", async () => {
  const c = fakeClock();
  const gaveUp: string[] = [];
  const w = new PickWaiters(c.setT, c.clearT, (id) => gaveUp.push(id));
  const p = w.wait("p1");
  c.advance(ACK_TIMEOUT_MS - 1);
  assert.equal(w.has("p1"), true);
  c.advance(1);
  assert.deepEqual(await p, { id: "p1", state: "error", canPlayNow: false, title: null, error: null });
  assert.deepEqual(gaveUp, ["p1"]);
});

test("waiters: acked but no answer (an old room page) = sent; the ack restarts the clock", async () => {
  const c = fakeClock();
  const gaveUp: string[] = [];
  const w = new PickWaiters(c.setT, c.clearT, (id) => gaveUp.push(id));
  const p = w.wait("p1");
  c.advance(ACK_TIMEOUT_MS - 1000);
  w.ack("p1");
  c.advance(RESULT_TIMEOUT_MS - 1);
  assert.equal(w.has("p1"), true);
  c.advance(1);
  assert.equal((await p).state, "sent");
  assert.deepEqual(gaveUp, []);
});

test("waiters: play now waits for an answer without an ack; none in time is an error", async () => {
  const c = fakeClock();
  const gaveUp: string[] = [];
  const w = new PickWaiters(c.setT, c.clearT, (id) => gaveUp.push(id));
  const p = w.wait("p9", "play_now");
  w.ack("p9"); // an ack changes nothing for play now
  c.advance(RESULT_TIMEOUT_MS);
  assert.deepEqual(await p, { id: "p9", state: "error", canPlayNow: false, title: null, error: null });
  assert.deepEqual(gaveUp, []);
  const q = w.wait("p9", "play_now");
  w.result({ id: "p9", state: "added", canPlayNow: false, title: "Clip", error: null });
  assert.equal((await q).state, "added");
});

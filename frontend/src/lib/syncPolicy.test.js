import { createGuestSync, guestStep, noteJump } from "./syncPolicy";

// A phone whose every jump costs `cost` s of loading (the picture stands still meanwhile), joining a room 90 s in.
// The guest loop ticks every 500 ms, like usePlaybackSync. Returns how often it jumped and how long it stood still.
function replay({ cost, supportsRate = true, secs = 180, oldRule = false }) {
  const p = { t: 0, rate: 1, loadLeft: 0, jumps: 0, frozen: 0 };
  const seek = (x) => { p.t = x; p.loadLeft = cost; p.jumps += 1; };
  const st = createGuestSync();
  let host = 90;
  let cooldown = 0;
  seek(host);
  noteJump(st, 0);
  for (let ms = 0; ms < secs * 1000; ms += 100) {
    host += 0.1;
    if (p.loadLeft > 0) { p.loadLeft -= 0.1; p.frozen += 0.1; } else p.t += 0.1 * p.rate;
    if (ms % 500) continue;
    if (oldRule) { // the rule before 1.8.0: jump whenever 2 s off, aimed 0.15 s ahead, 3 s apart
      if (p.loadLeft <= 0 && Math.abs(p.t - host) > 2 && ms > cooldown) { seek(host + 0.15); cooldown = ms + 3000; }
      continue;
    }
    const out = guestStep(st, { now: ms, t: p.t, target: host, buffering: p.loadLeft > 0, supportsRate });
    if (out.seek != null) seek(out.seek);
    if (out.rate != null) p.rate = out.rate;
  }
  return { jumps: p.jumps, frozen: p.frozen, drift: p.t - host };
}

test("the old rule froze a slow phone for good (the bug this module fixes)", () => {
  const r = replay({ cost: 4, oldRule: true });
  expect(r.jumps).toBeGreaterThan(30);
  expect(r.frozen).toBeGreaterThan(170);
});

test("a slow phone settles after a few jumps and then plays on", () => {
  for (const supportsRate of [true, false]) {
    const r = replay({ cost: 4, supportsRate });
    expect(r.jumps).toBeLessThanOrEqual(4);
    expect(r.frozen).toBeLessThan(20);
    expect(Math.abs(r.drift)).toBeLessThan(supportsRate ? 0.5 : 2);
  }
});

test("a fast phone jumps once and stays in sync", () => {
  const r = replay({ cost: 0.3 });
  expect(r.jumps).toBe(1);
  expect(Math.abs(r.drift)).toBeLessThan(0.3);
});

test("the host's own jump is followed at once and does not widen the tolerance", () => {
  const st = createGuestSync();
  let now = 0;
  let target = 100;
  const tick = (t) => guestStep(st, { now, t, target });
  for (let i = 0; i < 4; i += 1) { tick(target); now += 500; target += 0.5; } // in sync
  for (let k = 0; k < 5; k += 1) {
    target += 120; // host seeks two minutes ahead
    const out = tick(target - 120);
    expect(out.seek).toBeGreaterThan(target);
    expect(out.level).toBe(0);
    now += 500; target += 0.5;
    tick(out.seek + 0.5);
    now += 2000; target += 2;
    tick(out.seek + 2.5);
    now += 500; target += 0.5;
  }
});

test("jumps that keep coming widen the tolerance, a calm minute narrows it", () => {
  const st = createGuestSync();
  let now = 0;
  let target = 50;
  let levelSeen = 0;
  for (let i = 0; i < 40; i += 1) { // always 3 s behind after every jump: a phone that cannot keep up
    const out = guestStep(st, { now, t: target - 3, target });
    levelSeen = Math.max(levelSeen, out.level);
    now += 500; target += 0.5;
  }
  expect(levelSeen).toBeGreaterThanOrEqual(1);
  for (let i = 0; i < 300; i += 1) { guestStep(st, { now, t: target, target }); now += 500; target += 0.5; }
  expect(st.level).toBe(0);
});

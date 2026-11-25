// How a guest follows the host while the room is playing. Pure (no React, no timers): usePlaybackSync calls
// guestStep twice a second, and the tests replay it against a simulated slow phone.
//
// The freeze this prevents: a guest on a slow line falls 2 s behind, jumps to the host's moment, spends 3–6 s
// loading there, comes out behind again and jumps again, so the picture stops every few seconds for good.
// Three things break that loop:
//   lead     every jump forward is aimed ahead by what this phone's earlier jumps really cost (learned, at most 4 s)
//   settle   after a jump or a stall the player gets a moment to run before its drift is judged again
//   backoff  jumps that keep coming (3 within 45 s) widen the tolerance 2 → 4 → 8 s and the wait between jumps;
//            a calm minute narrows it again. Inside the tolerance our own player catches up by speed (±5–10 %).
// A jump the host caused (seek, new position) is followed at once and never counts towards the backoff.

export const DRIFT_SEEK_S = 2;
const LEVELS = [
  { seek: DRIFT_SEEK_S, cooldown: 3000, span: 0.05 },
  { seek: 4, cooldown: 8000, span: 0.08 },
  { seek: 8, cooldown: 15000, span: 0.1 },
];
const RATE_ON_S = 0.25; // speed correction starts above this drift…
const RATE_OFF_S = 0.08; // …and goes on until the drift is this small
const SETTLE_MS = 1200;
const LEAD_MIN_S = 0.15;
const LEAD_MAX_S = 4;
const BURST_MS = 45000;
const BURST_N = 3;
const CALM_MS = 60000;
const HOST_MOVE_S = 1.5; // the room's moment moved this far from its own course: the host did something

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Fresh state for a new video. What a phone learned about its own jump cost (`lead`) is kept. */
export function createGuestSync(prev) {
  return {
    lead: prev?.lead ? { ...prev.lead } : { fwd: LEAD_MIN_S, back: LEAD_MIN_S },
    level: 0, levelAt: 0, cooldownUntil: 0, settleUntil: 0, lastJumpAt: 0,
    wasBuffering: false, pending: null, jumps: [], correcting: false, prev: null,
  };
}

/** A jump made outside guestStep (joining, resuming, the tap to play): give the player time to start, learn nothing. */
export function noteJump(st, now) {
  st.settleUntil = Math.max(st.settleUntil, now + SETTLE_MS);
  st.pending = null;
  st.correcting = false;
}

/**
 * One tick of a guest whose room is playing and whose own player is not paused.
 * in:  {now ms, t player s, target room s, base room speed, buffering, supportsRate}
 * out: {drift s | null, level, seek?: s, rate?: speed}. `seek` comes with `rate: base`.
 */
export function guestStep(st, { now, t, target, base = 1, buffering = false, supportsRate = false }) {
  // Did the room's moment jump (host seek, host's correction)? Then any drift is the host's doing.
  const prev = st.prev;
  st.prev = { now, target };
  const hostMoved = !!prev && Math.abs(target - (prev.target + ((now - prev.now) / 1000) * base)) > HOST_MOVE_S;
  if (hostMoved) {
    st.pending = null;
    st.cooldownUntil = 0;
  }
  if (buffering) {
    st.wasBuffering = true;
    return { drift: null, level: st.level };
  }
  if (st.wasBuffering) {
    st.wasBuffering = false;
    st.settleUntil = Math.max(st.settleUntil, now + SETTLE_MS);
  }
  const drift = t - target;
  if (now < st.settleUntil && !hostMoved) return { drift, level: st.level };

  // The last jump has played out: where did it land? Its error tells what a jump costs on this phone.
  if (st.pending) {
    const p = st.pending;
    st.pending = null;
    if (Math.abs(drift) < 10) st.lead[p.dir] = clamp(st.lead[p.dir] * 0.4 + (p.lead - drift / base) * 0.6, LEAD_MIN_S, LEAD_MAX_S);
  }

  if (st.level > 0 && now - st.lastJumpAt > CALM_MS && now - st.levelAt > CALM_MS) {
    st.level -= 1;
    st.levelAt = now;
  }
  const L = LEVELS[st.level];
  const out = { drift, level: st.level };

  if (Math.abs(drift) > (hostMoved ? DRIFT_SEEK_S : L.seek) && (hostMoved || now >= st.cooldownUntil)) {
    const dir = drift < 0 ? "fwd" : "back";
    const lead = st.lead[dir];
    out.seek = Math.max(0, target + lead * base);
    out.rate = base;
    st.pending = { lead, dir };
    st.cooldownUntil = now + L.cooldown;
    st.settleUntil = now + SETTLE_MS;
    st.correcting = false;
    if (!hostMoved) {
      st.lastJumpAt = now;
      st.jumps = st.jumps.filter((x) => now - x < BURST_MS);
      st.jumps.push(now);
      if (st.jumps.length >= BURST_N && st.level < LEVELS.length - 1) {
        st.level += 1;
        st.levelAt = now;
        st.jumps = [];
      }
    }
    return out;
  }

  if (supportsRate) {
    const a = Math.abs(drift);
    if (a > RATE_ON_S || (st.correcting && a > RATE_OFF_S)) {
      st.correcting = true;
      out.rate = Math.round(base * clamp(1 - drift * 0.1, 1 - L.span, 1 + L.span) * 100) / 100;
    } else {
      st.correcting = false;
      out.rate = base;
    }
  }
  return out;
}

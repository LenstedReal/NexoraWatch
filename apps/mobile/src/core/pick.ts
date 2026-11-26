// A video picked in the site browser (or shared to Nexora from another app) travels to the room page (web app) inside
// the main WebView. Android may reload that page while the browser is open (every WebView of the app shares one
// renderer, and a heavy site can take it down), so each pick waits here until the room confirms it:
//   open_browser (room)  -> a new browsing session for that room; picks waiting for another room are dropped
//   picked(...)          -> kept and sent at once; several picks can be on their way (the browser stays open)
//   pick_ready (room)    -> the room page (again) listens: every pick for this room (or for any room) not yet
//                           confirmed is sent again; the room skips ids it already handled
//   pick_ack (id)        -> the room has it (an old room page acks without id: the oldest waiting pick)
//   pick_result (id)     -> what the room did with it: added (playing), queued, or the error it would show
// No React / React Native imports, so it can be unit-tested with plain Node.

/** What the room page receives through window.__nexoraPick. */
export type PickResult = {
  id: string;
  url: string;
  referer: string;
  title: string | null;
  kind: string;
  room: string;
  source: "browser" | "share";
};

/** What became of a pick, for the browser's row or the Android toast. */
export type PickOutcome = {
  id: string;
  /** added: the room plays it; queued: it waits in the queue; sent: an old room page took it without saying more */
  state: "added" | "queued" | "sent" | "error";
  canPlayNow: boolean;
  title: string | null;
  /** the room's own words for what went wrong; null = the room did not answer */
  error: string | null;
};

export const PICK_TTL_MS = 3 * 60 * 1000;
/** A link shared from another app while no room was open waits longer: the person first opens or joins a room. */
export const SHARE_TTL_MS = 10 * 60 * 1000;
export const ACK_TIMEOUT_MS = 25 * 1000;
export const RESULT_TIMEOUT_MS = 25 * 1000;

/** The room page an address belongs to ("/room/ABC234"), or "" for any other page. */
export function roomPath(urlOrPath: string | null | undefined): string {
  const m = String(urlOrPath || "").match(/\/room\/([A-Za-z2-9]{6})(?:[/?#]|$)/);
  return m ? `/room/${m[1].toUpperCase()}` : "";
}

type Entry = { res: PickResult; at: number; ttl: number; acked: boolean };

let seq = 0;
function newId(now: number): string {
  seq = (seq + 1) % 1_000_000;
  return `p${Math.max(0, Math.floor(now)).toString(36)}${seq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export class PickBox {
  private room = "";
  private entries: Entry[] = [];

  /** The browser opens for this room (the page's path, or the last known address of the main WebView). */
  open(room: string): void {
    this.room = roomPath(room);
    // A pick for another room no longer has anywhere to go; one for any room (a share) still does.
    this.entries = this.entries.filter((e) => !e.res.room || e.res.room === this.room);
  }

  /** A video was picked (or shared): what to send to the room page now. */
  picked(
    m: { url: string; page: string; title: string; kind: string },
    now: number,
    opts: { source?: "browser" | "share"; room?: string; id?: string } = {},
  ): PickResult {
    const source = opts.source ?? "browser";
    const room = opts.room !== undefined ? roomPath(opts.room) : this.room;
    const res: PickResult = { id: opts.id ?? newId(now), url: m.url, referer: m.page, title: m.title || null, kind: m.kind, room, source };
    const ttl = source === "share" && !room ? SHARE_TTL_MS : PICK_TTL_MS;
    this.entries.push({ res, at: now, ttl, acked: false });
    return res;
  }

  /** The room page is listening (again): every pick to send to it, oldest first. */
  ready(room: string, now: number): PickResult[] {
    this.prune(now);
    const here = roomPath(room);
    if (!here) return [];
    return this.entries.filter((e) => !e.acked && (!e.res.room || e.res.room === here)).map((e) => e.res);
  }

  /** The room has it. Without an id (an old room page): the oldest pick still waiting. Returns the id, or null. */
  ack(id?: string | null): string | null {
    const e = id ? this.entries.find((x) => x.res.id === id) : this.entries.find((x) => !x.acked);
    if (!e) return null;
    e.acked = true;
    return e.res.id;
  }

  /** The room answered for this pick: it is done. Returns what was sent, or null when it is not known (any more). */
  result(id: string): PickResult | null {
    const i = this.entries.findIndex((x) => x.res.id === id);
    if (i < 0) return null;
    const [e] = this.entries.splice(i, 1);
    return e.res;
  }

  /** Forget a pick (the browser gave up on it: the room never confirmed it). */
  drop(id: string): void {
    this.entries = this.entries.filter((x) => x.res.id !== id);
  }

  get(id: string): PickResult | null {
    return this.entries.find((x) => x.res.id === id)?.res ?? null;
  }

  /** Picks not yet confirmed by a room (any room). */
  waiting(now: number): number {
    this.prune(now);
    return this.entries.filter((e) => !e.acked).length;
  }

  private prune(now: number) {
    this.entries = this.entries.filter((e) => now - e.at < e.ttl);
  }
}

/** A {type:"pick_result"} message from the room page, as an outcome; null when it is not one. */
export function parsePickResult(m: any): PickOutcome | null {
  if (!m || m.type !== "pick_result" || typeof m.id !== "string" || !m.id) return null;
  const title = typeof m.title === "string" && m.title ? m.title : null;
  if (m.ok === true) {
    const queued = m.queued === true;
    return { id: m.id, state: queued ? "queued" : "added", canPlayNow: queued && m.can_play_now === true, title, error: null };
  }
  const error = typeof m.error === "string" && m.error.trim() ? m.error.trim().slice(0, 300) : null;
  return { id: m.id, state: "error", canPlayNow: false, title, error };
}

type Waiter = { resolve: (o: PickOutcome) => void; timer: unknown; acked: boolean; playNow: boolean };

/**
 * Waits for the room's answer to each pick. Not even acked within ACK_TIMEOUT_MS: the room did not answer (error,
 * and onGiveUp lets the caller forget the pick so it is not added later behind the person's back). Acked but no
 * result within RESULT_TIMEOUT_MS: an old room page, which takes picks without answering: "sent".
 * "Play now" (a queued pick wanted at once) gets no ack: no answer within RESULT_TIMEOUT_MS is an error.
 */
export class PickWaiters {
  private waiting = new Map<string, Waiter>();
  private setT: (fn: () => void, ms: number) => unknown;
  private clearT: (t: unknown) => void;
  private onGiveUp: (id: string) => void;

  constructor(setT: (fn: () => void, ms: number) => unknown, clearT: (t: unknown) => void, onGiveUp: (id: string) => void = () => {}) {
    this.setT = setT;
    this.clearT = clearT;
    this.onGiveUp = onGiveUp;
  }

  /** Starts waiting for the answer to this pick ("pick"), or to "play now" for it. */
  wait(id: string, what: "pick" | "play_now" = "pick"): Promise<PickOutcome> {
    this.settle(id, null); // a second wait for the same id replaces the first
    return new Promise<PickOutcome>((resolve) => {
      const playNow = what === "play_now";
      const w: Waiter = { resolve, timer: null, acked: playNow, playNow };
      this.waiting.set(id, w);
      this.arm(id, w);
    });
  }

  ack(id: string): void {
    const w = this.waiting.get(id);
    if (!w || w.acked) return;
    w.acked = true;
    this.arm(id, w);
  }

  /** The room's answer. Returns false when nobody waited for it (a share delivered to a room opened later). */
  result(o: PickOutcome): boolean {
    return this.settle(o.id, o);
  }

  has(id: string): boolean {
    return this.waiting.has(id);
  }

  cancelAll(): void {
    for (const id of [...this.waiting.keys()]) this.settle(id, null);
  }

  private arm(id: string, w: Waiter) {
    if (w.timer != null) this.clearT(w.timer);
    w.timer = this.setT(() => {
      if (this.waiting.get(id) !== w) return;
      if (!w.acked) this.onGiveUp(id);
      this.settle(id, w.acked && !w.playNow
        ? { id, state: "sent", canPlayNow: false, title: null, error: null }
        : { id, state: "error", canPlayNow: false, title: null, error: null });
    }, w.acked ? RESULT_TIMEOUT_MS : ACK_TIMEOUT_MS);
  }

  private settle(id: string, o: PickOutcome | null): boolean {
    const w = this.waiting.get(id);
    if (!w) return false;
    this.waiting.delete(id);
    if (w.timer != null) this.clearT(w.timer);
    if (o) w.resolve(o);
    return true;
  }
}

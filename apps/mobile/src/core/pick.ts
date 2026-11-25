// A video picked in the site browser travels to the room page (web app) inside the main WebView. Android may reload
// that page while the browser is open (every WebView of the app shares one renderer, and a heavy site can take it
// down), so the pick waits here until the room confirms it:
//   open_browser (room)  -> a new browsing session for that room; an older pick is dropped
//   picked(result)       -> kept and sent at once
//   pick_ready (room)    -> the room page (again) listens: a pick made for this room and not yet confirmed is sent again
//   pick_ack             -> the room has it: nothing waits any more
// No React / React Native imports, so it can be unit-tested with plain Node.

export type PickResult = { url: string; referer: string; title: string | null; kind: string; room: string };

export const PICK_TTL_MS = 3 * 60 * 1000;

/** The room page an address belongs to ("/room/ABC234"), or "" for any other page. */
export function roomPath(urlOrPath: string | null | undefined): string {
  const m = String(urlOrPath || "").match(/\/room\/([A-Za-z2-9]{6})(?:[/?#]|$)/);
  return m ? `/room/${m[1].toUpperCase()}` : "";
}

export class PickBox {
  private room = "";
  private pending: { res: PickResult; at: number } | null = null;

  /** The browser opens for this room (the page's path, or the last known address of the main WebView). */
  open(room: string): void {
    this.room = roomPath(room);
    this.pending = null;
  }

  /** A video was picked: what to send to the room page now. */
  picked(m: { url: string; page: string; title: string; kind: string }, now: number): PickResult {
    const res: PickResult = { url: m.url, referer: m.page, title: m.title || null, kind: m.kind, room: this.room };
    this.pending = { res, at: now };
    return res;
  }

  /** The room page is listening (again): the pick to send, if one is waiting for this room. */
  ready(room: string, now: number): PickResult | null {
    const p = this.pending;
    if (!p) return null;
    if (now - p.at >= PICK_TTL_MS) {
      this.pending = null;
      return null;
    }
    const here = roomPath(room);
    return !p.res.room || p.res.room === here ? p.res : null;
  }

  ack(): void {
    this.pending = null;
  }
}

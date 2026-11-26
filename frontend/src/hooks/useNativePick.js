import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorText, useT } from "@/i18n";
import { addToRoom, playQueued } from "@/lib/addToRoom";
import { appShowsPickResult, onNativePick, onNativePlayNow, openNativeBrowser, pickMemory, rememberPick, reportPick } from "@/lib/native";

// The room's link field is on screen: an error is shown under it (SourcePanel), not again as a toast.
const sourceOnScreen = () => [...document.querySelectorAll('[data-testid="source-url-input"]')].some((el) => el.offsetParent !== null);

// Videos picked in the app's site browser ("Sitelerde gez ve video bul") or shared to the app (Share → Nexora) come
// back to the room. They are listened for by the room, for as long as it is open, not by the button: the panel with
// the button is closed while the browser is open on small screens, and Android may even reload this page meanwhile
// (see lib/native.js). One pick at a time, in the order they came: the first plays when the room has nothing on, the
// next ones go to the queue (lib/addToRoom.js). App 1.8.5+ shows the result itself (its browser stays open for the
// next video); an older app gets the toast / the panel error as before.
export function useNativePick({ code, ident, isHost, hasVideo, onRoom }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const live = useRef({ isHost, hasVideo, onRoom, t });
  live.current = { isHost, hasVideo, onRoom, t };
  const started = useRef(0); // when a pick last started a video here: the room's update may not have arrived yet
  const chain = useRef(Promise.resolve());
  const waiting = useRef(0);

  useEffect(() => {
    const work = (job) => {
      waiting.current += 1;
      setBusy(true);
      chain.current = chain.current.then(job).catch(() => {}).finally(() => {
        waiting.current -= 1;
        if (!waiting.current) setBusy(false);
      });
    };
    const roomHasVideo = () => !!live.current.hasVideo || Date.now() - started.current < 15000;
    const apply = (room) => {
      if (!room) return;
      started.current = Date.now();
      live.current.onRoom(room);
    };
    const playNow = async (itemId) => apply(await playQueued({ code, ident, itemId }));

    const offPick = onNativePick((res) => work(async () => {
      const id = typeof res.id === "string" ? res.id : "";
      const appShows = !!id && appShowsPickResult();
      const tt = live.current.t;
      const extra = { referer: res.referer || undefined, title: res.title || undefined };
      if (!appShows) setError(null);
      try {
        const out = await addToRoom({ code, ident, isHost: live.current.isHost, hasVideo: roomHasVideo(), url: res.url, extra });
        apply(out.room);
        if (id) rememberPick(id, { item: out.itemId });
        if (appShows) {
          reportPick(id, { ok: true, queued: out.queued, can_play_now: out.canPlayNow, title: out.title });
          return;
        }
        if (id) rememberPick(id, { result: { ok: true, queued: out.queued, can_play_now: out.canPlayNow, title: out.title } });
        if (!out.queued) return;
        if (!out.canPlayNow) {
          toast.success(tt("q_added"));
          return;
        }
        toast.success(tt("q_added"), {
          action: {
            label: tt("q_play"),
            onClick: () => playNow(out.itemId).catch((ex) => toast.error(errorText(live.current.t, ex))),
          },
        });
      } catch (ex) {
        if (appShows) {
          reportPick(id, { ok: false, error: errorText(tt, ex) });
          return;
        }
        setError(ex);
        // The video panel shows it under its link field; a toast only when that field is not on screen.
        if (!sourceOnScreen()) toast.error(errorText(tt, ex));
      }
    }));

    // App 1.8.5+: "Şimdi oynat" on a queued row of the app's browser.
    const offPlay = onNativePlayNow((id) => work(async () => {
      const mem = pickMemory(id);
      const title = mem?.result?.title ?? null;
      try {
        if (!mem?.item) {
          const e = new Error("queue_item_not_found");
          e.code = "queue_item_not_found";
          throw e;
        }
        await playNow(mem.item);
        reportPick(id, { ok: true, queued: false, can_play_now: false, title });
      } catch (ex) {
        reportPick(id, { ok: false, error: errorText(live.current.t, ex) });
      }
    }));

    return () => {
      offPick();
      offPlay();
    };
  }, [code, ident]);

  return { busy, error, open: () => { setError(null); return openNativeBrowser(); } };
}

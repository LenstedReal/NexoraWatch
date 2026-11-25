import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorText, useT } from "@/i18n";
import { api } from "@/lib/api";
import { onNativePick, openNativeBrowser } from "@/lib/native";

// The app's site browser ("Sitelerde gez ve video bul"): a video picked there comes back to the room. It is listened
// for by the room, for as long as the room is open, not by the button: the panel with the button is closed while the
// browser is open on small screens, and Android may even reload this page meanwhile (see lib/native.js).
// The host's pick becomes the room's video. Someone who is no longer the host when the pick arrives (the room passed
// to another person meanwhile) gets it added to the queue instead, so the pick is never lost.
export function useNativePick({ code, ident, isHost, onRoom }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const live = useRef({ isHost, onRoom, t });
  live.current = { isHost, onRoom, t };

  useEffect(() => onNativePick(async (res) => {
    const extra = { referer: res.referer || undefined, title: res.title || undefined };
    setBusy(true);
    setError(null);
    try {
      if (live.current.isHost) live.current.onRoom(await api.setVideo(code, ident, res.url, extra));
      else {
        await api.queueAdd(code, ident, res.url, extra);
        toast.success(live.current.t("q_added"));
      }
    } catch (ex) {
      setError(ex);
      toast.error(errorText(live.current.t, ex));
    } finally {
      setBusy(false);
    }
  }), [code, ident]);

  return { busy, error, open: () => { setError(null); return openNativeBrowser(); } };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { inApp } from "@/lib/native";
import { uploadVideo } from "@/lib/uploader";

// A phone whose screen goes dark in the middle of a long upload freezes the page in most browsers, and the file stops
// going out. While a file is being sent the screen is kept on (the app already keeps it on in rooms). The browser
// drops the lock when the page is hidden, so it is taken again when the page comes back.
function useScreenOn(on) {
  useEffect(() => {
    if (!on || inApp() || typeof navigator === "undefined" || !navigator.wakeLock) return undefined;
    let lock = null;
    let alive = true;
    const take = async () => {
      if (!alive || lock || document.visibilityState !== "visible") return;
      try {
        const l = await navigator.wakeLock.request("screen");
        if (!alive) {
          l.release().catch(() => {});
          return;
        }
        lock = l;
        l.addEventListener?.("release", () => { if (lock === l) lock = null; });
      } catch {
        lock = null; // not allowed here (battery saver, an old browser): the upload goes on without it
      }
    };
    take();
    document.addEventListener("visibilitychange", take);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", take);
      lock?.release?.().catch(() => {});
      lock = null;
    };
  }, [on]);
}

export function useUpload({ code, ident }) {
  const t = useT();
  const [file, setFile] = useState(null);
  const [prog, setProg] = useState(null);
  const [err, setErr] = useState(null);
  const ctrl = useRef(null);

  const start = useCallback(async (f) => {
    if (!f) return;
    setErr(null);
    ctrl.current?.abort();
    const mine = new AbortController();
    ctrl.current = mine;
    setProg({ phase: "preparing", loaded: 0, total: f.size });
    try {
      await uploadVideo({ file: f, code, ident, signal: mine.signal, onProgress: (p) => { if (ctrl.current === mine) setProg(p); } });
      if (ctrl.current !== mine) return;
      setProg((p) => ({ ...p, phase: "done" }));
      toast.success(t("upload_done"));
    } catch (e) {
      if (ctrl.current !== mine) return; // a newer upload (or a retry) took over
      if (e.code === "aborted") setProg(null);
      else { setErr(e); setProg((p) => ({ ...p, phase: "error", waiting: false })); }
    }
  }, [code, ident, t]);

  const pick = useCallback((f) => {
    if (!f) return;
    setFile(f);
    setProg(null);
    start(f);
  }, [start]);

  const cancel = useCallback(() => {
    ctrl.current?.abort();
    ctrl.current = null;
    setProg((p) => { if (p?.mediaId) api.uploadAbort(p.mediaId, ident).catch(() => {}); return null; });
  }, [ident]);

  const busy = !!prog && ["preparing", "uploading", "finalizing"].includes(prog.phase);
  useScreenOn(busy);
  // Retry picks up where the upload stopped: the server still has the parts that arrived (same file = same fingerprint).
  return { file, prog, err, busy, pick, cancel, retry: () => start(file) };
}

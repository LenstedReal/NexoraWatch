import { useState } from "react";
import { Link2, Upload, Loader2, Film, PlayCircle, Globe } from "lucide-react";
import { errorText, useT } from "@/i18n";
import { api } from "@/lib/api";
import { UploadPanel } from "./UploadPanel";
import { BrowseSheet } from "./BrowseSheet";
import { inApp } from "@/lib/native";

// A phone shows this panel in the "Video" tab and a wide screen next to the player: two copies can exist at once.
// Whatever must survive closing the tab (upload, Drive import, a pick in the app's site browser) therefore comes from
// the room: `upload`, `drive` and `pick`.
export const SourcePanel = ({ code, ident, video, upload, drive, pick, onRoom }) => {
  const t = useT();
  const [tab, setTab] = useState("link");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [sheet, setSheet] = useState(false); // the web's "browse sites" screen
  const imp = drive.imp;
  const isDrive = /drive\.google\.com/i.test(url);

  // Every pasted link enters the room the same way: a Drive file is imported by the server, anything else is checked and set.
  const bring = async (link) => {
    if (/drive\.google\.com/i.test(link)) await drive.start(link);
    else onRoom(await api.setVideo(code, ident, link));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await bring(url.trim());
      setUrl("");
    } catch (ex) {
      setErr(ex); // shown once, right under the field it is about (no second copy as a toast)
    } finally {
      setBusy(false);
    }
  };

  const browse = () => {
    // The app has its own site browser that finds the video; what is picked there comes back through the room
    // (useNativePick). A web page cannot read another site: the sheet opens the site in a new tab and takes the link back.
    setErr(null);
    if (inApp()) pick.open();
    else setSheet(true);
  };
  const working = busy || pick.busy;
  const shown = err || pick.error;

  return (
    <section className="src-card" data-testid="source-panel">
      <div className="src-head">
        {video ? <PlayCircle size={16} className="ok-c" /> : <Film size={16} />}
        <b data-testid="source-title">{video ? video.title || video.url : t("add_video")}</b>
        {video && <span className="np">{t("now_playing")}</span>}
      </div>
      <div className="seg">
        <button className={tab === "link" ? "on" : ""} onClick={() => setTab("link")} data-testid="source-tab-link"><Link2 size={14} /> {t("share_link")}</button>
        <button className={tab === "upload" ? "on" : ""} onClick={() => setTab("upload")} data-testid="source-tab-upload"><Upload size={14} /> {t("upload_video")}</button>
      </div>
      {tab === "link" ? (
        <form className="row" onSubmit={submit}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("url_ph")} data-testid="source-url-input" />
          <button className="set" disabled={working} data-testid="source-set-btn">{working ? <Loader2 size={15} className="spin" /> : t("set")}</button>
        </form>
      ) : (
        <UploadPanel upload={upload} />
      )}
      {tab === "link" && <p className="src-help" data-testid="source-help">{t("src_help")}</p>}
      {tab === "link" && (
        <button className="browse" onClick={browse} disabled={working} data-testid="source-browse-btn"><Globe size={15} /> {t("browse_sites")}</button>
      )}
      {tab === "link" && isDrive && <div className="hint" data-testid="drive-hint">{t("drive_hint")}</div>}
      {imp && (
        <div className="drive-prog" data-testid="drive-progress">
          <span>{t("drive_importing")} · {imp.filename}</span>
          <div className="bar"><i style={{ width: `${imp.size ? Math.min(100, Math.round((imp.done / imp.size) * 100)) : 5}%` }} /></div>
        </div>
      )}
      {shown && tab === "link" && <div className="inline-err" data-testid="source-error">{errorText(t, shown)}</div>}
      {sheet && <BrowseSheet onClose={() => setSheet(false)} onBring={bring} />}
    </section>
  );
};

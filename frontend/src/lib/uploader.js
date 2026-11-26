import { absUrl, api, ApiError } from "./api";

const CONCURRENCY = 3;
// A long video means hundreds of parts, and a phone loses its connection now and then on the way (screen off, Wi-Fi
// to mobile data, another app in front). Those are waited out and the part is sent again; only a server that keeps
// answering with an error stops the upload.
const HTTP_TRIES = 6; // the server answered with an error (5xx, an expired link, 408 / 429)
const NET_TRIES = 40; // the connection dropped or stalled
const STALL_MS = 30000; // nothing went out for this long: the request is dead and is sent again
const DRAIN_MS = 120000; // every byte handed to the phone, the answer may still take a while on a slow line
const FINISH_TRIES = 30; // asking again while the server joins the parts (5 s apart)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const uploadTiming = { stallMs: STALL_MS, drainMs: DRAIN_MS, checkMs: 5000, finishGapMs: 5000 }; // tests shorten these

function putPart(url, blob, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let last = Date.now();
    let sent = 0;
    let stalled = false;
    const onAbort = () => xhr.abort();
    // XHR has no "no progress" timeout of its own: a dead mobile connection would hold the part (and the upload) forever.
    const watch = setInterval(() => {
      const limit = sent >= blob.size ? uploadTiming.drainMs : uploadTiming.stallMs;
      if (Date.now() - last > limit) {
        stalled = true;
        xhr.abort();
      }
    }, uploadTiming.checkMs);
    const settle = (fn) => () => {
      clearInterval(watch);
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => {
      last = Date.now();
      sent = e.loaded;
      onProgress(e.loaded);
    };
    xhr.onload = settle(() => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, `http_${xhr.status}`, `HTTP ${xhr.status}`))));
    xhr.onerror = settle(() => reject(new ApiError(0, "unreachable", "Ağ hatası")));
    xhr.onabort = settle(() => reject(stalled ? new ApiError(0, "stalled", "Bağlantı durdu") : new ApiError(-1, "aborted", "İptal edildi")));
    signal.addEventListener("abort", onAbort, { once: true });
    xhr.send(blob);
  });
}

const waitOnline = async (signal) => {
  while (typeof navigator !== "undefined" && navigator.onLine === false && !signal.aborted) await sleep(1000);
};

// The server joins the parts; a connection lost meanwhile is asked again (the server waits for its first call and
// then answers with the finished upload, see backend/storage.py upload_complete).
async function finish(mediaId, ident, total, onProgress, signal) {
  onProgress({ phase: "finalizing", loaded: total, total, mediaId });
  for (let tries = 1; ; tries += 1) {
    if (signal.aborted) throw new ApiError(-1, "aborted", "İptal edildi");
    try {
      return { mediaId, ...(await api.uploadComplete(mediaId, ident)) };
    } catch (e) {
      if (e.status !== 0 || tries >= FINISH_TRIES) throw e;
      await waitOnline(signal);
      await sleep(uploadTiming.finishGapMs);
    }
  }
}

// Streams File slices part by part; the browser never loads the whole file into memory.
export async function uploadVideo({ file, code, ident, onProgress, signal: outer }) {
  // One part that cannot be sent stops the others too: no part keeps going (and redrawing the progress bar) behind an
  // error the screen already shows.
  const stop = new AbortController();
  const signal = stop.signal;
  const onOuter = () => stop.abort();
  if (outer.aborted) stop.abort();
  else outer.addEventListener("abort", onOuter, { once: true });
  try {
    return await run({ file, code, ident, onProgress, signal, stop });
  } finally {
    outer.removeEventListener("abort", onOuter);
  }
}

async function run({ file, code, ident, onProgress, signal, stop }) {
  const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
  const init = await api.uploadInit({
    code, participant_id: ident.participant_id, token: ident.token,
    filename: file.name, size: file.size, mime: file.type || undefined, fingerprint,
  });
  const mediaId = init.media_id;
  if (init.status === "completed") return finish(mediaId, ident, file.size, onProgress, signal);

  const { part_size: partSize, part_count: partCount } = init;
  const done = new Set(init.parts_done || []);
  const partBytes = (n) => (n < partCount ? partSize : file.size - partSize * (partCount - 1));
  let base = [...done].reduce((s, n) => s + partBytes(n), 0);
  const inflight = {};
  const waiting = new Set(); // parts waiting for the connection to come back
  const started = Date.now();
  const baseAtStart = base;
  let failed = null;
  const report = () => {
    if (failed) return;
    const loaded = base + Object.values(inflight).reduce((a, b) => a + b, 0);
    const elapsed = (Date.now() - started) / 1000;
    const speed = elapsed > 0.5 ? (loaded - baseAtStart) / elapsed : 0;
    onProgress({ phase: "uploading", loaded, total: file.size, speed, eta: speed > 0 ? (file.size - loaded) / speed : null, mediaId,
      waiting: waiting.size > 0 });
  };
  report();

  const queue = Array.from({ length: partCount }, (_, i) => i + 1).filter((n) => !done.has(n));
  const urls = {};
  const urlFor = async (n) => {
    if (!urls[n] || urls[n].exp < Date.now()) {
      const batch = queue.filter((x) => x >= n).slice(0, 20);
      const res = await api.partUrls(mediaId, ident, [...new Set([n, ...batch])]);
      const exp = Date.now() + (res.expires_in - 120) * 1000;
      Object.entries(res.urls).forEach(([k, u]) => (urls[k] = { url: absUrl(u), exp }));
    }
    return urls[n].url;
  };

  const worker = async () => {
    while (queue.length) {
      const n = queue.shift();
      const blob = file.slice((n - 1) * partSize, (n - 1) * partSize + partBytes(n));
      let httpTries = 0;
      let netTries = 0;
      for (;;) {
        if (signal.aborted) throw new ApiError(-1, "aborted", "İptal edildi");
        try {
          const url = await urlFor(n);
          await putPart(url, blob, (l) => { inflight[n] = l; report(); }, signal);
          delete inflight[n];
          waiting.delete(n);
          base += blob.size;
          report();
          break;
        } catch (e) {
          delete inflight[n];
          if (e.code === "aborted") throw e;
          const net = e.status === 0; // no answer: the connection, not the server
          if (net) netTries += 1;
          else httpTries += 1;
          const fatal = !net && e.status >= 400 && e.status < 500 && ![403, 408, 429].includes(e.status);
          if (fatal || httpTries >= HTTP_TRIES || netTries >= NET_TRIES) throw e;
          if (e.status === 403) delete urls[n];
          waiting.add(n);
          report();
          await waitOnline(signal);
          const tries = net ? Math.min(netTries, 5) : httpTries;
          await sleep(Math.min(15000, 800 * 2 ** tries) * (0.5 + Math.random() / 2));
        }
      }
    }
  };
  const guarded = async () => {
    try {
      await worker();
    } catch (e) {
      if (!failed) failed = e;
      stop.abort();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, guarded));
  if (failed) throw failed;
  return finish(mediaId, ident, file.size, onProgress, signal);
}

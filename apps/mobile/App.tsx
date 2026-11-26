import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, BackHandler, Linking, Platform, Pressable, StyleSheet, Text, ToastAndroid, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as ExpoLinking from "expo-linking";
import * as ScreenOrientation from "expo-screen-orientation";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import Constants from "expo-constants";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { C } from "./src/theme";
import { WEB_URL } from "./src/core/api";
import { enablePush, onNotificationTap } from "./src/core/push"; // push worker
import { loadLang, t, useT } from "./src/i18n";
import { IntroSplash } from "./src/components/Brand";
import { BrowserModal, type DetectedMedia } from "./src/screens/BrowserModal";
import { ROUTE_REPORTER, adsEnabled, initialAdState, onBackground, onResume, onRoute, routeOf, type AdEffects, type AdIds } from "./src/core/ads";
import { NexoraAds } from "./modules/nexora-ads/src";
import { ServicePlayer, type ServiceSession } from "./src/screens/ServicePlayer"; // rave: in-app services (beta)
import { parseServiceCommand, serviceUrlOk, type ServiceCommand, type ServiceReport } from "./src/core/serviceController";
import { PickBox, PickWaiters, parsePickResult, roomPath, type PickOutcome } from "./src/core/pick";
import { cleanUserAgent, facebookVideoUrl, firstUrl, isFacebookShareLink, isShareLink, shareText } from "./src/core/share";
import { moveToBack } from "./modules/nexora-share/src";

/**
 * Nexora Watch app = the Nexora Watch web app (same screens, same code, always the same version as the website)
 * plus native features the browser cannot offer: the site browser with video detection, screen rotation,
 * keeping the screen on during a room, deep links and the Android back button.
 */
const WEB_HOST = new URL(WEB_URL).host;
const VERSION = Constants.expoConfig?.version ?? "";

/** https://<web>/room/ABC234, nexora://room/ABC234 → the web URL to open. */
export function webUrlFrom(link: string | null): string | null {
  if (!link) return null;
  const m = link.match(/room\/([A-Za-z2-9]{6})(?:[/?#]|$)/);
  return m ? `${WEB_URL}/room/${m[1].toUpperCase()}` : null;
}

// "caps" tells the web app what this version of the app can do, so the web side never has to compare version numbers.
/** The page fills the whole screen (behind the status and navigation bars); it gets the real insets as CSS variables
 *  (--sa-top/right/bottom/left, used by the web CSS before env(safe-area-inset-*), which Android WebViews report
 *  unreliably). So every inset is applied exactly once, by the page, and the bars show the page's own dark colours. */
export function insetJs(i: { top: number; right: number; bottom: number; left: number }): string {
  const v = (n: number) => `${Math.max(0, Math.round(n))}px`;
  return `(function(){var s=document.documentElement.style;s.setProperty("--sa-top","${v(i.top)}");s.setProperty("--sa-right","${v(i.right)}");s.setProperty("--sa-bottom","${v(i.bottom)}");s.setProperty("--sa-left","${v(i.left)}");})(); true;`;
}

// 1.8.5: "pick_result" (the site browser stays open and shows what the room did with each video), "share" (Share →
// Nexora Watch from other apps), "app_state" (the page hears when the app goes to the background). The page also tells
// the app its browser's user agent once: the site browser presents itself with it (src/core/share.ts cleanUserAgent).
const CAPS = ["open_external", "service_player", "push", "pick_result", "share", "app_state"];
const BOOT = `window.__NEXORA_APP__ = { platform: ${JSON.stringify(Platform.OS)}, version: ${JSON.stringify(VERSION)}, caps: ${JSON.stringify(CAPS)} }; try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: "ua", ua: navigator.userAgent })); } catch (e) {} ${ROUTE_REPORTER} true;`;
// Asking Facebook where a share link leads, before Chrome's own agent is known.
const FALLBACK_UA = "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

/** Android's short message at the bottom of the screen: it also shows over another app (Share → Nexora). */
function toast(text: string) {
  if (Platform.OS === "android") ToastAndroid.show(text, ToastAndroid.LONG);
}

/** A Facebook share link (fb.watch, /share/v|r/) asked on the phone: the video's own address, or the link as it was
 *  (the server tries again; Facebook often answers a phone where it does not answer a server). */
async function expandFacebook(url: string, ua: string | null): Promise<string> {
  if (!isFacebookShareLink(url)) return url;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { method: "GET", headers: { "User-Agent": ua || FALLBACK_UA, Accept: "text/html" }, signal: ctl.signal });
    return facebookVideoUrl(r.url) ?? url;
  } catch {
    return url;
  } finally {
    clearTimeout(timer);
  }
}

// InMobi IDs: filled at build time from EXPO_PUBLIC_INMOBI_* (app.config.js `extra.inmobi`). Empty = no ads at all.
const AD_IDS: Partial<AdIds> = (Constants.expoConfig?.extra as any)?.inmobi ?? {};
const ADS_ON = Platform.OS === "android" && NexoraAds != null && adsEnabled(AD_IDS);
// No consent tool (CMP) yet: consent unavailable -> non-personalised, no device identifiers. See docs/ADS.md.
const AD_CONSENT = JSON.stringify({ gdpr_consent_available: false, gdpr: "1" });

/** Only our own site may be sent to the phone's browser: pages shown inside the room (video players) can post messages too. */
export function isOwnWebUrl(url: unknown): url is string {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return false;
  try {
    return new URL(url).host === WEB_HOST;
  } catch {
    return false;
  }
}

function Shell() {
  useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const web = useRef<WebView>(null);
  const canBack = useRef(false);
  const [svc, setSvc] = useState<ServiceSession | null>(null); // rave: the open service page (ServicePlayer)
  const svcCmd = useRef<((c: ServiceCommand) => void) | null>(null);
  const svcOpen = useRef<(() => void) | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const tapped = useRef<string | null>(null); // push worker: room of a notification tapped before the WebView exists
  const [loaded, setLoaded] = useState(false);
  const [intro, setIntro] = useState(true);
  const [failed, setFailed] = useState(false);
  const [browser, setBrowser] = useState(false);
  const picked = useRef(false);
  const browserBack = useRef<(() => void) | null>(null); // BrowserModal: back inside the site, then close
  const [ua, setUa] = useState<string | null>(null); // Chrome's agent for the site browser (from the room page)
  const uaRef = useRef<string | null>(null);
  uaRef.current = ua;
  // A video picked in the site browser (or shared from another app) waits until the room confirms it
  // (src/core/pick.ts): Android may reload the room page while the browser is open, and the reloaded room asks for it
  // again. The room's answer for each pick (added, queued, the error) comes back as pick_result.
  const [picks] = useState(() => new PickBox());
  const [waiters] = useState(() => new PickWaiters((fn, ms) => setTimeout(fn, ms), (tm) => clearTimeout(tm as ReturnType<typeof setTimeout>), (id) => picks.drop(id)));
  const shareRef = useRef<(link: string) => void>(() => {});
  const [webKey, setWebKey] = useState(0);
  const lastUrl = useRef<string | null>(null);
  const ads = useRef(initialAdState(ADS_ON ? AD_IDS : null, Date.now()));
  const [bannerWanted, setBannerWanted] = useState(false);
  const [bannerH, setBannerH] = useState(0);

  const applyAds = useCallback((e: AdEffects) => {
    if (!ADS_ON) return;
    setBannerWanted(e.banner);
    try {
      if (e.preloadInterstitial) NexoraAds!.loadInterstitial(AD_IDS.interstitialId!);
      if (e.showInterstitial) NexoraAds!.showInterstitial(AD_IDS.interstitialId!);
    } catch {}
  }, []);
  const routeChanged = useCallback(
    (urlOrPath: string) => {
      const [s, e] = onRoute(ads.current, routeOf(urlOrPath, WEB_HOST), Date.now());
      if (s.route === ads.current.route && !e.showInterstitial) return;
      ads.current = s;
      applyAds(e);
    },
    [applyAds],
  );

  useEffect(() => {
    if (!ADS_ON) return;
    try {
      NexoraAds!.init(AD_IDS.accountId!, AD_CONSENT, true);
    } catch {}
    const ev = NexoraAds!.addListener("onBanner", (b) => setBannerH(b.visible ? b.height : 0));
    const st = AppState.addEventListener("change", (state) => {
      const [s, e] = state === "active" ? onResume(ads.current, Date.now()) : onBackground(ads.current);
      ads.current = s;
      applyAds(e);
    });
    return () => {
      ev.remove();
      st.remove();
    };
  }, [applyAds]);

  // The banner is native and sits above the navigation bar; the WebView is padded by its height so it never covers content.
  const showBanner = ADS_ON && bannerWanted && !intro && !failed && !browser;
  const navInset = landscape ? 0 : Math.round(insets.bottom);
  useEffect(() => {
    if (!ADS_ON) return;
    try {
      if (showBanner) NexoraAds!.showBanner(AD_IDS.bannerId!, navInset);
      else NexoraAds!.hideBanner();
    } catch {}
  }, [showBanner, navInset]);
  const adPad = showBanner ? bannerH : 0;
  // Under a banner the page ends above it (banner + navigation bar are native), so its bottom inset is 0 then.
  const pageInsets = { top: insets.top, right: insets.right, bottom: showBanner ? 0 : insets.bottom, left: insets.left };
  const insetScript = insetJs(pageInsets);
  useEffect(() => {
    web.current?.injectJavaScript(insetScript);
  }, [insetScript]);

  useEffect(() => {
    (async () => {
      await loadLang();
      const initial = await ExpoLinking.getInitialURL().catch(() => null);
      if (isShareLink(initial)) {
        // Started by Share → Nexora Watch: no room is open yet. The video waits for the room the person opens
        // (the home page says so: ?shared=1) and goes there through the room's pick_ready.
        const raw = firstUrl(shareText(initial));
        if (raw) {
          setStart(tapped.current ?? `${WEB_URL}/?shared=1`);
          // Opening a room takes the person longer than asking Facebook where a share link leads.
          const url = await expandFacebook(raw, null);
          picks.picked({ url, page: "", title: "", kind: "page" }, Date.now(), { source: "share", room: "" });
          return;
        }
        toast(t("share_no_link"));
        setStart(tapped.current ?? WEB_URL);
        return;
      }
      setStart(tapped.current ?? webUrlFrom(initial) ?? WEB_URL);
    })();
    const sub = ExpoLinking.addEventListener("url", ({ url }) => {
      if (isShareLink(url)) {
        shareRef.current(url);
        return;
      }
      const target = webUrlFrom(url);
      if (target) web.current?.injectJavaScript(`location.href = ${JSON.stringify(target)}; true;`);
    });
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The room page hears when the app goes to the background and comes back (lib/away.js on the web): a video the
  // phone pauses meanwhile is not the host pausing the room.
  useEffect(() => {
    const st = AppState.addEventListener("change", (s) => {
      const state = s === "active" ? "active" : "background";
      web.current?.injectJavaScript(`window.__nexoraAppState && window.__nexoraAppState(${JSON.stringify(state)}); true;`);
    });
    return () => st.remove();
  }, []);

  // push worker: a tapped invite notification opens its room.
  useEffect(
    () =>
      onNotificationTap((link) => {
        const target = webUrlFrom(link);
        if (!target) return;
        if (web.current) web.current.injectJavaScript(`location.href = ${JSON.stringify(target)}; true;`);
        else {
          tapped.current = target;
          setStart((cur) => (cur ? target : cur));
        }
      }),
    [],
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (browser) {
        browserBack.current?.(); // back inside the site, then the browser closes
        return true;
      }
      if (svcOpen.current) { // rave: back closes the service page first
        svcOpen.current();
        return true;
      }
      if (canBack.current) {
        web.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [browser]);

  useEffect(
    () => () => {
      deactivateKeepAwake("room");
      ScreenOrientation.unlockAsync().catch(() => {});
    },
    [],
  );

  const reply = (res: object | null) =>
    web.current?.injectJavaScript(`window.__nexoraPick && window.__nexoraPick(${JSON.stringify(res)}); true;`);

  // The room page's renderer is gone (Android killed it, often together with a heavy site open in the browser). That
  // WebView cannot be used again: a new one opens the page the person was on, and the room joins again by itself.
  const recover = useCallback(() => {
    setLoaded(false);
    setStart(lastUrl.current || WEB_URL);
    setWebKey((k) => k + 1);
  }, []);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let m: any;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.type === "open_browser") {
      picked.current = false;
      picks.open(typeof m.room === "string" ? m.room : lastUrl.current ?? "");
      setBrowser(true);
    } else if (m.type === "pick_ready") {
      // The room (again) listens for picks: hand over every one that has not arrived yet, made in this room or
      // shared for any room.
      for (const res of picks.ready(typeof m.room === "string" ? m.room : lastUrl.current ?? "", Date.now())) reply(res);
    } else if (m.type === "pick_ack") {
      const id = picks.ack(typeof m.id === "string" && m.id ? m.id : null);
      if (id) waiters.ack(id);
    } else if (m.type === "pick_result") {
      // What the room did with a pick. Nobody waits for it when a share went to a room opened later: say it here.
      const o = parsePickResult(m);
      if (o) {
        const res = picks.result(o.id);
        if (!waiters.result(o) && res?.source === "share") toast(shareOutcome(o));
      }
    } else if (m.type === "ua") {
      if (typeof m.ua === "string") setUa((cur) => cur ?? cleanUserAgent(m.ua));
    } else if (m.type === "orientation") {
      if (m.mode === "landscape") ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
      else
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
          .then(() => setTimeout(() => ScreenOrientation.unlockAsync().catch(() => {}), 1200))
          .catch(() => {});
    } else if (m.type === "keep_awake") {
      if (m.on) activateKeepAwakeAsync("room").catch(() => {});
      else deactivateKeepAwake("room");
    } else if (m.type === "route") {
      // SPA navigation reported by ROUTE_REPORTER (pushState / replaceState / popstate).
      if (typeof m.path === "string") {
        routeChanged(m.path);
        if (m.path.startsWith("/")) lastUrl.current = WEB_URL + m.path;
      }
    } else if (m.type === "open_external") {
      // "Watch on the web": the website opens in the phone's browser.
      if (isOwnWebUrl(m.url)) Linking.openURL(m.url).catch(() => {});
    } else if (m.type === "service_open") {
      // rave: the room's ServiceCard opens the service page; only that service's own https pages are accepted.
      if (serviceUrlOk(m.service, m.url)) setSvc({ service: m.service, url: m.url, role: m.role === "host" ? "host" : "guest", key: Date.now() });
    } else if (m.type === "service_cmd") {
      const c = parseServiceCommand(m);
      if (c) svcCmd.current?.(c);
    } else if (m.type === "service_close") {
      setSvc(null);
    } else if (m.type === "push_enable") {
      // push worker: "Bildirimlere izin ver" in the web app; the token is sent to our own server (WEB_URL) only.
      enablePush(m.device_id, m.key).then((r) =>
        web.current?.injectJavaScript(`window.__nexoraPush && window.__nexoraPush(${JSON.stringify(r)}); true;`),
      );
    }
  }, [routeChanged, picks, waiters]); // eslint-disable-line react-hooks/exhaustive-deps

  // rave: the service page's reports go to the room's ServiceCard.
  const toRoom = (r: ServiceReport | { type: "closed" }) =>
    web.current?.injectJavaScript(`window.__nexoraService && window.__nexoraService(${JSON.stringify(r)}); true;`);
  const closeService = () => {
    setSvc(null);
    toRoom({ type: "closed" });
  };
  svcOpen.current = svc ? closeService : null;

  // The browser stays open: each pick goes to the room, and the room's answer comes back to the browser's row.
  const onPick = (m: DetectedMedia): Promise<PickOutcome> => {
    picked.current = true;
    const res = picks.picked(m, Date.now());
    reply(res);
    return waiters.wait(res.id);
  };
  // "Şimdi oynat" on a queued row: the room's host plays it at once.
  const onPlayNow = (id: string): Promise<PickOutcome> => {
    const answer = waiters.wait(id, "play_now");
    web.current?.injectJavaScript(`window.__nexoraPlayNow && window.__nexoraPlayNow(${JSON.stringify(id)}); true;`);
    return answer;
  };

  const shareOutcome = (o: PickOutcome) =>
    o.state === "added" ? t("share_added") : o.state === "queued" ? t("share_queued") : o.state === "sent" ? t("share_sent") : o.error ?? t("share_no_answer");

  // Share → Nexora Watch while the app runs (plugins/withShareIntent.js): the link goes to the room on screen, the
  // phone says what became of it, and the person is taken back to the app they shared from. No room open: the
  // home page says so, and the video goes to the room they open next.
  shareRef.current = async (link: string) => {
    const raw = firstUrl(shareText(link));
    if (!raw) {
      toast(t("share_no_link"));
      return;
    }
    const url = await expandFacebook(raw, uaRef.current);
    const room = roomPath(lastUrl.current);
    if (!room) {
      picks.picked({ url, page: "", title: "", kind: "page" }, Date.now(), { source: "share", room: "" });
      toast(t("share_pick_room"));
      const home = `${WEB_URL}/?shared=1`;
      if (web.current) web.current.injectJavaScript(`location.href = ${JSON.stringify(home)}; true;`);
      else setStart((cur) => cur ?? home);
      return;
    }
    const res = picks.picked({ url, page: "", title: "", kind: "page" }, Date.now(), { source: "share", room });
    reply(res);
    const o = await waiters.wait(res.id);
    toast(shareOutcome(o));
    if (o.state !== "error" && !browser) setTimeout(() => moveToBack(), 800);
  };
  const onCloseBrowser = () => {
    if (!picked.current) reply(null);
    setBrowser(false);
  };

  // Our own site stays inside the app; everything else (Play Store, GitHub, mail, other sites) opens outside.
  const onShouldStart = (req: WebViewNavigation & { isTopFrame?: boolean }) => {
    if (req.isTopFrame === false) return true;
    const u = req.url;
    if (u.startsWith("about:") || u.startsWith("data:") || u.startsWith("blob:")) return true;
    let host = "";
    try {
      host = new URL(u).host;
    } catch {
      return false;
    }
    if (host === WEB_HOST) return true;
    Linking.openURL(u).catch(() => {});
    return false;
  };

  const retry = () => {
    setFailed(false);
    web.current?.reload();
  };

  return (
    <View style={[styles.root, { paddingBottom: showBanner ? adPad + navInset : 0 }]}>
      <StatusBar style="light" hidden={landscape} translucent backgroundColor="transparent" />
      {start && (
        <WebView
          key={webKey}
          ref={web}
          source={{ uri: start }}
          injectedJavaScriptBeforeContentLoaded={BOOT + insetScript}
          applicationNameForUserAgent={`NexoraWatchApp/${VERSION}`}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={onShouldStart}
          onNavigationStateChange={(s) => {
            canBack.current = s.canGoBack;
            if (s.url) routeChanged(s.url);
            if (isOwnWebUrl(s.url)) lastUrl.current = s.url;
          }}
          onLoadEnd={() => {
            setLoaded(true);
            web.current?.injectJavaScript(insetScript);
          }}
          onError={() => setFailed(true)}
          onHttpError={(e) => {
            if (e.nativeEvent.statusCode >= 500 && e.nativeEvent.url.replace(/\/$/, "") === WEB_URL) setFailed(true);
          }}
          onRenderProcessGone={recover}
          onContentProcessDidTerminate={recover}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          allowsBackForwardNavigationGestures
          setSupportMultipleWindows={false}
          pullToRefreshEnabled={false}
          overScrollMode="never"
          textZoom={100}
          mixedContentMode="never"
          originWhitelist={["https://*", "http://*", "about:*", "blob:*", "data:*"]}
          style={styles.web}
        />
      )}
      {failed && (
        <View style={styles.fail}>
          <Ionicons name="cloud-offline-outline" size={44} color={C.purple} />
          <Text style={styles.failTitle}>{t("server_down")}</Text>
          <Pressable onPress={retry} style={styles.failBtn}>
            <Text style={styles.failBtnText}>{t("retry")}</Text>
          </Pressable>
        </View>
      )}
      {!loaded && !intro && !failed && (
        <View style={styles.loading}>
          <ActivityIndicator color={C.cyan} size="large" />
        </View>
      )}
      <ServicePlayer session={svc} commandRef={svcCmd} onReport={toRoom} onClose={closeService} />
      <BrowserModal visible={browser} onClose={onCloseBrowser} onPick={onPick} onPlayNow={onPlayNow} userAgent={ua} backRef={browserBack} />
      {intro && <IntroSplash slogan={t("slogan")} onDone={() => setIntro(false)} />}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  web: { flex: 1, backgroundColor: C.bg },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },
  fail: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 16, padding: 28, backgroundColor: C.bg },
  failTitle: { color: C.text, fontSize: 16, textAlign: "center" },
  failBtn: { backgroundColor: C.purple, paddingHorizontal: 26, paddingVertical: 13, borderRadius: 14 },
  failBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});

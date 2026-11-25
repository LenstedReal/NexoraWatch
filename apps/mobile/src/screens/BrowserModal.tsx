import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, R } from "../theme";
import { Badge, IconButton } from "../components/ui";
import { FALLBACK_CONFIG, loadConfig, type SiteInfo } from "../core/api";
import { useT } from "../i18n";

export type DetectedMedia = {
  url: string;
  kind: "hls" | "mp4" | "webm" | "video" | "youtube" | "vimeo" | "twitch" | "kick" | "archive" | "tiktok" | "instagram" | "x" | "facebook" | "blocked";
  page: string;
  title: string;
  how: string;
  duration?: number;
  /** same video, whatever address it came with (a TikTok video from the feed and from its own page) */
  key?: string;
  /** when it was found: newer first among equals */
  at?: number;
};

/**
 * Injected into pages of supported sites (before content loads, so fetch/XHR hooks catch the first manifest request).
 * Plain ES5 source (String.raw: no back-ticks, no dollar-brace inside). It reports:
 *   media  a video file the page plays: <video>/<source>, fetch(), XMLHttpRequest, Resource Timing. Segments are
 *          ignored; blob:/MediaSource players are reported as "blocked" (not shareable).
 *   nav    the page's address after it changed without a page load (sites that are single-page apps: TikTok, YouTube)
 *   item   a video of a feed: TikTok (from the site's own data: its API answers and the data in the page, the links
 *          on screen, the video playing right now) and X (the posts on screen that hold a video, the one playing now).
 *          The room plays TikTok in its official player and an X post's video file (found by the server), in sync.
 * Kick's player loads its stream inside a worker, where none of this can look: on a Kick page the address its player
 * gets (a live channel's, a recording's, a clip's) is asked from Kick's own API (same origin, the person's session).
 */
const DETECTOR = String.raw`(function(){
if(window.__nxDetector)return;window.__nxDetector=true;
var seen={},top=window.top===window;
var host=location.hostname.replace(/^(www|m|mobile)\./,''),tiktok=host==='tiktok.com',xsite=host==='x.com'||host==='twitter.com';
var RX=/\.(m3u8|mp4|webm|mov|m4v)(\?|#|$)/i;
var SKIP=/(\.ts|\.m4s|\.aac|\.vtt|\.jpg|\.png)(\?|#|$)|\/init\.mp4|segment|\/seg-|\/frag/i;
var API=/\/api\//;
function post(o){try{window.ReactNativeWebView.postMessage(JSON.stringify(o))}catch(e){}}
function report(url,how,extra){
  try{
    if(!url||typeof url!=='string')return;
    if(url.indexOf('blob:')===0||url.indexOf('mediasource:')===0){
      var k='blob:'+location.host+location.pathname; if(seen[k])return; seen[k]=1;
      post({t:'media',url:url,how:'blob',page:location.href,title:document.title,blocked:true});return;
    }
    if(url.indexOf('data:')===0)return;
    var abs=new URL(url,location.href).href; if(seen[abs])return; seen[abs]=1;
    var o={t:'media',url:abs,how:how,page:location.href,title:document.title};
    if(extra)for(var x in extra)o[x]=extra[x];
    post(o);
  }catch(e){}
}
function check(u,how){if(typeof u==='string'&&RX.test(u)&&!SKIP.test(u))report(u,how);}
var items={},nItems=0,lastCur='';
function item(id,author,desc,current,site){
  id=String(id||'');site=site||'tiktok';
  if(!/^\d{15,21}$/.test(id))return;
  author=typeof author==='string'&&/^[\w.-]{1,40}$/.test(author)?author:'';
  if(current){if(lastCur===site+id)return;lastCur=site+id;}
  else{if(items[site+id])return;items[site+id]=1;if(++nItems>80)return;}
  post({t:'item',site:site,id:id,author:author,title:typeof desc==='string'?desc.replace(/\s+/g,' ').trim().slice(0,120):'',page:location.href,current:!!current});
}
function walk(o,depth,b){
  if(!o||typeof o!=='object'||depth>40||b.n--<=0)return;
  if(Object.prototype.toString.call(o)==='[object Array]'){for(var i=0;i<o.length;i++)walk(o[i],depth+1,b);return;}
  var id=o.id||o.aweme_id||o.itemId;
  if((typeof id==='string'||typeof id==='number')&&o.video&&typeof o.video==='object'){
    var a=o.author;item(id,a&&typeof a==='object'?(a.uniqueId||a.unique_id):a,o.desc||o.title||'');
  }
  for(var k in o){if(Object.prototype.hasOwnProperty.call(o,k)){var v=o[k];if(v&&typeof v==='object')walk(v,depth+1,b);}}
}
function scanJson(text){
  if(typeof text!=='string'||text.length<2||text.length>8000000)return;
  try{walk(JSON.parse(text),0,{n:60000});}catch(e){}
}
var of=null;
try{of=window.fetch;if(of){window.fetch=function(i){
  var u=typeof i==='string'?i:(i&&i.url);
  try{check(u,'fetch')}catch(e){}
  var p=of.apply(this,arguments);
  if(tiktok&&typeof u==='string'&&API.test(u)){try{p.then(function(r){try{r.clone().text().then(scanJson,function(){})}catch(e){}},function(){})}catch(e){}}
  return p;
}}}catch(e){}
try{var XP=XMLHttpRequest.prototype,oo=XP.open,os=XP.send;
XP.open=function(m,u){try{this.__nxu=String(u);check(this.__nxu,'xhr')}catch(e){}return oo.apply(this,arguments)};
XP.send=function(){
  try{var x=this;if(tiktok&&API.test(x.__nxu||''))x.addEventListener('load',function(){
    try{if(!x.responseType||x.responseType==='text')scanJson(x.responseText);else if(x.responseType==='json')walk(x.response,0,{n:60000});}catch(e){}
  });}catch(e){}
  return os.apply(this,arguments);
};}catch(e){}
try{new PerformanceObserver(function(l){l.getEntries().forEach(function(en){check(en.name,'net')})}).observe({type:'resource',buffered:true})}catch(e){}
function scan(){
  try{
    var vs=document.querySelectorAll('video');
    for(var i=0;i<vs.length;i++){
      var v=vs[i],s=v.currentSrc||v.src;
      if(s)report(s,'video',{duration:isFinite(v.duration)?v.duration:0});
      var ss=v.querySelectorAll('source');for(var j=0;j<ss.length;j++){if(ss[j].src)report(ss[j].src,'source')}
    }
  }catch(e){}
}
var pageData=false,VID=/\/@([\w.-]{1,40})\/video\/(\d{15,21})/;
function scanTikTok(){
  if(!tiktok)return;
  try{
    if(!pageData){
      var sd=document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')||document.getElementById('SIGI_STATE')||document.getElementById('__NEXT_DATA__');
      if(sd&&sd.textContent){pageData=true;scanJson(sd.textContent);}
    }
    var vh=window.innerHeight||800,as=document.querySelectorAll('a[href*="/video/"]');
    for(var i=0;i<as.length&&i<200;i++){
      var m=(as[i].getAttribute('href')||'').match(VID);if(!m)continue;
      var r=as[i].getBoundingClientRect();
      if(r.bottom>0&&r.top<vh)item(m[2],m[1],as[i].getAttribute('title')||'');
    }
    var vs=document.querySelectorAll('video');
    for(var j=0;j<vs.length;j++){
      var v=vs[j];if(v.paused||v.readyState<2)continue;
      for(var el=v,d=0;el&&d<10;el=el.parentElement,d++){
        var idm=(el.id||'').match(/(\d{15,21})/);
        if(idm){item(idm[1],'','',true);return;}
        if(d<=4&&el.querySelector){var a=el.querySelector('a[href*="/video/"]'),hm=a&&(a.getAttribute('href')||'').match(VID);if(hm){item(hm[2],hm[1],'',true);return;}}
      }
    }
  }catch(e){}
}
var XS=/^\/([A-Za-z0-9_]{1,15})\/status\/(\d{15,21})(?:\/|$)/;
function xPost(art){
  try{
    var as=art.querySelectorAll('a[href*="/status/"]');
    for(var i=0;i<as.length;i++){
      var m=(as[i].getAttribute('href')||'').match(XS);
      if(m&&as[i].querySelector('time'))return m;
    }
    for(var j=0;j<as.length;j++){var n=(as[j].getAttribute('href')||'').match(XS);if(n)return n;}
  }catch(e){}
  return null;
}
function scanX(){
  if(!xsite)return;
  try{
    var vh=window.innerHeight||800,vs=document.querySelectorAll('video');
    for(var i=0;i<vs.length&&i<40;i++){
      var v=vs[i],art=v.closest&&v.closest('article');
      if(!art)continue;
      var r=art.getBoundingClientRect();
      if(r.bottom<=0||r.top>=vh)continue;
      var m=xPost(art);if(!m)continue;
      var tx=art.querySelector('[data-testid="tweetText"]');
      var desc=tx?tx.textContent:'';
      item(m[2],m[1],desc,false,'x');
      if(!v.paused&&v.readyState>=2)item(m[2],m[1],desc,true,'x');
    }
  }catch(e){}
}
function api(u,pick,how){
  try{
    (of||window.fetch).call(window,u,{credentials:'include',headers:{accept:'application/json'}})
      .then(function(r){return r.ok?r.json():null})
      .then(function(j){var v=null;try{v=j&&pick(j)}catch(e){}if(typeof v==='string'&&/^https?:/.test(v))report(v,how)})
      .catch(function(){});
  }catch(e){}
}
var KSKIP={browse:1,categories:1,category:1,following:1,dashboard:1,search:1,settings:1,login:1,signup:1,auth:1,api:1,popout:1,
transactions:1,subscriptions:1,messages:1,help:1,about:1,'terms-of-service':1,'privacy-policy':1,'community-guidelines':1,
'dmca-policy':1,careers:1,leaderboards:1,emotes:1,store:1,download:1,apps:1,mobile:1,contact:1,partners:1,security:1,video:1,videos:1,clips:1};
function extract(){
  try{
    if(host!=='kick.com')return;
    var p=location.pathname,m;
    if((m=p.match(/\/videos?\/([0-9a-f-]{36})/i)))api('/api/v1/video/'+m[1],function(j){return j.source},'kick');
    else if((m=location.search.match(/[?&]clip=(clip_[\w-]+)/)||p.match(/\/clips?\/(clip_[\w-]+)/)))
      api('/api/v2/clips/'+m[1],function(j){return j.clip&&(j.clip.clip_url||j.clip.video_url)},'kick');
    else if((m=p.match(/^\/([\w-]{3,40})\/?$/))&&!KSKIP[m[1].toLowerCase()])
      api('/api/v2/channels/'+m[1],function(j){return j.livestream&&j.playback_url},'kick');
  }catch(e){}
}
var lastHref='',lastTitle='';
function nav(){
  if(!top)return;
  if(location.href!==lastHref){lastHref=location.href;lastTitle=document.title;post({t:'nav',url:lastHref,title:lastTitle});extract();}
  else if(document.title!==lastTitle){lastTitle=document.title;post({t:'nav',url:lastHref,title:lastTitle});}
}
try{['pushState','replaceState'].forEach(function(k){var o=history[k];if(!o)return;history[k]=function(){var r=o.apply(this,arguments);setTimeout(nav,0);return r;};});
window.addEventListener('popstate',function(){setTimeout(nav,0)});}catch(e){}
function tick(){scan();scanTikTok();scanX();nav();}
document.addEventListener('play',function(e){if(e.target&&e.target.tagName==='VIDEO'){scan();scanTikTok();scanX();}},true);
document.addEventListener('DOMContentLoaded',tick);
setInterval(tick,1500);
})();true;`;

const YT_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/;
// Sites with an official player in the room: the page itself is offered (the server turns it into that player).
const VIMEO_RE = /^https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/|channels\/[\w-]+\/|groups\/[\w-]+\/videos\/|album\/\d+\/video\/|showcase\/\d+\/video\/)?(\d{6,12})(?:\/([0-9a-f]{6,16}))?\/?(?:[?#]|$)/i;
const TWITCH_LIVE_RE = /^https?:\/\/(?:www\.|m\.)?twitch\.tv\/([A-Za-z0-9][A-Za-z0-9_]{2,24})\/?(?:[?#]|$)/i;
const TWITCH_PAGES = new Set(["directory", "videos", "settings", "downloads", "search", "subscriptions", "wallet", "turbo", "store", "jobs",
  "privacy", "legal", "about", "friends", "inventory", "drops", "prime", "team", "teams", "user", "collections", "popout", "moderator",
  "embed", "login", "signup", "following", "broadcast", "partner", "creatorcamp", "bits", "payments", "messages", "activate",
  "annual-recap", "events", "clips", "category", "security", "safety", "ads", "p"]);
const TWITCH_VOD_RE = /^https?:\/\/(?:www\.|m\.)?twitch\.tv\/(?:videos|[A-Za-z0-9_]{3,25}\/(?:v|video))\/(\d{6,12})\/?(?:[?#]|$)/i;
const ARCHIVE_RE = /^https?:\/\/(?:www\.)?archive\.org\/details\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})(?:[/?#]|$)/i;
// src2: TikTok / Facebook posts: the page address is offered; the room plays it in the official embed.
const TIKTOK_RE = /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@[\w.-]+\/video\/(\d{15,21})/i;
const X_RE = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:([A-Za-z0-9_]{1,15})|i(?:\/web)?)\/status(?:es)?\/(\d{15,21})(?:[/?#]|$)/i;
const FB_RE = /^https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/(?:watch\/?\?(?:.*&)?v=(\d{6,20})|[\w.-]+\/videos\/(?:[\w.-]+\/)?(\d{6,20})|reel\/(\d{6,20}))/i;
// Sites whose page (or post) is offered, never a file the page loads: the server turns the page into the room's video,
// exactly as it does for a link pasted on the web. YouTube, TikTok, Facebook, Twitch play in their official players;
// an X post's video file is found by the server. On Kick and Reddit the file the page plays is offered (their sites
// may refuse our server, the page in the app never), and everyone, on the web too, watches it in Nexora's player.
const OFFICIAL_HOSTS = ["youtube.com", "youtu.be", "youtube-nocookie.com", "vimeo.com", "twitch.tv", "tiktok.com", "facebook.com", "fb.watch",
  "instagram.com", "x.com", "twitter.com", "twimg.com"];
export const isOfficialHost = (host: string) => OFFICIAL_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
// Pieces of a stream with sound only or picture only (audio playlists, DASH files): the page's main playlist, which
// carries both, is offered instead.
const PARTIAL = /\/(?:mp4a|audio)[^/?#]*\/|hls_audio|dash_audio|[_-]audio[_-]?only|v\.redd\.it\/[^?#]*\/dash_/i;
export const isPartialStream = (url: string) => PARTIAL.test(url);
const HLS_VARIANT = /\/(?:avc1|hevc|hvc1)\/|\/\d{3,4}x\d{3,4}\/|chunklist|hls_\d{3,4}\.m3u8|\/v1\/playlist\/|[_/]\d{3,4}p\d*(?:\.m3u8|\/)/i;
const HLS_MASTER = /master|playlist|index|manifest|\/pl\/[\w-]+\.m3u8/i;
const PAGE_KINDS = new Set<DetectedMedia["kind"]>(["youtube", "vimeo", "twitch", "archive", "tiktok", "facebook", "x"]);

/** The room's address of a TikTok video: its own page when the author is known, else TikTok's embed address. */
export function tiktokItem(id: string, author: string, title: string, page: string, current: boolean): DetectedMedia | null {
  if (!/^\d{15,21}$/.test(id)) return null;
  const who = /^[\w.-]{1,40}$/.test(author) ? author : "";
  return {
    url: who ? `https://www.tiktok.com/@${who}/video/${id}` : `https://www.tiktok.com/embed/v2/${id}`,
    kind: "tiktok", page, title: title.slice(0, 120) || (who ? `@${who}` : "TikTok"), how: current ? "current" : "feed", key: `tiktok:${id}`,
  };
}

/** The room's address of an X post (its video is found by the server). */
export function xItem(id: string, author: string, title: string, page: string, current: boolean): DetectedMedia | null {
  if (!/^\d{15,21}$/.test(id)) return null;
  const who = /^[A-Za-z0-9_]{1,15}$/.test(author) ? author : "";
  return {
    url: who ? `https://x.com/${who}/status/${id}` : `https://x.com/i/status/${id}`,
    kind: "x", page, title: title.slice(0, 120) || (who ? `@${who}` : "X"), how: current ? "current" : "feed", key: `x:${id}`,
  };
}

/** The page being viewed, when it is a video of a site with an official player (or an Internet Archive item). */
export function pageOffer(url: string, title: string, fallbackTitle: string): DetectedMedia | null {
  const yt = url.match(YT_RE);
  if (yt) return { url: `https://www.youtube.com/watch?v=${yt[1]}`, kind: "youtube", page: url, title: title || fallbackTitle, how: "page" };
  const vm = url.match(VIMEO_RE);
  if (vm) return { url: `https://vimeo.com/${vm[1]}${vm[2] ? `/${vm[2]}` : ""}`, kind: "vimeo", page: url, title: title || "Vimeo", how: "page" };
  const tv = url.match(TWITCH_VOD_RE);
  if (tv) return { url: `https://www.twitch.tv/videos/${tv[1]}`, kind: "twitch", page: url, title: title || "Twitch", how: "page" };
  const tl = url.match(TWITCH_LIVE_RE);
  if (tl && !TWITCH_PAGES.has(tl[1].toLowerCase())) {
    // A live channel: everyone watches live in Twitch's player, the room follows play / pause.
    return { url: `https://www.twitch.tv/${tl[1].toLowerCase()}`, kind: "twitch", page: url, title: title || `Twitch · ${tl[1]}`, how: "page", key: `twitch:${tl[1].toLowerCase()}` };
  }
  // Instagram is not offered: its player cannot be kept together. Kick and Reddit: the file their page plays is offered.
  const xm = url.match(X_RE);
  if (xm) return { ...xItem(xm[2], xm[1] || "", title.replace(/\s*\/\s*X\s*$/, ""), url, false)!, how: "page" };
  const tt = url.match(TIKTOK_RE);
  if (tt) return { url: url.split(/[?#]/)[0], kind: "tiktok", page: url, title: title || "TikTok", how: "page", key: `tiktok:${tt[1]}` };
  const fb = url.match(FB_RE);
  if (fb) return { url: fb[1] ? `https://www.facebook.com/watch/?v=${fb[1]}` : url.split(/[?#]/)[0], kind: "facebook", page: url, title: title || "Facebook", how: "page" };
  const ia = url.match(ARCHIVE_RE);
  if (ia) return { url: `https://archive.org/details/${ia[1]}`, kind: "archive", page: url, title: title || "Internet Archive", how: "page" };
  return null;
}
const MAX_ITEMS = 20;

export function hostOf(url: string): string {
  const m = url.match(/^https?:\/\/([^/?#:]+)/i);
  return m ? m[1].toLowerCase() : "";
}

// Short-link domains of supported sites.
const ALIASES: Record<string, string> = { "youtu.be": "youtube.com", "fb.watch": "facebook.com", "twitter.com": "x.com",
  "mobile.twitter.com": "x.com", "vm.tiktok.com": "tiktok.com", "vt.tiktok.com": "tiktok.com" };

// Pages the supported sites send you through (cookie consent). Allowed for navigation only; never a video source.
const HELPER_HOSTS = ["consent.google.com", "consent.youtube.com"];

export function isAllowedHost(host: string, sites: SiteInfo[]): boolean {
  const h = ALIASES[host] ?? host;
  return !!h && sites.some((s) => h === s.domain || h.endsWith(`.${s.domain}`));
}

function classify(url: string, blocked: boolean): DetectedMedia["kind"] {
  if (blocked) return "blocked";
  if (/\.m3u8(\?|#|$)/i.test(url)) return "hls";
  if (/\.(mp4|m4v|mov)(\?|#|$)/i.test(url)) return "mp4";
  if (/\.webm(\?|#|$)/i.test(url)) return "webm";
  return "video";
}

/** Order of the found list: the video on screen first, then official-player pages, then files (main playlists first). */
export function rank(m: DetectedMedia, current?: string | null): number {
  if (current && (m.key ?? m.url) === current) return -2;
  if (PAGE_KINDS.has(m.kind)) return -1;
  if (m.kind === "blocked") return 9;
  if (m.kind === "hls") return HLS_VARIANT.test(m.url) ? 1 : HLS_MASTER.test(m.url) || m.how === "kick" ? 0 : 1;
  if (m.how === "video" || m.how === "source") return 2;
  return 3;
}

/** Adds a found video, or improves the one already listed (a feed item gets its caption, a repeat stays one row). */
export function mergeFound(prev: DetectedMedia[], item: DetectedMedia, max = MAX_ITEMS): DetectedMedia[] {
  const k = item.key ?? item.url;
  const i = prev.findIndex((p) => (p.key ?? p.url) === k || p.url === item.url || (item.kind === "blocked" && p.kind === "blocked"));
  if (i >= 0) {
    const old = prev[i];
    const title = item.title && (!old.title || /^(@[\w.-]+|TikTok|X)$/.test(old.title)) ? item.title : old.title;
    if (title === old.title) return prev;
    const next = [...prev];
    next[i] = { ...old, title };
    return next;
  }
  return [...prev, { ...item, at: item.at ?? Date.now() }].slice(-max);
}

export function BrowserModal({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (m: DetectedMedia) => Promise<void>;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const web = useRef<WebView>(null);
  const [sites, setSites] = useState<SiteInfo[]>(FALLBACK_CONFIG.allowed_sites.filter((x) => x.domain !== "drive.google.com"));
  const [url, setUrl] = useState<string | null>(null); // null = start page with supported sites
  const [address, setAddress] = useState("");
  const [nav, setNav] = useState({ back: false, fwd: false, loading: false });
  const [found, setFound] = useState<DetectedMedia[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null); // key of the video on screen
  const [webKey, setWebKey] = useState(0); // a new WebView after Android killed the page (see recover)
  const pageHost = useRef("");
  const lastPage = useRef<string | null>(null);

  useEffect(() => {
    // Drive needs a Google sign-in, which Google blocks inside in-app browsers: Drive links are added by pasting
    // the share link in the Video tab instead, so it is not offered here.
    if (visible) loadConfig().then((c) => setSites(c.allowed_sites.filter((x) => x.domain !== "drive.google.com")));
  }, [visible]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  const sorted = useMemo(
    () => [...found].sort((a, b) => rank(a, current) - rank(b, current) || (b.at ?? 0) - (a.at ?? 0)),
    [found, current],
  );
  const shareable = sorted.filter((m) => m.kind !== "blocked");

  const addItem = (item: DetectedMedia) => setFound((prev) => mergeFound(prev, item));
  // The page now on screen, when it is a video of an official-player site: listed first.
  const offerPage = (pageUrl: string, title: string) => {
    const offer = pageOffer(pageUrl, title, t("yt_video"));
    if (!offer) return;
    addItem(offer);
    setCurrent(offer.key ?? offer.url);
  };
  // Android kills a page's renderer when memory runs out (heavy feeds); that WebView cannot be used again. A new one
  // opens the page that was on screen, and what was found so far stays in the list.
  const recover = () => {
    setNotice(t("b_reloaded"));
    if (lastPage.current) setUrl(lastPage.current);
    setWebKey((k) => k + 1);
  };
  // Android's back button: back in the site first, the browser closes from its first page.
  const back = () => {
    if (url && nav.back) web.current?.goBack();
    else onClose();
  };

  const open = (target: string) => {
    const host = hostOf(target);
    if (!isAllowedHost(host, sites)) {
      setNotice(t("b_unsupported"));
      return;
    }
    setFound([]);
    setCurrent(null);
    setListOpen(false);
    pageHost.current = host;
    lastPage.current = target;
    setUrl(target);
    setAddress(target);
  };

  const submitAddress = () => {
    const t = address.trim();
    if (!t) return;
    if (/^https?:\/\//i.test(t)) return open(t);
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t)) return open(`https://${t}`);
    // Free text: search on YouTube (a supported site) instead of a general web search.
    open(`https://m.youtube.com/results?search_query=${encodeURIComponent(t)}`);
  };

  const pick = async (m: DetectedMedia) => {
    setBusy(m.url);
    try {
      await onPick(m);
    } finally {
      setBusy(null);
    }
  };

  const remove = (u: string) => setFound((prev) => prev.filter((x) => x.url !== u));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={back} presentationStyle="fullScreen" statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
          <IconButton icon="close" onPress={onClose} label={t("close")} />
          <View style={styles.address}>
            <Ionicons name={url ? "lock-closed" : "search"} size={14} color={C.muted} />
            <TextInput
              value={address}
              onChangeText={setAddress}
              onFocus={() => setListOpen(false)}
              onSubmitEditing={submitAddress}
              placeholder={t("b_ph")}
              placeholderTextColor={C.dim}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              selectTextOnFocus
              style={styles.addrInput}
            />
            {nav.loading && <ActivityIndicator size="small" color={C.cyan} />}
            {!!url && (
              <Pressable
                hitSlop={8}
                onPress={() => {
                  setUrl(null);
                  setFound([]);
                  setAddress("");
                }}
              >
                <Ionicons name="apps" size={18} color={C.muted} />
              </Pressable>
            )}
          </View>
        </View>

        {notice && (
          <View style={styles.notice}>
            <Ionicons name="shield-checkmark" size={16} color={C.warning} />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        )}

        <View style={{ flex: 1 }}>
          {!url ? (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
              <Text style={styles.startTitle}>{t("b_title")}</Text>
              <Text style={styles.startSub}>{t("b_sub")}</Text>
              <View style={styles.grid}>
                {sites.map((s) => (
                  <Pressable key={s.domain} onPress={() => open(`https://${s.domain === "youtube.com" ? "m.youtube.com" : s.domain}`)} style={({ pressed }) => [styles.site, pressed && { opacity: 0.8 }]}>
                    <View style={styles.siteIcon}>
                      <Text style={styles.siteLetter}>{s.name.slice(0, 1)}</Text>
                    </View>
                    <Text style={styles.siteName} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <Text style={styles.siteDomain} numberOfLines={1}>
                      {s.domain}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.legal}>
                <Ionicons name="information-circle" size={16} color={C.muted} />
                <Text style={styles.legalText}>{t("b_legal")}</Text>
              </View>
            </ScrollView>
          ) : (
            <WebView
              key={webKey}
              ref={web}
              source={{ uri: url }}
              injectedJavaScriptBeforeContentLoaded={DETECTOR}
              injectedJavaScript={DETECTOR}
              injectedJavaScriptForMainFrameOnly={false}
              injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
              onShouldStartLoadWithRequest={(r) => {
                if (!/^https?:/i.test(r.url)) return false; // intent://, market:// etc.
                if ((r as any).isTopFrame === false) return true;
                if (r.url === "about:blank") return true;
                const host = hostOf(r.url);
                if (isAllowedHost(host, sites) || HELPER_HOSTS.includes(host)) return true;
                setNotice(host === "accounts.google.com" ? t("b_no_login") : t("b_blocked_nav"));
                // Nothing loaded yet (the site redirected straight away): go back to the site list, not a black page.
                if (!nav.back) {
                  setUrl(null);
                  setAddress("");
                }
                return false;
              }}
              onNavigationStateChange={(s) => {
                setNav({ back: s.canGoBack, fwd: s.canGoForward, loading: s.loading });
                if (s.loading) return;
                setAddress(s.url);
                if (/^https?:/i.test(s.url)) lastPage.current = s.url;
                const host = hostOf(s.url);
                if (host && host !== pageHost.current) {
                  // New site: forget videos detected on the previous one.
                  pageHost.current = host;
                  setFound([]);
                  setCurrent(null);
                }
                offerPage(s.url, s.title || "");
              }}
              onRenderProcessGone={recover}
              onContentProcessDidTerminate={recover}
              onMessage={(e) => {
                let m: any;
                try {
                  m = JSON.parse(e.nativeEvent.data);
                } catch {
                  return;
                }
                if (m?.t === "nav" && typeof m.url === "string") {
                  // The page changed without loading (TikTok, YouTube are single-page apps).
                  if (!isAllowedHost(hostOf(m.url), sites)) return;
                  lastPage.current = m.url;
                  setAddress(m.url);
                  offerPage(m.url, String(m.title || ""));
                  return;
                }
                if (m?.t === "item" && (m.site === "tiktok" || m.site === "x") && typeof m.id === "string") {
                  // A video of a feed: TikTok's (its official player) or an X post (its video file), in sync.
                  const page = String(m.page || "");
                  if (!isAllowedHost(hostOf(page), sites)) return;
                  const make = m.site === "x" ? xItem : tiktokItem;
                  const it = make(m.id, typeof m.author === "string" ? m.author : "", String(m.title || ""), page, !!m.current);
                  if (!it) return;
                  addItem(it);
                  if (m.current) setCurrent(it.key ?? it.url);
                  return;
                }
                if (m?.t !== "media" || typeof m.url !== "string") return;
                const page = String(m.page || "");
                if (!isAllowedHost(hostOf(page), sites)) return;
                // Official-player sites: the page itself is offered instead (pageOffer, above).
                if (isOfficialHost(hostOf(page)) || isPartialStream(m.url)) return;
                addItem({
                  url: m.url,
                  kind: classify(m.url, !!m.blocked),
                  page,
                  title: String(m.title || "").slice(0, 120),
                  how: String(m.how || ""),
                  duration: typeof m.duration === "number" ? m.duration : undefined,
                });
              }}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              allowsFullscreenVideo
              javaScriptEnabled
              domStorageEnabled
              setSupportMultipleWindows={false}
              style={{ backgroundColor: "#000" }}
            />
          )}
        </View>

        {listOpen && (
          <View style={[styles.sheet, { maxHeight: height * 0.42 }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{t("b_found")}</Text>
              {found.length > 0 && (
                <Pressable onPress={() => setFound([])} hitSlop={8} style={styles.clearBtn}>
                  <Ionicons name="trash-outline" size={14} color={C.error} />
                  <Text style={{ color: C.error, fontWeight: "800", fontSize: 12 }}>{t("b_clear")}</Text>
                </Pressable>
              )}
            </View>
            {sorted.length === 0 ? (
              <Text style={styles.hint}>{t("b_hint")}</Text>
            ) : (
              <FlatList
                data={sorted}
                keyExtractor={(m) => m.url}
                contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <View style={styles.item}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                        <Badge
                          text={item.kind === "blocked" ? t("b_protected") : item.kind.toUpperCase()}
                          color={item.kind === "blocked" ? C.error : item.kind === "hls" || PAGE_KINDS.has(item.kind) ? C.cyan : C.purple}
                        />
                        {!!item.duration && item.duration > 0 && (
                          <Text style={styles.meta}>
                            {Math.floor(item.duration / 60)}:{String(Math.floor(item.duration % 60)).padStart(2, "0")}
                          </Text>
                        )}
                      </View>
                      <Text style={styles.itemTitle} numberOfLines={1}>
                        {item.title || hostOf(item.page)}
                      </Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {item.kind === "blocked" ? t("b_protected_d") : hostOf(item.url)}
                      </Text>
                    </View>
                    {item.kind !== "blocked" && (
                      <Pressable onPress={() => pick(item)} disabled={!!busy} style={[styles.play, !!busy && { opacity: 0.5 }]}>
                        {busy === item.url ? <ActivityIndicator color="#fff" /> : <Ionicons name="play" size={18} color="#fff" />}
                      </Pressable>
                    )}
                    <Pressable onPress={() => remove(item.url)} hitSlop={8} style={styles.del} accessibilityLabel={t("close")}>
                      <Ionicons name="close" size={18} color={C.muted} />
                    </Pressable>
                  </View>
                )}
              />
            )}
          </View>
        )}

        <View style={[styles.bottom, { paddingBottom: insets.bottom + 8 }]}>
          <IconButton icon="chevron-back" onPress={() => (nav.back ? web.current?.goBack() : setUrl(null))} color={url ? C.text : C.dim} />
          <IconButton icon="refresh" onPress={() => web.current?.reload()} color={url ? C.text : C.dim} />
          <Pressable onPress={() => setListOpen((o) => !o)} style={[styles.detectBtn, shareable.length > 0 && styles.detectOn]}>
            <Ionicons name="videocam" size={18} color={shareable.length ? "#fff" : C.muted} />
            <Text style={[styles.detectText, { color: shareable.length ? "#fff" : C.muted }]}>
              {shareable.length ? t("b_n_found", { n: shareable.length }) : url ? t("b_searching") : t("b_pick_site")}
            </Text>
            <Ionicons name={listOpen ? "chevron-down" : "chevron-up"} size={16} color={shareable.length ? "#fff" : C.muted} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingBottom: 8, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  address: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.input, borderRadius: R.pill, paddingHorizontal: 14, height: 42 },
  addrInput: { flex: 1, color: C.text, fontSize: 14, paddingVertical: 0 },
  notice: { flexDirection: "row", gap: 8, alignItems: "center", padding: 10, backgroundColor: C.warning + "18", borderBottomWidth: 1, borderBottomColor: C.warning + "44" },
  noticeText: { flex: 1, color: C.text, fontSize: 12 },
  startTitle: { color: C.text, fontSize: 22, fontWeight: "900" },
  startSub: { color: C.muted, fontSize: 13, lineHeight: 19 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  site: { width: "48%", flexGrow: 1, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.border, padding: 14, gap: 4 },
  siteIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.purpleDeep, borderWidth: 1, borderColor: C.purple + "77", alignItems: "center", justifyContent: "center", marginBottom: 6 },
  siteLetter: { color: C.text, fontSize: 18, fontWeight: "900" },
  siteName: { color: C.text, fontSize: 15, fontWeight: "800" },
  siteDomain: { color: C.muted, fontSize: 11 },
  legal: { flexDirection: "row", gap: 8, padding: 12, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.border },
  legalText: { flex: 1, color: C.muted, fontSize: 12, lineHeight: 17 },
  bottom: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingTop: 8, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border },
  detectBtn: { flex: 1, height: 42, borderRadius: R.pill, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.input },
  detectOn: { backgroundColor: C.purple },
  detectText: { fontSize: 14, fontWeight: "800" },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 14, gap: 10, borderTopWidth: 1, borderColor: C.border },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { color: C.text, fontSize: 16, fontWeight: "800" },
  clearBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  hint: { color: C.muted, fontSize: 13 },
  item: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.cardHi, borderRadius: 14, padding: 12 },
  itemTitle: { color: C.text, fontSize: 14, fontWeight: "700" },
  meta: { color: C.muted, fontSize: 11 },
  play: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.purple, alignItems: "center", justifyContent: "center" },
  del: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: C.input },
});

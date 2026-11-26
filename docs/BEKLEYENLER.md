# Bekleyen işler

Bir dış nedenle şimdilik yapılamayan işler. Engel kalkınca buradan devam edilir.

## Dailymotion kaynağı (bırakıldı)

**Karar (26 Kasım 2026):** Dailymotion eklenmiyor. Uygulamanın sahibi ücretli bir paket almamaya karar verdi.

**Neden:** Dailymotion'ın resmî oynatıcısı (Player Web SDK) bir Player ID ile yükleniyor; oynat, durdur, ileri sar ve
konum okuma bu SDK ile yapılıyor. 2026'nın üçüncü çeyreğinden beri Player ID içermeyen gömme kodları 403 veriyor
(Dailymotion'ın Q3 2026 sürüm notu ve geliştirici günlüğü: "Player ID required in embed URLs"); yani ID'siz video
gösterilemiyor bile. Players bölümü (Studio → Embeds → Players) yalnızca Edge müşterilerine açık; normal kullanıcı,
standart ve premium creator hesaplarında yok. Yalnızca oynatıcı isteyenlerin aboneliği (Starter / Advanced) yeni
müşterilere kapalı. Edge yayıncılar, yayın kuruluşları ve medya grupları için ve fiyatı teklif üzerine veriliyor.
Açılan Dailymotion hesabı (VPN ile) Nexora'da hiçbir yerde kullanılmıyor.

**Video algılamayla neden olmuyor:** Dailymotion'ın akış adresleri varsayılan olarak adresi alan cihazın IP'sine / ağına
kilitli ve süreli (Dailymotion'ın "Generate stream URLs" belgesi). Bir telefonun bulduğu adres sunucunun "başka cihaz
açabiliyor mu" denetiminden geçmez, odadaki diğer telefonlarda ve webde açılmaz. 1.8.0'da tarayıcının dosya bulma yolu
denenmişti; resmî oynatıcı kararına aykırı olduğu için 1.8.1'de geri alındı. Uygulamada ve sitede Dailymotion hiçbir
yerde geçmiyor.

**Bir gün Player ID alınırsa:** `backend/resolver.py` `dailymotion.com/video/<id>` ve `dai.ly/<id>` bağlantılarını
`kind: "dailymotion"` (`seek: true, sync: true`) olarak çözer, canlı yayın ve oynatma listelerini `no_sync_source` ile
reddeder; `frontend/src/components/player/DailymotionPlayer.jsx` SDK'yı (`https://geo.dailymotion.com/libs/player/<PLAYER_ID>.js`,
`play` / `pause` / `seek` / `getState`) yükler; ID `DAILYMOTION_PLAYER_ID` ortam değişkeninden `/api/config` ile gelir,
boşsa Dailymotion kapalı kalır; site listesi, uygulama tarayıcısı (`pageOffer`), testler ve gizlilik politikası buna göre
güncellenir.

## Reddit: API anahtarı alınamıyor (dış engel, kalıcı)

**Durum (25 Kasım 2026):** Reddit, Kasım 2025'te kendi kendine API erişimini kapattı ("Responsible Builder Policy":
her başvuru Reddit'in onayına gidiyordu) ve 31 Ekim 2026'dan beri yeni Data API başvurusu kabul etmiyor. Bu yüzden
Nexora için Reddit API anahtarı (client id / secret) alınamıyor. 1.8.3'ün ilk paketinde olan anahtar ayarı
(`REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`) kullanılamayacağı için koddan ve `docker-compose.yml`'den çıkarıldı.

**Anahtarsız nasıl çalışıyor:**

- **Uygulama (her zaman):** "Sitelerde gez ve video bul" ile Reddit gönderisi açılıp video bir kez oynatılınca,
  uygulama Reddit'in kendi oynatıcısının yüklediği HLS listesini (`v.redd.it/<id>/HLSPlaylist.m3u8`) sayfanın
  içinden bulur. API ya da anahtar gerekmez. Oda bu dosyayı kendi oynatıcımızda oynatır; sitedekiler dahil herkes
  eşitli izler.
- **Site (bağlantı yapıştırma):** sunucu gönderinin herkese açık verisini anahtarsız okur
  (`www.reddit.com/comments/<id>.json`, `backend/resolver.py` `_reddit`). Reddit sunucu adreslerinden gelen anahtarsız
  istekleri reddedebilir; reddederse kullanıcı `reddit_app_only` hatasını görür: "videoyu uygulamadan ekle; eklenince
  sitedekiler de izler".
- Desteklenenler: gönderi bağlantıları (`reddit.com/r/<sub>/comments/<id>/…`, `old.reddit.com`, `redd.it/<id>`),
  paylaşım bağlantıları (`reddit.com/r/<sub>/s/<kod>`, yönlendirmesinden gönderi bulunur), crosspost'lar.
  Reddit'e yüklenmemiş videolar (YouTube bağlantısı paylaşılan gönderiler) ve yazı gönderileri `reddit_no_video` verir.
- Reddit'te canlı yayın yok: Reddit'in canlı yayın ağı RPAN Kasım 2022'de kapandı.

**Yapılacak:** İlk sürümden sonra sitede bir Reddit gönderisi bağlantısı yapıştırılıp sunucunun cevap alıp almadığı
görülür. Reddit ileride yeni bir başvuru yolu açarsa `_reddit_fetch`'e OAuth (client_credentials, `oauth.reddit.com`)
eklenir; şimdilik yapılacak bir şey yok.

## Kick: sitede yapıştırılan bağlantılar (dış engel)

**Durum (25 Kasım 2026):** Kick'in resmî API'si (api.kick.com) kanal ve yayın bilgisi veriyor, oynatma adresi vermiyor
(incelenen belgelere göre); adres yalnızca Kick'in kendi sitesinin kullandığı API'den (`kick.com/api/v2/channels/<kanal>`, `/api/v1/video/<id>`, `/api/v2/clips/<id>`)
alınabiliyor ve bu API Cloudflare bot denetiminin arkasında. Sunucudan gelen istekleri engelleyebilir.

- **Uygulama (her zaman):** Kick kanalı, kaydı ya da klibi açılınca uygulama aynı API'yi Kick'in kendi sayfasının
  içinden sorar (kişinin oturumu, aynı site) ve oynatıcının aldığı HLS adresini bulur. Canlı yayında herkes kendi
  oynatıcımızda aynı gecikmeyle canlıdadır; kayıt ve kliplerde tam eşitleme. Sitedekiler de izler.
- **Site (bağlantı yapıştırma):** sunucu aynı API'yi sorar (`backend/resolver.py` `_kick`). Engellenirse kullanıcı
  `kick_app_only` hatasını görür: "yayını uygulamadan ekle; eklenince sitedekiler de izler". Bot denetimini aşmaya
  çalışılmaz (tarayıcı taklidi, vekil sunucu yok).
- Kanal yayında değilse `kick_offline`.

**Yapılacak:** İlk sürümden sonra sitede bir Kick kanalı bağlantısı denenip sunucunun cevap alıp almadığı görülür.

## 1.8.6: gerçek telefonda denenecekler (bu ortamda yapılamadı)

- **TikTok (uygulamanın tarayıcısı):** akışta bir videoda Paylaş → Bağlantıyı kopyala: "Kopyaladığın video listeye eklendi"
  yazmalı ve video listenin başında olmalı. "Geçiş engellendi (…)" çıkarsa parantez içindeki site adını bildir: o adres
  TikTok'un geçtiği bir sayfaysa listeye eklenir. TikTok'a telefon/e-posta ile giriş denenmeli.
- **HLS hatası:** HLS bir video açılmazsa hata kutusunun altındaki küçük yazının (ör. `hls manifestLoadError 403`) ekran
  görüntüsü: asıl neden bundan anlaşılır.
- **Dikey videolar:** Facebook Reels, TikTok, Shorts ve dikey bir dosya iki telefonda: resim 3:4, video kesilmeden ve ortada.
- **Instagram:** eklenmedi. Resmî oynatıcısı dışarıdan kontrol edilemiyor, dosyaları yalnızca instagram.com'da açılıyor:
  herkeste aynı anda oynatılamıyor. Kural: senkron olmayan kaynak eklenmez.
- **Reddit yüksek kalite:** yapılmadı. Reddit akışındaki oynatıcı `f=sd` (düşük kalite) listesi veriyor; yüksek kalite
  listesinin herkeste açıldığı canlı Reddit'te denenmeden eklenmedi.

## 1.8.5: gerçek telefonda denenecekler (bu ortamda yapılamadı)

- **Paylaş → Nexora Watch:** TikTok uygulamasında bir videoda Paylaş → (diğer uygulamalar) → Nexora Watch. Bir oda
  açıkken: video odaya gider (boşsa oynar, doluysa sıraya), altta "Video odaya eklendi / sıraya eklendi" yazar, bir an
  sonra TikTok'a geri dönülür. Oda kapalıyken: ana sayfa "Paylaştığın video hazır" der, açılan ilk odaya eklenir.
  YouTube, X, Reddit, Facebook, Kick ve Twitch uygulamalarından da denenmeli. Paylaş menüsünde Nexora Watch'ın
  görünmesi ve geri dönüş, GitHub'daki derlemenin Kotlin değişikliğine bağlı (burada derlenemedi).
- **Uygulama tarayıcısı:** TikTok'ta akışı kaydırırken birkaç videoyu art arda seç: tarayıcı kapanmamalı, her satır
  sonucunu yazmalı, "Şimdi oynat" sıradakini hemen açmalı. Tarayıcıyı kapatıp aç: TikTok baştan yüklenmemeli. TikTok'un
  "uygulamada aç" ısrarı Chrome kimliğiyle azalmalı; azalmıyorsa ekran kaydı gerekli.
- **Oda sahibi başka uygulamadayken:** oda sahibi YouTube videosu oynarken TikTok'a geçsin; diğer telefonda video
  durmamalı. Dönünce oda sahibinin videosu odanın olduğu yere gelmeli. Oda sahibi 2 dakikadan uzun dışarıda kalırsa
  odanın sahipliği sıradaki kişiye geçebilir (1.8.1'den beri böyle); bu durumda geri dönen kişinin bulduğu videolar sıraya
  girer.
- **Facebook paylaşım bağlantısı:** Facebook uygulamasında "Bağlantıyı kopyala" ile alınan bağlantı (facebook.com/share/…)
  sitede yapıştırılınca açılmalı. Facebook sunucumuza yönlendirmeyi vermezse bağlantı "Facebook bu paylaşım bağlantısını
  açmadı" der; uygulamada Paylaş → Nexora Watch ise bağlantıyı önce telefonda açar.
- **Reddit sitede:** Reddit sunucumuzu reddettiğinde site gönderiyi kendi tarayıcısından okumaya çalışır. Reddit'in buna
  izin verip vermediği (CORS) yalnızca gerçek tarayıcıda görülür; izin vermezse eskisi gibi "uygulamadan ekle" yazar.
- **Uzun video yükleme:** 500 MB üstü bir videoyu hem sitede hem uygulamada yükle; yükleme sırasında ekran kapanmamalı
  (sitede), Wi-Fi'ı birkaç saniye kapatıp açınca "bağlantı bekleniyor" yazıp kaldığı yerden sürmeli, sonunda video odada
  oynamalı.

## 1.8.4: gerçek telefonda ve canlı sitelerde denenecekler (bu ortamda yapılamadı)

Bu ortamın internete çıkışı kapalı; canlı X, TikTok, Kick, Twitch ve Reddit sunucularına istek atılamadı. Aşağıdakiler
taklit sunucularla Chrome 153'te denendi; gerçek sitelerin davranışı telefonda doğrulanmalı.

- **X:** `video.twimg.com` başka sitelerin sayfasından gelen video isteğine 403 veriyor (halka açık raporlar). 1.8.4'te
  sunucu dosyayı tarayıcının soracağı gibi iki kez sorar: odanın sayfası Referer olarak / Referer olmadan. Yalnızca
  ikincisi açılıyorsa video `referrer_policy: "no-referrer"` ile işaretlenir ve oda onu Referer göndermeyen bir
  çerçevede oynatır; tarayıcı ilk denemede reddedilirse oynatıcı da bir kez bu yolla dener. X her iki yolu da
  reddederse bağlantı yine "yalnızca kendi sayfasında oynatıyor" der: bu X'in engelidir, sunucudan geçirme yapılmaz.
- **Twitch dik ekran:** Twitch'in sayfası 400×300 veya daha büyük ölçülür (Chrome / Android WebView 128+ CSS zoom'u
  çerçevenin içine taşır). Daha eski tarayıcıda Twitch kendi oynat düğmesine bir dokunuş isteyebilir.
- **Kick canlı:** yayın, Kick'in kendi API'sinin verdiği HLS'dir ve kendi oynatıcımızda oynar. Kick sunucumuza kanalı
  vermezse (bot denetimi) ya da yayın sunucusu başka sitelere CORS izni vermiyorsa canlı kanal Kick'in resmî gömme
  oynatıcısında açılır (player.kick.com): herkes canlıyı izler. Gömme oynatıcının JavaScript denetimi yok; oda yine de
  oynat/durdur'u yönetir: oda sahibi durdurunca yayın her telefonda kapanır, oynatınca herkes canlıya döner (oda sahibinin
  düğmesi oynatıcının altındaki çubukta). Kayıt ve kliplerde böyle bir oynatıcı yok: nedeniyle reddedilir.
- **TikTok:** bağlantı eklenirken TikTok'un resmî oEmbed'i sorulur. TikTok 400/404 derse (gizli, silinmiş, sahibi
  gömmeyi kapatmış) bağlantı nedeniyle reddedilir; videonun her telefonda "Video currently unavailable" demesi yerine.
  Fotoğraf gönderileri (slayt) de nedeniyle reddedilir. TikTok'a ulaşılamazsa hiçbir şey reddedilmez.
- **YouTube:** bağlantı eklenirken YouTube'un oEmbed'i 401 (gizli, gömme kapalı) ya da 404 (kaldırılmış) derse bağlantı
  nedeniyle reddedilir. Yaşa sınırlı videoları YouTube gömmede hiç oynatmıyor; bunu ancak oynatıcı söyler.
- **Oturumlar:** resmî oynatıcılar (YouTube, Twitch, TikTok, Facebook) her izleyicinin kendi tarayıcısındaki oturumla
  açılır. YouTube'a girişliysen izlediğin video geçmişine düşer (watch2gether'daki gibi); bu bir hata değil. Yalnızca
  girişle açılan videolar (gizli, kanal üyelerine özel) başkalarında açılmaz; YouTube'da bunlar eklenirken reddedilir.

## InMobi: Play yayınından sonra yapılacaklar

Panel kurulumu ve kimlikler tamam (`docs/ADS.md`). Uygulama Google Play'de yayınlanınca:

1. InMobi panel → Inventory Settings → Nexora Watch → App Details → **Link app URL**: Play adresini bağla.
2. Her iki yerleşimde (home_banner, room_exit) **Test Mode: Off** olduğundan emin ol; şu an InMobi uygulama Play'de
   olmadığı için test modunu kendisi "Global" tutuyor.
3. Play Console mağaza kaydında web sitesi `https://nexora.lenstedreal.info` olsun; birkaç gün içinde panelde
   app-ads.txt durumu doğrulandı olarak görünmeli.
4. Kendi reklamına tıklama; ilk günlerde gelir görünmeyebilir, bu normal.

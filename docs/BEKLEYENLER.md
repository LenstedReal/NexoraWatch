# Bekleyen işler

Bir dış nedenle şimdilik yapılamayan işler. Engel kalkınca buradan devam edilir.

## Dailymotion kaynağı (beklemede)

**Durum (26 Kasım 2026):** Hesap açıldı (VPN ile), ama bu hesabın Dailymotion Studio'sunda oynatıcı bölümü yok: solda
yalnızca Yükle, Medya, Analizler, Ödemeler, Ayarlar var; Ayarlar → Hesap'ta da hesap türü seçeneği görünmüyor.
Dailymotion'ın belgelerine göre Player ID, Studio'daki "Players" sekmesinden ya da Platform API ile (manage_players
yetkisi) alınıyor; bu hesapta ikisi de yok. Player ID alınamadığı için Dailymotion eklenmedi. Dailymotion'ın yardım sayfası Players bölümünü "Dailymotion Partner" hesaplarına bağlıyor; yayıncı erişimi Dailymotion Pro ile veriliyor. 26 Kasım 2026'da pro.dailymotion.com (artık dailymotionbusiness.com) sayfası, yalnızca oynatıcı isteyenler için olan aboneliğin yeni müşterilere geçici olarak kapatıldığını yazıyor; diğer seçenek (Edge) yayın kuruluşları için. Abonelik yeniden açılırsa ya da Studio'da Embeds → Players görünürse aşağıdaki adımlarla eklenir. (Önceki durum: 13 ve 25
Kasım'da Türkiye'den hesap açılamamıştı.) VPN ile açılan hesap Dailymotion'ın kurallarına takılıp kapatılırsa oynatıcı da
herkeste durur; Player ID alınırsa bu risk bilinerek eklenir (kararı uygulamanın sahibi verdi). Uygulamada ve sitede
Dailymotion hiçbir yerde geçmiyor; kullanıcıya yarım bir özellik gösterilmiyor. (1.8.0'da uygulamanın tarayıcısına dosya
bulma yoluyla eklenmişti; bu karara aykırı olduğu için 1.8.1'de geri alındı.)

**Neden Player ID gerekiyor:** Dailymotion'ın resmî oynatıcısı (Player Web SDK) yalnızca bir Player ID ile
yükleniyor. Oynat, durdur, ileri sar ve konum okuma bu SDK ile yapılıyor; eşitleme bunlarla kurulabiliyor. Resmî
yol dışında bir oynatıcı kullanılmayacak.

**Engel kalkınca yapılacaklar:**

1. dailymotion.com'da hesap aç (masaüstü sitesi), Studio → Players → Create player, adı `Nexora`, ayarlara dokunma.
2. Listede `x` ile başlayan kısa kodu al (ör. `x8k2m9p`). Gizli değil, düz yazılabilir.
3. Kod tarafı:
   - `backend/resolver.py`: `dailymotion.com/video/<id>` ve `dai.ly/<id>` bağlantılarını `kind: "dailymotion"`,
     `capabilities: {seek: true, rate_correction: false, sync: true}` olarak çöz; canlı yayınları ve oynatma
     listelerini `no_sync_source` ile reddet.
   - `frontend/src/components/player/`: `DailymotionPlayer.jsx` (SDK: `https://geo.dailymotion.com/libs/player/<PLAYER_ID>.js`,
     `play` / `pause` / `seek` / `getState`), `Stage.jsx` içinde sağlayıcı çubuğu ile göster.
   - Player ID ortam değişkeninden gelsin (`DAILYMOTION_PLAYER_ID`), `/api/config` ile istemciye geçsin; boşsa
     Dailymotion kapalı kalsın.
   - `backend/config.py` varsayılan site listesine `dailymotion.com|Dailymotion` eklensin (ID varsa); `apps/mobile`
     tarayıcısı Dailymotion sayfasını `pageOffer` ile önersin (YouTube gibi), dosya aramasın.
   - Testler: çözümleyici testi, sahte SDK ile ev sahibi/misafir eşitleme testi (Twitch/Facebook testleri gibi).
4. Gizlilik politikası: video sağlayıcıları listesine Dailymotion eklenir (TR + EN) ve GitHub'daki
   `NexoraWatch/` kopyaları yeniden üretilir.

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

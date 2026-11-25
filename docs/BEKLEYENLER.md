# Bekleyen işler

Bir dış nedenle şimdilik yapılamayan işler. Engel kalkınca buradan devam edilir.

## Dailymotion kaynağı (beklemede)

**Durum (25 Kasım 2026):** Dailymotion, Türkiye'den yeni hesap açılmasına hâlâ izin vermiyor ("ülkenizde yeni hesap
oluşturma kullanılamıyor"; ilk deneme 13 Kasım, son deneme 25 Kasım 2026, ikisinde de aynı). Hesap olmadan Player ID
alınamıyor, bu yüzden Dailymotion eklenmedi. Uygulamada ve sitede Dailymotion hiçbir yerde geçmiyor; kullanıcıya
yarım bir özellik gösterilmiyor. (1.8.0'da uygulamanın tarayıcısına dosya bulma yoluyla eklenmişti; bu karara aykırı
olduğu için 1.8.1'de geri alındı.) Hesap kısıtını aşmak için VPN ya da başkasının adına hesap kullanılmayacak:
Dailymotion'ın kurallarına aykırı olur ve hesap kapatılırsa oynatıcı da kapanır.

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

## InMobi: Play yayınından sonra yapılacaklar

Panel kurulumu ve kimlikler tamam (`docs/ADS.md`). Uygulama Google Play'de yayınlanınca:

1. InMobi panel → Inventory Settings → Nexora Watch → App Details → **Link app URL**: Play adresini bağla.
2. Her iki yerleşimde (home_banner, room_exit) **Test Mode: Off** olduğundan emin ol; şu an InMobi uygulama Play'de
   olmadığı için test modunu kendisi "Global" tutuyor.
3. Play Console mağaza kaydında web sitesi `https://nexora.lenstedreal.info` olsun; birkaç gün içinde panelde
   app-ads.txt durumu doğrulandı olarak görünmeli.
4. Kendi reklamına tıklama; ilk günlerde gelir görünmeyebilir, bu normal.

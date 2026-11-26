# Nexora Watch

Arkadaşlarınla aynı videoyu **aynı anda** izlediğin, Rave benzeri birlikte izleme uygulaması. Oda kurarsın, kodu ya da davet bağlantısını paylaşırsın; video herkeste aynı saniyede oynar. Yanında sohbet, emoji tepkileri, katılımcı listesi ve oylamalı video sırası var.

- Web: https://nexora.lenstedreal.info
- Android: GitHub Releases (`latest`), Google Play'e hazırlanıyor
- Kişisel sayfa: https://me.lenstedreal.info · İndirmeler: https://apk.lenstedreal.info

## Desteklenen kaynaklar

| Kaynak | Nasıl | Eşitleme |
|---|---|---|
| YouTube (video, Shorts) | resmî oynatıcı | var |
| TikTok | resmî gömme oynatıcı; uygulamanın tarayıcısı akıştaki videoları da bulur | var |
| X | gönderinin video dosyası: sunucu adresi X'in gömme verisinden bulur, video telefonlara X'ten gelir. X'in sunucusu başka sitelerin sayfasından gelen isteği reddedip doğrudan açılışa izin veriyorsa video, Referer göndermeyen bir çerçevede oynar (1.8.4) | var |
| Facebook videoları | resmî oynatıcı (JS SDK). Facebook uygulamasının kopyaladığı paylaşım bağlantıları (fb.watch, facebook.com/share/…) videonun kendi adresine çevrilir (1.8.5) | var |
| Twitch | resmî oynatıcı: kayıtlı yayınlar ve canlı yayınlar; dik ekranda da oynar (oynatıcı 400×300'ün altına inmez, CSS zoom ile küçültülerek çizilir, 1.8.4) | kayıtlarda tam; canlıda herkes canlıyı izler, oynat/durdur eşit |
| Kick | canlı yayın, kayıt, klip: Kick'in kendi oynatıcısının aldığı HLS, kendi oynatıcımızda. Kick sunucumuza kanalı vermezse ya da yayın sunucusu başka sitelere kapalıysa canlı kanal Kick'in resmî gömme oynatıcısında açılır (1.8.4) | kayıtlarda tam; canlıda herkes aynı gecikmeyle canlıda, oynat/durdur eşit (Kick'in gömme oynatıcısında da: oda sahibi durdurunca yayın herkeste durur, oynatınca herkes canlıya döner) |
| Reddit | gönderinin Reddit HLS videosu, kendi oynatıcımızda. Reddit sunucumuza gönderiyi vermezse sitede gönderiyi izleyicinin kendi tarayıcısı okur (1.8.5) | var |
| Google Drive | herkese açık dosya içe aktarılır | var |
| MP4 / M3U8 bağlantısı, telefondan yüklenen video | kendi oynatıcımız (kalite, altyazı, sıra) | var |

**Art arda video ekleme (1.8.5).** Gezinirken bulunan videolar sırayla odaya gider: oda boşsa ilki hemen oynar, sonrakiler sıraya girer ve biri bitince sıradaki kendiliğinden başlar; oda sahibi sıradakini "Şimdi oynat" ile hemen açabilir. Bağlantı kutusundaki "Ayarla" bu kuralın dışındadır, her zaman hemen oynatır.
- Uygulamanın tarayıcısı video seçilince kapanmaz; her satır "Odaya eklendi", "Sıraya eklendi" ya da hatayı gösterir. Tarayıcı kapatılınca sayfa arkada (sessiz, durdurulmuş) 10 dakika açık kalır, yeniden açınca kaldığı yerden sürer. Sitelere uygulama içi tarayıcı olarak değil, telefonun Chrome'u olarak görünür.
- **Paylaş → Nexora Watch** (Android): TikTok, YouTube, X, Reddit, Facebook, Kick, Twitch uygulamalarında Paylaş menüsünden Nexora Watch seçilince video açık odaya gider, telefon kısa bir yazıyla sonucu söyler ve paylaşılan uygulamaya geri dönülür. Açık oda yoksa ana sayfa bunu söyler; video açılan ilk odaya eklenir.
- Webde "Sitelerde gez" video gelince açık kalır, kopyalanan bir sonraki bağlantıyı da aynı şekilde alır.
- Oda sahibi video aramak için başka uygulamaya geçtiğinde telefonun kendiliğinden durdurduğu video odayı durdurmaz; geri dönünce oynatıcı odanın olduğu yere gelir, oda sahibinin kendi dokunuşu yine herkese geçer.

**Cihazdan yükleme (1.8.5).** Uzun videoların yüklemesi yarıda kalmıyor: dosya 8 MB'lık parçalarla gider ve uzun dosyalarda her 20 parçalık grubun ilk parçası, sıradaki bütün parçalar bitene kadar yükleme adresini alamıyordu; denemeleri bitince yükleme duruyor, öbür parçalar ilerleme çubuğunu oynatmaya devam ettiği için ekranda %87 gibi bir yerde takılı kalıyordu. Duran bir parça 30 saniye sonra yeniden gönderilir, bağlantı gidip gelirse bekleyip kaldığı yerden sürer; webde yükleme sürerken ekran kapanmaz.

Liste sitede ve uygulamada birebir aynıdır. Uygulamanın tarayıcısı videoyu kendisi bulur (Kick'te yalnızca kanalın, kaydın, klibin yayını; ana sayfanın 10 saniyelik önizlemeleri listelenmez; Reddit'te her video tek satır, gönderinin başlığıyla). Webde "Sitelerde gez" siteyi yanında açar; videonun bağlantısını kopyalayıp geri dönünce Nexora bağlantıyı kendisi alır ve odaya getirir (tarayıcı panoyu okumaya izin verdiyse; izin yoksa tek dokunuş). Kick ve Reddit bağlantılarını sunucu çözer; bu iki site sunucumuzu engellerse (Kick'in bot denetimi, Reddit'in sunucu kısıtı) video uygulamanın tarayıcısıyla eklenir ve eklenince sitedekiler de izler. Reddit API anahtarı artık alınamıyor (Reddit yeni başvuruları 31 Ekim 2026'da kapattı), sunucu gönderinin herkese açık verisini anahtarsız okur; ayrıntılar `docs/BEKLEYENLER.md`. Reddit'te canlı yayın yok (Reddit Kasım 2022'de kapattı). Yoklar: Instagram (oynatıcısı kontrol edilemiyor, dosyaları yalnızca instagram.com'da açılıyor; videoyu sunucudan geçirmek Instagram kurallarına aykırı), DRM/abonelik platformları (Netflix, Disney+, Prime Video, HBO Max: 1.8.3'ten beri kapalı, `SERVICES_ENABLED`). Dailymotion yok: resmî oynatıcısının istediği Player ID yalnızca ücretli Edge paketinde (`docs/BEKLEYENLER.md`). Vimeo, Internet Archive ve Dropbox bağlantıları yapıştırılınca çalışır, listede gösterilmez. Resmî oynatıcıların üstüne hiçbir şey çizilmez; başlık ve düğmeler oynatıcının altındaki çubuktadır.

## Repo yapısı

| Klasör | İçerik |
|---|---|
| `backend/` | FastAPI + MongoDB: odalar, WebSocket eşitleme, sohbet, sıra, altyazı, yükleme, Drive içe aktarma, moderasyon |
| `frontend/` | React web uygulaması: hem web sitesinin hem mobil uygulamanın arayüzü (tek kod) |
| `apps/mobile/` | Expo kabuğu: arayüzü WebView'da açar; yerel özellikler (sitelerde video bulma, abonelik servisleri, yatay ekran, derin bağlantı, InMobi reklam modülü) |
| `site/personal/`, `site/apk/` | me.lenstedreal.info ve apk.lenstedreal.info |
| `deploy/` | Caddy (HTTPS, üç alan adı) + web derleme |
| `packages/localization/` | Ortak çeviri dosyası (tr, en, de) |
| `docs/` | Kurulum, yayın, mimari, eşitleme, reklamlar, abonelik servisleri |

## Alan adları (Caddy)

| Değişken | Varsayılan | Ne sunar |
|---|---|---|
| `DOMAIN` | — | web uygulaması + `/api` (WebSocket dahil) |
| `PERSONAL_DOMAIN` | `me.lenstedreal.info` | kişisel sayfa |
| `APK_DOMAIN` | `apk.lenstedreal.info` | indirme sayfası + dokunma sayacı (`/api/track`) |

## Otomasyon (GitHub Actions)

- **Deploy** (`deploy.yml`): `main`'e push → imajlar derlenir, sunucu indirip yeniden başlar. Canlı sürüm: `/version.txt`. Bkz. `docs/DEPLOY.md`.
- **Android** (`android.yml`): `apps/mobile/` değişince imzalı APK + AAB üretir; APK Releases'e (`latest`) konur, AAB işin "Artifacts" bölümündedir. InMobi kimlikleri depo değişkenlerinden okunur (`docs/ADS.md`).
- **Backend** (`backend.yml`): API testleri + Docker derleme.

Arayüz web'de olduğu için web'deki düzeltmeler uygulamaya yeni APK gerekmeden yansır; yalnızca `apps/mobile/` değişiklikleri yeni APK ister.

## Çalıştırma

```bash
cp .env.example .env              # MEDIA_SIGNING_SECRET: openssl rand -hex 32
docker compose up -d              # API: http://<sunucu>:8001/api/
DOMAIN=nexora.alanadin.com docker compose --profile tls up -d   # HTTPS
```

Yüklenen videolar `media-data` volume'unda tutulur ve en geç 7 günde silinir. Oracle Object Storage isteğe bağlıdır (`docs/STORAGE.md`).

## Testler

```bash
cd backend && pip install -r requirements-dev.txt
MEDIA_SIGNING_SECRET=dev uvicorn server:app --port 8001 &
NEXORA_API_URL=http://localhost:8001 pytest -q
cd apps/mobile && npm test        # eşitleme ve reklam kuralları (Node 22+)
```

## Belgeler

- `docs/DEPLOY.md`: sunucu, güncelleme, DNS, yedek
- `docs/RELEASE.md`: imzalı APK/AAB, Google Play kontrol listesi
- `docs/PLAYBACK-SYNC.md`: eşitleme protokolü
- `docs/ADS.md`: InMobi kurulumu (odada reklam yok)
- `docs/SERVICES.md`: Netflix, Disney+, Prime Video, HBO Max (beta)
- `docs/BEKLEYENLER.md`: bekleyen ve bırakılan işler (Dailymotion neden yok; InMobi'nin Play sonrası adımları)
- `docs/SECURITY.md`, `docs/STORAGE.md`, `docs/TESTING.md`, `docs/ARCHITECTURE.md`

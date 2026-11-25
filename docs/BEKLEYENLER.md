# Bekleyen işler

Bir dış nedenle şimdilik yapılamayan işler. Engel kalkınca buradan devam edilir.

## Dailymotion resmî oynatıcısı (beklemede)

**Durum (25 Kasım 2026, 1.8.0):** Dailymotion uygulamanın tarayıcısında yeniden var: sayfadaki video, sitenin kendi
oynatıcısının aldığı HLS adresinden bulunur ve Nexora'nın kendi oynatıcısında eşitli oynar (odadaki diğer cihazlar
açamıyorsa sunucu `source_locked` ile reddeder). Eksik kalan tek şey resmî oynatıcı: o olmadan Dailymotion
**bağlantısı yapıştırılınca** (web sitesinde) çalışmaz.

**Neden hâlâ beklemede (13 Kasım 2026):** Dailymotion, Türkiye'den yeni hesap açılmasına izin vermiyor ("ülkenizde
yeni hesap oluşturma kullanılamıyor", geçici olduğu söyleniyor). Hesap olmadan Player ID alınamıyor.

**Neden Player ID gerekiyor:** Dailymotion'ın resmî oynatıcısı (Player Web SDK) yalnızca bir Player ID ile
yükleniyor. Oynat, durdur, ileri sar ve konum okuma bu SDK ile yapılıyor; eşitleme bunlarla kurulabiliyor.

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
   - `backend/config.py` site listesinde Dailymotion zaten var (1.8.0); `apps/mobile` tarayıcısı resmî oynatıcı gelince
     Dailymotion sayfasını `pageOffer` ile önersin (YouTube gibi), dosya aramasın.
   - Testler: çözümleyici testi, sahte SDK ile ev sahibi/misafir eşitleme testi (Twitch/Facebook testleri gibi).
4. Gizlilik politikası: video sağlayıcıları listesine Dailymotion eklenir (TR + EN) ve GitHub'daki
   `NexoraWatch/` kopyaları yeniden üretilir.

## InMobi: Play yayınından sonra yapılacaklar

Panel kurulumu ve kimlikler tamam (`docs/ADS.md`). Uygulama Google Play'de yayınlanınca:

1. InMobi panel → Inventory Settings → Nexora Watch → App Details → **Link app URL**: Play adresini bağla.
2. Her iki yerleşimde (home_banner, room_exit) **Test Mode: Off** olduğundan emin ol; şu an InMobi uygulama Play'de
   olmadığı için test modunu kendisi "Global" tutuyor.
3. Play Console mağaza kaydında web sitesi `https://nexora.lenstedreal.info` olsun; birkaç gün içinde panelde
   app-ads.txt durumu doğrulandı olarak görünmeli.
4. Kendi reklamına tıklama; ilk günlerde gelir görünmeyebilir, bu normal.

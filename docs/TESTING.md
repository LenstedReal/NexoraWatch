# TESTING

## Otomatik (bu ortamda çalıştırıldı)
- `frontend/src/lib/syncPolicy.test.js` (`cd frontend && npx craco test --watchAll=false syncPolicy`) — yavaş telefonda
  misafirin atla → yüklen → geride kal → yine atla döngüsü (1.8.0 öncesi kural) ve yeni kuralın birkaç atlamada oturması.
- `tests/upload_smoke.py <API> tests/sample.mp4` — multipart yükleme, Range 206, bayt eşleşmesi, yetkisiz silme/yükleme 403, kota 413, format 415.
- Backend smoke (oda/rejoin/host-only/stale seq/WS hello-pong-push/kötü token/oda kalıcılığı) — sonuçlar `test_reports/`.

## 1.8.6 (26 Kasım 2026): bu ortamda çalıştırılanlar
- Sunucu: `cd backend && pytest -q tests/test_resolver_sources.py tests/test_services.py` → 111 geçti (ağ kapalı). Yeni:
  site listesinde Reddit `app_only` + `beta`. Instagram eklenmedi: oynatıcısı dışarıdan kontrol edilemiyor, dosyaları yalnızca
  instagram.com'da açılıyor; senkron olmadan kaynak eklenmiyor (bağlantı `no_sync_source` alır).
- Web (Playwright, Chromium, ağ taklit): dikey videolar 39 kontrol (reel 3:4 resimde kesilmeden ve ortada, /watch arkasındaki
  dikey video Facebook'un çerçevesinden anlaşılır, masaüstünde 16:9 kalır, kendi oynatıcımızda dosyanın şekli, sonraki video
  öncekinin şeklini almaz, yatay telefon, TikTok/Shorts/normal YouTube); hata kutusunda oynatıcının kendi sözü; web listesinde
  Reddit yok, "Reddit: yalnızca mobil uygulamada (beta)" notu var. Eski testler (kick, kontroller, 1.8.4, 1.8.5 51/51, Drive) geçti.
- Uygulama: dedektör (TikTok Paylaş → Bağlantıyı kopyala: clipboard API, gizli metin + execCommand, seçim, clipboardData,
  paylaşım sayfası; sarmalayıcının özniteliğindeki video kimliği), yardımcılar (kopyalanan bağlantı, TikTok kısa bağlantıları,
  Shorts adresi, Instagram'ın teklif edilmemesi, yardımcı alan adları), App.tsx paketlenir, `tsc` temiz, 47/47 birim testi.
- Gerçek telefonda denenmedi (bkz. BEKLEYENLER).

## 1.8.5 (26 Kasım 2026): bu ortamda çalıştırılanlar
- Sunucu: `cd backend && pytest -q tests/test_resolver_sources.py tests/test_services.py` (ağ kapalı; Facebook'un yanıtları
  taklit). Yeni: Facebook paylaşım bağlantıları (fb.watch, /share/v|r|p/) yönlendirmeden, giriş sayfasının `next=`
  değerinden, sayfanın og:url / canonical adresinden videonun adresine çevrilir; Facebook bir şey söylemezse `fb_short`,
  başka bir siteye yönlendirirse ya da 5 adımda bitmezse hiçbir şey. `test_nexora_api.py`'ye: sıraya eklenen bağlantının
  `item_id`'si, aynı yüklemenin iki kez aynı anda tamamlanması (GitHub Actions'ta canlı sunucuyla çalışır).
- Web (Chrome, Playwright, taklit sunucu): oynat ya da sıraya ekle kuralı (oda boşsa ilki oynar, sonrakiler sıraya,
  "Şimdi oynat"), uygulamayla protokol v2 (seçim numarası, sıra, yeniden yüklenince ikinci kez eklenmemesi, sonuç
  mesajları, eski uygulama), webde "Sitelerde gez"in art arda iki bağlantı alması, Reddit'i tarayıcının okuması (Node'da
  taklit fetch ile: gönderi, paylaşım bağlantısı, crosspost, CORS reddi), ana sayfanın `?shared=1` notu: 51 + 8 kontrol.
  Oda sahibi başka uygulamadayken: telefonun durdurduğu video odaya yayınlanmaz, dönünce oynatıcı odanın olduğu yere
  gelir, otomatik oynatma reddedilirse oda sahibinin kendi dokunuşu yine yayınlanır: 10 kontrol. Eski web, oynatıcı
  düğmeleri, Kick ve eşitleme testleri yeniden geçti.
- Yükleme (Node, taklit sunucu ve XHR): 60 parçalı dosyada eski kod hata verip ilerleme çubuğunu oynatmaya devam ediyor
  ve hiç bitmiyor (sorun yeniden üretildi), yeni kod bitiriyor; duran bir parça yeniden gönderiliyor; tamamlama isteği
  bağlantı yüzünden iki kez kaybolursa üçüncüde bitiyor; sunucu bir parçayı kesin reddederse öbür parçalar da duruyor ve
  ekran bir daha "yükleniyor"a dönmüyor; iptal "iptal" olarak bitiyor.
- Uygulama: `npm test` (47 test: seçimlerin bekletilmesi ve sonuçları, paylaşılan metinden bağlantı, Facebook paylaşım
  bağlantısı, tarayıcı kimliği, MainActivity.kt değişikliği), algılayıcı ve tarayıcı yardımcıları (Chromium'da taklit
  sayfalar), App.tsx'in esbuild ile paketlenmesi. `tsc --noEmit` burada React Native tipleri olmadığı için ancak React
  Native taklit edilerek çalıştı (uygulamanın kendi kodu temiz); gerçek tip denetimi GitHub Actions'ta.
- Burada yapılamayanlar: Kotlin ve `expo prebuild` (Android SDK yok; yalnızca GitHub Actions'taki derleme derler),
  gerçek telefon, canlı TikTok / Facebook / Reddit. Bkz. `docs/BEKLEYENLER.md` (1.8.5).

## 1.8.4 (26 Kasım 2026): bu ortamda çalıştırılanlar
- Sunucu: `cd backend && pytest -q tests/test_resolver_sources.py tests/test_services.py` (ağ kapalı; X, TikTok,
  Kick, Reddit yanıtları taklit). Yeni: X dosyası Referer ile 403 / Referer'sız 200 → `referrer_policy`; ikisi de
  403 → `source_locked`; TikTok oEmbed 400 → `tiktok_unavailable`; fotoğraf gönderisi → `tiktok_photo`.
  `test_nexora_api.py`, `test_client_errors.py`, `test_devices.py` canlı sunucu + MongoDB ister: GitHub Actions'ta çalışır.
- Web (Chrome 153, Playwright, taklit sunucular): Referer'ı reddeden video sunucusu (çerçeveyle oynar, ikinci deneme,
  tek hata, altyazı çerçevede), Twitch dik ekran (360×203 alanda Twitch'in sayfası ≥400×300), web "Sitelerde gez"
  (kopyalanan bağlantı dönünce kendiliğinden gelir, izin yoksa düğme gösterilir), hata yalnızca bir kez (kutunun
  altında; kutu ekranda değilse bildirim). Eski eşitleme, bağlantı ve oda testleri de yeniden geçti.
- Oynatıcı düğmeleri, hem normal hem X'in Referer'sız çerçevesinde (Chrome 153, dokunmatik): oynat / durdur, +10 / −10 sn,
  ilerleme çubuğuna dokunma, ses, sessiz, hız 1.5×, altyazı (odanın dosyası listede ve açılıyor), sağ tarafa çift
  dokunma +10 sn. HLS: ağ kesilince yükleme 3 kez yeniden başlar (1, 2, 3 sn arayla), dördüncüde hata.
- Kick: kanal sunucumuza verilmezse ya da yayın başka sitelere kapalıysa canlı kanal Kick'in resmî oynatıcısında açılır
  ve oda onu yine yönetir (sunucu testi + odada test: oda sahibi "Yayını herkese başlat" ile açar, alttaki düğmeyle
  durdurur ve yeniden başlatır, oda her seferinde oynat / durdur'u duyar; misafir düğme görmez, odanın oynat / durdur'una
  uyar; oynatıcının üstüne bir şey çizilmez).
- Uygulama: `tsc --noEmit` (strict), `npm test` (31 test), tarayıcı yardımcıları ve enjekte edilen algılayıcı
  (Chromium'da taklit TikTok / X / Kick / Reddit / YouTube sayfaları).
- Gerçek telefonda ve canlı sitelerde denenmedi: bkz. `docs/BEKLEYENLER.md` (1.8.4).

## İki fiziksel telefon prosedürü (YAPILMADI — kullanıcı yapmalı)
1. Telefon A: oda kur, MP4 bağlantısı ayarla. Telefon B: davet bağlantısıyla katıl.
2. Sync panelini (Activity simgesi) iki cihazda aç.
3. Play → 30 sn bekle → Pause → ileri sar 60 sn → geri sar → video değiştir.
4. B'nin Wi-Fi'ını 20 sn kapat/aç; uygulamayı arka plana alıp 30 sn sonra dön.
5. B ağ hızını düşür (geliştirici ayarı / hücresel).
6. "Ölçüm raporu" → `avg/max/>2s/latency` değerlerini kaydet; ham veri `GET /api/rooms/{code}/metrics/summary`.

Kabul: oda ve playback state'i her adımdan sonra korunmalı; >2 sn olaylar raporlanmalı.

## Platform build'leri
- Android: `cd apps/android && ./gradlew assembleDebug testDebugUnitTest -PnexoraApi=https://...` (bu ortamda **çalıştırılamadı**).
- iOS: `cd apps/ios && xcodegen && xcodebuild -scheme NexoraWatch -destination 'platform=iOS Simulator,name=iPhone 15' test` (**çalıştırılamadı**).

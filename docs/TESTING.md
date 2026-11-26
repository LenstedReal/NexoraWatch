# TESTING

## Otomatik (bu ortamda çalıştırıldı)
- `frontend/src/lib/syncPolicy.test.js` (`cd frontend && npx craco test --watchAll=false syncPolicy`) — yavaş telefonda
  misafirin atla → yüklen → geride kal → yine atla döngüsü (1.8.0 öncesi kural) ve yeni kuralın birkaç atlamada oturması.
- `tests/upload_smoke.py <API> tests/sample.mp4` — multipart yükleme, Range 206, bayt eşleşmesi, yetkisiz silme/yükleme 403, kota 413, format 415.
- Backend smoke (oda/rejoin/host-only/stale seq/WS hello-pong-push/kötü token/oda kalıcılığı) — sonuçlar `test_reports/`.

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

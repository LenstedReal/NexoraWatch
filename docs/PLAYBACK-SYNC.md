# PLAYBACK-SYNC

## Protokol (WS `/api/ws?code=&participant_id=&token=`)
İstemci → sunucu
- `{"type":"ping","client_time":ms}` her 10 sn (açılışta 3 kez)
- `{"type":"playback","playing":bool,"position":s,"seq":int,"media_id":str,"sent_at":serverMs}` (yalnız host)
- `{"type":"message","text":str,"client_id":uuid}` · `{"type":"reaction","emoji":str}` · `{"type":"buffering","buffering":bool}`

Sunucu → istemci
- `hello {room, participant_id, server_time}` · `room {room}` · `playback {playback, server_time, cmd_sent_at, seq, stale?}`
- `message` · `presence` · `peer_state` · `reaction` · `pong {client_time, server_time}` · `error {code, detail}` · `room_closed`
- Kapanış kodları: 4000 başka soketle değiştirildi, 4403 yetkisiz, 4404 oda yok, 4410 oda kapandı/süresi doldu.

`playback` nesnesi (geriye uyumlu): `{playing, position, updated_at(serverMs), revision, media_id, updated_by}`.

## Kurallar
- Sunucu `seq` değeri `last_seq`'ten büyük ve `media_id` güncel değilse komutu uygulamaz (`stale:true`).
- İstemci yalnızca `revision` büyükse state'i kabul eder.
- Beklenen konum = `position + (now + offset − updated_at)/1000` (playing ise). `offset` = en düşük RTT'li pong örneğinden.
- Misafir (`frontend/src/lib/syncPolicy.js`, 1.8.0): buffering sırasında düzeltme yok; buffering bitince ve her
  atlamadan sonra 1,2 sn oturma süresi. |sapma| > 2 sn → atlama. İleri atlamalar bu telefonun önceki atlamalarının
  gerçek maliyeti kadar ileri hedeflenir (öğrenilir, 0,15–4 sn). 45 sn içinde 3 atlama olursa tolerans 2 → 4 → 8 sn,
  bekleme 3 → 8 → 15 sn olur; sakin geçen her dakika bir basamak geri iner. Ev sahibinin kendi atlaması (seek)
  hemen izlenir ve bu sayıma girmez. Tolerans içinde kendi oynatıcımız hızla yetişir (0,25 sn üstünde başlar,
  0,08 sn altına inince durur; ±%5 / %8 / %10). YouTube: yalnız atlama.
  Eski kural (her 2 sn sapmada +0,15 sn ile atla) yavaş hatta atla → yüklen → geride kal → yine atla döngüsüne
  girip görüntüyü sürekli donduruyordu.
- Canlı HLS (sonu olmayan yayın): her cihaz kendi canlı ucunda kalır, konum değil yalnızca oynat/durdur izlenir;
  hls.js geride kalanı en çok %5 hızlandırıp aynı gecikmeye getirir. Başka cihazın konumuna atlamak canlı yayında
  anlamsızdı ve misafiri sürekli dondururdu.
- hls.js medya hatası: önce kurtar, sonra ses kodeğini değiştirip kurtar, üçüncüde "çözümlenemedi" hatası
  (sınırsız kurtarma görüntüyü tekrar tekrar donduruyordu).
- Host: buffering asla `playing=false` yazmaz; 1 sn yerel kontrol, uyumsuzluk > 0,75 sn veya 20 sn keepalive'da yayın.
- Autoplay engellenirse "Senkrona katılmak için dokun" düğmesi.

## Ölçüm
`POST /api/rooms/{code}/metrics` örnekleri; `GET /api/rooms/{code}/metrics/summary` → katılımcı başına `avg_drift_s`, `max_drift_s`, `over_2s`, `avg_rtt_ms`, `avg_command_latency_ms`, `corrections`, `reconnects`, `player_errors`, `buffering_ms`.
İki fiziksel telefonla test **henüz yapılmadı**; prosedür `TESTING.md`.

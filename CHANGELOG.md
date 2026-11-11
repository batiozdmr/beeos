# Changelog

Bu dosya [Keep a Changelog](https://keepachangelog.com/) biçimini takip eder ve [SemVer](https://semver.org/) kurallarına uyar.
Giriş yazımı: `feat:`, `fix:`, `security:`, `perf:`, `docs:`, `chore:`.

## [0.13.0] — 2026-11-11

### Yeni
- **Çoklu profil** — `Store.list/use/create/remove`. Favoriler, gizli kartlar, sıra, kullanım ve
  son açılanlar profil başına ayrı tutulur. Ayarlar > **Aktif profil / Profil ekle / Profili sil**.
  Default profil her zaman mevcut; silinemez. Örnek: `cocuk` profiliyle farklı favoriler + farklı
  ebeveyn PIN davranışı.
- **Fare olayları batch** — Telefondan gelen cursor olayları 120 ms'de bir toplu yollanır
  (`events: [...]`). ~60 Hz → ~8 Hz istek; pil ve TLS handshake maliyeti belirgin azaldı. Backend
  tek istekte en çok 60 olay işler, sıra korunur (önce hareket, sonra tıklama).

### Düzeltme
- **Hata mesajı sözlüğü (backend)** — Generic "İşlem yapılamadı" yerine endpoint bağlamına göre
  anlaşılır mesaj + hata kodu (`launch_failed`, `wifi_failed`, `bt_failed`, `mirror_failed`,
  `cursor_failed`, `update_failed`, vb.). `_friendly_error()` tek kaynak.

## [0.12.0] — 2026-11-11

### Yeni
- **Ebeveyn kilidi** — Ayarlar > "Ebeveyn PIN'i" ile 4 haneli PIN tanımla; kart menüsünden
  "PIN ile aç" / "PIN istenmesin". Doğru PIN'den sonra 5 dk içinde tekrar sorulmaz.
- **HDMI sink ses düzeyi kalıcılığı** — Her sink'in (dahili hoparlör / TV / kulaklık) son düzey +
  mute durumu `/var/lib/beeos/sink-levels.json`'da saklı. Cihaz geri geldiğinde eski düzey otomatik
  geri yüklenir.
- **`beeos-nvidia` komutu** — Nvidia proprietary driver için interaktif kurulum/durum/kaldırma
  (`beeos-nvidia install`); non-free apt kaynağı ekler, nouveau blacklist, initramfs yeniler.
- **Ekrana geçiş bildirimi** — Sway oturum restart gerektiğinde ("TV farklı ekran kartına bağlı")
  önceden bildirim merkezinde "Ekrana geçiliyor…" notu.

### Belge
- **docs/pc-first-run.md** — İmaj indir → USB'ye yaz → boot → kurulum sihirbazı adım adım.

### Yapı
- **ESLint (ES5 webOS uyumluluğu)** — `.eslintrc.json` + CI'de `npx eslint@8` adımı. 17 dosya,
  0 hata. `tests/` için 2022 override.

### Test
- 6 yeni frontend testi (`availableHere` / `moveItem` kenar senaryoları) → 42 Node testi.
- 11 yeni backend testi (`swap_dir` atomik, `verify_signature` hata yolları, `_allow_lan`) → 51 Python.

## [0.11.0] — 2026-11-10

### Yeni
- **İlk açılış sihirbazı (Onboarding)** — Yeni cihazda `Store.onboarded` false iken açılış animasyonundan
  sonra tam ekran karşılama akışı başlar. Adımlar: Hoş geldin → Adın → (PC'de) Ağ durumu → Telefon
  kumandası QR + fingerprint pinning → Favori seç (6 popüler karttan) → Tuş özeti → Başla.
  Her adım atlanabilir; Dpad (TV) ve klavye (PC) ile tam gezilebilir. Ayarlar > **Karşılama
  sihirbazını tekrar göster** ile her zaman tekrar açılır. `js/onboarding.js` (~370 satır).

## [0.10.0] — 2026-11-10

### Yeni
- **UxPlay / AirPlay 2 alıcısı** — iPhone/iPad/Mac "Ekran Yansıt" ile beeOS'a doğrudan yayın.
  `beeos-airplay.service` + `/etc/beeos/airplay.env` + avahi-daemon (Bonjour). Uygulamalar rafına
  **AirPlay** kartı (talimat gösterir). Belge: [docs/airplay.md](docs/airplay.md).
- **Bildirim merkezi** — Backend `notify()`: güncelleme çıktığında, kumanda eşleştiğinde, ekran
  yansıtma isteği geldiğinde kalıcı not bırakır. `/api/notifications` + `/clear` + `/seen`.
  Telefon kumandasında "Bildirim merkezi" satırı (son 50 olay, okunmamış sayacı).
- **Haftalık imaj derlemesi (CI)** — `.github/workflows/image.yml` pazartesi 03:00 UTC'de `os/build.sh`
  çalıştırır; artifact olarak SHA256 + boyut. `workflow_dispatch` ile manuel tetik; smoke QEMU boot
  (warn-only). Başarısızlıkta otomatik GitHub issue.
- **others_off ayarı** — `display_mode.othersOff`: beeOS ekrana geçince diğerlerini kapat (default)
  ya da aç bırak (geliştirici modu). `/api/display/mode` ile değiştirilir (UI'de henüz sadece
  endpoint).

### Güvenlik
- **IP başına başarısızlık sayacı** — Global PIN lockout'una ek: aynı IP 5 hatalı denemeden sonra
  2 dk → 10 denemede 15 dk → 20'de 2 saat kilitli. Dağıtılmış brute-force engellenir.

### Test
- 9 yeni backend testi: IP ban (3), bildirim merkezi (4), yedekleme (2). Toplam: 45 backend testi.

### Hâlâ bekleyen (0.11'e)
`app.js` parçalama, profil/çoklu kullanıcı, ebeveyn kilidi, WebSocket cursor, hata sözlüğü, PIN
uzunluğu (geriye uyum sorunu).

## [0.9.0] — 2026-11-10

0.8.0 denetiminde (bkz. `docs/audits/0.8.0.md`) çıkan 10 yeni bulgu ve kalan iş listesinin büyük bölümü.

### Güvenlik
- **Mirror answerer token** (yeni Y1): `mirror_signal` artık her iki rol için (offerer + answerer) ayrı
  token ister. Lokal same-origin herhangi bir sayfa yabancı answer SDP enjekte edemez. Answerer token
  URL ile iletiliyor (`mirror.html?tok=...`).
- **ETag anahtarı düzeltildi** (yeni Y2): `(size, mtime=0)` → `(VERSION, size, crc32(ilk16KB))`.
  Pakette mtime hep 0 olduğu için aynı boyutlu değişmiş dosyalar Chrome tarafından 304 ile eski
  içerikle servis edilebiliyordu; artık sürüm anahtarda.
- **Fingerprint pinning**: TV'deki QR kodu `#fp=<sha256>` içeriyor; telefon ilk pair'de fp'yi saklar,
  sonraki açılışlarda `/api/state`'ten dönen fp ile karşılaştırır. Değişirse "güvenlik uyarısı" +
  kullanıcı onayı (MITM işareti olabilir).
- **İkinci cihaz arayışı** (O5): `mirror_start` `state in (pending|waiting|live)` iken reddediyor.
  "Başka bir cihaz onay bekliyor" hatası; yanlışlıkla ikinci offer eskiyi silmez.
- `_allow_lan` tek kaynak (`/etc/beeos/remote.json`); yanlış yerde (update.json) ayarlanmışsa uyarı
  loglar ve geriye dönük okur.

### Yeni
- **Uyku zamanlayıcı UI** telefon kumandasında (15 / 30 / 60 / 120 dk, "uygulamaları kapat" seçeneği).
- **Saati elle ayarla UI** (datetime-local picker).
- **Ayarları dışa aktar**: `/api/backup` JSON döner; UI dosya olarak indirir.
- **QR fingerprint pinning** (yukarıda) — pair ekranına ekstra güvenlik katmanı.

### Sağlamlık + Düzeltme
- `mirror_approve`'da `open_app` başarısızsa `mirror_reset` hata metniyle çağrılıyor; telefon
  `pollAnswer` ile idle durumuna geçtiğini öğrenir (`/api/mirror/status` yeni endpoint).
- **Açılış temizliği**: yarım `.beeos-new` / `.beeos-rollback` dosyaları silinir.
- **Overlay rollback manifest**: yeni sürümde eklenen dosyalar rollback'te temizlenir (yetim systemd
  unit kalmaz).
- **Bitrate `setParameters` erken uygulama**: `addTrack` sonrası hemen (ICE connected beklenmeden)
  uygulanıyor; ilk 1-2 sn tam bitrate'de kalma sorunu çözüldü (D1).

### Performans
- `photo_list` 60s TTL cache (ekran koruyucu her açılışta `listdir` yapmıyor artık).

### Dokümantasyon + Yapı
- Audit raporları `docs/audits/` altına taşındı.
- 8 yeni test (mirror answerer token zorunluluğu, concurrent reddi, backup export/import).

### Hâlâ bekleyen (0.10'a kalan)
app.js parçalama, UxPlay/AirPlay alıcısı, profil/ebeveyn kilidi, bildirim merkezi, WebSocket cursor,
CI haftalık imaj, PIN uzunluğu + IP ban.

## [0.8.0] — 2026-11-10

### Yeni
- **Ekran yansıtmada onay akışı**: telefon offer gönderince TV'de "`<telefon>` ekranını paylaşmak
  istiyor" bildirimi çıkar; kullanıcı **İzin ver** / **Reddet** seçer. Alıcı sayfa (mirror.html) ancak
  onay sonrası açılır.
- **Mirror oturum token'ı**: `mirror_start` tek-kullanımlık token döndürür; sonraki sinyal çağrıları
  `X-BeeOS-Mirror` başlığıyla imzalanır. Bildirim beklerken 60 sn zaman aşımı.
- **WebRTC otomatik reconnect**: ICE koparsa `restartIce()` + yeni offer ile 2 denemeye kadar otomatik
  yeniden bağlanma (hem telefon hem mirror.html tarafında).
- **Mirror kalite seçimi** (Düşük 540p / Orta 720p / Yüksek 1080p) ve bitrate ayarı
  (`RTCRtpSender.setParameters`); *Yansıtmada ses* anahtarı (telefon ekran sesini de gönderir).
- **Fare hassasiyeti** ayarı (Yavaş / Düşük / Orta / Hızlı / Çok hızlı); kumanda sayfasında chip seçimi.
- **Uyku zamanlayıcı** (`/api/sleep`): 1–600 dk; süre sonunda bilgisayarı kapat veya uygulamaları kapat.
- **Saat elle ayarlama** (`/api/time`): NTP çalışmayan ağlar için `timedatectl set-time`.
- **HTTPS sertifikası IP SAN içeriyor**: tüm aktif IPv4 adresleri SAN'a yazılır; IP değişince
  sertifika otomatik yeniden üretilir. `remote_cert_fingerprint()` SHA-256 base64url döndürür
  (gelecekteki QR pinning için).
- **ETag tabanlı cache validation**: statik dosyalarda `If-None-Match` → 304, bandwidth tasarrufu.
- **Mirror timeout + reaper thread**: pending 60 sn, waiting 60 sn, live-after-idle 30 sn — sızan
  oturumlar otomatik temizlenir.
- **Uinput hata sınıflandırması**: ilk hatada `modprobe uinput` dener, hatanın nedenini (modül yok /
  yetki yok) telefona döner.

### Güvenlik
- **`/api/cursor` ve `/api/mirror/start` oturum zorunlu** — PIN tek başına artık yetmez. Böylece PIN
  tahmini tek başına tam ekran kontrolü veremez.
- **Minisign imzası zorunlu** (anahtar varsa): `/etc/beeos/update.pub` varsa imzasız paket reddedilir
  (önceki sürümlerde uyarıyla atlanıyordu).
- **SSRF daraltması**: `tv_url_ok` artık özel IP aralıklarını (10/8, 172.16/12, 192.168/16) reddeder.
  Ev LAN'ındaki Tvheadend gibi servisler için opt-in: `/etc/beeos/remote.json` → `{"allowLan": true}`.
- **Unicode kontrol / BiDi override filtresi**: `remote_text` artık `Cc / Cf / Co / Cs` kategorisindeki
  karakterleri atar (U+202E vb. ile yazı manipülasyonu engelli).
- **`STATE_DIR` kalıcı olarak `0700`**: `/var/lib/beeos` modu her start'ta garanti edilir.
- **Mirror signal endpoint'i** aktif oturum yoksa 403 döner (role=offerer için token şart).

### Düzeltme
- **Overlay dosyaları artık iki aşamalı yazılıyor**: tüm `.beeos-new` tmp dosyaları hazırlanır, ancak
  hepsi hazırsa toplu rename yapılır; yarım güncelleme (systemd unit'lerinin yarısı yeni) riski kalktı.
  `overlay.prev` snapshot rollback için tutulur.
- **`open_app` artık `mirror_lock` dışında**: DevTools 5 sn bekletmesi paralel sinyal akışını
  dondurmuyor.
- **`display_watch` sway soket kayıplarına karşı dayanıklı**: 3 ardışık başarısızlıkta soket
  yeniden açılır.
- **`remote_save` artık `fsync`'li**: crash'te geçici dosya kaybolmaz; `last` güncellemeleri 30 sn'de
  bir throttled yazım.
- **Sertifika SAN eşleşmezse** her boot'ta yeniden üretilir (IP değişti ise).
- **Mirror.html** offer 90 sn gelmezse hata gösterip çıkar; ICE "disconnected" durumunda 2 sn
  bekleyip restartIce tetikler.
- **Çağrı sırasında ICE buffer**: telefon tarafında token gelmeden gönderilen aday mesajları
  buffer'da bekler, token ulaşınca flush olur.

### Dokümantasyon
- `README.md`: Fare modu, Ekran yansıtma, HTTPS notu, Kumanda güvenliği, Oyun, Uyku zamanlayıcı
  bölümleri eklendi.
- `docs/troubleshooting.md` (yeni): kumanda HTTPS uyarısı, fare modu arızası, ekran yansıtma
  başlamıyor, sertifika kabul, Chrome önbellek, güncelleme indirilmiyor.
- `docs/api.md` (yeni): tüm `/api/*` endpoint tablosu (method, path, auth, body, cevap).

## [0.7.4] — 2026-11-09

- `beeOS 0.7.4` noktasal güncelleme (bkz. `git log v0.7.0..v0.7.4`).

## [0.7.3] — 2026-11-09

- `beeOS 0.7.3` noktasal güncelleme.

## [0.7.2] — 2026-11-09

- `beeOS 0.7.2` noktasal güncelleme.

## [0.7.1] — 2026-11-09

- `beeOS 0.7.1` noktasal güncelleme.

## [0.7.0] — 2026-11-09

### Yeni
- **Fare modu** (ilk sürüm): telefondaki dokunmatik yüzey `/dev/uinput` üzerinden sanal fare oluşturur.
  Tek dokunuş sol tık, iki parmak sağ tık, iki parmak kaydırma tekerlek, uzun basma sürükleme.
- **Ekran yansıtma** (ilk sürüm): telefon ekranını WebRTC ile TV'ye aktar. Basit HTTP polling sinyali,
  in-memory kutu. (Not: 0.8.0'da TV onay akışı eklendi.)
- **HTTPS uzak kumanda**: `openssl req -x509` ile kendinden imzalı sertifika; `getDisplayMedia` için
  gereken secure context sağlanır.
- **GeForce Now** kartı (`js/config.js` içinde, yalnız PC).
- `mirror.html` (proje kökünde): WebRTC answerer sayfası, tam ekran.

## [0.6.0] — 2026-11-07

### Yeni
- **Favoriler** ve **Son açılanlar** rafları (yapay raflar, `app.js` computeModel'de hesaplanır).
- **EPG (yayın akışı)**: `js/epg.js` ile XMLTV parse; kanal listesinde "şimdi" programı, OSD'de
  "şimdi / sırada" + ilerleme çubuğu. `tvg-id` üstünden eşleşme; yerleşik kanalların kimlikleri
  `js/channels.js` içinde.
- `tests/run.js` (ilk birim testleri): Store + TV.parseM3U + EPG yardımcı fonksiyonları (17 test).
- CI'ye `node tests/run.js` adımı eklendi.
- Ayarlar panelinde Favoriler/Son açılanlar/EPG anahtarları, XMLTV adres alanı.

## [0.5.3] — 2026-10

### Düzeltme
- PC sürümünde: arka uç `If-Modified-Since` başlığını atar; güncelleme sonrası Chrome önbelleği eski
  arayüzü tutmuyor. (Commit `7d53d3d`, 0.8.0'da ETag ile yer değiştirdi.)

## [0.5.2] — 2026-10

- Canlı TV: yerleşik kanallar ve M3U liste desteği (`js/channels.js`, `js/tv.js`); `/api/tv/proxy`
  CORS vermeyen yayınlar için.

## [0.5.1] — 2026-10

- Telefon kumandası (ilk sürüm), Bluetooth, açılış splash'i, daha hızlı boot.
- Uygulama yükleme ekranı backend sekmeyi açarken görünmeye devam eder.

## [0.5.0] — 2026-10

- GitHub Releases üzerinden uygulama içi güncelleme, VirtualBox VM betiği, ses OSD, HDMI çıkış
  yönetimi.

## Önceki sürümler

- `0.4.x` ve öncesi için `git log --oneline` ya da commit mesajları.

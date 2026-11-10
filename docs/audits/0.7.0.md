# beeOS — Eksik ve Zayıflık Denetimi

Sürüm bağlamı: deponun şu anki ucu **0.7.4** (yeni etiket `v0.7.4`); özet notta geçen `v0.7.0` sonrasında 0.7.1–0.7.4 noktasal etiketleri de atılmış durumda. Denetim, "Fare modu + ekran yansıtma + HTTPS uzak kumanda + GeForce Now" sonrası tüm kod tabanını kapsar.

Her bulgu için öncelik: **Y** (yüksek · güvenlik / veri kaybı / çok sayıda kullanıcı etkisi), **O** (orta · belirgin UX ya da sağlamlık boşluğu), **D** (düşük · hoş olan iyileştirme). Rakam parantez içinde yer alırsa dosya:satır referansıdır.

---

## 1. Güvenlik

| # | Önc. | Bulgu | Yapılacak |
|---|------|-------|-----------|
| 1.1 | **Y** | Kumanda HTTPS kendinden imzalı; telefon her açılışta "güvenli değil" uyarısı verir ve HSTS pinning yok. Ağda MITM yapabilen biri sertifikayı değiştirirse kullanıcı fark etmez (`lan_urls`, `beeos_server.py:1076`). | İlk eşleşmede telefona cert fingerprint'i QR kodun içinde yolla (`js/qr.js`); sonraki açılışlarda `remote.html` saklı fingerprint'i doğrulasın. Uyumsuzsa eşleşmeyi reddet. |
| 1.2 | **Y** | `RemoteHandler` tüm LAN arayüzlerinde (`0.0.0.0:8081`) dinler ama hangi ağdayız ayrımı yok. Kafe Wi-Fi'sinde cihaz açıkken kumanda sayfası herkese görünür; PIN denemesi başlasa da PIN 6 hane (20 bit) → 10 denemede 5 dk kilit, 24 saatte yüzlerce girişim mümkün (`do_POST`, `beeos_server.py:1796`). | PIN'i 8 haneye çıkar ya da passphrase'e döndür; başarısız denemeyi IP başına izle, kalıcı IP block-list tut; opsiyonel "sadece ev ağı" (NM connection UUID whitelist). |
| 1.3 | **Y** | `/dev/uinput` üzerinden sanal fare = kernel'e sahte input event enjeksiyonu. Backend `root` çalışıyor, sadece PIN auth var; başarılı bir PIN tahmini → tam ekran kontrolü (`UInputMouse`, `beeos_server.py:1227`). | `/api/cursor` oturum (`session_check`) olmadan reddedilsin; tekil `X-BeeOS-PIN`'le kabul kaldırılsın. Ayrıca hız/konum sınırı: belirli süre içinde X olaydan fazlası throttle. |
| 1.4 | **Y** | `/api/mirror/start` TV'de otomatik olarak `mirror.html` sekmesi açıyor (`open_app`, satır 1340). Oturumsuz PIN'le tetiklenebiliyor; dizüstüne oturmuş biri bilmeden telefondan açılan yabancı bir yayına maruz kalabilir. | Mirror başlamadan önce beeOS üstünde "X cihazından yansıtma, kabul et/reddet" onay bildirimi göster; onaylanana kadar `mirror.html` fullscreen değil, köşede önizleme. |
| 1.5 | **O** | `mirror_signal` sadece in-memory kutu; `role`'a göre iki tarafın SDP/ICE'ını herhangi bir kimlik denetimi olmadan okutuyor (`Handler.route`, satır 1763 → oturumsuz 127.0.0.1'den). Lokal tarayıcıda açılan rastgele sayfa `X-BeeOS: 1` başlığı atamaz ama yerel kötü niyetli uzantı atabilir. | `/api/mirror/signal` dahil tüm mirror endpoint'leri `X-BeeOS` + aynı-origin kontrolü yanında kısa ömürlü token (mirror_start sırasında üretilen) gerektirsin. |
| 1.6 | **O** | `verify_signature` minisign anahtarı yoksa sessizce atlar (`beeos_server.py:586`); yorumda "bir sonraki major'da zorunlu" diyor ama 0.7.x hâlâ opsiyonel. GitHub token ele geçirilirse paket sahtelenebilir, SHA-256 .sha256 asset'ten okunduğu için eşlenen asset de sahte olur. | Imza key'ini `os/overlay/etc/beeos/update.pub`'a kopyala (zaten örnek var) ve `verify_signature`'da anahtar varsa imza olmayınca kurulumu **reddet**. |
| 1.7 | **O** | `tv_url_ok` loopback/link-local'ı dışlıyor ama **private range** (10/8, 172.16/12, 192.168/16) açık (`beeos_server.py:819`). Kullanıcının LAN'ındaki router admin paneli, NAS, IPTV servisinin yönetim arayüzü bu proxy üzerinden çağrılabilir. | `is_private` da reddet; sadece kasıtlı IPTV sunucuları için ayarlardan "LAN kaynaklarına izin ver" seçeneği. |
| 1.8 | **O** | `wtype` ile gelen metin `--` ile ayrıldığı için argv enjeksiyonu güvenli, ama `isprintable()` filtresi Unicode kontrol karakterlerini bırakır (örn. U+202E RTL override). Geri atağı: kumandadan gönderilen yazı Chrome adres çubuğuna girince beklenmedik davranış (`remote_text`, `beeos_server.py:1361`). | Yalnızca `str.isprintable()` yerine `unicodedata.category` ile `Cc/Cf/Co/Cs` kategorilerini at. |
| 1.9 | **O** | `REMOTE_KEY` `/var/lib/beeos/remote-key.pem` 0600 olarak yazılıyor ama `STATE_DIR`'in modu belirtilmemiş; sistem default'una bağlı. | `os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)` ve chmod 700 garantile. |
| 1.10 | **D** | Chrome policy `RemoteDebuggingAllowed: true` (overlay/.../beeos.json). Localhost'ta DevTools 9222 bizim için ama bir Flatpak'li tarayıcı da bu porttan konuşabilir. | 9222 dinlemesini `--remote-debugging-address=127.0.0.1` ile sabitle; (Chrome'u başlatan `beeos-browser` kontrol et). |
| 1.11 | **D** | Nonce havuzu bellekte 5 dk tutuluyor; servis restart olunca sıfırlanır → replay penceresi kısa sürede açılabilir. | Nonce'ları atomik dosyaya bufferlayıp startup'ta son N tanesini yükle. |

---

## 2. Kararlılık ve hata yönetimi

| # | Önc. | Bulgu | Yapılacak |
|---|------|-------|-----------|
| 2.1 | **Y** | `UInputMouse._open` başarısız olursa (örn. `input` grubu kaybı, `/dev/uinput` modülü yüklü değil) hata sadece log'a düşer, UI'de sadece "Fare açılamadı (uinput)" toast'u görünür — kullanıcı neden olduğunu bilmez (`beeos_server.py:1245`). | Hata nedenini (`ENOENT`, `EACCES`) sınıflandırıp telefonda "uinput modülünü yükleyin: `sudo modprobe uinput`" gibi aktif mesaj göster; ilk başarısızlıkta `modprobe uinput` dene. |
| 2.2 | **Y** | Mirror için timeout yok. `mirror_start` sonrası telefon kayıpsa `mirror.html` TV'de sonsuza kadar "Telefon bekleniyor" ekranı kalır (`mirror_signal`, `beeos_server.py:1361`). | Backend'de 60 sn offer bekleme; süresi dolarsa `mirror_reset()` + `go_home()`. `mirror.html` 30 sn offer gelmezse hata gösterip çıksın. |
| 2.3 | **Y** | WebRTC reconnect yok. `iceConnectionState=failed/disconnected` sadece "Bağlantı koptu" yazıyor, kullanıcı manuel tekrar başlatmak zorunda (`remote.html:988`, `mirror.html:93`). | `failed` olunca offerer tarafı `restartIce()` + yeni offer ile 2 deneme otomatik. |
| 2.4 | **O** | `EPG.fetchUrl` tek denemelik; 30 sn timeout sonrası sessiz başarısız, UI'de EPG yok ama sebep gözükmez (`epg.js:55`). | 3 retry (exponential backoff), son hatayı `status()` ile UI'a sızdır (Ayarlar > TV'de "EPG: bağlanılamadı" göster). |
| 2.5 | **O** | `tv_proxy_cache_lookup` ağ varken de stale veriyi dönebiliyor; `stale_ok` sadece hata yolunda kullanılıyor ama çağrı sırası `tv_proxy` içinde kontrol edilmeli. | Normal akışta önce fresh fetch, hata/timeout'ta `stale_ok=True`. Kod zaten büyük ölçüde doğru, test eksik → test yaz. |
| 2.6 | **O** | `mirror` dict thread-safe ama `open_app` DevTools çağrısı `mirror_lock` tutarken yapılıyor — DevTools 5 sn timeout'u lock'u kilitler, paralel sinyal akışı durur (`beeos_server.py:1338`). | `open_app` çağrısını lock'tan çıkar; sadece SDP alanlarını set ederken lock. |
| 2.7 | **O** | `display_watch` thread sonsuz loop; `swaymsg` çökerse exception yakalanıyor ama tekrarlanmıyor. Uzun-süreli TV takma/çıkarma döngüsünde HDMI durumu güncellenmez (`beeos_server.py:1587`). | Döngü içinde 3 başarısızlıktan sonra sway soketini yenile. |
| 2.8 | **O** | `update_apply` sırasında elektrik kesilirse `web.prev` ve `web` arasında belirsiz durum kalabilir — `swap_dir` atomik rename yapsa da overlay dosyaları tek tek kopyalanıyor (satır 764). | `overlay` için de temp staging + atomik rename stratejisi; ya da journaled flag dosyası (başlangıçta "mid-update" kontrolü, rollback). |
| 2.9 | **O** | `remote_cert` 10 yıllık sertifika üretir; tek bir sertifika için IP SAN yok. Telefon IP değişirse `DNS:beeos,DNS:localhost` ile eşleşmez ama bu zaten uyarı veriyor → sorun değil. Yine de IP SAN yardımcı olurdu. | `-addext subjectAltName=DNS:beeos,DNS:localhost,IP:<ip>` (her boot'ta IP yenile). |
| 2.10 | **D** | `remote_save` `os.replace` kullanıyor ama fsync yok; crash'te tmp kaybolabilir. | Dosyayı flush+fsync et, sonra rename. |
| 2.11 | **D** | `app.js` 2283 satır tek dosya; hata yakalama birimi uygulama geneli. Tek satır JS exception, launcher'ı kullanılamaz bırakabilir. | Bootstrap içinde top-level try/catch + hata UI'si; modülleri (home / tv / settings / saver / loader) ayır (0.6'da ertelenen refactor). |

---

## 3. Kullanıcı deneyimi

| # | Önc. | Bulgu | Yapılacak |
|---|------|-------|-----------|
| 3.1 | **Y** | Fare modu `only:"pc"` olduğu gibi `mirror.html` da sadece PC backend'inde çalışıyor; webOS TV kullanıcısı telefon kumandasındaki 3. segmenti görür ama hiçbir şey olmaz (ya da hata yer). `availableHere` kart filtresi gibi kumanda sekmeleri için de platform filtresi yok (`remote.html` tüm cihazlarda aynı). | `remote_info()`'ya `platform` alanı ekle; telefon sayfası `tv` ise Fare/Yansıt segmentlerini gizlesin. |
| 3.2 | **Y** | İlk eşleşme deneyimi "TV'deki PIN'i yaz" — ama PIN'i görmek için önce TV'de **Telefon** kartına gidip menü açmak gerek. Kumanda açıkken kullanıcıya PIN yeri gösterilmiyor (`remote.html` pair ekranı:`#pair h1`). | Pair ekranında QR kod (TV'deki URL için zaten var) + "beeOS → Telefon kartı → PIN göster" adımlarını numaralı göster. |
| 3.3 | **O** | Mirror başlatma akışı: telefon → `getDisplayMedia` → offer → backend → `open_app` → TV sekmesi → `mirror.html` polling (800ms) → ICE. İlk görüntü için 3-6 saniye gecikme. Kullanıcıya progress yok (`remote.html:1003`). | `castBtn` stage'lerini (Ekran seçildi → TV açılıyor → ICE kuruluyor → Yayında) ilerleme çubuğuyla göster. |
| 3.4 | **O** | Fare modunda `buzz(10)` sadece click'te; sürekli hareket sırasında haptic feedback yok. Hassasiyeti ayarlamak isteyen için slider yok (sabit `SPEED=2.2`, `remote.html:807`). | Ayarlar sheet'inde "Fare hassasiyeti" slider (1.0-4.0); scroll yönü ters çevirme opsiyonu. |
| 3.5 | **O** | Mirror sırasında TV'de ses yok (`audio: false` sabit, `remote.html:974`). Kullanıcı video paylaşırken sesin duyulmaması şaşırtıcı. | Paylaşım tipine göre: tam ekran → `audio: true`; sekme → `audio: true, suppressLocalAudioPlayback: true`. |
| 3.6 | **O** | `mirror.html` overlay'i 1.2 sn sonra gizleniyor ama bağlantı kopunca tekrar görünmesi için `oniceconnectionstatechange` bekliyor; `connected` → `disconnected` arasındaki kısa gecikmelerde "siyah ekran" olur (`mirror.html:93`). | `ontrack.onmute` + `onunmute` ile video donunca overlay göster. |
| 3.7 | **O** | Hata mesajı tutarlılığı: bazı yerde "İşlem yapılamadı" (`beeos_server.py:1775`), bazen "Bağlanılamadı" (`remote.html:1021`), bazen "Fare açılamadı (uinput)" — kullanıcı için teknik terim karışık. | Tek bir sözlük: "İşlem gerçekleştirilemedi", "Cihaza ulaşılamadı", "Ayarlar düzgün değil" → arkadaki teknik detay ayrı satır (gri). |
| 3.8 | **O** | Telefon kumanda sayfasında "Fare" segmenti dokunmatik buton; buton metni yok (ikon + label birlikte değil). Erişilebilirlik: screen reader'a ne olduğu belli değil. | `aria-label="Fare modu"` + visually-hidden text. |
| 3.9 | **D** | webOS TV'de 'Fare' ve 'Yansıt' kartları PC-only ama ayarlar panelinde ekran yansıtma / fare ile ilgili hiç satır yok — kullanıcı bilgi için yardım aramak zorunda. | TV'de ayarlar > Sistem'de "Bu özellik yalnızca beeOS PC sürümünde çalışır" bilgi satırı. |
| 3.10 | **D** | Loader zaman aşımı PC'de 20 sn, TV'de 8 sn (`app.js:583`); uygulama ilk açılış süresinin uzadığı durumda (Netflix cold start) loader kapanıp kullanıcı karanlık ekran görür. | `beforeload` eventiyle ilerleme izle veya CDP `Page.loadEventFired` kullan. |

---

## 5. Test kapsamı

| # | Önc. | Bulgu | Yapılacak |
|---|------|-------|-----------|
| 5.1 | **Y** | `tests/run.js` toplam 367 satır ve Store + TV helper + EPG yardımcı fonksiyonlarını kapsıyor. `app.js` (2283 satır, launcher mantığının tamamı), `platform.js`, `qr.js`, `a11y.js`, `search_suggest.js`, `diag.js` için **sıfır** birim test. | En azından `app.js` içindeki `availableHere`, `computeModel`, `moveItem`, `toggleFavorite` fonksiyonlarını saf hale getirip test yaz. |
| 5.2 | **Y** | Backend (`beeos_server.py` 1908 satır) için hiç test yok. `session_check` HMAC doğrulaması, `swap_dir` atomikliği, `tv_url_ok` SSRF kontrolü, `ver_tuple` versiyon karşılaştırması — hepsi test edilmeli. | Python `unittest` ile `tests/test_backend.py` ekle; CI'ye `python -m unittest` koş. |
| 5.3 | **O** | `UInputMouse` test imkânsız (kernel'e bağlı), ama `_emit` için ioctl çağrıları `mock patch` ile doğrulanabilir — struct pack formatının 24 bayt (`llHHi`) olması kritik. | `ctypes.sizeof` + sabit beklenen bayt dizisi testi. |
| 5.4 | **O** | `mirror_signal`, `mirror_start`, `mirror_reset` için integration testi yok. İki fake istemciyle (offerer/answerer) sıralı çağrı akışı test edilebilir. | Backend test dosyasına mirror akış testi ekle. |
| 5.5 | **O** | EPG parse büyük XMLTV'de (iptv-org Türkiye ~10MB, 50K `<programme>`) test edilmiyor. Chromium 38'de DOMParser bellek sorunu çıkabilir. | Test corpus (küçük sentetik 1MB) ekle; perf benchmark. |
| 5.6 | **O** | Integration / end-to-end test yok. VirtualBox'ta imajı başlatıp kumandayla 3-4 akışı otomatik test edebilirsiniz (zaten `vbox.ps1 key` API'si var). | `tests/e2e.ps1` smoke suite: açıl → kumanda bağlan → Netflix aç → kapat. CI matrix dışında nightly. |
| 5.7 | **D** | `node --check` syntax check'i çalışıyor (CI) ama lint (eslint) yok — stilistik sorunlar ve `== null` gibi muhtemel hatalar yakalanmaz. | Minimal eslint config (ES5 target) ekle. |

---

## 6. Performans

| # | Önc. | Bulgu | Yapılacak |
|---|------|-------|-----------|
| 6.1 | **O** | `EPG.parseXml` tüm `<programme>` elemanlarını belleğe alır, 10MB XMLTV = ~50k nesne. Chromium 38 (webOS 3) için ağır (`epg.js:20`). | Sadece bugün ve yarın için filtre; `parseXml` içinde `start` tarih aralığı dışındakileri atla. |
| 6.2 | **O** | Fare throttle 60Hz (`remote.html:775`, `schedule → setTimeout(flush, 16)`) — ama WebSocket değil HTTP POST kullanıyor. Her hareket ayrı TCP setup/teardown; 60 req/sn → telefon pili ve TLS handshake maliyeti. | WebSocket endpoint `/api/cursor/ws` ekle; sürekli bağlantı, binary mesajlar (`dx,dy,wheel`). |
| 6.3 | **O** | Mirror bitrate ayarı yok. `getDisplayMedia({video:{frameRate:30}})` çıktı, encoder tam HD 2.5-5 Mbps kullanır; ev Wi-Fi'de takılabilir (`remote.html:973`). | `RTCRtpSender.setParameters` ile `maxBitrate` ayarı; kumandada "Yüksek / Orta / Düşük" kalite seçimi. |
| 6.4 | **O** | `tv_proxy` her segment için ayrı HTTP connection (`urllib.request.urlopen`); HLS live stream'de 2-6 sn parçalar = sürekli connection churn. | `tv_opener` için HTTP keepalive (urllib3 / requests ile) ya da httpx. |
| 6.5 | **D** | `remote_load`/`remote_save` her kumanda isteğinde çağrılmıyor ama session `last` güncellemesinde save tetikleniyor — yoğun fare hareketi sırasında sık disk IO olabilir (`session_check`, satır 1072). | `last` güncellemesini 30 sn'de bir diske yaz; bellekte sayaç tut. |
| 6.6 | **D** | `photo_list` tüm dizinleri her çağrıda `listdir` yapar, 500 dosyaya kadar. Ekran koruyucu her açıldığında gereksiz IO. | 60 sn TTL'li cache. |

---

## 7. Dokümantasyon

| # | Önc. | Bulgu | Yapılacak |
|---|------|-------|-----------|
| 7.1 | **Y** | README'de Fare modu (0.7.0'da eklendi) ve Yansıt (0.7.0) hakkında tek satır yok. Kullanıcı var olduğunu bilmiyor. | README'ye "Telefon kumandası" altına yeni başlık: "Fare modu" + "Ekran yansıtma" (gereksinimler: HTTPS, Android Chrome, aynı ağ). |
| 7.2 | **Y** | HTTPS sertifikası ilk açılışta "güvenli değil" uyarısı veriyor ama README bunu açıklamıyor; kullanıcı panik yapıp eşleşmeden vazgeçer. | README'de "İlk bağlantıda tarayıcı 'bu site güvenli değil' der; **Devam et** → **Yine de ziyaret et** seçin. Sertifika sizin TV'niz tarafından yerel olarak üretilmiştir, dışarı çıkmaz." |
| 7.3 | **O** | GeForce Now kartı eklendi ama hiçbir yerde oyun kolu kurulum / Nvidia hesap gereksinimi anlatılmıyor. | README'de "Oyun" bölümü: GeForce Now + ileride eklenecek diğer bulut oyun hizmetleri. |
| 7.4 | **O** | Troubleshooting bölümü yok. "Chrome cache sorunu" (önceki commit 7d53d3d), "mirror çalışmıyor → HTTPS", "fare açılmıyor → uinput modülü", "TV sertifikayı kabul etmiyor → tarayıcıda ayarlardan sertifikaları temizle" gibi bilinen sorunlar yok. | `docs/troubleshooting.md` oluştur, README'den link ver. |
| 7.5 | **O** | PC modu için ayrı kullanım kılavuzu yok; README içinde iç içe. İlk kez alacak için ne gerekli (USB disk boyutu, HDMI, BIOS boot order) kısmi ama ekran yansıtmanın çalışması için Chrome'un hangi sürümünün, telefonda hangi tarayıcının gerektiği belirsiz. | `docs/pc-first-run.md` adım adım. |
| 7.6 | **D** | `CHANGELOG.md` sadece 598 bayt; 0.6.0 ve 0.7.x arası değişiklikler yok. | `tools/release.py bump` komutuyla otomatik CHANGELOG girişi oluştur. |
| 7.7 | **D** | API endpoint'lerin (`/api/*`) tek kaynak dokümantasyonu yok — docstring'den dağınık okunuyor. | `docs/api.md` tablo halinde endpoint + method + auth + body şeması. |

---

## 8. İşlevsel eksikler

| # | Önc. | Bulgu | Yapılacak |
|---|------|-------|-----------|
| 8.1 | **O** | Chromecast / AirPlay / DLNA alıcısı yok. Telefondaki "Yansıt" düğmesi beeOS'u listede göstermez; sadece kendi `remote.html`'imizden mirror çalışıyor. Önceki soruya cevap: UxPlay (AirPlay) + gmediarender (DLNA) kurulumu. | `os/overlay`'e UxPlay + rygel systemd unit'leri; iOS → beeOS, Android → gmediarender. |
| 8.2 | **O** | Oyun kategorisi şu an sadece **GeForce Now** (1 kart). Xbox Cloud Gaming (`xbox.com/play`), Boosteroid, now.gg eklenmesi çok küçük iş. | `js/config.js`'e 2-3 bulut oyun kartı daha. |
| 8.3 | **O** | Çoklu kullanıcı / profil yok. Favoriler, son açılanlar, TV kanalları tek profilin. Aile kullanımı için yetersiz. | `Store`'a `profiles: { default, kids, ... }`; ana ekran köşesinde profil değiştirme. |
| 8.4 | **O** | Ebeveyn kilidi yok. Çocuk hesabına açılmayacak kart gizleme / PIN ile korumalı kart yok. | Ayarlar > "PIN ile korunan kartlar" listesi; açılışta 4 haneli PIN iste. |
| 8.5 | **O** | Uyku zamanlayıcısı / alarm yok. Kullanıcı TV'yi 30 dk sonra kapatmak isteyebilir. | Ayarlar > "Uyku zamanlayıcı" (15/30/60 dk → `power("off")`). |
| 8.6 | **O** | Saat/tarih göstergesi var ama ağ saati (NTP) kurumsal / eski ağlarda bazen senkronize olmuyor; kullanıcıya saat elle set imkânı yok. | Ayarlar > Sistem > Saat (timedatectl). |
| 8.7 | **O** | Bildirim merkezi yok. Mirror istekleri, güncelleme çıktığı, kanal kırıldığı bildirimler hep toast → kaybolur. | Hafif "bildirimler" panel (son 10 olay, Store'da saklı). |
| 8.8 | **O** | Yedekleme / geri yükleme yok. Kullanıcı tüm ayarlarını (favoriler, M3U listeleri, EPG adresi, kumanda eşleşmeleri) başka kuruluma taşıyamaz. | Ayarlar > "Dışa aktar / İçe aktar" (JSON dosyası BEEOS-LOG'a yaz). |
| 8.9 | **O** | `only` filtresi iki değerli (`tv`/`pc`); ileride webOS6 vs webOS3, PC vs Raspberry Pi gibi ayrımlar için yetersiz. | `availableHere` geliştir; kart'ta `platforms: ["pc","tv6+"]` dizi. |
| 8.10 | **O** | Fare modunda klavye yok. Kullanıcı mouse ile tıkladığı arama alanına yazamıyor (zaten "Yaz" sekmesi var ama yan yana değil). | Fare ekranında "Klavye" küçük düğme → Yaz sekmesine atla. |
| 8.11 | **D** | OTA güncelleme güvenliği: minisign opsiyonel (bkz. 1.6) + versiyon downgrade koruması yok. Düşük sürüme downgrade = eski açık'lara dönüş. | `ver_tuple(new) > ver_tuple(current)` zaten kontrol ediliyor (`update_check` satır 508) ama rollback bu kontrolden kaçar — rollback olasılığına kullanıcı onayı iste. |
| 8.12 | **D** | Haber kategorisi yok (yurtdışı: BBC News, Reuters, TRT World iframe; yurtiçi: NTV, HaberTürk zaten var ama tek kanal). Müzik kategorisi sadece Spotify. | `js/config.js`'e 2-3 müzik (YouTube Music, Deezer) ve 1-2 haber kartı. |

---

## 9. Build / release

| # | Önc. | Bulgu | Yapılacak |
|---|------|-------|-----------|
| 9.1 | **O** | `release.yml` tag push'ta release üretiyor, ama `appinfo.json` doğrulama dışında semver atlaması (0.6.0 → 0.7.4 arasında 0.7.0, 0.7.1, 0.7.2, 0.7.3 varlığı) kontrol edilmiyor. Noktasal hotfix yapıldığında eski major'daki kullanıcı yeni major'a atlıyor — geçiş notu yok. | `release.yml`'de önceki release ile diff `--generate-notes` zaten kullanıyor; eklen: upgrade hop uyarısı. |
| 9.2 | **O** | PC updater atomik ama `/opt/beeos/overlay`'in alt klasörleri tek tek kopyalanıyor (satır 764), tam ortasında güç kesilirse yarım overlay. systemd unit'lerinin yarısı yeni yarısı eski. | 8. maddede yer alan "staging + atomik swap" overlay için de uygula. |
| 9.3 | **O** | Rollback için `web.prev` + `bin.prev` tutuluyor ama `overlay.prev` yok. Rollback sadece web+bin'i geri getiriyor, systemd unit'leri yeni sürümde kalıyor — uyumsuzluk mümkün (`update_rollback`, satır 700). | Overlay snapshot'ı da tut (git bare repo gibi); rollback'te uygula. |
| 9.4 | **O** | `ci.yml` syntax check + testleri koşuyor ama PR'larda imaj derlemesi yok (uzun sürer ama haftalık cron olabilir). Release'tan önce kimse imaj boot etmedi. | Haftalık cron: `vbox.ps1 build` benzeri headless build; smoke test. |
| 9.5 | **D** | `tools/release.py pack`'in çıktısı deterministic (mtime 0, 0755/0644), fakat `gzip.GzipFile` compression level default (9). Her sürümde paket boyutu dalgalanabilir. | `compresslevel=6` sabitle; `.sha256` dosyasını paketten sonra dışarıdan üret. |
| 9.6 | **D** | `release.yml`'de `verify-tag` var ama tag imzalanmıyor (user `batiozdmr` GPG anahtarı kontrol edilmiyor). | `git tag -s` kullan; release workflow `--verify-tag` zaten var. |

---

## 10. Platform-spesifik

| # | Önc. | Bulgu | Yapılacak |
|---|------|-------|-----------|
| 10.1 | **Y** | webOS TV test akışı manuel (`ares-install`). PC'de çalışan değişikliklerin TV'de patlaması bu yüzden sık görülür. ES5 uyumluluğu için otomatik lint yok (ör. `let/const/arrow/spread` kullanımı). | eslint `ecmaVersion:5` + `tests/run.js` vm context'inde ES5 flag'li syntax parse. |
| 10.2 | **O** | 0.5.3 commit mesajı "always send UI files so updates are not hidden by Chrome's cache" — çözüm `del self.headers["If-Modified-Since"]` ile (satır 1626). Yan etki: her sayfa yüklenişi ağır varlıkları (hls.min.js 800KB) yeniden çekiyor. | `Cache-Control: no-cache` yerine `ETag` based validation; dosya içeriği aynıysa 304. |
| 10.3 | **O** | Sway kiosk edge-case'leri: ikinci monitör ekleme sırasında `display_use` → session restart (1.5 sn timer, satır 1548). Restart sırasında arayüz kayboluyor, kullanıcı "donmuş" sanıyor. | Restart öncesi tam ekran "TV'ye geçiliyor…" overlay. |
| 10.4 | **O** | Çoklu monitör kombinasyonu 2'den fazla ekranda (dizüstü + TV + monitör) `show_on(name, others_off=True)` her şeyi kapatıyor; ortalama kullanıcı için OK, developer için can sıkıcı (satır 1524). | `others_off` opsiyonel (ayarlardan "Yalnızca bir ekranda göster" toggle). |
| 10.5 | **O** | Chrome policy `PasswordManagerEnabled: true` → TV'ye şifre kaydetmek kullanıcı güvenliği için risk; herkese açık (otel/kafe). | `PasswordManagerEnabled: false` + `AutofillAddressEnabled: false`. |
| 10.6 | **D** | `firmware-nvidia-graphics` eklenmiş ama Wayland/Nvidia hâlâ sorunlu kombinasyon; `nouveau` blacklist var (satır 190). Nvidia proprietary driver otomatik kurulmuyor → modern Nvidia kartı olan dizüstü ekrana görüntü vermez. | `nvidia-driver` paketi + `kms` için script; güvenli mod seçeneği zaten var. |
| 10.7 | **D** | HDMI ses yönlendirmesi: `wpctl set-volume @DEFAULT_AUDIO_SINK@` → sink TV'ye geçtiğinde önceki (laptop) sinkin düzeyi kaybolur. | Sink değişiminde eski sink düzeyini sakla. |
| 10.8 | **D** | `os/vbox.ps1` ve `os/vm.ps1` arasında feature-parity yok; VBox lehine yoğun geliştirme olmuş ama iki yolu sürdürmek çaba istiyor. | Birini birincil ilan et (VBox); ötekini `docs/` altına alternatif olarak bırak. |

---

## Özet rakamları

- Toplam bulgu: **~50** (10 kategori, 8-11 madde)
- Öncelik dağılımı: Yüksek **9**, Orta **28**, Düşük **13**
- En kritik 3 başlık (hemen ele alınmalı):
  1. **Mirror onayı yok** (1.4): yabancı telefondan ekrana zorla yayın.
  2. **Fare endpoint'i oturumsuz PIN'e açık** (1.3): PIN tahmini → tam ekran kontrolü.
  3. **Fingerprint pinning yok, HTTPS self-signed** (1.1): MITM detect edilmiyor.
- En büyük mimari borç: `app.js` 2283 satır tek dosya + backend için **sıfır birim test**.
- Dokümantasyon: README 0.6'da güncelleniyor, 0.7'de (mirror + fare + geforce now) hiç güncel değil.

**Önerilen 0.8 hedefleri**: mirror onay bildirimi, oturumlu `/api/cursor`, fingerprint pinning (QR), README güncellemesi, backend birim testleri. Bunlar risk/çaba dengesinde en iyi getiriyi verir.

# Güvenlik sertleştirmesi — telefon kumandası ve Bluetooth

## 1. Telefon kumandası TLS
Şu an `:8081` düz HTTP: aynı Wi-Fi'da pasif dinleyici PIN'i ve tuşları yakalayabilir.

### Plan
- Açılışta `openssl req -x509 -newkey ed25519 -nodes -subj "/CN=beeos" -days 3650` ile self-signed cert
- `/var/lib/beeos/remote.{crt,key}` olarak sakla, 0600
- `beeos_server.py` → `remote.html`'i `http.server.ThreadingHTTPServer` yerine `ssl.wrap_socket` ile servis et
- İlk bağlantıda telefona fingerprint göster (SHA-256 kısa gösterim), TV ekranında aynı fingerprint
- Telefon kabul edince `localStorage`'a fingerprint'i yaz; sonraki bağlantılarda değişiklik → uyarı

### Sertifika yenileme
- Otomatik: her yılın başında yeni cert üret; eskisi 30 gün paralel sunulur
- Fingerprint değiştiğinde telefon yeniden onay ister (SSH `known_hosts` mantığı)

## 2. Oturum token (HMAC)
PIN sadece ilk eşleşme için; sonraki her istek `Authorization: Bearer <token>`.

### Akış
1. Telefon `POST /api/remote/pair` { pin } → sunucu PIN'i doğrular, 32 bayt rastgele `session_id`
   + `secret` üretir, `remote.json`'a kaydeder (en fazla 4 aktif oturum)
2. İsteklerde `X-BeeOS-Session: <id>` + `X-BeeOS-Sig: hex(hmac_sha256(secret, method + "\n" + path + "\n" + body))`
3. Sunucu tarafta sabit zamanlı karşılaştırma, nonce önbelleği (son 5 dk, replay'i engelle)
4. Oturum 30 gün hareketsiz kalırsa silinir; ayarlar panelinden "Tüm oturumları kapat" düğmesi

### Rate-limit
- PIN girişi: 10 yanlış → 5 dk kilit (mevcut) → **kademeli**: 5, 15, 60 dk
- Başarısız girişleri `remote.json`'da sakla, `last_attempts` listesi (IP, zaman)

## 3. Bluetooth passkey
`bluetoothctl` ile şu an `agent NoInputNoOutput` (just-works) kullanılıyor. Just-works MITM'e açık.

### Plan
- `agent DisplayYesNo` → sayısal karşılaştırma (6 hane ekranda, cihazda)
- Her eşleşme isteğinde TV ekranında onay kutusu: "Kulaklık XYZ eşleşsin mi? Kod: 384219"
- `bluetoothctl` pair akışı Python tarafta pexpect ile sürülür; zaman aşımı 30 sn
- Eski "just-works" cihazlar için fallback: ayarlardan "güvensiz eşleşmeye izin ver" düğmesi (varsayılan kapalı)

## 4. mDNS keşfi
IP girme zorunluluğu kalksın: telefon `_beeos._tcp.local` yayınını görür, listeden seçer.

### Plan
- `avahi-daemon` aktif (çoğu Debian'da var), servis dosyası:
  `/etc/avahi/services/beeos.service`:
  ```xml
  <service-group>
    <name replace-wildcards="yes">beeOS %h</name>
    <service>
      <type>_beeos._tcp</type>
      <port>8081</port>
      <txt-record>fp=&lt;cert fingerprint ilk 16 hex&gt;</txt-record>
      <txt-record>v=1</txt-record>
    </service>
  </service-group>
  ```
- Android: Network Service Discovery; iOS: Bonjour. Telefon uygulaması bulunca TXT'deki fp'yi karşılaştırır.
- Ekranda 6 haneli PIN'in yanına QR kod: `beeos://pair?host=<ip>:8081&fp=<...>&pin=<...>`

# Güncelleme paketi imzalama (minisign)

SHA-256 doğrulaması paketin bozulmamış olduğunu söyler, kim yayınladığını söylemez. GitHub token'ı
veya CDN ele geçerse kötü niyetli bir paket aynı SHA ile servis edilebilir. Bunu kapatmak için
`minisign` imzası eklenir: anahtar yayıncıda offline durur, cihaz yalnızca genel anahtarı taşır.

## 1. Anahtar üret (bir defa, güvenli makinede)
```
minisign -G -p beeos.pub -s beeos.key
```
- `beeos.pub` → depoya düşer (`os/overlay/etc/beeos/update.pub`)
- `beeos.key` → çevrimdışı yedek; CI'da **değil**

## 2. Release akışına imza ekle
`tools/release.py` paketi üretince:
```
minisign -S -s $BEEOS_SIGN_KEY -m beeos-update-<sürüm>.tar.gz
```
İmza dosyası `.minisig` olarak release'e eklenir.

## 3. Cihaz doğrulaması
`os/backend/beeos_server.py#update_download` SHA-256'dan sonra şunu çalıştırır:
```
minisign -V -p /etc/beeos/update.pub -m pkg.tar.gz -x pkg.tar.gz.minisig
```
- Komut 0 dışı dönerse: `raise UpdateError("İmza doğrulanamadı")`
- Komut bulunamazsa (eski imaj): şimdilik uyarı logla, kurulumu engelleme. Bir sonraki major'da zorunlu kıl.

## 4. Anahtar rotasyonu
- Yeni anahtar üret, `update.pub` yanına `update-next.pub` olarak koy
- Bir sürüm boyunca iki anahtarla doğrula (`-p update.pub || -p update-next.pub`)
- Sonraki sürümde eskiyi sil

## 5. CI gizli değişkenleri
- `BEEOS_SIGN_KEY` — minisign anahtar dosyasının içeriği (not: parolayla şifrelen, parola ayrı gizli olarak girilir)
- `BEEOS_SIGN_PASSPHRASE` — anahtar parolası

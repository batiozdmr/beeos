# Güvenlik

## Desteklenen sürümler
Güvenlik düzeltmeleri yalnızca son sürüme gelir. Cihazlar **Ayarlar > Güncellemeleri kontrol et** ile güncellenir.

## Açık bildirme
Güvenlik açıklarını herkese açık issue olarak **açma**. GitHub'da **Security > Report a vulnerability**
(özel güvenlik bildirimi) ile bildir. Mümkünse şunları ekle: etkilenen sürüm, adımlar, olası etki.
Bildirime birkaç gün içinde dönüş yapılır; düzeltme yayınlanınca bildiren kişi (isterse) anılır.

## Kapsam
Özellikle önemli olanlar: telefon kumandası (port 8081, PIN), arayüz sunucusunun dışarıdan çağrılması
(`/api/` istekleri), güncelleme mekanizması (paket indirme ve doğrulama), imajdaki varsayılan ayarlar.

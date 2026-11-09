# DRM ve oynatma kalitesi

## Mevcut durum
- **TV (webOS)**: TV'nin kendi oynatıcısı (Widevine L1 donanımsal). 1080p/4K yayıncı sözleşmesine bağlı.
- **PC (Debian + Chrome)**: Widevine **L3** (yazılımsal) — Netflix maks **720p**, Disney+ 720p,
  Prime Video 720p. YouTube ve Spotify DRM istemiyor, kalite tam.

## Neden böyle
Linux için Netflix yalnızca donanımsal DRM onayı olan platformlara (ChromeOS, bazı Fire TV, akıllı TV)
yüksek çözünürlük verir. Masaüstü Linux Chrome'da L1 yok.

## Seçenekler

### A) Kabul et, kullanıcıya söyle
- Ayarlar > TV > "Oynatma hakkında" bölümüne not: "Netflix/Disney+ bu bilgisayarda en fazla 720p"
- Düşük maliyet, net davranış.

### B) ChromeOS Flex
- Google'ın resmî Linux dağıtımı; Widevine L1 **bazı** modellerde çalışıyor (donanıma bağlı).
- Deneme: hedef donanımda ChromeOS Flex kur, Netflix'te `nf-config quality` sonucu kontrol et.
- beeOS'u ChromeOS üstüne kiosk olarak koşturmak mümkün ama çekirdek güncellemeleri Google'da kalır → imaj akışımız kırılır.

### C) Fire TV donanımına taşı
- Debian yerine Android TV tabanlı donanıma geçiş çok büyük iş. Kapsam dışı.

### D) Harici kutu / stick
- Kullanıcıya "Netflix 1080p istiyorsan HDMI'ya Chromecast / Fire TV stick tak" de;
  beeOS'tan HDMI yönlendirme özelliğiyle tetikle (uzun vade).

**Öneri**: A + D. Kısa vadede uyarı metni + ayar; uzun vadede HDMI girişine kutu entegrasyonu araştırması.

## DASH desteği
hls.js yalnızca HLS. DASH için `shaka-player` eklenebilir (~400 KB minified).
- `js/vendor/shaka.min.js` olarak vendored, `js/tv.js` içinde kaynak sonuna göre seçici
- Kullanıcı M3U listesinde `.mpd` adresi verirse otomatik shaka kullanılır

## Alt yazı (WebVTT)
Ayarlar > Erişilebilirlik > Alt yazı:
- Yazı boyu (küçük/orta/büyük/çok büyük)
- Arka plan (şeffaf / yarı saydam / siyah)
- Gecikme (-5 sn … +5 sn, 100 ms adım)
- Renk kontrastı (beyaz/sarı; kontur)

CSS değişkenleri: `--sub-size`, `--sub-bg`, `--sub-color`. hls.js/shaka ikisi de `<track>` elemanıyla bu
stilleri kabul eder.

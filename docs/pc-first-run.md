# beeOS PC — İlk Kurulum Kılavuzu

Bu belge, beeOS'u bir masaüstü/dizüstü bilgisayara **flash disk** olarak kurmak için gereken adımları
sıralar. Kurulu sistemine dokunmaz — USB'yi çıkarınca her şey eskisi gibi döner.

> **Donanım gereksinimleri** (küçük kutu)
> - Intel Core i3 ya da üstü (Chrome + Widevine için SSE4.2 şart)
> - 2 GB RAM (4 GB rahat)
> - **UEFI** açılış desteği (son 10 yıl içindeki her PC'de var)
> - HDMI ya da DisplayPort çıkışı
> - **8 GB veya daha büyük** USB disk (3.0 tavsiye — açılış 3-4 kat hızlanır)
>
> **Nvidia ekran kartı**: proprietary driver otomatik kurulmaz. İlk denemede ekran siyah gelirse
> açılış menüsünü **Esc** ile aç ve "**beeOS (güvenli mod, ekran kartı sürücüsüz)**" seç
> (ayrıntı: [docs/troubleshooting.md](troubleshooting.md)).

---

## 1. Önce elindekiler

- Bir **USB disk** (8 GB+). Üstündeki her şey silinecek — önemli bir şey varsa önce yedekle.
- Bir **HDMI** veya **DisplayPort** kablosu (TV'ye bağlanacaksan).
- Telefon kumandası isterseniz: **Android Chrome** tavsiye edilir (iPhone Safari ekran paylaşımı
  desteklemez; fare ve kumanda çalışır ama "Yansıt" düğmesi iOS'ta pasif kalır).
- Aynı **Wi-Fi ağı** üzerinde telefon ve bilgisayar — kumanda için şart.

---

## 2. İmajı indir

GitHub'daki en son sürümü aç:

- **https://github.com/batiozdmr/beeos/releases/latest**

İndirmen gereken iki dosya:

- `beeos.img` (yaklaşık 1.5-2 GB — sistem imajının kendisi)
- `beeos.img.sha256` (sağlama toplamı, 64 karakterlik bir metin)

### Sağlama toplamını doğrula (opsiyonel ama şiddetle tavsiye)

Dosya indirilirken bozulmuş mu diye kontrol:

- **Windows (PowerShell)**: `Get-FileHash beeos.img -Algorithm SHA256`, sonra `.sha256`'nın içindekiyle
  karşılaştır (ikisi de aynı olmalı).
- **macOS/Linux**: `sha256sum -c beeos.img.sha256` — "OK" dönerse temizdir.

---

## 3. USB'ye yaz

### Windows

**[Rufus](https://rufus.ie/)** tavsiye edilir (ücretsiz, tek dosya):

1. USB'yi tak, Rufus'u aç, **Device** olarak USB'yi seç.
2. **Boot selection** → **SELECT** → `beeos.img`'i göster.
3. **Partition scheme**: **GPT**.
4. **Target system**: **UEFI (non-CSM)**.
5. **START** → "DD image mode" sorarsa onu seç.

5-10 dakika sürer. "READY" olunca USB'yi güvenle çıkar.

### macOS / Linux

```bash
# diskX'in doğru sürücü olduğundan kesin ol (yanlış disk = veri kaybı)!
# macOS: diskutil list   /   Linux: lsblk
sudo dd if=beeos.img of=/dev/sdX bs=4M status=progress conv=fsync
```

> ⚠ **UYARI**: `of=/dev/sdX` yanlış girilirse tüm diski silebilirsin. `lsblk` ile mutlaka doğrula.

---

## 4. Bilgisayardan boot

1. USB'yi takılı bırak, bilgisayarı yeniden başlat.
2. Markaya göre **boot menü** tuşuna tıkla açılırken:
   - **F12** (Dell, Lenovo, Acer)
   - **F10** (HP)
   - **F9** (HP bazı modeller, ASUS)
   - **Esc** (çoğu markada ikinci seçenek)
   - **F2 / Del** (BIOS/UEFI ayarlarına girer — oradan "Boot Order" ile USB'yi öne al)
3. Listeden **UEFI USB** / markanın adını içeren seçeneği (ör. "UEFI: SanDisk 3.2 Gen1") seç.
4. **Secure Boot açık kalabilir** — beeOS imzalı shim bootloader kullanır, kapatmaya gerek yok.

5-15 saniye içinde beeOS logolu açılış ekranı gelmeli. Siyah kalırsa yukarıdaki "Nvidia" kutusuna bak.

---

## 5. İlk açılış — karşılama sihirbazı

İlk kez açıldığında **tam ekran karşılama sihirbazı** otomatik başlar. 6 adımdır:

1. **Hoş geldin** → "Devam".
2. **Adın** — ana ekrandaki "Günaydın Ahmet" yazısı için. İstersen boş bırak.
3. **Ağ durumu** — Wi-Fi varsa yeşil görünür. Yoksa "Atla" de, sonra Ayarlar'dan bağlanırsın.
4. **Telefon kumandası QR'ı** — bir sonraki adımda ayrıntı.
5. **Favoriler** — 6 popüler karttan (YouTube, Netflix, Prime, Disney+, Spotify, Tarayıcı) sevdiklerini
   seç. Ana ekranın en üstündeki "Favoriler" rafına düşerler.
6. **Tuş özeti** — klavyeden hangi tuş ne yapar (`Enter` aç, `F1` ayarlar, `A-Z` yazarak ara, `Home`
   ana ekrana dön).

Sihirbazı tekrar görmek istersen: **Ayarlar > Karşılama sihirbazını tekrar göster**.

---

## 6. Telefonu kumanda yap

### Hızlı yol (QR)

Karşılama sihirbazının 4. adımındaki QR kodu **telefon kamerasına tut**:

1. Kamera URL'yi algılar — üstteki banner'a dokun, Chrome açılır.
2. "Bu site güvenli değil" uyarısı normal — beeOS kendi ürettiği sertifikayla konuşuyor, dışarı çıkmaz.
   **Gelişmiş** → **Yine de ziyaret et** seç.
3. PIN otomatik dolar, telefon eşleşir ve kumanda arayüzü açılır.

### Elle

Chrome adres çubuğuna: `https://<beeOS IP'si>:8081` yaz (IP karşılama ekranında + Ayarlar > Telefon'da
yazar). Yukarıdaki güvenlik uyarısını geç, TV'deki PIN'i gir.

### Neler var?

- **Yön tuşları / Dokunmatik / Fare** (üç mod, segmentten seç)
- **Oynat/Dur, Önceki/Sonraki, Ses**
- **Uygulamalar** (TV'deki aynı kartlar, aramayla)
- **Yaz** (telefon klavyesinden TV'ye yazı — mikrofonla sesle de olur)
- **Yansıt** — telefon ekranını TV'ye paylaş (Android Chrome)

Ayrıntı: [troubleshooting.md](troubleshooting.md) → "Kumanda bağlantısı".

---

## 7. Netflix / Disney+ / Prime (DRM'li uygulamalar)

Hazır. Google Chrome Widevine kütüphanesiyle geliyor — ekstra şey kurman gerekmez. İlk açılışta
oynatma başlamadan **1-2 saniye** gecikme olabilir (Widevine sertifikası ilk kez çekilir).

Hesaplar: her uygulamanın kendi hesabı. İlk girişte normal web akışı: e-posta + şifre.

> İpucu: sık kullandığın hesapları TV'ye değil telefona kaydet; yansıtma / arama ile geç.

---

## 8. AirPlay (iPhone / iPad / Mac)

beeOS 0.10'dan itibaren **AirPlay 2 alıcısı** çalıştırıyor. iPhone/iPad/Mac'ten doğrudan
yansıtabilirsin — beeOS'un kendi "Yansıt" düğmesine ihtiyaç yok.

1. Aynı Wi-Fi'de olduklarından emin ol.
2. iPhone: **Kontrol Merkezi** → **Ekran Yansıt** → listeden **beeOS**.
3. Mac: menü çubuğu → **Ekran Yansıt** → **beeOS**.

Ayrıntı: [docs/airplay.md](airplay.md) (ad değiştirme, PIN koyma, sorun giderme).

---

## 9. Güncellemeler

beeOS kendi kendini günceller. Yeni sürüm çıktığında bildirim merkezinde not düşer.

- **Ayarlar > Güncelleme > Kontrol et** manuel tetikler.
- Paket GitHub Releases'tan indirilir, SHA-256 doğrulanır (imzalı ise minisign ile doğrulanır,
  zorunlu değilse uyarı).
- **Atomik yazım**: eski sürüm `web.prev` / `bin.prev` / `overlay.prev` olarak saklanır.
- Güncelleme sırasında elektrik giderse yarım kalan `.beeos-new` dosyaları sonraki açılışta temizlenir.
- **Geri alma**: Ayarlar > Güncelleme > "Önceki sürüme dön" — web + bin + overlay toplu rollback.

---

## 10. Sorun giderme

Her sık karşılaşılan sorun için ayrı başlık: [docs/troubleshooting.md](troubleshooting.md). Özet:

- Siyah ekran → "güvenli mod" (Esc açılışta)
- "Güvenli değil" uyarısı → normal, "Yine de ziyaret et"
- Fare açılmıyor → `sudo modprobe uinput`
- Chrome önbellek takılmış → Ayarlar > Güncelleme > Chrome'u yeniden başlat
- TV sertifikayı kabul etmiyor → tarayıcıdan ilgili sitenin önbelleğini temizle

---

## 11. Verilerin nereye gider?

Kurulumdan sonra üç kalıcı yer var:

- **`/var/lib/beeos/`** — beeOS'un kendi hali: kumanda PIN'i, oturum anahtarları, TV sertifikası,
  güncelleme durumu. Buraya sadece beeOS yazar.
- **`/mnt/beeos-log/`** — **BEEOS-LOG** adlı FAT32 bölümü. Bilgisayarı Windows'tan yeniden başlatıp
  USB'yi takarsan burası normal bir sürücü olarak görünür. İçinde:
  - `Fotograflar/` — buraya attığın fotoğraflar **ekran koruyucuda** gösterilir (Ayarlar >
    Ekran Koruyucu > Stil: Fotoğraflar).
  - `teshis-<tarih>/` — tanı günlükleri (her açılış ayrı klasör).
- Arayüz ayarları (favoriler, M3U listeleri, EPG adresi) — tarayıcının **localStorage**'ında.
  Ayarlar > "Ayarları dışa aktar" ile JSON dosyası alıp başka kuruluma taşıyabilirsin.

---

Hazırsın. Sorun çıkarsa `docs/troubleshooting.md`'ye bak; hâlâ çözmüyorsa
[GitHub Issues](https://github.com/batiozdmr/beeos/issues)'da yaz.

# beeOS

TV için hızlı, sade ana ekran. Saf HTML/CSS/JS (ES5), eski webOS ile uyumlu. İki şekilde çalışır:
- **LG webOS TV** uygulaması olarak (.ipk)
- **Flash diskten açılan sistem** olarak: PC'yi HDMI ile TV'ye bağla, flash diskle aç, doğrudan beeOS gelir
  (bkz. *Flash disk (PC) sürümü*)

Açık kaynaklıdır: [MIT lisansı](LICENSE). Katkı ve sürüm çıkarma: [CONTRIBUTING.md](CONTRIBUTING.md),
davranış kuralları: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), güvenlik bildirimi: [SECURITY.md](SECURITY.md).

## Özellikler
- Petek temalı açılış animasyonu ve açılış sesi (arı vızıltısıyla)
- Netflix, YouTube, Prime Video, Spotify marka logoları (Simple Icons, CC0), Disney+ için elle çizilmiş işaret
- Hero alanı + raflar, odaklanan uygulamaya göre renk değiştiren arka plan
- Hero'da büyük marka ikonu ve içerik satırı: PC'de açık sekmenin başlığı ("Devam et"), yoksa son açılış
- Odak açılışta en son açılan uygulamada başlar; rafta ekran dışında kart varsa kenarda ok görünür
- Açılış animasyonu, uygulama açılış ekranı, yükleme sırasında iskelet kartlar
- **Arama** ("Ara" kartı; PC'de ana ekranda harf yazmak yeter): yazılanı seçilen uygulamada arar
- **Ekran klavyesi**: kumandayla yazı (Wi-Fi şifresi, kullanıcı adı, arama). Fiziksel klavye de yazar
- Bağlantı göstergesi ve bildirimi (internet kopunca / gelince)
- Ses efektleri (Web Audio ile üretilir, dosya yok), açma/kapama ve ses düzeyi
- beeOS ayarları paneli (Kırmızı tuş veya "beeOS" kartı); sıfırlama işlemleri onay ister
- Erişilebilirlik: büyük yazı, yüksek kontrast, tuş ipuçları (ilk açılışlarda / hep / gizli)
- Kart menüsü (OK'a basılı tut veya Yeşil tuş): sola/sağa/başa taşı, gizle
- Yüklü uygulamalar rafı (TV'den otomatik), TV'deki gerçek uygulama logoları
- Ekran koruyucu (panel izine karşı hareket eden saat): Saat, Petek, Renk akışı, Fotoğraflar (PC)
- 1-9 tuşları: ilk raftaki uygulamayı doğrudan açar
- Ayarlar kalıcı (localStorage)

## Yapı
- `appinfo.json`  webOS uygulama tanımı
- `index.html`, `css/style.css`  arayüz
- `js/config.js`  kartlar ve ikonlar (uygulama kimlikleri burada)
- `js/platform.js`  ortam algılama (TV / PC / tarayıcı) ve PC arka ucu çağrıları
- `js/store.js`  ayar saklama, `js/sound.js`  ses efektleri, `js/app.js`  mantık
- `js/logos.js`  marka logoları (`tools/build_logos.py` ile üretilir)
- `logos/`  isteğe bağlı kendi logo PNG'lerin (bkz. `logos/BENIOKU.txt`)
- `tools/make_icons.py`  beeOS uygulama ikonu üretici

## Tarayıcıda test
```
python -m http.server 8080
```
- `http://localhost:8080`  normal
- `http://localhost:8080/?mock`  örnek "Tüm Uygulamalar" rafıyla
- `http://localhost:8080/?pc`  PC (flash disk) modu, sahte Wi-Fi/güç cevaplarıyla
- Tuşlar: oklar, Enter (basılı tut = menü), Esc = geri, F1 = ayarlar, F2 = kart menüsü

## TV'ye yükleme (webOS CLI: `npm i -g @webos-tools/cli`)
```
ares-setup-device            # TV'yi ekle (ad: tv, IP, port 9922, kullanıcı prisoner)
ares-package .               # .ipk üretir
ares-install --device tv com.beeuptech.beeos_<sürüm>_all.ipk   # sürüm: appinfo.json
ares-launch  --device tv com.beeuptech.beeos
ares-inspect --device tv com.beeuptech.beeos --open   # hata ayıklama
```

## Notlar
- Uygulama kimlikleri modele göre değişebilir: `ares-launch --device tv --running` ile kontrol et.
- Zayıf TV'de kasma olursa: Ayarlar > Animasyonlar ve Arka plan ışığı kapatılabilir.
- Tüm Uygulamalar rafı ve TV logoları `listApps` servisine bağlı; izin verilmezse raf görünmez, launcher normal çalışır.

## Flash disk (PC) sürümü
Debian 13 + sway (kiosk) + Google Chrome. Açılışta masaüstü yok, doğrudan tam ekran beeOS gelir.
Kartlar web sürümlerini açar (YouTube TV arayüzü, Netflix, Prime, Disney+, Spotify).
**Home**, **Windows** veya **F12** tuşu açık uygulamadan beeOS'a döner.
PC'de ek kartlar: **Wi-Fi** (ağ seç, şifre gir), **Güç** (kapat, yeniden başlat, açık uygulamaları kapat)
ve **Telefon** (telefon kumandası).
Ayarlar panelindeki **Bağlantılar** bölümü: Wi-Fi, **Bluetooth** (aç/kapat, cihaz ara, şifresiz eşleştir ve bağlan,
bağlantıyı kes, unut; `bluetoothctl`) ve telefon kumandası. TV'de bu satır TV'nin kendi ağ ayarlarını açar.

- Açılış: GRUB menüsü gizli (açılırken **Esc** menüyü ve güvenli modu gösterir), çekirdek yazıları yerine
  beeOS açılış ekranı (plymouth, `os/overlay/usr/share/plymouth/themes/beeos`, logo `tools/make_icons.py` ile).
- Uygulamalar arka planda açılır; sayfa yüklenene kadar beeOS'un yükleme ekranı görünür, Geri ile vazgeçilir.
- **Telefon kumandası**: telefon aynı ağdayken `http://<PC'nin IP'si>:8081` adresini açar, TV'deki
  **Telefon** kartında görünen 6 haneli PIN'i girer. Yön tuşları, OK, Geri, beeOS'a dön, ses, oynat/duraklat,
  yazı gönderme (telefon klavyesinin mikrofonuyla sesle yazma). PIN `/var/lib/beeos/remote.json`'da durur;
  10 hatalı denemede 5 dk kilitlenir. Kart üzerinden kapatılabilir, yeni PIN üretilebilir.
- **Fotoğraflı ekran koruyucu**: flash diskin `BEEOS-LOG` bölümündeki `Fotograflar` klasörü (Windows'ta açılır,
  bölüm 64 MB) veya `/home/bee/Resimler`.

- `os/backend/beeos_server.py`  arka uç: arayüzü sunar, Chrome sekmelerini (DevTools, 127.0.0.1:9222) yönetir,
  Wi-Fi (nmcli), güç, bağlantı durumu, fotoğraflar, telefon kumandası (8081)
- `os/backend/remote.html`  telefon kumandası sayfası
- `os/overlay/`  sisteme olduğu gibi kopyalanan dosyalar (otomatik giriş, sway, Chrome politikaları, servisler)
- `os/build.sh`  imaj üretimi (Docker içinde): Secure Boot uyumlu (shim + imzalı GRUB), GPT, ext4

```
.\os\build.ps1                 # build\beeos.img üretir (Docker Desktop; ilk sefer ~15 dk)
.\os\vm.ps1 start              # imajı sanal makinede aç (QEMU, Secure Boot, USB bellek olarak)
.\os\vm.ps1 shot acilis        # ekran görüntüsü -> build\vm-acilis.png
.\os\vm.ps1 stop
.\os\write-usb.ps1             # takılı USB diskleri listeler
.\os\write-usb.ps1 -Disk 2     # imajı 2 numaralı flash diske yazar (yönetici; diskteki her şey silinir)
```
- Flash disk: en az 8 GB, USB 3.0 önerilir. İlk açılışta sistem bölümü diskin tamamına büyütülür.
- Açılış: HP'de açılırken **F9** > flash disk. Secure Boot açık kalabilir.
- TV'ye HDMI bağlıyken laptop ekranı kapanır; kapak kapalıyken de çalışmaya devam eder.
- Netflix Linux'ta tarayıcıda en fazla 720p oynatır.

### VirtualBox'ta deneme
Her değişiklikte flash diske yazıp bilgisayarı açmak yerine VirtualBox kullanılır (`winget install Oracle.VirtualBox`).
```
.\os\vbox.ps1 build            # imajı derle, VM diskine çevir ve VM'i aç (tek komut)
.\os\vbox.ps1                  # son imajla VM'i aç (imaj değiştiyse disk yenilenir)
.\os\vbox.ps1 reset            # diski imajdan sıfırla (ayarlar silinir)
.\os\vbox.ps1 shot ana         # ekran görüntüsü -> build\vbox-ana.png
.\os\vbox.ps1 key f1 down ret  # tuş gönder
.\os\vbox.ps1 powerdown        # kapat;  .\os\vbox.ps1 logs  BEEOS-LOG günlükleri
```
- VM: EFI, 4 GB RAM, 4 çekirdek, SATA disk (`build\vm\`). Telefon kumandası bilgisayardan `http://127.0.0.1:18081`.
- VirtualBox Hyper-V (Docker Desktop) ile birlikte çalışırken yavaştır; `key` ile gönderilen tuşlar gecikebilir.
  Otomatik denemede telefon kumandası API'si daha güvenilir:
  `curl -X POST -H "X-BeeOS-PIN: <PIN>" -d '{"key":"down","n":6}' http://127.0.0.1:18081/api/key`
- `-Headless` pencere açmadan çalıştırır. `os/vm.ps1` (Docker içinde QEMU, Secure Boot) da hâlâ kullanılabilir.

### Sürümler ve güncelleme
- Sürüm numarasının tek kaynağı `appinfo.json`. Arka uç ve arayüz oradan okur.
- Release: `python tools/release.py bump X.Y.Z`, commit, `python tools/release.py tag`, etiketi push et.
  GitHub Actions `beeos-update-X.Y.Z.tar.gz` (arayüz `web/`, `/opt/beeos/bin` dosyaları `bin/`, diğer sistem
  dosyaları `overlay/`) ve `.sha256` dosyasını Release'e ekler.
- Cihazda **Ayarlar > Sistem > Güncellemeleri kontrol et**: arka uç GitHub Releases API'den son sürümü sorar,
  paketi indirir, SHA-256 ile doğrular, `/opt/beeos/web` ve `/opt/beeos/bin` klasörlerini yenisiyle değiştirir
  (eskisi `.prev` olarak kalır), sonra arka ucu ve Chrome'u yeniden açar. Çekirdek, Chrome ve Debian paketleri
  bu yolla güncellenmez; onlar için yeni imaj gerekir.
- VM'de deneme (GitHub'a yayınlamadan):
  ```
  .\os\vbox.ps1 build -UpdateApi http://10.0.2.2:8000/latest.json   # bu sürümle imaj
  python tools/release.py bump 0.5.0                                 # sürümü yükselt
  python tools/release.py serve                                      # paketi ve sahte GitHub cevabını sun
  ```
  Kaynak `/etc/beeos/update.json` ile değişir: `{"api": "...", "token": "..."}` (token isteğe bağlı).

### Markalar
Netflix, YouTube, Prime Video, Disney+, Spotify ve diğer adlar/logolar sahiplerinin tescilli markalarıdır; beeOS bu
şirketlerle bağlantılı değildir. Logolar Simple Icons'tan (CC0) alınır, MIT lisansının kapsamında değildir.

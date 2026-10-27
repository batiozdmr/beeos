# beeOS

TV için hızlı, sade ana ekran. Saf HTML/CSS/JS (ES5), eski webOS ile uyumlu. İki şekilde çalışır:
- **LG webOS TV** uygulaması olarak (.ipk)
- **Flash diskten açılan sistem** olarak: PC'yi HDMI ile TV'ye bağla, flash diskle aç, doğrudan beeOS gelir
  (bkz. *Flash disk (PC) sürümü*)

## Özellikler
- Petek temalı açılış animasyonu ve açılış sesi (arı vızıltısıyla)
- Netflix, YouTube, Prime Video, Spotify marka logoları (Simple Icons, CC0)
- Hero alanı + raflar, odaklanan uygulamaya göre renk değiştiren arka plan
- Açılış animasyonu, uygulama açılış ekranı, yükleme sırasında iskelet kartlar
- Ses efektleri (Web Audio ile üretilir, dosya yok), açma/kapama ve ses düzeyi
- beeOS ayarları paneli (Kırmızı tuş veya "beeOS" kartı)
- Kart menüsü (OK'a basılı tut veya Yeşil tuş): sola/sağa/başa taşı, gizle
- Yüklü uygulamalar rafı (TV'den otomatik), TV'deki gerçek uygulama logoları
- Ekran koruyucu (panel izine karşı hareket eden saat)
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
ares-install --device tv com.beeuptech.beeos_0.4.0_all.ipk
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
PC'de ek kartlar: **Wi-Fi** (ağ seç, şifre gir) ve **Güç** (kapat, yeniden başlat, açık uygulamaları kapat).

- `os/backend/beeos_server.py`  arka uç: arayüzü sunar, Chrome sekmelerini (DevTools, 127.0.0.1:9222) yönetir, Wi-Fi (nmcli), güç
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

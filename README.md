# beeOS

LG webOS TV'ler için hızlı, sade ana ekran. Saf HTML/CSS/JS (ES5), eski webOS ile uyumlu.

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
- Tuşlar: oklar, Enter (basılı tut = menü), Esc = geri, F1 = ayarlar, F2 = kart menüsü

## TV'ye yükleme (webOS CLI: `npm i -g @webos-tools/cli`)
```
ares-setup-device            # TV'yi ekle (ad: tv, IP, port 9922, kullanıcı prisoner)
ares-package .               # .ipk üretir
ares-install --device tv com.ozdem.beeos_0.3.0_all.ipk
ares-launch  --device tv com.ozdem.beeos
ares-inspect --device tv com.ozdem.beeos --open   # hata ayıklama
```

## Notlar
- Uygulama kimlikleri modele göre değişebilir: `ares-launch --device tv --running` ile kontrol et.
- Zayıf TV'de kasma olursa: Ayarlar > Animasyonlar ve Arka plan ışığı kapatılabilir.
- Tüm Uygulamalar rafı ve TV logoları `listApps` servisine bağlı; izin verilmezse raf görünmez, launcher normal çalışır.

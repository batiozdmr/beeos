# beeOS'a katkı

Hata bildirimi, öneri ve pull request'ler açıktır. Katkıların MIT lisansıyla (bkz. `LICENSE`) yayınlanmasını kabul etmiş olursun.

## Kod düzeni
- Arayüz (`js/`) **ES5** yazılır: eski webOS (Chromium 38) da çalıştırır. `let`, `const`, ok fonksiyonu, `class` yok.
- Yorumlar ve arayüz metinleri Türkçedir. Çevredeki kodun düzenine uy; az ve gerekli yorum.
- Arka uç (`os/backend/beeos_server.py`) sadece Python standart kütüphanesini (+ `python3-websocket`) kullanır.
- Linux'ta çalışan dosyalar LF satır sonuyla kalır (`.gitattributes`).

## Deneme
- Arayüz: `python -m http.server 8080`, sonra `http://localhost:8080/?pc` (PC modu, sahte arka uç cevapları:
  `js/platform.js` içindeki `Mock`). Yeni bir arka uç çağrısı eklediysen `Mock`'a da sahte cevabını ekle.
- Sistem: `.\os\vbox.ps1 build` imajı derler ve VirtualBox'ta açar (bkz. README, *VirtualBox'ta deneme*).

## Sürüm çıkarma (bakımcılar)
Sürüm numarası yalnızca `appinfo.json`'da durur.
```
python tools/release.py bump 0.5.0
git commit -am "beeOS 0.5.0"
python tools/release.py tag
git push origin HEAD v0.5.0
```
Etiket push edilince GitHub Actions (`.github/workflows/release.yml`) güncelleme paketini üretip Release olarak
yayınlar; cihazlar onu **Ayarlar > Güncellemeleri kontrol et** ile bulur.

## Güvenlik
Güvenlik açıklarını herkese açık issue yerine GitHub'daki **Security > Report a vulnerability** ile bildir.

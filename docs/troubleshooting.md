# beeOS — Sorun giderme

Bu belge en sık karşılaşılan sorunları ve çözümlerini listeler. Yeni bir sorun mu? GitHub Issues'a
açın: <https://github.com/batiozdmr/beeos/issues>.

---

## Kumanda bağlantısı — "Güvenli değil" uyarısı

**Belirti**: Telefon tarayıcısında `https://192.168.1.10:8081` açtığınızda *"Bağlantı güvenli değil"*
ya da *"Bu sertifikaya güvenilmiyor"* uyarısı çıkıyor.

**Neden**: beeOS uzak kumanda için kendinden imzalı sertifika kullanır. Tarayıcı bunu bilmediği için
önceden güven veremez. Sertifika sizin TV'nizde yerelde üretilir, hiçbir yere gönderilmez.

**Çözüm**:
- **Android Chrome / Edge**: *Gelişmiş* → *beeos-remote adresini ziyaret et (güvenli değil)*.
- **iOS Safari**: *Ayrıntıları göster* → *Siteyi ziyaret et* → sertifika uyarısında *Devam Et*.
- Bir kez kabul etmek yeterlidir. Tarayıcı site ayarlarında istisnayı saklar.

Daha kapsamlı çözüm (önerilen değil): beeOS sertifikasını Android'de *Ayarlar → Güvenlik →
Sertifikalar* altına kurabilirsiniz, ama kullanıcı CA deposu bazı tarayıcılar tarafından itilir.

---

## Fare modu çalışmıyor

**Belirti**: Kumanda sayfasında *Fare* segmentine geçip dokunmatik yüzeyi kaydırınca TV'de hiçbir şey
olmuyor. Toast: *"Fare açılamadı (uinput)"* ya da *"uinput modülü yüklenemedi"*.

**Nedenler ve çözümler**:

1. **`uinput` çekirdek modülü yüklü değil.** beeOS 0.8.0+ ilk hata alınca `modprobe uinput`'u kendisi
   dener; başarısızsa:
   ```bash
   sudo modprobe uinput
   echo uinput | sudo tee /etc/modules-load.d/uinput.conf   # kalıcı yap
   ```
2. **`/dev/uinput` erişilemez** (toast *"Yetki yok"*). Arka uç `root` olarak çalışmalı (varsayılan,
   `systemd` birimi olarak). Manuel çalıştırıyorsanız `sudo` ile deneyin.
3. **Chrome'un oynatıcı penceresi odakta değil**. Chrome'un ağır bir sayfasında (Netflix tam ekran)
   fare olayları bazen tüketilmiyor — ekrana bir kez dokunup fareyi hareket ettirin.

Kontrol:
```bash
ls -la /dev/uinput           # crw------- root root olmalı
lsmod | grep uinput           # yüklü olmalı
sudo cat /sys/kernel/debug/input/devices | grep -A5 "beeOS telefon touchpad"
```

---

## Ekran yansıtma başlamıyor

**Belirti**: *Yansıt* düğmesine basınca *"Bu tarayıcıda ekran paylaşımı yok"* ya da
*"Başlatılamadı: NotSupportedError"*.

**Nedenler**:

1. **iOS Safari**: `getDisplayMedia` API'si iOS'ta desteklenmiyor. Android Chrome / Edge / Firefox
   kullanın.
2. **HTTP üzerinden açtınız** (HTTPS değil). `getDisplayMedia` yalnız *secure context*'te çalışır.
   Adres `https://...` ile başlamalı. Arka uç HTTPS başlatamamışsa logda *"UYARI: kumanda HTTP"*
   görünür — sertifika üretilemiyor demektir, `openssl` yüklü mü kontrol edin.
3. **Kurumsal / okul Wi-Fi'si**: bazı ağlar WebRTC ICE'yi engeller. Yerel ağ olmasına dikkat.

Belirti: *"TV'de izin bekleniyor…"* yazısı 60 sn kalıp *"Zaman aşımı — TV'de izin verilmedi"* çıkıyor
→ TV ekranında onay bildirimi çıkmamış demektir. beeOS arayüzü açık mı? *Ayarlar → Kumanda* altında
cihaz listesinde telefonunuz var mı? Yoksa oturum geçersiz, kumandayı ayırıp tekrar eşleştirin.

---

## TV sertifikayı kabul etmiyor / eski sertifika hatası

**Belirti**: Daha önce çalışan kumandayı açmaya çalışınca *"NET::ERR_CERT_AUTHORITY_INVALID"* ya da
*"Sertifika süresi doldu"*.

**Neden**: PC'nin IP'si değişti ve sertifika yenilendi; eski istisnayı tarayıcı hâlâ tutuyor.

**Çözüm**:
- Chrome / Edge: *Ayarlar → Gizlilik ve güvenlik → Site Ayarları → `192.168.X.X`:8081 için verileri
  temizle* (ya da *Tarama verilerini temizle* → *Çerezler ve site verileri* → Saat aralığı: *Son 1
  saat*).
- Safari: *Ayarlar → Safari → Gelişmiş → Web Sitesi Verileri → `192.168.X.X` kaydını sil*.
- Sonra kumanda adresini yeniden açın, "Devam Et" diyin.

PC tarafında sertifikayı el ile yenilemek isterseniz:
```bash
sudo rm /var/lib/beeos/remote-cert.pem /var/lib/beeos/remote-key.pem
sudo systemctl restart beeos-backend
```

---

## Chrome önbellek sorunu — güncelleme sonrası eski arayüz

**Belirti**: Güncelleme kuruldu, yeniden başlatıldı ama hâlâ eski arayüz / eski özellikler görünüyor.

**Geçmiş**: 0.5.3 sürümünde arka uç `If-Modified-Since` başlığını atıyordu (commit `7d53d3d`),
böylece Chrome her istekte dosyayı yeniden alıyordu. 0.8.0'da bu ETag ile değiştirildi: dosya
değişmediyse 304, değiştiyse 200 + yeni içerik.

**Çözümler**:
1. Telefon kumandası veya klavyeden **F5** ile sayfayı yenileyin.
2. Çözülmezse Chrome'u tamamen kapatın:
   ```bash
   pkill -u bee chrome
   # birkaç saniye bekleyip
   systemctl restart beeos-browser
   ```
3. Hâlâ sorun varsa Chrome'un profilindeki `Cache` klasörünü silin:
   ```bash
   rm -rf /tmp/beeos-chrome/Default/Cache
   systemctl restart beeos-browser
   ```
   (beeOS Chrome profilini RAM'de tutar; reboot zaten temizler.)

---

## Güncelleme indirilmiyor

**Belirti**: *Ayarlar → Sistem → Güncellemeleri kontrol et* basıldığında *"GitHub'a ulaşılamadı"*
ya da *"Henüz yayınlanmış sürüm yok"*.

**Nedenler ve çözümler**:

1. **İnternet yok**. Üst şeritteki bağlantı göstergesi kırmızıysa önce Wi-Fi'ya bağlanın.
2. **GitHub 404** (depo gizli): `/etc/beeos/update.json` yoksa varsayılan API
   `https://api.github.com/repos/batiozdmr/beeos/releases/latest` kullanılır. Gizli depo
   kullanıyorsanız:
   ```json
   {
     "api": "https://api.github.com/repos/<kullanıcı>/<depo>/releases/latest",
     "token": "ghp_xxx"
   }
   ```
   `/etc/beeos/update.json` olarak yazın (0600, root).
3. **Deneme sunucusu**:
   ```powershell
   .\os\vbox.ps1 build -UpdateApi http://10.0.2.2:8000/latest.json
   python tools/release.py bump 0.8.1
   python tools/release.py serve
   ```
4. **İmza hatası** (*"Paket imzalı değil — reddedildi"* veya *"İmza doğrulanamadı"*): 0.8.0+'da
   `/etc/beeos/update.pub` varsa imzasız paket reddedilir. GitHub Release'e
   `.minisig` dosyası eklenmiş mi kontrol edin; yoksa `release.yml`'de minisign adımı başarısız
   olmuş demektir.
5. **Sağlama toplamı tutmuyor**: paket yeniden indirilsin diye `/var/lib/beeos/update/` klasörünü silin:
   ```bash
   sudo rm -rf /var/lib/beeos/update
   ```

Loglar: `journalctl -u beeos-backend -n 100` içinde *"güncelleme kontrolü:"* ya da
*"güncelleme hatası:"* satırları.

---

## Telefon kumandası bağlanamıyor (PIN sürekli yanlış)

**Belirti**: PIN'i doğru giriyorsunuz ama *"PIN yanlış"* diyor; sonra *"Çok fazla hatalı PIN. Birkaç
dakika bekle."* kilidi geliyor.

**Nedenler**:

1. **TV'deki PIN yenilenmiş**: *Telefon* kartında *Yeni PIN* düğmesine basmış olabilirsiniz, eski
   PIN'i kullanıyorsunuz. Kartta görünen yeni PIN'i girin.
2. **Oturum sayısı doldu** (max 4). TV'de *Ayarlar → Kumanda → Aktif cihazlar* listesinden eski
   cihazları çıkarın.
3. **Sağdan solda yazılan PIN** (iOS QWERTY): tarayıcı yakın oto-tamamlama ile başka bir sayı
   gönderiyor olabilir. Sayıları tek tek elle girin, otomatik doldurma kapatın.

Kilidi erken açmak için:
```bash
sudo systemctl restart beeos-backend
```

---

## VirtualBox'ta telefon kumandası görünmüyor

**Belirti**: `vbox.ps1 build` ile VM açtınız, telefondan `https://192.168.1.10:8081` açılmıyor.

**Nedenler**:

1. VM'in ağ kartı **NAT** değil, **Bridged** olmalı. `vbox.ps1 0.7.0+` artık bunu otomatik yapıyor
   ama eski VM'de kontrol edin (*Ayarlar → Ağ → Attached to: Bridged Adapter*).
2. VM'in IP'si DHCP'den alınmış olmalı. VM konsolunda `ip -4 a` ile kontrol edin;
   `192.168.X.X` değil `10.0.2.X` ise hâlâ NAT'tasınız.
3. Windows güvenlik duvarı 8081 portunu engelliyor olabilir.

---

## "Alıcı sayfası açılamadı" (ekran yansıtma)

**Belirti**: Telefon offer gönderiyor, TV'de bildirim çıkıyor, *İzin ver*'e basınca *"Alıcı sayfası
açılamadı"*.

**Neden**: Chrome DevTools (127.0.0.1:9222) cevap vermiyor — Chrome donmuş ya da reboot sonrası tam
hazır değil.

**Çözüm**:
```bash
curl -s http://127.0.0.1:9222/json/version   # Chrome yanıt veriyor mu?
systemctl restart beeos-browser
```

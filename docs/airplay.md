# AirPlay (iPhone / iPad / Mac)

beeOS 0.10+ **UxPlay** üzerinden AirPlay 2 alıcısı sunar: iPhone/iPad/Mac'ten doğrudan
"Ekran Yansıt" ile beeOS ekranına görüntü + ses akışı gönderebilirsin. Kendi telefon
kumandası + Yansıt butonumuza ektir; iOS'ta (Safari `getDisplayMedia` desteklemediği
için) bu tek yoldur.

## Kullanım

1. iPhone/iPad'de **Kontrol Merkezi**'ni aç (sağ üst köşeden kaydır).
2. **Ekran Yansıt** (ikiz dikdörtgen simgesi).
3. Listede **beeOS** görünür — dokun.
4. Birkaç saniye sonra telefonunun görüntüsü TV'de tam ekran açılır.
5. Durdurmak için aynı menüden **Yansıtmayı durdur**.

Mac için: **Kontrol Merkezi → Ekran Yansıt → beeOS**.

## Gereksinimler

- Telefon / Mac beeOS'la **aynı yerel ağda** olmalı (Bonjour/mDNS → avahi-daemon).
- UxPlay paketi (`apt install uxplay`; sistem imajında hazır). Debian trixie'de
  main'de yer alır; yoksa `gstreamer1.0-plugins-good`, `-bad`, `-libav` +
  `gst-rtsp-server-1.0` bağımlılıklarıyla gelir.
- AirPlay 2 mirroring: iOS 11.4+ / macOS 11+.

## Güvenlik notu

Varsayılanda **eşleşme PIN'i kapalı** — aynı ağdaki herkes beeOS'a yayın yapabilir.
Ev ağında bu makul; kafe / otel gibi paylaşımlı ağda aç:

```
sudo sed -i 's/-async$/-async -pin=1234/' /etc/systemd/system/beeos-airplay.service
sudo systemctl daemon-reload && sudo systemctl restart beeos-airplay
```

(`1234` yerine 4 haneli PIN yaz — telefon ilk bağlantıda sorar.)

## Alıcı adını değiştir

```
sudo sed -i 's/AIRPLAY_NAME=beeOS/AIRPLAY_NAME=Salon-TV/' /etc/beeos/airplay.env
sudo systemctl restart beeos-airplay
```

## Sorun giderme

- **Listede görünmüyor**: `systemctl status avahi-daemon beeos-airplay`. Firewall
  5353/UDP (mDNS) ve 7000/TCP (RAOP) açık mı?
- **Bağlanıyor ama görüntü siyah**: UxPlay sway oturumu hazır olmadan başlamış olabilir.
  `journalctl -u beeos-airplay` → "wayland-0" uyarısı varsa servisi elle restart et.
- **Ses yok**: PipeWire sink'ini kontrol et: `wpctl status`. UxPlay varsayılan sink'e
  ses verir; HDMI sink seçili değilse laptop hoparlörüne gider.
- **Kesintiler**: Wi-Fi 5 GHz'e geç (2.4 GHz AirPlay için dar). Kalite düşer ama koparsa
  router'a yakınlaş.
- **"Could not create RSA key"**: /var/lib/uxplay yazma izni eksik; bee kullanıcısı
  home'una fallback eder (`/home/bee/.uxplay`).

## UxPlay vs beeOS'un kendi Yansıtı

| Özellik | UxPlay (AirPlay) | beeOS Yansıt (WebRTC) |
|---------|------------------|------------------------|
| Cihaz | iPhone/iPad/Mac | Android Chrome (iOS Safari desteklemez) |
| Onay akışı | PIN opsiyonel | Her yansıtmada TV'de "İzin ver" |
| Ses | Evet | Opsiyonel |
| Gecikme | ~100-200 ms | ~200-400 ms |
| Sertifika | AirPlay (Apple) | HTTPS self-signed |

İkisi aynı anda çalışabilir — ayrı portlar.

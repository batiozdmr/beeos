# Gözlenebilirlik

## Arka uç log'u (yapılandırılmış)
`os/backend/beeos_server.py` içindeki `log()` fonksiyonunu JSON'a çevir:
```python
def log(*parts, **kw):
    rec = {"t": datetime.utcnow().isoformat() + "Z", "lvl": kw.get("lvl", "info"), "msg": " ".join(str(p) for p in parts)}
    rec.update({k: v for k, v in kw.items() if k != "lvl"})
    sys.stderr.write(json.dumps(rec, ensure_ascii=False) + "\n")
```
systemd günlüğünden `journalctl -u beeos-backend -o cat | jq .` ile sorgulanır.

## Arayüz log'u
`js/log.js` → ring buffer (son 500 satır), opt-in `/api/log` ile arka uca gönderim.
Ayarlar > Gelişmiş > "Tanıyı gönder" düğmesi `telemetry` anahtarını açar.

## Tanı ekranı (Ayarlar > Sistem > Tanı)
Göstereceği bilgiler:
- Sürüm, kurulum tarihi, son güncelleme
- Ağ: SSID, IP, gecikme (`/api/ping`), DNS
- Disk: `/opt/beeos`, `/var/log`, `BEEOS-LOG` kullanımı
- Proxy: son 10 `/api/tv/proxy` isteği, durum kodu, ms
- Son 50 UI log satırı (JSON)
- "QR kod ile dışa aktar" düğmesi → `data:text/plain;base64,...` biçiminde QR, telefonla okunur

## Opt-in telemetri
Hiçbir şey otomatik gönderilmez. Kullanıcı açarsa:
- Başlatma süresi (açılış → ilk kart odağı)
- Günlük çökme sayısı
- Aktif kart (hero'daki uygulama) — kullanıcı adı, PII yok
- Sürüm, dil, platform (pc/tv)

Gönderim adresi: `/api/log` — arka uç yerel diske yazar; harici sunucuya gönderim yok
(ileri sürümde opsiyonel endpoint için ayrı onay).

# beeOS — HTTP API

Arka uç iki ayrı sunucu açar:

| Sunucu | Adres | Bind | Kullanım |
|---|---|---|---|
| **Arayüz API'si** | `http://127.0.0.1:8080` | yalnız loopback | beeOS arayüzü (Chrome) ve `mirror.html` |
| **Kumanda API'si** | `https://0.0.0.0:8081` | tüm arayüzler | Telefon kumandası (yerel ağ) |

Kimlik doğrulama tipleri:

| Kısaltma | Nasıl | Nerede |
|---|---|---|
| `X-BeeOS: 1` | sabit başlık; CSRF'ye karşı | Arayüz API'si (zorunlu; ayrıca Host `127.0.0.1:8080` olmalı) |
| `PIN` | `X-BeeOS-PIN: <6 hane>` | Kumanda API'si, ilk eşleşme |
| `Session HMAC` | `X-BeeOS-Session` + `X-BeeOS-Sig` + `X-BeeOS-Nonce` (HMAC-SHA256 secret, msg) | Kumanda API'si, eşleşme sonrası |
| `Mirror Token` | `X-BeeOS-Mirror: <token>` (mirror_start cevabından) | Yansıtma sinyali (role=offerer) |

> **Not**: `/api/cursor` ve `/api/mirror/start` **oturum zorunlu** — PIN tek başına yetmez (0.8.0+).

İstek gövdesi (POST): JSON (`application/json`). Yanıt: `{"ok": true, ...}` veya
`{"ok": false, "error": "<kısa Türkçe mesaj>"}`. HTTP durum kodu başarı için 200; kimlik/izin için
401 / 403; hız kilidinde 429; yol yoksa 404.

---

## Arayüz API'si (`127.0.0.1:8080`)

Hepsi `X-BeeOS: 1` + Host `127.0.0.1:8080` ister. Başarısızlık: 403 `forbidden`.

### Teşhis / Durum

| Method | Path | Body | Yanıt |
|---|---|---|---|
| GET | `/api/info` | — | `{platform: "pc", version}` |
| GET | `/api/status` | — | `{online, name, remoteSeq, mirror, mirrorState}` |
| GET | `/api/diag` | — | `{net, disk, update, proxy}` |
| POST | `/api/log` | `{events: [...]}` | `{ok}` — opt-in UI log |

### Uygulamalar

| Method | Path | Body | Yanıt |
|---|---|---|---|
| POST | `/api/launch` | `{id, url, ua?, nav?}` | `{ok, resumed?, cancelled?, error?}` |
| POST | `/api/launch/cancel` | `{id}` | `{ok}` |
| GET | `/api/apps/open` | — | `{apps: {id: title}}` |
| POST | `/api/home` | — | `{ok}` |
| POST | `/api/apps/close` | — | `{closed}` |
| POST | `/api/power` | `{action: "off"\|"reboot"}` | `{ok}` |

### Ağ

| Method | Path | Body | Yanıt |
|---|---|---|---|
| GET | `/api/wifi` | — | `{enabled, current, networks[]}` |
| POST | `/api/wifi/connect` | `{ssid, password?}` | `{ok, error?}` |
| GET | `/api/bt` | — | `{powered, devices[]}` |
| POST | `/api/bt/power` | `{on: bool}` | `{powered, ...}` |
| POST | `/api/bt/scan` | — | aynı |
| POST | `/api/bt/connect`<br>`/api/bt/disconnect`<br>`/api/bt/remove` | `{mac}` | `{ok, ...}` |

### Ekran (sway çıkışları)

| Method | Path | Body | Yanıt |
|---|---|---|---|
| GET | `/api/display` | — | `{outputs[], failed?, confirm?}` |
| POST | `/api/display/use` | `{name}` | `{ok, confirm?, restarting?}` |
| POST | `/api/display/keep` | — | `{ok}` |
| POST | `/api/display/revert` | — | `{ok}` |

### Medya / Fotoğraflar / Volume

| Method | Path | Body | Yanıt |
|---|---|---|---|
| POST | `/api/volume` | `{action: "volup"\|"voldown"\|"mute"}` | `{volume}` |
| GET | `/api/photos` | — | `{photos: ["/photos/0", ...]}` |

### Kumanda yönetimi (TV tarafından)

| Method | Path | Body | Yanıt |
|---|---|---|---|
| GET | `/api/remote` | — | `{enabled, pin, urls, fingerprint, sessions[]}` |
| POST | `/api/remote` | `{enabled?, newPin?, forgetAll?, forget?}` | aynı |
| POST | `/api/remote/wait` | `{apps: [...]}` | uzun poll (25 sn) — `{cmds[]}` |

### Güncelleme

| Method | Path | Body | Yanıt |
|---|---|---|---|
| GET | `/api/update` | — | `{current, state, progress, error, rollback, latest?, available?, notes?, size?}` |
| POST | `/api/update/check` | — | aynı |
| POST | `/api/update/install` | — | aynı — asenkron |
| POST | `/api/update/rollback` | — | aynı |

### TV proxy (canlı yayın)

| Method | Path | Query | Yanıt |
|---|---|---|---|
| GET | `/api/tv/proxy` | `u=<url>`, `raw?=1` | stream (M3U8 yeniden yazılır); headers: `X-BeeOS-Cache: hit\|stale` |

### Ekran yansıtma (arayüz + mirror.html tarafı)

| Method | Path | Body | Yanıt |
|---|---|---|---|
| GET | `/api/mirror/pending` | — | `{pending: {device, ts}\|null, state}` |
| POST | `/api/mirror/approve` | `{accept: bool}` | `{ok, rejected?}` — açar/vazgeçer |
| POST | `/api/mirror/signal` | `{role: "answerer", sdp?, ice?}` | `{sdp, ice}` — answerer polling |
| POST | `/api/mirror/stop` | — | `{ok}` |

### Sistem — uyku / saat

| Method | Path | Body | Yanıt |
|---|---|---|---|
| GET | `/api/sleep` | — | `{left, action}` |
| POST | `/api/sleep` | `{minutes, action?: "off"\|"closeapps"}` | aynı |
| POST | `/api/time` | `{time: "YYYY-MM-DD HH:MM[:SS]"}` | `{ok, error?}` — ağ saatini kapatıp ayarlar |

### Arayüz durumu ve yedek

| Method | Path | Body | Yanıt |
|---|---|---|---|
| GET | `/api/uistate` | — | `{state: {settings, profiles, active} \| null}` |
| POST | `/api/uistate` | `{state}` | `{ok}` — arayüz her ayar değişikliğinde (2 sn gecikmeli) yazar |
| POST | `/api/uistate/restored` | — | `{ok}` — geri yükleme uygulandı, `restore` bayrağı iner |
| GET | `/api/backup` | — | `{backup: {app, version, ts, data: {ui}}}` — PIN ve oturum anahtarı içermez |
| POST | `/api/backup` | `{data: <backup>}` | `{ok, restored}` — arayüz `/api/status` `restore:true` görünce yenilenir |
| GET | `/api/notifications` | — | `{unread, items}` |
| POST | `/api/notifications/seen` · `/clear` | `{id?}` | `{ok}` |

---

## Kumanda API'si (`0.0.0.0:8081`, HTTPS)

Her istek PIN veya oturum imzası ister. PIN başarısız 10 kez → 5 dk kilit (sonra 15 dk, sonra 1 saat).

### Eşleşme

| Method | Path | Body | Yanıt |
|---|---|---|---|
| POST | `/api/pair` | `{name: "cihaz etiketi"}` | PIN ile ilk kez: `{session, secret}` (saklanır, bir daha ağa gitmez). Oturumla: `{ok}` (yoklama; `remoteSeq`'i artırır). |

### Kumanda tuşları

| Method | Path | Body | Yanıt |
|---|---|---|---|
| POST | `/api/key` | `{key, n?}` | `{ok}` — `key`: up/down/left/right/ok/back/playpause/next/prev/backspace/settings/menu/home/volup/voldown/mute |
| POST | `/api/text` | `{text}` | `{ok}` — `wtype --` ile; Cc/Cf/Co/Cs kategorisi filtrelenir |
| POST | `/api/volume` | `{level: 0-100}` | `{volume}` |
| POST | `/api/power` | `{action: "off"\|"reboot"\|"closeapps"}` | `{ok}` |
| POST | `/api/state` | — | `{version, apps, open, volume, online, network}` |
| POST | `/api/launch` | `{id, q?}` | `{ok, error?}` — arama varsa `q` |

### Fare (oturum zorunlu — PIN tek başına 401)

| Method | Path | Body | Yanıt |
|---|---|---|---|
| POST | `/api/cursor` | `{dx?, dy?, wheel?, click?: "left"\|"right"\|"middle", down?, up?}` | `{ok, error?}` |

### Yansıtma (oturum zorunlu)

| Method | Path | Body | Yanıt |
|---|---|---|---|
| POST | `/api/mirror/start` | `{sdp: "<offer JSON string>"}` | `{token, pending: true}` → TV onayı bekle |
| POST | `/api/mirror/signal` | `{role: "offerer", sdp?, ice?}` + `X-BeeOS-Mirror: <token>` | `{sdp, ice}` — offerer polling |
| POST | `/api/mirror/stop` | — | `{ok}` |

### Sistem sayfası (telefon)

Hepsi POST; gövde boşsa okuma yapar.

| Path | Body | Yanıt |
|---|---|---|
| `/api/sleep` | `{}` okur · `{minutes, action?}` ayarlar | `{left, action}` |
| `/api/time` | `{time}` | `{ok, error?}` |
| `/api/backup` | `{}` dışa aktarır · `{data}` geri yükler | `{backup}` / `{ok, restored}` |
| `/api/notifications` · `/seen` · `/clear` | `{id?}` | `{unread, items}` / `{ok}` |

TV'deki QR kodu `https://<ip>:8081/#pin=<PIN>&fp=<parmak izi>` adresini taşır. `#` sonrası sunucuya
gönderilmez; telefon PIN'i buradan okuyup kendiliğinden eşleşir, sonra adres çubuğundan siler.

---

## HMAC oturum imzası nasıl

```
msg = method + "\n" + path + "\n" + nonce + "\n" + body_bytes
sig = hex(HMAC-SHA256(secret, msg))
Headers:
  X-BeeOS-Session: <sid, 32 hex>
  X-BeeOS-Sig:     <sig, 64 hex>
  X-BeeOS-Nonce:   <nonce, 8-64 [0-9a-zA-Z_-]>
```

- `secret`: `/api/pair` cevabında dönen `secret` (32 bayt, hex). Sakla; bir daha dönmez.
- `nonce`: her istekte farklı (replay engeli); backend 5 dk tutar.
- `method` ve `path` tam olarak isteğin kendisi; `body_bytes` gönderilen ham UTF-8.

## Mirror token nasıl

- `mirror_start` ilk çağrıda `token` üretir (24 bayt base64url).
- Sonraki her `mirror/signal` isteğinde `X-BeeOS-Mirror: <token>` gönder. Telefon (offerer) bu token'ı,
  TV'deki `mirror.html` (answerer) ise onay sonrası adresine (`?tok=`) yazılan ayrı bir token'ı kullanır.
- Oturum bittiğinde (`/api/mirror/stop` veya 60 sn boşluk) token geçersiz.

## Hata kodları

| HTTP | Anlam |
|---|---|
| 401 | Oturum/PIN gerekli veya geçersiz |
| 403 | `X-BeeOS: 1` yok, Host yanlış, kumanda kapalı, mirror token tutmuyor |
| 404 | Yol yok |
| 405 | GET/POST desteklenmiyor |
| 429 | Çok fazla PIN hatası (kilit) |

## Değişiklikler (0.8.0)

- Yeni: `/api/mirror/pending`, `/api/mirror/approve`, `/api/sleep` (GET/POST), `/api/time`.
- `/api/cursor` ve `/api/mirror/start`: **oturum zorunlu**.
- `/api/mirror/signal`: role=offerer artık `X-BeeOS-Mirror` token ister.
- `/api/remote` cevabına `fingerprint` (SHA-256 base64url) eklendi.
- `/api/status` cevabına `mirror` ve `mirrorState` eklendi.

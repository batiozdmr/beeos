# Logo kaynakları

Her logo için: dosya, kaynak, lisans, son güncelleme. `tools/build_logos.py` bu listeden `js/logos.js`
içine PNG → base64 gömmesi üretir.

| Dosya | Marka | Kaynak | Lisans | Notlar |
|---|---|---|---|---|
| `logos/netflix.png` | Netflix | [Simple Icons](https://simpleicons.org/?q=netflix) | CC0 1.0 | Marka sahibi: Netflix, Inc. |
| `logos/youtube.png` | YouTube | Simple Icons | CC0 1.0 | Marka sahibi: Google LLC |
| `logos/primevideo.png` | Prime Video | Simple Icons | CC0 1.0 | Marka sahibi: Amazon.com, Inc. |
| `logos/spotify.png` | Spotify | Simple Icons | CC0 1.0 | Marka sahibi: Spotify AB |
| `logos/disneyplus.png` | Disney+ | Elle çizilmiş (beeOS) | **belirsiz** | Simple Icons kataloğunda yok; marka sahibinden geri bildirim gelirse `TRADEMARKS.md` akışı uygulanır |

## Logo güncelleme
```
# Yeni kaynak PNG'leri logos/ klasörüne koy (256x256 önerilir, siyah üstüne saydam arkaplanlı)
python tools/build_logos.py
# js/logos.js yenilenir; commit et
```

## Redaction (takedown)
```
python tools/build_logos.py --redact disneyplus
# logos/disneyplus.png -> logos/placeholder.png kopyalanır, js/logos.js yeniden üretilir
```

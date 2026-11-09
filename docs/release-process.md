# Sürüm süreci

Tek gerçek kaynak: `appinfo.json#version`. Arka uç, arayüz ve release araçları oradan okur.

## Semver politikası
- **PATCH** (0.7.**1**) — güvenlik düzeltmesi, kanal URL güncellemesi, hata düzeltmesi.
  İmaj güncellemesi **gerekmez** — `tools/release.py` paketi `beeos-update-X.Y.Z.tar.gz` yeterli.
- **MINOR** (0.**8**.0) — yeni özellik, geriye dönük uyumlu. İmaj gerekmez.
- **MAJOR** (**1**.0.0) — kırıcı değişiklik, çekirdek/Chrome/Debian geçişi. **Yeni imaj gerekir**;
  release notu "Yeni imaj gerekiyor" başlığıyla başlar.

## Dallar
- `main` — bir sonraki minor'ün geliştirmesi
- `release/0.N` — yayımlanmış minor için LTS dalı, **6 ay** güvenlik destek penceresi
- `hotfix/<konu>` — açık bir güvenlik veya üretim hatası için kısa ömürlü dal

## Hotfix akışı
1. En son yayımlanmış `release/0.N` dalından aç:
   ```
   git switch -c hotfix/kanald-url release/0.7
   ```
2. Düzeltmeyi uygula, test et
3. `python tools/release.py bump 0.7.1` → PR aç → merge → tag push
4. Aynı değişikliği `main`'e cherry-pick:
   ```
   git switch main && git cherry-pick <hotfix-sha>
   ```
5. Release notunda "Bu hotfix 0.8.0'da da var" cümlesini ekle.

## Changelog otomasyonu
Conventional commits kullan:
- `feat(tv): Tivibu kanalı eklendi`
- `fix(remote): PIN 5 denemede kilitleniyor`
- `security(update): minisign imza doğrulaması`
- `chore: ...` → changelog'a girmez

`tools/release.py bump X.Y.Z` çalışırken:
- Son tag'den bu yana gelen commitleri topla
- `feat:` → "Yenilikler", `fix:` → "Düzeltmeler", `security:` → "Güvenlik"
- `CHANGELOG.md` üstüne ekle, commit et

## LTS tablosu
| Sürüm | Çıkış | Destek bitişi |
|---|---|---|
| 0.7.x | 2026-11 | 2027-05 |
| 0.6.x | 2026-?? | 2027-?? |

`docs/release-process.md` her minor'de tabloya satır ekler.

## Yayınlama kontrol listesi
- [ ] `appinfo.json#version` yükseltildi
- [ ] CHANGELOG.md güncel
- [ ] `node tests/run.js` geçiyor
- [ ] `python tools/channels_health.py` kırık kanal göstermiyor (patch hariç)
- [ ] VM'de güncelleme → başarılı kurulum → rollback çalışıyor
- [ ] Tag push: `git tag v<X.Y.Z> && git push --tags`
- [ ] GitHub Actions release artifact'ı ve `.sha256`/`.minisig` üretti mi?

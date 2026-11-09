# İmaj üretim notları

## Hızlandırma: Docker katman cache
İlk build ~15 dk. Debootstrap + apt download tekrar edilmezse ~3 dk.

### Kalıcı apt cache volume
`os/build.sh` içinde:
```sh
apt-get update && apt-get install ...
```
→ bunu BuildKit cache mount ile değiştir:
```dockerfile
# syntax=docker/dockerfile:1.6
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends ...
```
`.ps1`'de `DOCKER_BUILDKIT=1` ve `docker buildx` kullan.

### Debootstrap cache
`/var/cache/debootstrap` için ayrı bir named volume (`beeos-deboot`), container'a mount et.

## Reproducible build
- `SOURCE_DATE_EPOCH` = son commit tarihi (UTC unix):
  `export SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)`
- `tar --sort=name --mtime="@$SOURCE_DATE_EPOCH" --owner=0 --group=0 --numeric-owner`
- Debian paket pinleme: `/etc/apt/preferences.d/beeos.pref` → her paket için sabit sürüm
  (en azından chrome, grub-efi-amd64-signed, shim-signed, plymouth)
- GRUB: `GRUB_TIMESTAMP=0`; mkfs.ext4 için `-E hash_seed=<sabit uuid>` ve `-E root_owner=0:0`
- Son adım: `sha256sum build/beeos.img` → her build'de aynı özet çıkmalı. Artifact'e ekle.

## QEMU'yu Hyper-V ile beraber
VirtualBox Hyper-V açıkken yavaşlar (Windows). Çözüm:
- Geliştirme: `os/vm.ps1` (QEMU, Docker içinde, Hyper-V ile sorun yok)
- Son deneme: `os/vbox.ps1` (daha gerçekçi EFI davranışı)
- WSL2 kullananlar için `--mount=type=bind,source=$env:USERPROFILE/.beeos-cache,...` ile cache paylaş.

## CI gece imajı (öneri)
`.github/workflows/nightly-image.yml`:
- Cron: `0 2 * * *`
- `os/build.sh` → `beeos-nightly-<tarih>.img` + `.sha256`
- 7 günden eski artifact'leri sil

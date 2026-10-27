# beeOS flash disk imajını üretir: build\beeos.img
# Gerekli: Docker Desktop. İlk derleme ~10-15 dk (paketler indirilir), sonrakiler 2-3 dk.
#   .\os\build.ps1            normal derleme (indirilmiş sistem önbellekten kullanılır)
#   .\os\build.ps1 -Rebuild   Debian ve Chrome'u sıfırdan indir (güncelleme için)
param([switch]$Rebuild)
# Docker bilgi mesajlarını stderr'e yazar; hata kontrolü $LASTEXITCODE ile
$root = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force (Join-Path $root "build") | Out-Null
docker volume create beeos-work | Out-Null
docker run --rm --privileged `
  -e REBUILD=$([int]$Rebuild.IsPresent) `
  -v beeos-work:/work `
  -v "${root}:/src:ro" `
  -v "$(Join-Path $root 'build'):/out" `
  debian:trixie bash /src/os/build.sh
if ($LASTEXITCODE -ne 0) { throw "Derleme başarısız" }

# beeOS flash disk imajını üretir: build\beeos.img
# Gerekli: Docker Desktop. İlk derleme ~10-15 dk (paketler indirilir), sonrakiler 2-3 dk.
#   .\os\build.ps1            normal derleme (indirilmiş sistem önbellekten kullanılır)
#   .\os\build.ps1 -Rebuild   Debian ve Chrome'u sıfırdan indir (güncelleme için)
#   .\os\build.ps1 -UpdateApi http://10.0.2.2:8000/latest.json
#                             güncellemeler GitHub yerine bilgisayardaki deneme sunucusundan (VM'de, tools/release.py serve)
param([switch]$Rebuild, [string]$UpdateApi = "")
# Docker bilgi mesajlarını stderr'e yazar; hata kontrolü $LASTEXITCODE ile
$root = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force (Join-Path $root "build") | Out-Null
# Docker Desktop kapalıysa başlat ve hazır olmasını bekle (bilgisayar yeniden başlayınca kapanıyor)
docker version 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  "Docker Desktop başlatılıyor…"
  Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  for ($i = 0; $i -lt 100; $i++) {
    Start-Sleep 3
    docker volume ls 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
  }
  if ($LASTEXITCODE -ne 0) { throw "Docker başlamadı" }
}
docker volume create beeos-work | Out-Null
docker run --rm --privileged `
  -e REBUILD=$([int]$Rebuild.IsPresent) `
  -e UPDATE_API=$UpdateApi `
  -v beeos-work:/work `
  -v "${root}:/src:ro" `
  -v "$(Join-Path $root 'build'):/out" `
  debian:trixie bash /src/os/build.sh
if ($LASTEXITCODE -ne 0) { throw "Derleme başarısız" }

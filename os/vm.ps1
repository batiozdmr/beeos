# beeOS imajını sanal makinede dener (Docker içinde QEMU + KVM).
#   .\os\vm.ps1 start          .\os\vm.ps1 shot acilis      .\os\vm.ps1 key down ret      .\os\vm.ps1 stop
# Docker bilgi mesajlarını stderr'e yazar; hata kontrolü $LASTEXITCODE ile
$root = Split-Path -Parent $PSScriptRoot
$name = "beeos-vm"
if (-not (docker ps -q -f "name=^$name$")) {
  docker run -d --rm --name $name --privileged `
    -v beeos-work:/work -v "${root}:/src:ro" -v "$(Join-Path $root 'build'):/out" `
    debian:trixie sleep infinity | Out-Null
}
docker exec $name bash /src/os/vm.sh @args
if ($args[0] -eq "stop") { docker rm -f $name | Out-Null }

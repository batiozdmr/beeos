# beeOS'u VirtualBox sanal makinesinde dener (flash diske yazmadan). VirtualBox 7 gerekir.
#   .\os\vbox.ps1                 son imajı (build\beeos.img) VM diskine çevirir (değiştiyse) ve VM'i açar
#   .\os\vbox.ps1 build           önce imajı derler (os\build.ps1, -Rebuild de geçer), sonra VM'i açar
#   .\os\vbox.ps1 build -UpdateApi http://10.0.2.2:8000/latest.json
#                                 güncellemeleri bilgisayardaki deneme sunucusundan alan imaj (tools/release.py serve)
#   .\os\vbox.ps1 reset           diski imajdan sıfırdan kurar (ayarlar, Wi-Fi vb. silinir) ve açar
#   .\os\vbox.ps1 shot <ad>       ekran görüntüsü -> build\vbox-<ad>.png
#   .\os\vbox.ps1 key <tuşlar>    tuş gönderir: ret esc up down left right home f1 f12 back tab space
#   .\os\vbox.ps1 type <yazı>     yazı yazar (ekran klavyesi yerine)
#   .\os\vbox.ps1 logs            VM kapalıyken BEEOS-LOG bölümündeki son açılışın günlükleri (Docker gerekir)
#   .\os\vbox.ps1 powerdown       düzgün kapatır (güç tuşu)       .\os\vbox.ps1 stop   hemen kapatır
# -Headless: pencere açmadan çalıştırır (ekran görüntüsü ve tuşlarla kullanılır).
# VM'de telefon kumandası: bilgisayarda http://127.0.0.1:18081 (NAT port yönlendirmesi).
[CmdletBinding(PositionalBinding = $false)]
param([Parameter(Position = 0)][string]$cmd = "start", [switch]$Headless, [switch]$Rebuild, [string]$UpdateApi = "",
      [Parameter(ValueFromRemainingArguments)]$rest)
$root = Split-Path -Parent $PSScriptRoot
$vb = Join-Path $env:ProgramFiles "Oracle\VirtualBox\VBoxManage.exe"
if (-not (Test-Path $vb)) { throw "VirtualBox bulunamadı: winget install Oracle.VirtualBox" }
$name = "beeOS"
$img = Join-Path $root "build\beeos.img"
$dir = Join-Path $root "build\vm"
$vdi = Join-Path $dir "beeos.vdi"

# VBoxManage bilgi mesajlarını stderr'e yazar; hata kontrolü çıkış koduyla
function vbm { & $vb @args; if ($LASTEXITCODE -ne 0) { throw "VBoxManage $($args[0]) başarısız" } }
function running { (& $vb list runningvms) -match "`"$name`"" }
function exists { (& $vb list vms) -match "`"$name`"" }

function stop-vm {
  if (running) {
    & $vb controlvm $name poweroff 2>$null | Out-Null
    for ($i = 0; $i -lt 30 -and (running); $i++) { Start-Sleep 1 }
    Start-Sleep 2   # oturum kilidinin kalkması için
  }
}

function create-vm {
  New-Item -ItemType Directory -Force $dir | Out-Null
  vbm createvm --name $name --ostype Debian_64 --basefolder $dir --register | Out-Null
  # EFI açılış (flash diskteki gibi shim + GRUB); 4 GB RAM, 4 çekirdek, 1920x1080 ekran.
  # localhostreachable: VM bilgisayarın 127.0.0.1'ine 10.0.2.2'den ulaşır (güncelleme deneme sunucusu)
  vbm modifyvm $name --firmware efi --memory 4096 --cpus 4 --ioapic on `
    --graphicscontroller vmsvga --vram 128 --accelerate-3d off `
    --mouse usbtablet --usb-xhci on --audio-driver default --audio-out on `
    --nic1 nat --nat-pf1 "kumanda,tcp,127.0.0.1,18081,,8081" --nat-localhostreachable1 on --boot1 disk --boot2 none --boot3 none --boot4 none
  vbm setextradata $name GUI/LastGuestSizeHint "1920,1080"
  vbm storagectl $name --name SATA --add sata --controller IntelAhci --portcount 1 --hostiocache on
}

function attach-disk([switch]$Fresh) {
  if (-not (Test-Path $img)) { throw "İmaj yok: önce .\os\build.ps1 (ya da .\os\vbox.ps1 build)" }
  if (-not $Fresh -and (Test-Path $vdi) -and (Get-Item $vdi).LastWriteTime -gt (Get-Item $img).LastWriteTime) { return }
  "VM diski hazırlanıyor (build\beeos.img -> build\vm\beeos.vdi)…"
  stop-vm
  & $vb storageattach $name --storagectl SATA --port 0 --device 0 --medium none 2>$null | Out-Null
  if (Test-Path $vdi) { & $vb closemedium disk $vdi --delete 2>$null | Out-Null; Remove-Item $vdi -ErrorAction SilentlyContinue }
  vbm convertfromraw $img $vdi --format VDI | Out-Null
  # 8 GB'lık flash disk gibi: beeOS boş alanı açılıştan sonra kendisi büyütür (beeos-grow)
  vbm modifymedium disk $vdi --resize 8192 | Out-Null
  vbm storageattach $name --storagectl SATA --port 0 --device 0 --type hdd --nonrotational on --medium $vdi
}

function start-vm {
  if (-not (exists)) { create-vm }
  attach-disk
  if (running) { "VM zaten açık"; return }
  vbm startvm $name --type $(if ($Headless) { "headless" } else { "gui" }) | Out-Null
  "VM başladı"
}

# Klavye tarama kodları (set 1): basma ve bırakma
$keys = @{ ret = "1c 9c"; esc = "01 81"; up = "e0 48 e0 c8"; down = "e0 50 e0 d0"; left = "e0 4b e0 cb";
           right = "e0 4d e0 cd"; home = "e0 47 e0 c7"; f1 = "3b bb"; f12 = "58 d8"; back = "0e 8e";
           tab = "0f 8f"; space = "39 b9" }

switch ($cmd) {
  "start" { start-vm }
  "build" {
    & (Join-Path $PSScriptRoot "build.ps1") -Rebuild:$Rebuild -UpdateApi $UpdateApi
    start-vm
  }
  "reset" {
    if (-not (exists)) { create-vm }
    attach-disk -Fresh
    start-vm
  }
  "shot" {
    $out = Join-Path $root "build\vbox-$(if ($rest) { $rest[0] } else { 'shot' }).png"
    vbm controlvm $name screenshotpng $out
    $out
  }
  "key" {
    foreach ($k in $rest) {
      if (-not $keys.ContainsKey($k)) { throw "bilinmeyen tuş: $k ($($keys.Keys -join ' '))" }
      vbm controlvm $name keyboardputscancode ($keys[$k] -split " ")
      Start-Sleep -Milliseconds 400
    }
  }
  "type" { vbm controlvm $name keyboardputstring ($rest -join " ") }
  "logs" {
    if (running) { throw "Önce VM'i kapat: .\os\vbox.ps1 powerdown" }
    $raw = Join-Path $dir "disk.raw"
    Remove-Item $raw -ErrorAction SilentlyContinue
    vbm clonemedium disk $vdi $raw --format RAW | Out-Null
    try {
      docker run --rm -v "${root}:/src:ro" -v "${dir}:/vm" debian:trixie bash /src/os/vm.sh logs /vm/disk.raw
    } finally {
      & $vb closemedium disk $raw --delete 2>$null | Out-Null
      Remove-Item $raw -ErrorAction SilentlyContinue
    }
  }
  "powerdown" {
    vbm controlvm $name acpipowerbutton
    for ($i = 0; $i -lt 90 -and (running); $i++) { Start-Sleep 1 }
    if (running) { "90 sn'de kapanmadı" } else { "kapandı" }
  }
  "stop" { stop-vm; "kapandı" }
  default { throw "kullanım: start | build | reset | shot <ad> | key <tuş...> | type <yazı> | logs | powerdown | stop" }
}

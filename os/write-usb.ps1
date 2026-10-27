# build\beeos.img'yi flash diske yazar. Yönetici olarak çalıştırılmalı.
#   .\os\write-usb.ps1                   USB diskleri listeler (hiçbir şey yazmaz)
#   .\os\write-usb.ps1 -Disk 2           2 numaralı USB diske yazar (onay ister)
#   .\os\write-usb.ps1 -Disk 2 -Yes      onay sormadan yazar
# DİKKAT: Seçilen flash diskteki her şey silinir.
param([int]$Disk = -1, [switch]$Yes, [string]$Image)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $Image) { $Image = Join-Path $root "build\beeos.img" }

$usb = Get-Disk | Where-Object { $_.BusType -eq "USB" -and -not $_.IsSystem -and -not $_.IsBoot }
if ($Disk -lt 0) {
  if (-not $usb) { "USB disk bulunamadı. Flash diski tak ve tekrar dene."; exit 1 }
  $usb | Format-Table Number, FriendlyName, @{n="Boyut(GB)"; e={[math]::Round($_.Size/1GB,1)}}, PartitionStyle -AutoSize
  "Yazmak için: .\os\write-usb.ps1 -Disk <Number>"
  exit 0
}

$target = $usb | Where-Object Number -eq $Disk
if (-not $target) { throw "Disk $Disk bir USB disk değil (ya da sistem diski). Yazılmadı." }
if (-not (Test-Path $Image)) { throw "İmaj yok: $Image  (önce .\os\build.ps1)" }
$imgLen = (Get-Item $Image).Length
if ($target.Size -lt $imgLen) { throw "Flash disk çok küçük: imaj $([math]::Round($imgLen/1GB,1)) GB" }
if ($target.Size -gt 300GB) { throw "Disk 300 GB'tan büyük; flash disk olduğundan emin olmak için reddedildi." }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Yönetici olarak çalıştır (sağ tık > Yönetici olarak çalıştır)." }

"Hedef: Disk $Disk  $($target.FriendlyName)  $([math]::Round($target.Size/1GB,1)) GB"
"İmaj : $Image  $([math]::Round($imgLen/1GB,2)) GB"
if (-not $Yes) {
  $a = Read-Host "Bu flash diskteki HER ŞEY silinecek. Devam için EVET yaz"
  if ($a -ne "EVET") { "İptal edildi."; exit 1 }
}

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class RawDisk {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);
  public static FileStream Open(int n, bool write) {
    // GENERIC_READ|GENERIC_WRITE, paylaşım okuma|yazma, OPEN_EXISTING, WRITE_THROUGH
    var h = CreateFile(@"\\.\PhysicalDrive" + n, write ? 0xC0000000u : 0x80000000u, 3, IntPtr.Zero, 3, 0x80000000u, IntPtr.Zero);
    if (h.IsInvalid) throw new IOException("Disk açılamadı, hata " + Marshal.GetLastWin32Error());
    // bufferSize 1 = .NET arabelleği yok, 4 MB'lık parçalar doğrudan diske gider
    return new FileStream(h, write ? FileAccess.ReadWrite : FileAccess.Read, 1, false);
  }
}
"@

"Disk temizleniyor…"
Set-Disk -Number $Disk -IsOffline $false -ErrorAction SilentlyContinue
Clear-Disk -Number $Disk -RemoveData -RemoveOEM -Confirm:$false
# Sabit disklerde Windows'un araya girmemesi için; flash disklerde desteklenmez, temizlenmiş disk yeterli
Set-Disk -Number $Disk -IsOffline $true -ErrorAction SilentlyContinue

$chunk = 4MB
$buf = New-Object byte[] $chunk
$src = [IO.File]::OpenRead($Image)
$dst = [RawDisk]::Open($Disk, $true)
$sw = [Diagnostics.Stopwatch]::StartNew()
$done = 0L
try {
  while (($n = $src.Read($buf, 0, $chunk)) -gt 0) {
    if ($n % 512) { [Array]::Clear($buf, $n, 512 - $n % 512); $n += 512 - $n % 512 }
    $dst.Write($buf, 0, $n)
    $done += $n
    if (($done / $chunk) % 32 -eq 0) {
      $mbs = [math]::Round($done / 1MB / [math]::Max($sw.Elapsed.TotalSeconds, 1), 1)
      Write-Progress -Activity "beeOS yazılıyor" -Status "$([math]::Round($done/1GB,2)) GB  ($mbs MB/sn)" -PercentComplete ($done * 100 / $imgLen)
    }
  }
  $dst.Flush()
} finally { $src.Close(); $dst.Close() }
Write-Progress -Activity "beeOS yazılıyor" -Completed
"Yazıldı: $([math]::Round($done/1GB,2)) GB, $([math]::Round($sw.Elapsed.TotalMinutes,1)) dk"

"Doğrulanıyor…"
$a = [IO.File]::OpenRead($Image)
$b = [RawDisk]::Open($Disk, $false)
$ba = New-Object byte[] $chunk; $bb = New-Object byte[] $chunk
$pos = 0L
try {
  while (($n = $a.Read($ba, 0, $chunk)) -gt 0) {
    $m = $n; if ($m % 512) { $m += 512 - $m % 512 }
    [void]$b.Read($bb, 0, $m)
    for ($i = 0; $i -lt $n; $i += 4096) {
      if ($ba[$i] -ne $bb[$i] -or $ba[[math]::Min($i + 4095, $n - 1)] -ne $bb[[math]::Min($i + 4095, $n - 1)]) {
        throw "Doğrulama hatası (bayt $($pos + $i)). Flash disk bozuk olabilir."
      }
    }
    $pos += $n
  }
} finally { $a.Close(); $b.Close() }
Set-Disk -Number $Disk -IsOffline $false -ErrorAction SilentlyContinue
"TAMAM: beeOS flash diske yazıldı. Bilgisayarı yeniden başlatıp F9 ile flash diski seç."

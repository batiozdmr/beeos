#!/bin/bash
# beeOS imajını sanal makinede (QEMU, Secure Boot açık UEFI, USB bellek olarak) dener.
# os/vm.ps1 çağırır. Komutlar:
#   start           build/beeos.img'nin kopyasını (8 GB'lık USB gibi) başlatır
#   boot            aynı diskle tekrar açar (kapat-aç denemesi; ayarlar kalıcı mı?)
#   powerdown       düzgün kapatır (güç tuşu gibi)
#   logs            BEEOS-LOG bölümündeki son açılışın günlüklerini gösterir
#   shot <ad>       ekran görüntüsü -> build/vm-<ad>.png
#   key <tuşlar>    tuş gönderir (QEMU sendkey adları: ret, down, home, esc, f1 ...)
#   stop            kapatır
set -euo pipefail
W=/work/vm
MON=$W/mon.sock

mon() { echo "$*" | socat - "UNIX-CONNECT:$MON" >/dev/null; }

case "${1:-}" in
  start)
    command -v qemu-system-x86_64 >/dev/null || {
      apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        qemu-system-x86 qemu-utils ovmf socat netpbm >/dev/null; }
    mkdir -p $W
    rm -f $W/disk.qcow2
    qemu-img create -q -f qcow2 -b /out/beeos.img -F raw $W/disk.qcow2 8G
    cp /usr/share/OVMF/OVMF_VARS_4M.ms.fd $W/vars.fd
    exec bash "$0" boot
    ;;
  boot)
    # SLOW=1: ucuz USB 2.0 flash disk gibi yavaş disk (okuma 25 MB/sn, yazma 10 MB/sn, az IOPS)
    THROTTLE=""
    [ "${SLOW:-0}" = 1 ] && THROTTLE=",throttling.bps-read=25000000,throttling.bps-write=10000000,throttling.iops-total=300"
    qemu-system-x86_64 -enable-kvm -machine q35,smm=on -cpu host -m 4096 -smp 4 \
      -global driver=cfi.pflash01,property=secure,value=on \
      -drive if=pflash,format=raw,unit=0,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.secboot.fd \
      -drive if=pflash,format=raw,unit=1,file=$W/vars.fd \
      -device qemu-xhci -drive if=none,id=stick,format=qcow2,file=$W/disk.qcow2$THROTTLE \
      -device usb-storage,drive=stick,removable=on \
      -device virtio-vga,xres=1920,yres=1080 -device usb-kbd -device usb-tablet \
      -nic user,model=virtio-net-pci \
      -audiodev none,id=snd -device intel-hda -device hda-output,audiodev=snd \
      -display none -monitor unix:$MON,server,nowait -daemonize
    echo "VM başladı"
    ;;
  powerdown)
    mon system_powerdown
    # kapanan qemu konteynerde zombi (Z) olarak kalabilir: onları sayma
    for i in $(seq 90); do ps -eo stat=,comm= | grep -v '^Z' | grep -q qemu-system || { echo kapandı; exit 0; }; sleep 1; done
    echo "90 sn'de kapanmadı"
    ;;
  logs)
    command -v mdir >/dev/null || apt-get install -y -qq mtools >/dev/null 2>&1
    export MTOOLS_SKIP_CHECK=1
    qemu-img convert -O raw $W/disk.qcow2 $W/d.raw
    dd if=$W/d.raw of=$W/log.img bs=1M skip=257 count=64 status=none; rm -f $W/d.raw
    d=$(mdir -b -i $W/log.img :: | grep '/2' | sort | tail -1)
    for f in session.log drm.txt; do echo "== $f"; mtype -i $W/log.img "$d/$f"; done
    echo "== journal (beeOS)"; mtype -i $W/log.img "$d/journal.txt" | grep -E 'beeos-preload|arayüz yüklendi|Startup finished|beeos-profile'
    ;;
  shot)
    mon "screendump $W/s.ppm"
    sleep 1
    pnmtopng $W/s.ppm > "/out/vm-${2:-shot}.png" 2>/dev/null
    echo "/out/vm-${2:-shot}.png"
    ;;
  key)
    shift
    for k in "$@"; do mon "sendkey $k"; sleep 0.4; done
    ;;
  stop)
    mon quit || true
    ;;
  *) echo "kullanım: start | shot <ad> | key <tuş...> | stop"; exit 1 ;;
esac

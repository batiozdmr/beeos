#!/bin/bash
# beeOS flash disk imajı üretir. Docker içinde (debian:trixie, --privileged) çalışır; os/build.ps1 başlatır.
#   /src  : proje klasörü (salt okunur)   /out : çıktı (beeos.img)   /work : önbellek (docker volume)
# Çıktı: GPT disk imajı = EFI bölümü (shim + imzalı GRUB, Secure Boot ile açılır)
#   + BEEOS-LOG (FAT32, Windows'ta açılır; teşhis günlükleri) + ext4 sistem bölümü.
set -euo pipefail

SUITE=trixie
R=/work/rootfs
ESP_MB=256
IMG=/out/beeos.img
ROOT_UUID=b33e0500-0000-4000-8000-0000000000be
ESP_ID=BEE05EF1
LOG_MB=64
LOG_ID=BEE0106A

log() { echo -e "\n\033[1;33m== $*\033[0m"; }

log "Derleme araçları"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq mmdebstrap dosfstools mtools e2fsprogs fdisk curl ca-certificates >/dev/null

PKGS=(
  # temel sistem
  systemd-sysv udev dbus dbus-user-session libpam-systemd polkitd kbd locales tzdata
  linux-image-amd64 initramfs-tools shim-signed grub-efi-amd64-signed
  e2fsprogs gdisk cloud-guest-utils parted util-linux
  # ağ ve bluetooth
  network-manager wpasupplicant iproute2 iputils-ping bluez
  # ekran ve ses
  sway xwayland wtype libgl1-mesa-dri libegl1 mesa-vulkan-drivers intel-media-va-driver
  pipewire pipewire-pulse pipewire-alsa wireplumber alsa-ucm-conf
  fonts-noto-core fonts-noto-color-emoji fonts-dejavu-core
  # markalı açılış ekranı
  plymouth plymouth-themes
  # donanım yazılımları (Intel Wi-Fi/ses, Nvidia HDMI çıkışı)
  firmware-intel-graphics wireless-regdb pciutils rsync
  firmware-iwlwifi firmware-intel-sound firmware-sof-signed firmware-misc-nonfree
  firmware-nvidia-graphics firmware-realtek intel-microcode
  # beeOS arka ucu
  python3 python3-websocket curl ca-certificates less nano
)

if [ ! -f /work/rootfs.done ] || [ "${REBUILD:-0}" = 1 ]; then
  log "Debian $SUITE kök dosya sistemi (ilk seferde ~10 dk)"
  rm -rf "$R"
  mmdebstrap --mode=root --variant=minbase \
    --components="main contrib non-free non-free-firmware" \
    --include="$(IFS=,; echo "${PKGS[*]}")" \
    --aptopt='Acquire::Retries "3"' \
    "$SUITE" "$R" http://deb.debian.org/debian

  log "Google Chrome (Netflix için Widevine içerir)"
  curl -fsSL -o "$R/tmp/chrome.deb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  mount --bind /dev "$R/dev"; mount -t proc proc "$R/proc"; mount -t sysfs sys "$R/sys"
  cp /etc/resolv.conf "$R/etc/resolv.conf"
  # mmdebstrap paket listelerini temizler: Chrome'un bağımlılıkları için yeniden indir
  chroot "$R" sh -c 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /tmp/chrome.deb >/dev/null && rm /tmp/chrome.deb'
  umount "$R/dev" "$R/proc" "$R/sys"
  touch /work/rootfs.done
fi

log "beeOS dosyaları ve ayarlar"
# Windows'tan bağlanan klasörün izinleri anlamsız: kopyala, sonra izinleri düzelt
CP="cp -r --no-preserve=mode,ownership"
$CP /src/os/overlay/. "$R/"
rm -rf "$R/opt/beeos/web"
mkdir -p "$R/opt/beeos/web"
$CP /src/index.html /src/css /src/js /src/logos /src/icon.png /src/largeIcon.png "$R/opt/beeos/web/"
$CP /src/os/backend/beeos_server.py /src/os/backend/remote.html "$R/opt/beeos/bin/"
chmod -R u=rwX,go=rX "$R/opt/beeos" "$R/etc/systemd" "$R/etc/opt" "$R/home/bee"
chmod 755 "$R"/opt/beeos/bin/*
chmod 644 "$R/opt/beeos/bin/remote.html"
chmod -R u=rwX,go=rX "$R/usr/share/plymouth/themes/beeos"

cat > "$R/etc/fstab" <<EOF
UUID=$ROOT_UUID  /          ext4  noatime,commit=60,errors=remount-ro  0 1
UUID=${ESP_ID:0:4}-${ESP_ID:4:4}  /boot/efi  vfat  umask=0077,noauto,nofail  0 2
UUID=${LOG_ID:0:4}-${LOG_ID:4:4}  /mnt/beeos-log  vfat  umask=0022,nofail,x-systemd.device-timeout=10s  0 0
tmpfs  /tmp  tmpfs  nosuid,nodev,size=25%  0 0
EOF
echo beeos > "$R/etc/hostname"
printf '127.0.0.1\tlocalhost\n127.0.1.1\tbeeos\n::1\tlocalhost ip6-localhost ip6-loopback\n' > "$R/etc/hosts"

mount --bind /dev "$R/dev"; mount -t proc proc "$R/proc"; mount -t sysfs sys "$R/sys"
trap 'umount "$R/dev" "$R/proc" "$R/sys" 2>/dev/null || true' EXIT
chroot "$R" /bin/bash -e <<'CHROOT'
export DEBIAN_FRONTEND=noninteractive
# dil, saat dilimi, klavye
sed -i 's/^# *tr_TR.UTF-8/tr_TR.UTF-8/' /etc/locale.gen
locale-gen >/dev/null
echo 'LANG=tr_TR.UTF-8' > /etc/default/locale
ln -sf /usr/share/zoneinfo/Europe/Istanbul /etc/localtime
echo 'Europe/Istanbul' > /etc/timezone
echo 'KEYMAP=trq' > /etc/vconsole.conf

# kullanıcı: bee (şifresiz, sadece tty1 otomatik giriş). root kilitli.
id bee >/dev/null 2>&1 || useradd -m -s /bin/bash -G video,render,input,audio,netdev,bluetooth bee
passwd -l bee >/dev/null; passwd -l root >/dev/null
mkdir -p /home/bee/Resimler      # ekran koruyucu fotoğrafları (BEEOS-LOG/Fotograflar da okunur)
chown -R bee:bee /home/bee

# önbellekteki eski kök sisteme sonradan eklenen paketler (Intel GPU firmware'i olmadan ekran siyah kalır)
NEED=""
for p in pciutils firmware-intel-graphics wireless-regdb rsync plymouth plymouth-themes wtype; do dpkg -s $p >/dev/null 2>&1 || NEED="$NEED $p"; done
[ -z "$NEED" ] || { apt-get update -qq && apt-get install -y -qq $NEED >/dev/null; }
# Windows donanım saatini yerel saatte tutar; Linux da öyle okusun (yoksa saat 3 saat kayar)
printf '0.0 0 0.0
0
LOCAL
' > /etc/adjtime
mkdir -p /mnt/beeos-log
# eski sürüm büyütmeyi açılışta yapıyordu (açılışı 2 dk yavaşlatıyordu); artık zamanlayıcıyla sonradan
rm -f /etc/systemd/system/multi-user.target.wants/beeos-grow.service
# Açılışta RAM'e önceden okunacak dosyalar: Chrome, ekran sistemi, Intel/Mesa sürücüleri ve bağımlılıkları
L=/usr/lib/x86_64-linux-gnu
{ find /opt/google/chrome -type f
  ls $L/dri/*.so $L/libgallium* $L/libEGL_mesa* $L/libgbm* $L/libva* 2>/dev/null
  for b in /opt/google/chrome/chrome /opt/google/chrome/*.so /usr/bin/sway /usr/bin/swaybg $L/dri/*.so $L/libgallium*; do
    ldd "$b" 2>/dev/null | awk '/=> \//{print $3}'
  done; } | xargs -r readlink -f | sort -u > /opt/beeos/preload.list
echo "preload: $(wc -l < /opt/beeos/preload.list) dosya, $(tr '\n' '\0' < /opt/beeos/preload.list | du -cb --files0-from=- | tail -1 | cut -f1 | numfmt --to=iec)"
systemctl enable NetworkManager beeos-backend beeos-grow.timer beeos-logdump.timer beeos-preload beeos-profile-save bluetooth >/dev/null 2>&1
systemctl mask apt-daily.timer apt-daily-upgrade.timer man-db.timer e2scrub_all.timer >/dev/null 2>&1
systemctl set-default multi-user.target >/dev/null

# markalı açılış ekranı (initramfs'e girer; aşağıdaki update-initramfs ile)
plymouth-set-default-theme beeos

# kernel /vmlinuz ve /initrd.img bağlantıları GRUB için
KVER=$(ls /lib/modules | sort -V | tail -1)
ln -sf "boot/vmlinuz-$KVER" /vmlinuz
ln -sf "boot/initrd.img-$KVER" /initrd.img
update-initramfs -u -k "$KVER" >/dev/null

# makine kimliği ilk açılışta üretilsin; önbellekleri temizle
: > /etc/machine-id
rm -f /var/lib/dbus/machine-id
apt-get clean
rm -rf /var/lib/apt/lists/* /var/cache/apt/*.bin /var/log/*.log /tmp/*
CHROOT
umount "$R/dev" "$R/proc" "$R/sys"; trap - EXIT

log "EFI bölümü (shim + imzalı GRUB)"
KVER=$(ls "$R/lib/modules" | sort -V | tail -1)
GRUBCFG=/work/grub.cfg
cat > "$GRUBCFG" <<EOF
# Menü gizli: açılış doğrudan beeOS'a gider. Açılırken Esc'ye basmak menüyü (güvenli mod) gösterir.
set timeout=2
set timeout_style=hidden
search --no-floppy --fs-uuid --set=root $ROOT_UUID
# nouveau (açık kaynak Nvidia sürücüsü) RTX 40 serisinde çöküp açılışı kilitliyor: varsayılan kapalı
menuentry "beeOS" {
  linux /vmlinuz root=UUID=$ROOT_UUID ro quiet splash loglevel=3 rd.udev.log_level=3 vt.global_cursor_default=0 modprobe.blacklist=nouveau systemd.show_status=auto
  initrd /initrd.img
}
menuentry "beeOS (deneme: Nvidia nouveau açık)" {
  linux /vmlinuz root=UUID=$ROOT_UUID ro systemd.show_status=true
  initrd /initrd.img
}
menuentry "beeOS (güvenli mod, ekran kartı sürücüsüz)" {
  linux /vmlinuz root=UUID=$ROOT_UUID ro nomodeset systemd.show_status=true
  initrd /initrd.img
}
EOF
ESP=/work/esp.img
rm -f "$ESP"
mkfs.vfat -F 32 -n BEEOS-EFI -i "$ESP_ID" -C "$ESP" $((ESP_MB * 1024)) >/dev/null
export MTOOLS_SKIP_CHECK=1
mmd -i "$ESP" ::/EFI ::/EFI/BOOT ::/EFI/debian
mcopy -i "$ESP" "$R/usr/lib/shim/shimx64.efi.signed" ::/EFI/BOOT/BOOTX64.EFI
mcopy -i "$ESP" "$R/usr/lib/shim/mmx64.efi.signed" ::/EFI/BOOT/mmx64.efi
mcopy -i "$ESP" "$R/usr/lib/grub/x86_64-efi-signed/grubx64.efi.signed" ::/EFI/BOOT/grubx64.efi
mcopy -i "$ESP" "$GRUBCFG" ::/EFI/BOOT/grub.cfg
mcopy -i "$ESP" "$GRUBCFG" ::/EFI/debian/grub.cfg

log "Günlük bölümü (BEEOS-LOG, FAT32)"
LOGIMG=/work/log.img
rm -f "$LOGIMG"
mkfs.vfat -F 32 -n BEEOS-LOG -i "$LOG_ID" -C "$LOGIMG" $((LOG_MB * 1024)) >/dev/null
printf 'beeOS teşhis günlükleri. Her açılış ayrı klasöre yazılır.
Fotograflar klasörüne koyduğun fotoğraflar ekran koruyucuda (Stil: Fotoğraflar) gösterilir.
' > /work/BENIOKU.txt
mcopy -i "$LOGIMG" /work/BENIOKU.txt ::/BENIOKU.txt
mmd -i "$LOGIMG" ::/Fotograflar

log "Sistem bölümü (ext4)"
USED_MB=$(du -sm "$R" | cut -f1)
ROOT_MB=$((USED_MB * 115 / 100 + 600))
ROOTIMG=/work/root.img
rm -f "$ROOTIMG"
mke2fs -q -t ext4 -L beeos -U "$ROOT_UUID" -E root_owner=0:0 -d "$R" "$ROOTIMG" "${ROOT_MB}M"

log "Disk imajı (GPT)"
TOTAL_MB=$((1 + ESP_MB + LOG_MB + ROOT_MB + 1))
rm -f "$IMG"
truncate -s "${TOTAL_MB}M" "$IMG"
sfdisk -q "$IMG" <<EOF
label: gpt
start=1MiB, size=${ESP_MB}MiB, type=C12A7328-F81F-11D2-BA4B-00A0C93EC93B, name="EFI"
start=$((1 + ESP_MB))MiB, size=${LOG_MB}MiB, type=EBD0A0A2-B9E5-4433-87C0-68B6B72699C7, name="BEEOS-LOG"
start=$((1 + ESP_MB + LOG_MB))MiB, size=${ROOT_MB}MiB, type=0FC63DAF-8483-4772-8E79-3D69D8477DE4, name="beeOS"
EOF
dd if="$ESP" of="$IMG" bs=1M seek=1 conv=notrunc status=none
dd if="$LOGIMG" of="$IMG" bs=1M seek=$((1 + ESP_MB)) conv=notrunc status=none
dd if="$ROOTIMG" of="$IMG" bs=1M seek=$((1 + ESP_MB + LOG_MB)) conv=notrunc status=none
rm -f "$ESP" "$LOGIMG" "$ROOTIMG"

log "Bitti: $(basename "$IMG")  $(du -h --apparent-size "$IMG" | cut -f1)  (kernel $KVER, kök $USED_MB MB)"

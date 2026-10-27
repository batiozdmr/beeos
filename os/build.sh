#!/bin/bash
# beeOS flash disk imajı üretir. Docker içinde (debian:trixie, --privileged) çalışır; os/build.ps1 başlatır.
#   /src  : proje klasörü (salt okunur)   /out : çıktı (beeos.img)   /work : önbellek (docker volume)
# Çıktı: GPT disk imajı = EFI bölümü (shim + imzalı GRUB, Secure Boot ile açılır) + ext4 sistem bölümü.
set -euo pipefail

SUITE=trixie
R=/work/rootfs
ESP_MB=256
IMG=/out/beeos.img
ROOT_UUID=b33e0500-0000-4000-8000-0000000000be
ESP_ID=BEE05EF1

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
  sway xwayland libgl1-mesa-dri libegl1 mesa-vulkan-drivers intel-media-va-driver
  pipewire pipewire-pulse pipewire-alsa wireplumber alsa-ucm-conf
  fonts-noto-core fonts-noto-color-emoji fonts-dejavu-core
  # donanım yazılımları (Intel Wi-Fi/ses, Nvidia HDMI çıkışı)
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
$CP /src/os/backend/beeos_server.py "$R/opt/beeos/bin/"
chmod -R u=rwX,go=rX "$R/opt/beeos" "$R/etc/systemd" "$R/etc/opt" "$R/home/bee"
chmod 755 "$R"/opt/beeos/bin/*

cat > "$R/etc/fstab" <<EOF
UUID=$ROOT_UUID  /          ext4  noatime,commit=60,errors=remount-ro  0 1
UUID=${ESP_ID:0:4}-${ESP_ID:4:4}  /boot/efi  vfat  umask=0077,noauto,nofail  0 2
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
chown -R bee:bee /home/bee

systemctl enable NetworkManager beeos-backend beeos-grow bluetooth >/dev/null 2>&1
systemctl mask apt-daily.timer apt-daily-upgrade.timer man-db.timer e2scrub_all.timer >/dev/null 2>&1
systemctl set-default multi-user.target >/dev/null

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
set timeout=0
set timeout_style=hidden
search --no-floppy --fs-uuid --set=root $ROOT_UUID
menuentry "beeOS" {
  linux /vmlinuz root=UUID=$ROOT_UUID ro quiet loglevel=3 rd.udev.log_level=3 systemd.show_status=false vt.global_cursor_default=0 splash
  initrd /initrd.img
}
menuentry "beeOS (güvenli mod, ekran kartı sürücüsüz)" {
  linux /vmlinuz root=UUID=$ROOT_UUID ro nomodeset
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

log "Sistem bölümü (ext4)"
USED_MB=$(du -sm "$R" | cut -f1)
ROOT_MB=$((USED_MB * 115 / 100 + 600))
ROOTIMG=/work/root.img
rm -f "$ROOTIMG"
mke2fs -q -t ext4 -L beeos -U "$ROOT_UUID" -E root_owner=0:0 -d "$R" "$ROOTIMG" "${ROOT_MB}M"

log "Disk imajı (GPT)"
TOTAL_MB=$((1 + ESP_MB + ROOT_MB + 1))
rm -f "$IMG"
truncate -s "${TOTAL_MB}M" "$IMG"
sfdisk -q "$IMG" <<EOF
label: gpt
start=1MiB, size=${ESP_MB}MiB, type=C12A7328-F81F-11D2-BA4B-00A0C93EC93B, name="EFI"
start=$((1 + ESP_MB))MiB, size=${ROOT_MB}MiB, type=0FC63DAF-8483-4772-8E79-3D69D8477DE4, name="beeOS"
EOF
dd if="$ESP" of="$IMG" bs=1M seek=1 conv=notrunc status=none
dd if="$ROOTIMG" of="$IMG" bs=1M seek=$((1 + ESP_MB)) conv=notrunc status=none
rm -f "$ESP" "$ROOTIMG"

log "Bitti: $(basename "$IMG")  $(du -h --apparent-size "$IMG" | cut -f1)  (kernel $KVER, kök $USED_MB MB)"

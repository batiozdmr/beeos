# tty1'de otomatik girişte beeOS oturumunu başlat
if [ "$(tty)" = "/dev/tty1" ]; then
  exec /opt/beeos/bin/beeos-session
fi

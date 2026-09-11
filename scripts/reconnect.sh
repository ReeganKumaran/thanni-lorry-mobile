#!/bin/bash
# Reconnect the phone to the local stack after a replug or an adb restart.
#
# Every USB tunnel lives inside the adb server process. When adb dies — a
# replug, `adb kill-server`, another tool restarting it — every tunnel goes with
# it. The phone then reaches nothing on localhost, and because a dead reverse
# port on Android hangs rather than refuses, the app reports "did not respond
# in time" after its 8s timeout instead of "can't reach". This restores the
# tunnels, PROVES both ends answer before launching, and restarts the app.
#
#   ./scripts/reconnect.sh              # Samsung by default
#   ./scripts/reconnect.sh bcf75895     # another device serial
#
# Ports: the app asks for 8200 and 8081; the tunnel decides where those land.
set -u
DEVICE="${1:-RZGYC1CPTND}"
BACKEND_PORT="${BACKEND_PORT:-8765}"   # the supervised backend on the laptop
METRO_PORT="${METRO_PORT:-8083}"
PKG=com.aura.companion

adb start-server >/dev/null 2>&1
if ! adb -s "$DEVICE" get-state >/dev/null 2>&1; then
  echo "device $DEVICE is not attached"; adb devices; exit 1
fi

adb -s "$DEVICE" reverse tcp:8200 "tcp:$BACKEND_PORT" >/dev/null
adb -s "$DEVICE" reverse tcp:8081 "tcp:$METRO_PORT"   >/dev/null
adb -s "$DEVICE" reverse tcp:8001 tcp:8101            >/dev/null
echo "tunnels:"; adb -s "$DEVICE" reverse --list | sed 's/^/  /'

# Launching the app before these answer reproduces "Unable to load script".
ok=1
for pair in "metro http://127.0.0.1:$METRO_PORT/status" "backend http://127.0.0.1:$BACKEND_PORT/health"; do
  name=${pair%% *}; url=${pair#* }
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url")
  printf "  %-8s %s\n" "$name" "$code"
  [ "$code" = "200" ] || ok=0
done
[ $ok = 1 ] || { echo "a service is down — fix that first, the tunnels are fine"; exit 1; }

adb -s "$DEVICE" shell am force-stop "$PKG"
sleep 2
adb -s "$DEVICE" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
echo "app relaunched"

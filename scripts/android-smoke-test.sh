#!/usr/bin/env bash
# Smoke test: install an APK on the connected emulator/device and launch it three ways,
# checking that the app process survives and logcat shows no crash.
#
#   scripts/android-smoke-test.sh path/to/app.apk
#
# Writes smoke-<scenario>.png and smoke-logcat.txt to the current directory and exits
# non-zero (after all artifacts are written) if any scenario failed.
set -u

APK="${1:?usage: android-smoke-test.sh <apk>}"
PKG="com.venusddev.qashy"
WAIT_SECONDS="${SMOKE_WAIT_SECONDS:-20}"
LOGCAT_FILE="smoke-logcat.txt"
FAILED=0

: > "$LOGCAT_FILE"

fail() {
  echo "FAIL: $*"
  FAILED=1
}

# Append the main+crash buffers to the full log, then check them for crash signatures.
check_logcat() {
  local name="$1" log
  log="$(mktemp)"
  adb logcat -d -b main -b crash > "$log" 2>&1
  {
    echo "===== scenario: $name ====="
    cat "$log"
  } >> "$LOGCAT_FILE"

  if grep -q "FATAL EXCEPTION" "$log"; then
    fail "$name: FATAL EXCEPTION in logcat"
    grep -A60 -B5 "FATAL EXCEPTION" "$log"
  fi
  if grep -q "AndroidRuntime: Process: $PKG" "$log"; then
    fail "$name: AndroidRuntime crash for $PKG"
  fi
  if grep -E "ReactNativeJS" "$log" | grep -qiE "Unhandled JS Exception|fatal"; then
    fail "$name: fatal JS error"
    grep -E "ReactNativeJS" "$log" | grep -iE "Unhandled JS Exception|fatal"
  fi
  if grep -q "ANR in $PKG" "$log"; then
    fail "$name: ANR"
  fi

  echo "--- last 200 logcat lines ($name) ---"
  tail -n 200 "$log"
  rm -f "$log"
}

# Run one scenario: $1 = name, remaining args = the `adb shell am start ...` command.
# The caller has already put the app in the required starting state.
run_scenario() {
  local name="$1"
  shift
  echo "=== scenario: $name ==="
  adb logcat -c

  if ! adb shell "$@"; then
    fail "$name: am start failed"
  fi

  sleep "$WAIT_SECONDS"

  if adb shell pidof "$PKG" > /dev/null; then
    echo "$name: process alive"
  else
    fail "$name: $PKG is not running"
  fi

  adb exec-out screencap -p > "smoke-$name.png" || echo "screenshot failed for $name"
  check_logcat "$name"
}

echo "Installing $APK"
if ! adb install -r "$APK"; then
  echo "FAIL: install failed"
  exit 1
fi

adb shell am force-stop "$PKG"

# (a) cold launch from the launcher activity
run_scenario cold-launch \
  am start -W -n "$PKG/.MainActivity"

# (b) cold deep link: kill the app first
adb shell am force-stop "$PKG"
run_scenario cold-deeplink \
  am start -W -a android.intent.action.VIEW -d "qashy:///transaction" "$PKG"

# (c) warm deep link: the app is still running from (b)
run_scenario warm-deeplink \
  am start -W -a android.intent.action.VIEW -d "qashy:///overview" "$PKG"

if [ "$FAILED" -ne 0 ]; then
  echo "Smoke test FAILED. Full logcat: $LOGCAT_FILE"
  exit 1
fi
echo "Smoke test passed."

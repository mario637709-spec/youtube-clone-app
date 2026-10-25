#!/usr/bin/env bash
# scripts/test-apk-in-codespace.sh
# Automates Android emulator setup, APK installation, and live screenshot capture in Codespace
set -e

echo "=========================================================="
echo "🤖 ANDROID EMULATOR SETUP & APK TEST IN CODESPACE"
echo "=========================================================="

export ANDROID_HOME=${ANDROID_HOME:-"/usr/local/lib/android/sdk"}
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator

echo "[Step 1] Ensuring Android SDK platform tools..."
mkdir -p "$ANDROID_HOME"
if command -v sdkmanager &> /dev/null; then
    yes | sdkmanager --licenses || true
    sdkmanager "platform-tools" "emulator" || true
fi

echo "[Step 2] Downloading latest YouTube Clone APK (v1.0.12)..."
APK_PATH="/tmp/app-debug.apk"
curl -sSL -o "$APK_PATH" "https://github.com/mario637709-spec/youtube-clone-app/releases/download/v1.0.0-12/app-debug.apk"
echo "APK downloaded to $APK_PATH ($(ls -lh $APK_PATH | awk '{print $5}'))"

echo "[Step 3] Checking for connected devices or running emulator..."
adb devices

# If no emulator running and kvm exists, launch headless emulator
DEVICE_COUNT=$(adb devices | grep -v "List" | grep "device" | wc -l || true)
if [ "$DEVICE_COUNT" -eq 0 ]; then
    echo "No running emulator found. Creating/starting AVD test_device..."
    if command -v avdmanager &> /dev/null; then
        echo "no" | avdmanager create avd -n test_device -k "system-images;android-30;google_apis;x86_64" --force || true
        emulator -avd test_device -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect &
        EMU_PID=$!
        echo "Waiting for device to boot..."
        adb wait-for-device
        while [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]; do
            sleep 2
        done
        echo "Device booted!"
    fi
fi

echo "[Step 4] Installing YouTube Clone APK..."
adb install -r "$APK_PATH"

echo "[Step 5] Launching App com.kiro.youtube..."
adb shell monkey -p com.kiro.youtube -c android.intent.category.LAUNCHER 1

echo "[Step 6] Waiting 12 seconds for feed from 3 Firebase DBs to render..."
sleep 12

echo "[Step 7] Capturing Live Screenshot..."
mkdir -p /tmp/screenshots
adb exec-out screencap -p > /tmp/screenshots/live_emulator_screenshot.png
echo "Screenshot saved successfully to /tmp/screenshots/live_emulator_screenshot.png"
ls -lh /tmp/screenshots/live_emulator_screenshot.png

echo "=========================================================="
echo "✅ APK TEST COMPLETED SUCCESSFULLY IN CODESPACE!"
echo "=========================================================="

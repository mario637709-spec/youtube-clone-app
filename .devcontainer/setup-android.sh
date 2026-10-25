#!/bin/bash
set -e
echo "Setting up Android SDK environment in Codespace..."

# Set environment variables
export ANDROID_HOME=${ANDROID_HOME:-"/usr/local/lib/android/sdk"}
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

# Accept licenses if sdkmanager exists
if command -v sdkmanager &> /dev/null; then
    yes | sdkmanager --licenses || true
fi

echo "Android environment ready!"

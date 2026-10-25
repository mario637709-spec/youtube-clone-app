#!/bin/bash
set -e

echo "==========================================="
echo "📱 Building YouTube Clone Android APK..."
echo "==========================================="

cd frontend
echo "1. Installing frontend dependencies..."
npm install --legacy-peer-deps

echo "2. Building static Next.js export..."
CAPACITOR_BUILD=true npx next build

echo "3. Syncing web build to Capacitor Android..."
npx cap sync android

echo "4. Compiling Android APK with Gradle..."
cd android
chmod +x ./gradlew
./gradlew assembleDebug --no-daemon

echo ""
echo "================================================================="
echo "🎉 SUCCESS! Android APK Generated Successfully:"
echo "File: frontend/android/app/build/outputs/apk/debug/app-debug.apk"
echo "================================================================="

// Central API base config — saari jagah isi ko import karo.
import { Capacitor } from '@capacitor/core';

const RENDER_BACKEND = 'https://kiro-youtube-app-backend.onrender.com/api';

const getApiBase = () => {
  // If explicitly building for Capacitor / APK
  if (process.env.NEXT_PUBLIC_IS_CAPACITOR === 'true' || process.env.CAPACITOR_BUILD === 'true') {
    return process.env.NEXT_PUBLIC_API_URL || RENDER_BACKEND;
  }

  if (typeof window !== 'undefined') {
    // 1. Native mobile app check via Capacitor SDK
    try {
      if (Capacitor.isNativePlatform()) {
        return process.env.NEXT_PUBLIC_API_URL || RENDER_BACKEND;
      }
    } catch {}

    const { hostname, protocol } = window.location;
    const ua = navigator.userAgent || '';
    const isAndroidOrWebView = ua.includes('Android') || ua.includes('wv') || ua.includes('Capacitor');

    // 2. Android WebView or Capacitor scheme
    if (protocol === 'capacitor:' || protocol === 'ionic:' || isAndroidOrWebView) {
      return process.env.NEXT_PUBLIC_API_URL || RENDER_BACKEND;
    }

    // 3. Local desktop browser development
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    if (isLocal && !isAndroidOrWebView) {
      return 'http://localhost:5000/api';
    }

    // 4. Production web
    if (process.env.NEXT_PUBLIC_API_URL && !process.env.NEXT_PUBLIC_API_URL.includes('localhost')) {
      return process.env.NEXT_PUBLIC_API_URL;
    }
    return RENDER_BACKEND;
  }

  return process.env.NEXT_PUBLIC_API_URL || RENDER_BACKEND;
};

export const API_BASE_URL = getApiBase();
export const getApiBaseUrl = () => getApiBase();

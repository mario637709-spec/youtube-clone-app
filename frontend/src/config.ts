// Central API base config — saari jagah isi ko import karo.
//
// Priority:
//   1. Mobile Capacitor / Native App -> Live Render backend
//   2. Local Browser Dev (localhost:3000) -> Local backend (localhost:5000)
//   3. Production Web -> NEXT_PUBLIC_API_URL or live Render backend

const getApiBase = () => {
  if (typeof window !== 'undefined') {
    const { hostname, protocol } = window.location;
    
    // Check if running inside mobile Capacitor App (Android / iOS)
    const isCapacitor = protocol === 'capacitor:' || (window as any).Capacitor !== undefined;
    if (isCapacitor) {
      return process.env.NEXT_PUBLIC_API_URL || 'https://kiro-youtube-app-backend.onrender.com/api';
    }

    // Local development in browser
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    if (isLocal) {
      return 'http://localhost:5000/api';
    }
    
    // In production browser, use NEXT_PUBLIC_API_URL if configured
    if (process.env.NEXT_PUBLIC_API_URL && !process.env.NEXT_PUBLIC_API_URL.includes('localhost')) {
      return process.env.NEXT_PUBLIC_API_URL;
    }
    return 'https://kiro-youtube-app-backend.onrender.com/api';
  }

  return process.env.NEXT_PUBLIC_API_URL || 'https://kiro-youtube-app-backend.onrender.com/api';
};

export const API_BASE_URL = getApiBase();
export const getApiBaseUrl = () => getApiBase();

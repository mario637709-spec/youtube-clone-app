// ───────────────────────────────────────────────────────────────────
// Central API base config — saari jagah isi ko import karo.
//
// Priority:
//   1. NEXT_PUBLIC_API_URL (build-time env — Render/Vercel pe set karo)
//   2. Dev: http://localhost:5000/api (local backend)
//   3. Same-origin fallback: /api (agar backend frontend ke saath serve ho)
// ───────────────────────────────────────────────────────────────────

const getApiBase = () => {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;

  if (typeof window !== 'undefined') {
    const { hostname } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    if (isLocal) return 'http://localhost:5000/api';
    // Production same-origin: assume backend served alongside frontend
    return '/api';
  }

  return 'http://localhost:5000/api';
};

export const API_BASE_URL = getApiBase();

export const getApiBaseUrl = () => getApiBase();

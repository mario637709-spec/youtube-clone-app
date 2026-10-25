/**
 * ═══════════════════════════════════════════════════════════════════
 *  MICROSERVICE 1: healthMonitor.js
 *  ─────────────────────────────────────────────────────────────────
 *  📋 KYA KARTA HAI:
 *     Har service (Piped, Invidious, etc.) ka health track karta hai.
 *     Agar koi service down ho → usse skip karta hai.
 *     Har 2 minute mein sab services ko ping karta hai.
 *
 *  ✅ KAB KAAM KARTA HAI:
 *     Hamesha — ye sirf monitoring karta hai, koi bandwidth use nahi
 *
 *  ❌ KAHAN FAIL HO SAKTA HAI:
 *     Agar network hi down ho toh sab services unhealthy dikhenge
 *
 *  💡 KAISE KAAM KARTA HAI:
 *     Service → ping → response time < 3s → HEALTHY
 *                   → timeout / error    → UNHEALTHY (2 min retry)
 * ═══════════════════════════════════════════════════════════════════
 */

const axios = require('axios');

// ─── Service Registry ─────────────────────────────────────────────
const SERVICES = {
  // ┌─────────────────────────────────────────────────────────────┐
  // │  PIPED — Free YT proxy, multiple public instances           │
  // │  Pros: Fast, no auth, multiple instances                    │
  // │  Cons: Public servers, may go down, rate limits             │
  // └─────────────────────────────────────────────────────────────┘
  piped: [
    { url: 'https://pipedapi.kavin.rocks',       name: 'piped-kavin'   },
    { url: 'https://pipedapi.lunar.icu',          name: 'piped-lunar'   },
    { url: 'https://api.piped.yt',                name: 'piped-main'    },
    { url: 'https://piped-api.garudalinux.org',   name: 'piped-garuda'  },
    { url: 'https://piped-api.privacydev.net',    name: 'piped-privacy' },
  ],

  // ┌─────────────────────────────────────────────────────────────┐
  // │  INVIDIOUS — Another free YT proxy, open source            │
  // │  Pros: Completely open, no tracking                         │
  // │  Cons: Slower, often overloaded                             │
  // └─────────────────────────────────────────────────────────────┘
  invidious: [
    { url: 'https://inv.nadeko.net',              name: 'inv-nadeko'    },
    { url: 'https://invidious.privacyredirect.com', name: 'inv-privacy' },
    { url: 'https://yt.drgnz.club',               name: 'inv-drgnz'    },
    { url: 'https://invidious.nerdvpn.de',         name: 'inv-nerdvpn'  },
  ],
};

// ─── Health State Store ───────────────────────────────────────────
const healthState = new Map(); // name → { healthy, lastCheck, responseTime, failures }

// ─── Init all as unknown ──────────────────────────────────────────
const initHealth = () => {
  [...SERVICES.piped, ...SERVICES.invidious].forEach(s => {
    healthState.set(s.name, {
      healthy: true,         // Assume healthy until proven otherwise
      lastCheck: null,
      responseTime: null,
      failures: 0,
      url: s.url,
      type: SERVICES.piped.includes(s) ? 'piped' : 'invidious',
    });
  });
};

// ─── Ping a single service ────────────────────────────────────────
const pingService = async (service) => {
  const state = healthState.get(service.name);
  const pingUrl = `${service.url}/stats`;
  const start = Date.now();

  try {
    await axios.get(pingUrl, { timeout: 3000 });
    const rt = Date.now() - start;

    healthState.set(service.name, {
      ...state,
      healthy: true,
      lastCheck: Date.now(),
      responseTime: rt,
      failures: 0,
    });

    return true;
  } catch {
    const failures = (state.failures || 0) + 1;
    healthState.set(service.name, {
      ...state,
      healthy: failures < 3,   // 3 consecutive fails → mark unhealthy
      lastCheck: Date.now(),
      responseTime: null,
      failures,
    });

    return false;
  }
};

// ─── Check all services ───────────────────────────────────────────
const checkAll = async () => {
  const allServices = [...SERVICES.piped, ...SERVICES.invidious];
  await Promise.allSettled(allServices.map(pingService));
  console.log('[HealthMonitor] Check complete:', getStatusSummary());
};

// ─── Get best available instance of a type ───────────────────────
const getBestInstance = (type) => {
  const list = SERVICES[type] || [];
  // Sort by: healthy first, then by response time
  const healthy = list
    .map(s => ({ ...s, state: healthState.get(s.name) }))
    .filter(s => s.state?.healthy !== false)
    .sort((a, b) => (a.state?.responseTime || 9999) - (b.state?.responseTime || 9999));

  return healthy.length > 0 ? healthy[0].url : list[0].url; // fallback to first if all down
};

// ─── Get all healthy Piped instances (rotation) ───────────────────
const getHealthyPipedInstances = () => {
  return SERVICES.piped
    .map(s => ({ ...s, state: healthState.get(s.name) }))
    .filter(s => s.state?.healthy !== false)
    .sort((a, b) => (a.state?.responseTime || 9999) - (b.state?.responseTime || 9999))
    .map(s => s.url);
};

// ─── Get all healthy Invidious instances ─────────────────────────
const getHealthyInvidiousInstances = () => {
  return SERVICES.invidious
    .map(s => ({ ...s, state: healthState.get(s.name) }))
    .filter(s => s.state?.healthy !== false)
    .map(s => s.url);
};

// ─── Status summary for logs/API ─────────────────────────────────
const getStatusSummary = () => {
  const summary = {};
  healthState.forEach((state, name) => {
    summary[name] = state.healthy ? `✅ ${state.responseTime}ms` : `❌ dead`;
  });
  return summary;
};

// ─── Full status for /api/stream/health endpoint ──────────────────
const getFullStatus = () => {
  const result = { piped: [], invidious: [], checkedAt: new Date().toISOString() };
  SERVICES.piped.forEach(s => {
    const st = healthState.get(s.name);
    result.piped.push({ name: s.name, url: s.url, ...st });
  });
  SERVICES.invidious.forEach(s => {
    const st = healthState.get(s.name);
    result.invidious.push({ name: s.name, url: s.url, ...st });
  });
  return result;
};

// ─── Start auto health check loop ────────────────────────────────
const start = () => {
  initHealth();
  // First check after 5s (let server start first)
  setTimeout(checkAll, 5000);
  // Then every 2 minutes
  setInterval(checkAll, 2 * 60 * 1000);
  console.log('[HealthMonitor] 🟢 Started — monitoring Piped + Invidious instances');
};

module.exports = {
  start,
  checkAll,
  getBestInstance,
  getHealthyPipedInstances,
  getHealthyInvidiousInstances,
  getFullStatus,
  getStatusSummary,
  SERVICES,
};

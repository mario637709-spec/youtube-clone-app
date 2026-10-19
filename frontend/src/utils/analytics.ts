// @ts-nocheck
// Analytics signal sender — har user action ko recommendation engine tak pahunchata hai.
// Logged-in → JWT header (server user profile update karta hai)
// Guest    → guestId (server guest_profiles me store karta hai)

import { apiClient } from './api';

let guestId = null;

export const getGuestId = () => {
  if (!guestId) {
    try {
      guestId = localStorage.getItem('guest_id');
      if (!guestId) {
        guestId = 'g_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem('guest_id', guestId);
      }
    } catch (e) {
      guestId = 'g_anon';
    }
  }
  return guestId;
};

// Silently send a signal — fail kabhi block nahi karta playback ko
export const fireEvent = async (type, videoId, extra = {}) => {
  try {
    await apiClient.post('/events', {
      type,
      videoId,
      guestId: getGuestId(),
      ...extra,
    });
  } catch (e) {
    // personalization is non-critical — ignore
  }
};
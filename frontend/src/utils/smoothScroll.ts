// @ts-nocheck
// Disabled: custom lerp wheel-hijack caused janky scroll ("tattti") and
// fought the browser's native smooth scrolling / touchpad momentum.
// Native browser scroll is used instead (silky on Windows touchpads/wheels).
export const initSmoothScroll = () => {
  if (typeof window === 'undefined') return;
  return () => {};
};
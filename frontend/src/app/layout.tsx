"use client";
// @ts-nocheck
import React, { useEffect, Suspense } from 'react';
import useAuthStore from '@/store/authStore';
import { initSmoothScroll } from '@/utils/smoothScroll';
import MobileBottomNav from '@/components/MobileBottomNav/MobileBottomNav';
import { ThemeProvider } from '@/theme/ThemeSystem';
import '@/theme/ThemeSystem.css';
import '../App.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const loadUser = useAuthStore(state => state.loadUser);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(
        (registration) => {
          console.log('[SW] ServiceWorker registration successful with scope: ', registration.scope);
        },
        (err) => {
          console.log('[SW] ServiceWorker registration failed: ', err);
        }
      );
    }
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    const cleanup = initSmoothScroll();
    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  // Initialize device detection (shared with inline script)
  useEffect(() => {
    const d = document.documentElement;
    const ua = navigator.userAgent;
    const isPhone = /Android|iPhone|iPod|iPad|Windows Phone|Mobile|Opera Mini|IEMobile/i.test(ua) || (navigator.maxTouchPoints > 1 && Math.min(window.innerWidth, window.innerHeight) < 768);
    d.setAttribute('data-device', isPhone ? 'phone' : 'desktop');
    const handleResize = () => {
      const now = window.matchMedia('(max-width: 640px)').matches || /Android|iPhone|iPod|iPad|Mobile/i.test(navigator.userAgent);
      d.setAttribute('data-device', now ? 'phone' : 'desktop');
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Manrope:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&family=Public+Sans:wght@400;500;600;700&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  var d = document.documentElement;
  var ua = navigator.userAgent;
  var isPhone = /Android|iPhone|iPod|iPad|Windows Phone|Mobile|Opera Mini|IEMobile/i.test(ua) || (navigator.maxTouchPoints > 1 && Math.min(window.innerWidth, window.innerHeight) < 768);
  d.setAttribute('data-device', isPhone ? 'phone' : 'desktop');
  window.addEventListener('resize', function(){
    var now = window.matchMedia('(max-width: 640px)').matches || /Android|iPhone|iPod|iPad|Mobile/i.test(navigator.userAgent);
    d.setAttribute('data-device', now ? 'phone' : 'desktop');
  });
})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <div className="App">
          <ThemeProvider>
            {children}
            <MobileBottomNav />
          </ThemeProvider>
        </div>
      </body>
    </html>
  );
}

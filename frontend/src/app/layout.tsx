"use client";
// @ts-nocheck
import React, { useEffect } from 'react';
import useAuthStore from '@/store/authStore';
import { getCookie } from '@/utils/cookies';
import { initSmoothScroll } from '@/utils/smoothScroll';
import MobileBottomNav from '@/components/MobileBottomNav/MobileBottomNav';
import '../index.css';
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

  useEffect(() => {
    const savedTheme = typeof window !== 'undefined' ? (localStorage.getItem('yt_theme') || getCookie('yt_theme') || 'dark') : 'dark';
    
    const applyTheme = (theme) => {
      let resolved = theme;
      if (theme === 'device' && typeof window !== 'undefined') {
        resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      document.body.setAttribute('data-theme', resolved);
    };

    applyTheme(savedTheme);
  }, []);

  return (
    <html lang="en" className="dark" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  window.exports = window.exports || {};
  window.module = window.module || { exports: window.exports };
  var d = document.documentElement;
  d.setAttribute('data-theme', 'dark');
  d.classList.add('dark');
  document.body && document.body.setAttribute('data-theme', 'dark');
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
      <body className="dark" data-theme="dark" suppressHydrationWarning>
        <div className="App">
          {children}
          <MobileBottomNav />
        </div>
      </body>
    </html>
  );
}

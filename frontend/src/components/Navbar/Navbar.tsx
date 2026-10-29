"use client";
// @ts-nocheck
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import useAuthStore from '@/store/authStore';
import AuthModal from '../AuthModal/AuthModal';
import { apiClient } from '@/utils/api';
import './Navbar.css';

const Navbar = ({ onMenuClick }) => {
  const router = useRouter();
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState('');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [subMenu, setSubMenu] = useState(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const user = useAuthStore(state => state.user);
  const logout = useAuthStore(state => state.logout);
  const loadUser = useAuthStore(state => state.loadUser);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 8);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setSubMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
      if (searchRef.current) searchRef.current.blur();
    }
  };

  const handleVoiceSearch = () => {
    if (!('webkitSpeechRecognition' in window)) return;
    const recognition = new (window as any).webkitSpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    setMicActive(true);
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0].transcript)
        .join('');
      setSearchQuery(transcript);
    };
    recognition.onend = () => setMicActive(false);
    recognition.onerror = () => setMicActive(false);
    recognition.start();
  };

  const handleLogout = async () => {
    try {
      await apiClient.post('/auth/logout');
      logout();
      loadUser();
      router.push('/');
    } catch (err) {
      console.error('Logout failed:', err);
    }
    setMenuOpen(false);
  };

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/');

  return (
    <header className={`aura-navbar ${isScrolled ? 'scrolled' : ''}`} role="banner">
      <nav className="aura-navbar-inner" aria-label="Main navigation">
        {/* ── Left: Menu + Logo ── */}
        <div className="aura-navbar-left">
          <button
            className="aura-nav-btn aura-menu-btn"
            onClick={() => { setMenuOpen(!menuOpen); if (menuOpen) setSubMenu(null); }}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              {menuOpen ? 'close' : 'menu'}
            </span>
          </button>

          <Link href="/" className="aura-logo" aria-label="AuraTube Home">
            <svg className="aura-logo-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M23.498 6.186a3.166 3.166 0 0 0-2.122-2.686C19.505 3.08 12 3.08 12 3.08s-7.505 0-9.377 0.423a3.166 3.166 0 0 0-2.122 2.686C0.43 7.263 0 8.34 0 9.653v5.394c0 1.313 0.43 2.39 1.001 3.463a3.165 3.165 0 0 0 2.122 2.686C4.495 20.92 12 20.92 12 20.92s7.505 0 9.377-0.423a3.166 3.166 0 0 0 2.122-2.686c0.57-1.073 1-2.15 1-3.463v-5.394c0-1.313-0.43-2.39-1-3.463ZM9.545 15.568V8.432L15.818 12 9.545 15.568Z"/>
            </svg>
            <span className="aura-logo-text">AuraTube</span>
          </Link>
        </div>

        {/* ── Center: Search ── */}
        <div className="aura-navbar-center">
          <form className="aura-search" onSubmit={handleSearch} role="search">
            <label htmlFor="search-input" className="aura-sr-only">Search</label>
            <span className="aura-search-icon material-symbols-outlined" aria-hidden="true">search</span>
            <input
              ref={searchRef}
              id="search-input"
              type="search"
              className="aura-search-input"
              placeholder="Search"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoComplete="off"
              aria-label="Search videos"
            />
            <button
              type="button"
              className={`aura-nav-btn aura-voice-btn ${micActive ? 'active' : ''}`}
              onClick={handleVoiceSearch}
              aria-label={micActive ? 'Listening... click to stop' : 'Search by voice'}
            >
              <span className="material-symbols-outlined" aria-hidden="true">{micActive ? 'mic' : 'mic_none'}</span>
              {micActive && <span className="aura-mic-ring" aria-hidden="true"></span>}
            </button>
          </form>
        </div>

        {/* ── Right: Actions ── */}
        <div className="aura-navbar-right">
          <Link href="/shorts" className={`aura-nav-btn ${isActive('/shorts') ? 'active' : ''}`} aria-label="Shorts">
            <span className="material-symbols-outlined" aria-hidden="true">ondemand_video</span>
          </Link>

          <Link href="/upload" className={`aura-nav-btn ${isActive('/upload') ? 'active' : ''}`} aria-label="Create">
            <span className="material-symbols-outlined" aria-hidden="true">add_circle_outline</span>
            <span className="material-symbols-outlined filled" aria-hidden="true" style={{display: isActive('/upload') ? 'inline' : 'none'}}>add_circle</span>
          </Link>

          {user ? (
            <>
              <Link href="/notifications" className={`aura-nav-btn ${isActive('/notifications') ? 'active' : ''}`} aria-label="Notifications">
                <span className="material-symbols-outlined" aria-hidden="true">notifications_none</span>
                <span className="material-symbols-outlined filled" aria-hidden="true" style={{display: isActive('/notifications') ? 'inline' : 'none'}}>notifications</span>
              </Link>

              <div className="aura-avatar-menu">
                <button
                  className="aura-avatar-btn"
                  onClick={() => { setMenuOpen(!menuOpen); setSubMenu(null); }}
                  aria-label="Account menu"
                  aria-expanded={menuOpen}
                  aria-haspopup="true"
                >
                  <span className="aura-avatar" style={{background: 'var(--aura-gradient-brand)'}}>
                    {user.avatar ? (
                      <img src={user.avatar} alt="" aria-hidden="true" />
                    ) : (
                      <span className="material-symbols-outlined" aria-hidden="true">person</span>
                    )}
                    <span className="aura-avatar-ring" aria-hidden="true"></span>
                  </span>
                </button>

                {menuOpen && (
                  <div className="aura-dropdown" role="menu" ref={menuRef}>
                    {!subMenu ? (
                      <>
                        <div className="aura-dropdown-header">
                          <div className="aura-user-info">
                            <span className="aura-avatar aura-avatar-lg" style={{background: 'var(--aura-gradient-brand)'}}>
                              {user.avatar ? <img src={user.avatar} alt="" /> : <span className="material-symbols-outlined">person</span>}
                            </span>
                            <div className="aura-user-meta">
                              <span className="aura-user-name">{user.name || 'User'}</span>
                              <span className="aura-user-handle">@{user.handle || 'user'}</span>
                            </div>
                          </div>
                        </div>
                        <hr className="aura-dropdown-divider" />
                        <div className="aura-dropdown-section">
                          <Link href="/channel/me" className="aura-dropdown-item" role="menuitem" onClick={() => { setMenuOpen(false); }}>
                            <span className="material-symbols-outlined" aria-hidden="true">dashboard</span>
                            <span>Your channel</span>
                          </Link>
                          <Link href="/feed/subscriptions" className="aura-dropdown-item" role="menuitem" onClick={() => { setMenuOpen(false); }}>
                            <span className="material-symbols-outlined" aria-hidden="true">subscriptions</span>
                            <span>Subscriptions</span>
                          </Link>
                          <Link href="/history" className="aura-dropdown-item" role="menuitem" onClick={() => { setMenuOpen(false); }}>
                            <span className="material-symbols-outlined" aria-hidden="true">history</span>
                            <span>History</span>
                          </Link>
                          <Link href="/feed/library" className="aura-dropdown-item" role="menuitem" onClick={() => { setMenuOpen(false); }}>
                            <span className="material-symbols-outlined" aria-hidden="true">video_library</span>
                            <span>Your videos</span>
                          </Link>
                        </div>
                        <hr className="aura-dropdown-divider" />
                        <div className="aura-dropdown-section">
                          <button className="aura-dropdown-item" role="menuitem" onClick={() => setSubMenu('appearance')}>
                            <span className="material-symbols-outlined" aria-hidden="true">palette</span>
                            <span>Appearance</span>
                            <span className="material-symbols-outlined aura-dropdown-chevron" aria-hidden="true">chevron_right</span>
                          </button>
                          <Link href="/settings" className="aura-dropdown-item" role="menuitem" onClick={() => { setMenuOpen(false); }}>
                            <span className="material-symbols-outlined" aria-hidden="true">settings</span>
                            <span>Settings</span>
                          </Link>
                        </div>
                        <hr className="aura-dropdown-divider" />
                        <button className="aura-dropdown-item aura-dropdown-danger" role="menuitem" onClick={handleLogout}>
                          <span className="material-symbols-outlined" aria-hidden="true">logout</span>
                          <span>Sign out</span>
                        </button>
                      </>
                    ) : subMenu === 'appearance' && (
                      <div className="aura-submenu">
                        <button className="aura-submenu-header" onClick={() => setSubMenu(null)}>
                          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
                          <span>Appearance</span>
                        </button>
                        <hr className="aura-dropdown-divider" />
                        <div className="aura-theme-options">
                          <button className="aura-theme-option active" role="menuitemradio" aria-checked="true">
                            <span className="aura-theme-swatch aura-theme-aura" aria-hidden="true"></span>
                            <span className="aura-theme-name">Aura (Default)</span>
                            <span className="aura-theme-desc">Light blue · Pink · Purple</span>
                          </button>
                          <button className="aura-theme-option" role="menuitemradio" aria-checked="false">
                            <span className="aura-theme-swatch aura-theme-light" aria-hidden="true"></span>
                            <span className="aura-theme-name">Light</span>
                            <span className="aura-theme-desc">Clean white theme</span>
                          </button>
                          <button className="aura-theme-option" role="menuitemradio" aria-checked="false">
                            <span className="aura-theme-swatch aura-theme-dark" aria-hidden="true"></span>
                            <span className="aura-theme-name">Dark</span>
                            <span className="aura-theme-desc">OLED-friendly dark</span>
                          </button>
                          <button className="aura-theme-option" role="menuitemradio" aria-checked="false">
                            <span className="aura-theme-swatch aura-theme-device" aria-hidden="true"></span>
                            <span className="aura-theme-name">Device</span>
                            <span className="aura-theme-desc">Match system setting</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <button className="aura-btn aura-btn-primary aura-signin-btn" onClick={() => setAuthModalOpen(true)}>
              Sign in
            </button>
          )}

          {authModalOpen && <AuthModal onClose={() => setAuthModalOpen(false)} />}
        </div>
      </nav>
    </header>
  );
};

export default Navbar;
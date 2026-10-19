"use client";
// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import useAuthStore from '@/store/authStore';
import AuthModal from '../AuthModal/AuthModal';
import { getCookie, setCookie } from '@/utils/cookies';
import { apiClient } from '@/utils/api';
import './Navbar.css';

const Navbar = ({ onMenuClick }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [subMenu, setSubMenu] = useState(null); // 'appearance' | 'language' | 'location' | null
  
  // Settings states loaded from storage/cookies
  const [theme, setTheme] = useState('dark');
  const [language, setLanguage] = useState('British English');
  const [location, setLocation] = useState('India');
  const [restrictedMode, setRestrictedMode] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const settings = getCookie('yt_settings') || {};
      
      const storedTheme = settings.theme || localStorage.getItem('yt_theme');
      if (storedTheme) setTheme(storedTheme);
      
      const storedLang = settings.language || localStorage.getItem('yt_language');
      if (storedLang) setLanguage(storedLang);

      const storedLoc = settings.location || localStorage.getItem('yt_location');
      if (storedLoc) setLocation(storedLoc);

      const storedRestricted = settings.restrictedMode !== undefined ? settings.restrictedMode : localStorage.getItem('yt_restricted');
      if (storedRestricted !== undefined && storedRestricted !== null) setRestrictedMode(storedRestricted === 'true' || storedRestricted === true);
    }
  }, []);

  // Modal states
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [googleAccountOpen, setGoogleAccountOpen] = useState(false);
  const [switchAccountOpen, setSwitchAccountOpen] = useState(false);
  const [purchasesOpen, setPurchasesOpen] = useState(false);
  const [dataPrivacyOpen, setDataPrivacyOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');

  const { user, logout, setUser } = useAuthStore();
  const router = useRouter();

  const menuRef = useRef(null);
  const avatarRef = useRef(null);

  // Sync settings from logged-in user profile on load
  useEffect(() => {
    if (user && user.settings) {
      if (user.settings.theme && user.settings.theme !== theme) {
        setTheme(user.settings.theme);
      }
      if (user.settings.language && user.settings.language !== language) {
        setLanguage(user.settings.language);
      }
      if (user.settings.location && user.settings.location !== location) {
        setLocation(user.settings.location);
      }
      if (user.settings.restrictedMode !== undefined && user.settings.restrictedMode !== restrictedMode) {
        setRestrictedMode(user.settings.restrictedMode);
      }
    }
  }, [user]);

  // Helper to persist settings in database
  const updateSettingsInDb = async (newTheme, newLang, newLoc, newRestricted) => {
    if (!user) return;
    try {
      const updatedUser = await apiClient.put('/users', {
        settings: {
          theme: newTheme !== undefined ? newTheme : theme,
          language: newLang !== undefined ? newLang : language,
          location: newLoc !== undefined ? newLoc : location,
          restrictedMode: newRestricted !== undefined ? newRestricted : restrictedMode
        }
      });
      setUser(prev => ({
        ...prev,
        settings: updatedUser.settings || {}
      }));
    } catch (err) {
      console.error('Failed to save settings to database:', err);
    }
  };

  // Close dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (
        menuOpen &&
        menuRef.current &&
        !menuRef.current.contains(e.target) &&
        avatarRef.current &&
        !avatarRef.current.contains(e.target)
      ) {
        setMenuOpen(false);
        setSubMenu(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [menuOpen]);

  // Apply theme dynamically when theme changes
  useEffect(() => {
    const applyTheme = (t) => {
      let resolved = t;
      if (t === 'device') {
        resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      document.body.setAttribute('data-theme', resolved);
    };
    applyTheme(theme);
  }, [theme]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  const handleNotificationClick = () => {
    alert("Notifications:\n1. Tech Explorer uploaded a new video.\n2. Someone commented on your video.\n3. Your upload was successful.");
  };

  const handleUploadClick = () => {
    if (!user) {
      setAuthModalOpen(true);
    } else {
      router.push('/upload');
    }
  };

  const handleProfileClick = () => {
    setMenuOpen(!menuOpen);
    setSubMenu(null);
  };

  const handleThemeChange = (newTheme) => {
    setTheme(newTheme);
    localStorage.setItem('yt_theme', newTheme);
    const settings = getCookie('yt_settings') || {};
    setCookie('yt_settings', {
      ...settings,
      theme: newTheme,
      language,
      location,
      restrictedMode
    });
    updateSettingsInDb(newTheme, language, location, restrictedMode);
  };

  const handleLanguageChange = (newLang) => {
    setLanguage(newLang);
    localStorage.setItem('yt_language', newLang);
    const settings = getCookie('yt_settings') || {};
    setCookie('yt_settings', {
      ...settings,
      theme,
      language: newLang,
      location,
      restrictedMode
    });
    setSubMenu(null);
    updateSettingsInDb(theme, newLang, location, restrictedMode);
  };

  const handleLocationChange = (newLoc) => {
    setLocation(newLoc);
    localStorage.setItem('yt_location', newLoc);
    const settings = getCookie('yt_settings') || {};
    setCookie('yt_settings', {
      ...settings,
      theme,
      language,
      location: newLoc,
      restrictedMode
    });
    setSubMenu(null);
    updateSettingsInDb(theme, language, newLoc, restrictedMode);
  };

  const handleRestrictedToggle = () => {
    const val = !restrictedMode;
    setRestrictedMode(val);
    localStorage.setItem('yt_restricted', val);
    const settings = getCookie('yt_settings') || {};
    setCookie('yt_settings', {
      ...settings,
      theme,
      language,
      location,
      restrictedMode: val
    });
    updateSettingsInDb(theme, language, location, val);
  };

  const handleFeedbackSubmit = (e) => {
    e.preventDefault();
    if (feedbackText.trim()) {
      alert(`Thank you for your feedback!\nSubmitted: "${feedbackText}"`);
      setFeedbackText('');
      setFeedbackOpen(false);
    }
  };

  const handleSwitchAccount = (profile) => {
    setUser({
      id: profile.id,
      username: profile.username,
      email: profile.email,
      channelName: profile.channelName,
      avatar: profile.avatar
    });
    setSwitchAccountOpen(false);
    setMenuOpen(false);
    alert(`Switched to profile: ${profile.channelName}`);
  };

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <button className="menu-btn" onClick={onMenuClick}>
          <svg viewBox="0 0 24 24" width="24" height="24">
            <path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
          </svg>
        </button>
        <div className="logo" onClick={() => router.push('/')} style={{ cursor: 'pointer' }}>
          <svg viewBox="0 0 90 20" width="90" height="20">
            <path fill="#FF0000" d="M27.9727 3.12324C27.6435 1.89323 26.6768 0.926623 25.4468 0.597366C23.2197 0 14.285 0 14.285 0C14.285 0 5.35042 0 3.12323 0.597366C1.89323 0.926623 0.926623 1.89323 0.597366 3.12324C0 5.35042 0 10 0 10C0 10 0 14.6496 0.597366 16.8768C0.926623 18.1068 1.89323 19.0734 3.12323 19.4026C5.35042 20 14.285 20 14.285 20C14.285 20 23.2197 20 25.4468 19.4026C26.6768 19.0734 27.6435 18.1068 27.9727 16.8768C28.5701 14.6496 28.5701 10 28.5701 10C28.5701 10 28.5677 5.35042 27.9727 3.12324Z"/>
            <path fill="#FFF" d="M11.4253 14.2854L18.8477 10.0004L11.4253 5.71533V14.2854Z"/>
          </svg>
          <span className="logo-text">YouTube</span>
        </div>
      </div>

      <div className="navbar-center">
        <form className="search-form" onSubmit={handleSearch}>
          <input
            type="text"
            className="search-input"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button type="submit" className="search-btn">
            <svg viewBox="0 0 24 24" width="24" height="24">
              <path fill="currentColor" d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
          </button>
        </form>
        <button className="voice-search-btn" onClick={() => alert("Voice search is not supported on this browser demo.")}>
          <svg viewBox="0 0 24 24" width="24" height="24">
            <path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
            <path fill="currentColor" d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
        </button>
      </div>

      <div className="navbar-right" style={{ position: 'relative' }}>
        <button className="icon-btn" onClick={handleUploadClick} title="Upload Video">
          <svg viewBox="0 0 24 24" width="24" height="24">
            <path fill="currentColor" d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
          </svg>
        </button>
        <button className="icon-btn" onClick={handleNotificationClick} title="Notifications">
          <svg viewBox="0 0 24 24" width="24" height="24">
            <path fill="currentColor" d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z"/>
          </svg>
          <span className="notification-badge">3</span>
        </button>
        <div 
          ref={avatarRef}
          className="user-avatar" 
          onClick={handleProfileClick} 
          style={{ cursor: 'pointer' }} 
          title={user ? "Profile Settings" : "Sign In"}
        >
          <img src={user ? user.avatar : "https://ui-avatars.com/api/?name=Guest&background=888&color=fff"} alt="User" />
        </div>

        {/* Dynamic Animated Settings Dropdown Menu */}
        {menuOpen && (
          <div ref={menuRef} className="yt-dropdown-menu">
            {subMenu === null && (
              <div className="yt-menu-main animate-slide-down">
                {/* Header Section */}
                <div className="yt-menu-header">
                  <img src={user ? user.avatar : "https://ui-avatars.com/api/?name=Guest&background=888&color=fff"} alt="User" className="yt-header-avatar" />
                  <div className="yt-header-details">
                    <h4 className="yt-header-name">{user ? user.channelName || user.username : "Guest User"}</h4>
                    <p className="yt-header-handle">{user ? `@${user.username || 'guest'}` : "@guest_user"}</p>
                    {user && (
                      <Link href={`/channel/${user.id}`} className="yt-header-link" onClick={() => setMenuOpen(false)}>
                        View your channel
                      </Link>
                    )}
                  </div>
                </div>
                
                <hr className="yt-menu-divider" />
                
                {/* Google Account details */}
                {user ? (
                  <>
                    <button className="yt-menu-item" onClick={() => { setGoogleAccountOpen(true); setMenuOpen(false); }}>
                      <svg viewBox="0 0 24 24" width="20" height="20" className="yt-menu-icon"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                      <span className="yt-menu-text">Google Account</span>
                    </button>
                    <button className="yt-menu-item" onClick={() => { setSwitchAccountOpen(true); setMenuOpen(false); }}>
                      <svg viewBox="0 0 24 24" width="20" height="20" className="yt-menu-icon"><path fill="currentColor" d="M19 8l-4 4h3c0 3.31-2.69 6-6 6-1.01 0-1.97-.25-2.8-.7l-1.46 1.46C8.97 19.54 10.43 20 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46C15.03 4.46 13.57 4 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z"/></svg>
                      <span className="yt-menu-text">Switch account</span>
                      <span className="yt-menu-arrow">&rsaquo;</span>
                    </button>
                    <button className="yt-menu-item" onClick={() => { logout(); setMenuOpen(false); }}>
                      <svg viewBox="0 0 24 24" width="20" height="20" className="yt-menu-icon"><path fill="currentColor" d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
                      <span className="yt-menu-text">Sign out</span>
                    </button>
                  </>
                ) : (
                  <button className="yt-menu-item sign-in-highlight" onClick={() => { setAuthModalOpen(true); setMenuOpen(false); }}>
                    <svg viewBox="0 0 24 24" width="20" height="20" className="yt-menu-icon"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
                    <span className="yt-menu-text">Sign In</span>
                  </button>
                )}

                <hr className="yt-menu-divider" />

                {/* Studio and purchases */}
                <button className="yt-menu-item" onClick={() => { router.push('/upload'); setMenuOpen(false); }}>
                  <svg viewBox="0 0 24 24" width="20" height="20" className="yt-menu-icon"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.5 14H8c-1.1 0-2-.9-2-2V9c0-1.1.9-2 2-2h8.5c1.1 0 2 .9 2 2v5c0 1.1-.9 2-2 2zM10 8.5v7l6-3.5-6-3.5z"/></svg>
                  <span className="yt-menu-text">YouTube Studio</span>
                </button>
                <button className="yt-menu-item" onClick={() => { setPurchasesOpen(true); setMenuOpen(false); }}>
                  <svg viewBox="0 0 24 24" width="20" height="20" className="yt-menu-icon"><path fill="currentColor" d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
                  <span className="yt-menu-text">Purchases and memberships</span>
                </button>

                <hr className="yt-menu-divider" />

                {/* Settings list */}
                <button className="yt-menu-item" onClick={() => { setDataPrivacyOpen(true); setMenuOpen(false); }}>
                  <svg viewBox="0 0 24 24" width="20" height="20" className="yt-menu-icon"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                  <span className="yt-menu-text">Your data in YouTube</span>
                </button>

                <button className="yt-menu-item" onClick={() => setSubMenu('appearance')}>
                  <svg viewBox="0 0 24 24" width="20" height="20" className="yt-menu-icon"><path fill="currentColor" d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/></svg>
                  <span className="yt-menu-text">Appearance: {theme === 'device' ? 'Device theme' : theme === 'dark' ? 'Dark mode' : 'Light mode'}</span>
                  <span className="yt-menu-arrow">&rsaquo;</span>
                </button>

                <button className="yt-menu-item" onClick={() => setSubMenu('language')}>
                  <svg viewBox="0 0 24 24" width="20" height="20" className="yt-menu-icon"><path fill="currentColor" d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>
                  <span className="yt-menu-text">Display language: {language}</span>
                  <span className="yt-menu-arrow">&rsaquo;</span>
                </button>

                <button className="yt-menu-item" onClick={() => setSubMenu('location')}>
                  <svg viewBox="0 0 24 24" width="20" height="20" className="yt-menu-icon"><path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                  <span className="yt-menu-text">Location: {location}</span>
                  <span className="yt-menu-arrow">&rsaquo;</span>
                </button>

                <button className="yt-menu-item" onClick={handleRestrictedToggle}>
                  <svg viewBox="0 0 24 24" width="20" height="20" className="yt-menu-icon"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                  <span className="yt-menu-text">Restricted Mode: {restrictedMode ? 'On' : 'Off'}</span>
                  <span className="yt-menu-arrow">&rsaquo;</span>
                </button>

                <button className="yt-menu-item" onClick={() => { setShortcutsOpen(true); setMenuOpen(false); }}>
                  <svg viewBox="0 0 24 24" width="20" height="20" className="yt-menu-icon"><path fill="currentColor" d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z"/></svg>
                  <span className="yt-menu-text">Keyboard shortcuts</span>
                </button>

                <hr className="yt-menu-divider" />

                <button className="yt-menu-item" onClick={() => { router.push('/profile'); setMenuOpen(false); }}>
                  <svg viewBox="0 0 24 24" width="20" height="20" className="yt-menu-icon"><path fill="currentColor" d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg>
                  <span className="yt-menu-text">Settings</span>
                </button>

                <hr className="yt-menu-divider" />

                <button className="yt-menu-item" onClick={() => alert("For help support, please contact admin@kiro-clone.com.")}>
                  <svg viewBox="0 0 24 24" width="20" height="20" className="yt-menu-icon"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 16h-2v-2h2v2zm1.07-7.75l-.9.92C12.45 11.9 12 12.5 12 14h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.04-.42 1.99-1.07 2.75z"/></svg>
                  <span className="yt-menu-text">Help</span>
                </button>
                <button className="yt-menu-item" onClick={() => { setFeedbackOpen(true); setMenuOpen(false); }}>
                  <svg viewBox="0 0 24 24" width="20" height="20" className="yt-menu-icon"><path fill="currentColor" d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 12h-2v-2h2v2zm0-4h-2V6h2v4z"/></svg>
                  <span className="yt-menu-text">Send feedback</span>
                </button>
              </div>
            )}

            {/* Appearance Sub-Menu */}
            {subMenu === 'appearance' && (
              <div className="yt-menu-sub animate-slide-in">
                <div className="yt-sub-header" onClick={() => setSubMenu(null)}>
                  <span className="yt-sub-back">&larr;</span>
                  <span className="yt-sub-title">Appearance</span>
                </div>
                <hr className="yt-menu-divider" />
                <button className={`yt-sub-item ${theme === 'device' ? 'active' : ''}`} onClick={() => handleThemeChange('device')}>
                  {theme === 'device' && <span className="yt-check-icon">&#10003;</span>}
                  <span className="yt-sub-text">Use device theme</span>
                </button>
                <button className={`yt-sub-item ${theme === 'dark' ? 'active' : ''}`} onClick={() => handleThemeChange('dark')}>
                  {theme === 'dark' && <span className="yt-check-icon">&#10003;</span>}
                  <span className="yt-sub-text">Dark theme</span>
                </button>
                <button className={`yt-sub-item ${theme === 'light' ? 'active' : ''}`} onClick={() => handleThemeChange('light')}>
                  {theme === 'light' && <span className="yt-check-icon">&#10003;</span>}
                  <span className="yt-sub-text">Light theme</span>
                </button>
              </div>
            )}

            {/* Language Sub-Menu */}
            {subMenu === 'language' && (
              <div className="yt-menu-sub animate-slide-in">
                <div className="yt-sub-header" onClick={() => setSubMenu(null)}>
                  <span className="yt-sub-back">&larr;</span>
                  <span className="yt-sub-title">Choose your language</span>
                </div>
                <hr className="yt-menu-divider" />
                {['British English', 'Hindi', 'Spanish', 'French', 'German', 'Japanese'].map(lang => (
                  <button key={lang} className={`yt-sub-item ${language === lang ? 'active' : ''}`} onClick={() => handleLanguageChange(lang)}>
                    {language === lang && <span className="yt-check-icon">&#10003;</span>}
                    <span className="yt-sub-text">{lang}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Location Sub-Menu */}
            {subMenu === 'location' && (
              <div className="yt-menu-sub animate-slide-in">
                <div className="yt-sub-header" onClick={() => setSubMenu(null)}>
                  <span className="yt-sub-back">&larr;</span>
                  <span className="yt-sub-title">Choose your location</span>
                </div>
                <hr className="yt-menu-divider" />
                {['India', 'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany'].map(loc => (
                  <button key={loc} className={`yt-sub-item ${location === loc ? 'active' : ''}`} onClick={() => handleLocationChange(loc)}>
                    {location === loc && <span className="yt-check-icon">&#10003;</span>}
                    <span className="yt-sub-text">{loc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />

      {/* Keyboard Shortcuts Modal */}
      {shortcutsOpen && (
        <div className="yt-modal-overlay" onClick={() => setShortcutsOpen(false)}>
          <div className="yt-modal-card" onClick={e => e.stopPropagation()}>
            <div className="yt-modal-header">
              <h3>Keyboard Shortcuts</h3>
              <button className="yt-close-modal" onClick={() => setShortcutsOpen(false)}>&times;</button>
            </div>
            <div className="yt-modal-body">
              <table className="yt-shortcuts-table">
                <thead>
                  <tr>
                    <th>Shortcut</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td><kbd>Space</kbd> or <kbd>k</kbd></td><td>Play / Pause Video</td></tr>
                  <tr><td><kbd>m</kbd></td><td>Mute / Unmute Audio</td></tr>
                  <tr><td><kbd>f</kbd></td><td>Toggle Fullscreen Mode</td></tr>
                  <tr><td><kbd>&larr;</kbd> (Left Arrow)</td><td>Skip backward 5 seconds</td></tr>
                  <tr><td><kbd>&rarr;</kbd> (Right Arrow)</td><td>Skip forward 5 seconds</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Google Account Modal */}
      {googleAccountOpen && (
        <div className="yt-modal-overlay" onClick={() => setGoogleAccountOpen(false)}>
          <div className="yt-modal-card" onClick={e => e.stopPropagation()}>
            <div className="yt-modal-header">
              <h3>Google Account</h3>
              <button className="yt-close-modal" onClick={() => setGoogleAccountOpen(false)}>&times;</button>
            </div>
            <div className="yt-modal-body google-account-details">
              <div className="ga-profile">
                <img src={user ? user.avatar : undefined} alt="User Profile" />
                <h4>{user ? user.channelName || user.username : ""}</h4>
                <p>{user ? user.email : ""}</p>
              </div>
              <div className="ga-stats">
                <div className="ga-stat-row"><strong>Account Status:</strong> <span className="status-badge">Verified</span></div>
                <div className="ga-stat-row"><strong>Cloud Storage:</strong> <span>4.2 GB / 15 GB Used</span></div>
                <div className="ga-stat-row"><strong>Account Security:</strong> <span className="status-badge-green">Protected</span></div>
              </div>
              <button className="ga-manage-btn" onClick={() => alert("This redirects to myaccount.google.com in real app.")}>Manage your Google Account</button>
            </div>
          </div>
        </div>
      )}

      {/* Switch Account Modal */}
      {switchAccountOpen && (
        <div className="yt-modal-overlay" onClick={() => setSwitchAccountOpen(false)}>
          <div className="yt-modal-card" onClick={e => e.stopPropagation()}>
            <div className="yt-modal-header">
              <h3>Switch Account</h3>
              <button className="yt-close-modal" onClick={() => setSwitchAccountOpen(false)}>&times;</button>
            </div>
            <div className="yt-modal-body account-list">
              {[
                { id: user?.id || '1', username: user?.username || 'vishu', email: user?.email || 'vishu@gmail.com', channelName: user?.channelName || 'Al Wala', avatar: user?.avatar || 'https://ui-avatars.com/api/?name=Al+Wala' },
                { id: '2', username: 'slayy_point', email: 'slayy@yt.com', channelName: 'Slayy Point', avatar: 'https://ui-avatars.com/api/?name=Slayy+Point&background=ff0000&color=fff' },
                { id: '3', username: 'tech_explorer', email: 'tech@yt.com', channelName: 'Tech Explorer', avatar: 'https://ui-avatars.com/api/?name=Tech+Explorer&background=0088ff&color=fff' }
              ].map(profile => (
                <div key={profile.id} className="account-row" onClick={() => handleSwitchAccount(profile)}>
                  <img src={profile.avatar} alt={profile.channelName} className="account-avatar" />
                  <div className="account-details">
                    <h5>{profile.channelName}</h5>
                    <p>{profile.email}</p>
                  </div>
                  {user?.id === profile.id && <span className="active-profile-check">&#10003;</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Purchases Modal */}
      {purchasesOpen && (
        <div className="yt-modal-overlay" onClick={() => setPurchasesOpen(false)}>
          <div className="yt-modal-card" onClick={e => e.stopPropagation()}>
            <div className="yt-modal-header">
              <h3>Purchases & Memberships</h3>
              <button className="yt-close-modal" onClick={() => setPurchasesOpen(false)}>&times;</button>
            </div>
            <div className="yt-modal-body purchases-details">
              <div className="membership-box">
                <h4>YouTube Premium</h4>
                <p>Status: <strong>Active Subscription</strong></p>
                <p>Next billing date: July 12, 2026</p>
                <span className="premium-label">Premium Benefits Enabled</span>
              </div>
              <div className="channel-memberships">
                <h5>Channel Memberships (1)</h5>
                <div className="membership-row">
                  <img src="https://ui-avatars.com/api/?name=Slayy+Point&background=ff0000&color=fff" alt="Channel" />
                  <div>
                    <h6>Slayy Point</h6>
                    <p>Level: Sanskari Level 2</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Data Privacy Modal */}
      {dataPrivacyOpen && (
        <div className="yt-modal-overlay" onClick={() => setDataPrivacyOpen(false)}>
          <div className="yt-modal-card" onClick={e => e.stopPropagation()}>
            <div className="yt-modal-header">
              <h3>Your Data in YouTube</h3>
              <button className="yt-close-modal" onClick={() => setDataPrivacyOpen(false)}>&times;</button>
            </div>
            <div className="yt-modal-body privacy-details">
              <p>Here you can review and delete your watch and search activity logs to manage recommendation preferences.</p>
              <div className="privacy-card">
                <h5>Watch History</h5>
                <p>Status: <strong>Tracking Enabled</strong></p>
                <p>Total items: 30 videos stored</p>
                <button className="privacy-btn-red" onClick={() => alert("Watch history has been cleared locally!")}>Clear Watch History</button>
              </div>
              <div className="privacy-card">
                <h5>Search History</h5>
                <p>Status: <strong>Tracking Enabled</strong></p>
                <button className="privacy-btn-red" onClick={() => alert("Search history has been cleared locally!")}>Clear Search History</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Send Feedback Modal */}
      {feedbackOpen && (
        <div className="yt-modal-overlay" onClick={() => setFeedbackOpen(false)}>
          <div className="yt-modal-card" onClick={e => e.stopPropagation()}>
            <div className="yt-modal-header">
              <h3>Send Feedback to YouTube</h3>
              <button className="yt-close-modal" onClick={() => setFeedbackOpen(false)}>&times;</button>
            </div>
            <form onSubmit={handleFeedbackSubmit} className="yt-modal-body feedback-form">
              <p>Let us know if you found a bug or have design suggestions!</p>
              <textarea
                placeholder="Describe your issue or share your ideas..."
                value={feedbackText}
                onChange={e => setFeedbackText(e.target.value)}
                required
              />
              <div className="feedback-actions">
                <button type="button" className="feedback-cancel" onClick={() => setFeedbackOpen(false)}>Cancel</button>
                <button type="submit" className="feedback-submit">Submit</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;

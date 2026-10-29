"use client";
// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import useAuthStore from '@/store/authStore';
import useVideoStore from '@/store/videoStore';
import './MobileBottomNav.css';

const MobileBottomNav = () => {
  const router = useRouter();
  const pathname = usePathname();
  const [showMiniPlayer, setShowMiniPlayer] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { currentVideo, setCurrentVideo, clearCurrentVideo } = useVideoStore();

  const navItems = [
    { href: '/', icon: 'home', label: 'Home', active: pathname === '/' },
    { href: '/shorts', icon: 'ondemand_video', label: 'Shorts', active: pathname === '/shorts' },
    { href: '/upload', icon: 'add_circle_outline', label: 'Create', active: pathname === '/upload', isCreate: true },
    { href: '/feed/subscriptions', icon: 'subscriptions', label: 'Subscriptions', active: pathname.startsWith('/feed/subscriptions') },
    { href: '/feed/library', icon: 'video_library', label: 'Library', active: pathname.startsWith('/feed/library') },
  ];

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  useEffect(() => {
    if (currentVideo) setShowMiniPlayer(true);
  }, [currentVideo]);

  const handleNavClick = (href: string) => {
    if (href === '/upload') {
      router.push('/upload');
      return;
    }
    if (currentVideo && href !== pathname) {
      // Keep mini player when navigating
      router.push(href);
    } else {
      router.push(href);
    }
  };

  const closeMiniPlayer = () => {
    clearCurrentVideo();
    setShowMiniPlayer(false);
    setExpanded(false);
  };

  const toggleExpand = () => setExpanded(!expanded);

  if (!currentVideo && !showMiniPlayer) return null;

  return (
    <>
      {/* Mini Player Bar */}
      <div className={`aura-mini-player ${expanded ? 'expanded' : ''} ${showMiniPlayer ? 'visible' : ''}`} role="region" aria-label="Mini player">
        <div className="aura-mini-player-content" onClick={toggleExpand}>
          <div className="aura-mini-thumb">
            {currentVideo?.thumbnail && (
              <img src={currentVideo.thumbnail} alt="" loading="lazy" />
            )}
            <div className="aura-mini-play-overlay" aria-hidden="true">
              <span className="material-symbols-outlined">play_arrow</span>
            </div>
          </div>
          <div className="aura-mini-info">
            <span className="aura-mini-title">{currentVideo?.title || 'Playing...'}</span>
            <span className="aura-mini-channel">{currentVideo?.channelTitle || ''}</span>
          </div>
          <div className="aura-mini-controls">
            <button className="aura-mini-btn" aria-label="Previous" onClick={(e) => { e.stopPropagation(); /* prev */ }}>
              <span className="material-symbols-outlined">skip_previous</span>
            </button>
            <button className="aura-mini-btn aura-mini-play" aria-label={showMiniPlayer ? 'Pause' : 'Play'} onClick={(e) => { e.stopPropagation(); /* toggle play */ }}>
              <span className="material-symbols-outlined">{showMiniPlayer ? 'pause' : 'play_arrow'}</span>
            </button>
            <button className="aura-mini-btn" aria-label="Next" onClick={(e) => { e.stopPropagation(); /* next */ }}>
              <span className="material-symbols-outlined">skip_next</span>
            </button>
            <button className="aura-mini-btn aura-mini-close" aria-label="Close mini player" onClick={(e) => { e.stopPropagation(); closeMiniPlayer(); }}>
              <span className="material-symbols-outlined">close</span>
            </button>
            <button className="aura-mini-btn aura-mini-expand" aria-label="Expand player" onClick={(e) => { e.stopPropagation(); setExpanded(true); }}>
              <span className="material-symbols-outlined">fullscreen</span>
            </button>
          </div>
        </div>
        <div className="aura-mini-progress" role="slider" aria-label="Playback progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}>
          <div className="aura-mini-progress-fill" style={{width: '0%'}} />
        </div>
      </div>

      {/* Expanded Mini Player */}
      {expanded && (
        <div className="aura-mini-expanded" onClick={(e) => { if (e.target === e.currentTarget) closeMiniPlayer(); }}>
          <div className="aura-mini-expanded-content">
            <div className="aura-mini-expanded-header">
              <button className="aura-mini-expanded-close" onClick={(e) => { e.stopPropagation(); setExpanded(false); }} aria-label="Minimize">
                <span className="material-symbols-outlined">minimize</span>
              </button>
              <span className="aura-mini-expanded-title">Now Playing</span>
            </div>
            <div className="aura-mini-expanded-body">
              <div className="aura-mini-expanded-video">
                {currentVideo?.thumbnail && (
                  <img src={currentVideo.thumbnail} alt="" />
                )}
                <div className="aura-mini-expanded-overlay">
                  <button className="aura-mini-expanded-play" aria-label="Play">
                    <span className="material-symbols-outlined">play_arrow</span>
                  </button>
                </div>
              </div>
              <div className="aura-mini-expanded-info">
                <h3 className="aura-mini-expanded-title-text">{currentVideo?.title || 'Video'}</h3>
                <p className="aura-mini-expanded-channel">{currentVideo?.channelTitle || 'Channel'}</p>
                <div className="aura-mini-expanded-actions">
                  <button className="aura-btn aura-btn-ghost aura-mini-action-btn" aria-label="Like">
                    <span className="material-symbols-outlined">thumb_up</span>
                    <span>Like</span>
                  </button>
                  <button className="aura-btn aura-btn-ghost aura-mini-action-btn" aria-label="Dislike">
                    <span className="material-symbols-outlined">thumb_down</span>
                  </button>
                  <button className="aura-btn aura-btn-ghost aura-mini-action-btn" aria-label="Share">
                    <span className="material-symbols-outlined">share</span>
                    <span>Share</span>
                  </button>
                  <button className="aura-btn aura-btn-ghost aura-mini-action-btn" aria-label="Save">
                    <span className="material-symbols-outlined">save</span>
                    <span>Save</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation Bar */}
      <nav className="aura-bottom-nav" role="navigation" aria-label="Main navigation" style={{paddingBottom: showMiniPlayer ? 'var(--aura-bottom-nav-h)' : 0}}>
        <div className="aura-bottom-nav-inner">
          {navItems.map((item, index) => (
            <Link
              key={item.href}
              href={item.href}
              className={`aura-bottom-nav-item ${item.active ? 'active' : ''} ${item.isCreate ? 'create' : ''}`}
              onClick={(e) => {
                if (item.isCreate) return;
                e.preventDefault();
                handleNavClick(item.href);
              }}
              aria-label={item.label}
              aria-current={item.active ? 'page' : undefined}
              style={{ '--delay': `${index * 40}ms` }}
            >
              <span className={`aura-bottom-nav-icon material-symbols-outlined ${item.active ? 'filled' : ''}`} aria-hidden="true">
                {item.icon}
              </span>
              <span className="aura-bottom-nav-label">{item.label}</span>
              {item.isCreate && (
                <span className="aura-create-ring" aria-hidden="true"></span>
              )}
              {item.active && !item.isCreate && (
                <span className="aura-bottom-nav-indicator" aria-hidden="true"></span>
              )}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
};

export default MobileBottomNav;
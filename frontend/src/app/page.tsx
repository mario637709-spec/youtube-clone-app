"use client";
// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import Navbar from '@/components/Navbar/Navbar';
import Sidebar from '@/components/Sidebar/Sidebar';
import VideoCard, { VideoCardSkeleton } from '@/components/VideoCard/VideoCard';
import ShortsShelf from '@/components/ShortsShelf/ShortsShelf';
import { categories } from '@/data/dummyData';
import { apiClient } from '@/utils/api';
import useVideoStore from '@/store/videoStore';
import { getGuestId } from '@/utils/analytics';
import { initialFeed } from '@/data/initialFeed';
import { prewarmVideos } from '@/utils/clientStream';
import WatchClient from './watch/[id]/WatchClient';
import '@/pages/Home.css';

const Home = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { videos, setVideos, homeCategory, setHomeCategory, currentVideo, setCurrentVideo } = useVideoStore();
  const [loading, setLoading] = useState(videos.length === 0);

  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);

  // Handle hardware Back button and browser popstate for in-place watch modal
  useEffect(() => {
    const handlePopState = () => {
      if (useVideoStore.getState().currentVideo) {
        useVideoStore.getState().setCurrentVideo(null);
        setTimeout(() => {
          const pos = useVideoStore.getState().feedScrollPos || 0;
          if (pos > 0) {
            window.scrollTo({ top: pos, behavior: 'instant' });
          }
        }, 20);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Check URL on startup: if ?v=xxx or /watch?v=xxx was opened directly, load that video
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const vidId = urlParams.get('v') || urlParams.get('id');
        if (vidId && !currentVideo) {
          const found = initialFeed.find(x => x.id === vidId || x.youtube_id === vidId);
          if (found) {
            setCurrentVideo(found);
          } else {
            apiClient.get(`/videos/${vidId}`).then(vid => {
              if (vid) setCurrentVideo(vid);
            }).catch(() => {});
          }
        }
      } catch {}
    }
  }, []);
  // Refs prevent stale-closure races: rapid scroll events could fire multiple
  // concurrent fetches with the same page and skip/shorten the feed.
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const lastLoadAtRef = useRef(0);
  const scrollTimerRef = useRef(null);
  // Allow scrolling through the full merged catalog (db.json + all
  // db_worker*.json = ~2.1k non-short videos). The backend stops serving
  // via hasMore once the corpus is exhausted; this cap only guards
  // against runaway requests, so it's set well above the real size.
  const MAX_PAGES = 25000; // Allows infinite pagination through all 480k+ videos in the 3 Firebase DBs
  const LOAD_COOLDOWN_MS = 800;

  const extractList = (data) => (Array.isArray(data) ? data : (data && Array.isArray(data.videos) ? data.videos : []));
  const applyHasMore = (data, list) => {
    const more = data && typeof data.hasMore === 'boolean'
      ? data.hasMore
      : list.length >= 20;
    hasMoreRef.current = more;
    setHasMore(more);
  };

  // Fetch initial page
  useEffect(() => {
    const fetchInitialVideos = async () => {
      setLoading(true);
      pageRef.current = 1;
      hasMoreRef.current = true;
      setPage(1);
      setHasMore(true);
      try {
        let data = null;
        let list = [];
        try {
          data = await apiClient.get(`/feed?category=${encodeURIComponent(homeCategory)}&guestId=${getGuestId()}&page=1&limit=20`);
          list = extractList(data);
        } catch (feedErr) {
          console.warn('/feed endpoint failed, trying /videos directly:', feedErr?.message || feedErr);
        }

        if (!list || list.length === 0) {
          data = await apiClient.get(`/videos?category=${encodeURIComponent(homeCategory)}&page=1&limit=20`);
          list = extractList(data);
        }

        if (list && list.length > 0) {
          setVideos(list);
          applyHasMore(data, list);
        } else {
          throw new Error('Empty feed returned from backend');
        }
      } catch (err) {
        console.warn('Backend unavailable, using initialFeed fallback:', err);
        const filtered = homeCategory === 'All'
          ? initialFeed
          : initialFeed.filter(v => (v.category || '').toLowerCase() === homeCategory.toLowerCase());
        setVideos(filtered.length > 0 ? filtered : initialFeed);
        hasMoreRef.current = false;
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    };
    fetchInitialVideos();
  }, [homeCategory, setVideos]);

  // 2026-08-15: Playback speed boost — home feed ke top videos ka CDN
  // stream pre-warm karo (IndexedDB cache me URL + expiry daal do).
  // Watch page pe player tab cache hit karega → instant play instead of
  // 8-15s cold extraction. prewarmVideos khud idle-priority + concurrency
  // limited hai aur in-flight dedupe share karta hai player ke saath.
  useEffect(() => {
    if (videos.length > 0) {
      if (typeof prewarmVideos === 'function') { prewarmVideos(videos, 12, 3); }
    }
  }, [videos]);

  // Load more videos when scrolling
  const loadMoreVideos = async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) return;
    if (Date.now() - lastLoadAtRef.current < LOAD_COOLDOWN_MS) return;
    if (pageRef.current >= MAX_PAGES) {
      hasMoreRef.current = false;
      setHasMore(false);
      return;
    }
    loadingMoreRef.current = true;
    setLoadingMore(true);
    lastLoadAtRef.current = Date.now();
    const nextPage = pageRef.current + 1;
    try {
      let data = null;
      let list = [];
      try {
        data = await apiClient.get(`/feed?category=${encodeURIComponent(homeCategory)}&guestId=${getGuestId()}&page=${nextPage}&limit=20`);
        list = extractList(data);
      } catch (feedErr) {
        console.warn('/feed loadMore failed, trying /videos:', feedErr?.message || feedErr);
      }

      if (!list || list.length === 0) {
        data = await apiClient.get(`/videos?category=${encodeURIComponent(homeCategory)}&page=${nextPage}&limit=20`);
        list = extractList(data);
      }

      if (list && list.length > 0) {
        setVideos(prev => {
          const existingIds = new Set(prev.map(v => v.id));
          const newVideos = list.filter(v => !existingIds.has(v.id));
          return [...prev, ...newVideos];
        });
        pageRef.current = nextPage;
        setPage(nextPage);
        applyHasMore(data, list);
      } else {
        hasMoreRef.current = false;
        setHasMore(false);
      }
    } catch (err) {
      console.error('Error loading more videos:', err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  // Scroll listener for infinite scroll (debounced -> prevents fetch floods
  // that balloon the DOM and crash the tab on low-RAM machines)
  useEffect(() => {
    const handleScroll = () => {
      const threshold = 800; // px from bottom for smooth mobile loading
      const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
      const windowHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const fullHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        document.documentElement.offsetHeight || 0
      );
      if (windowHeight + scrollY >= fullHeight - threshold) {
        if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = setTimeout(loadMoreVideos, 100);
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      document.removeEventListener('scroll', handleScroll);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, [homeCategory]);

  // Real-time polling for pending videos
  useEffect(() => {
    let interval = null;
    const hasPending = Array.isArray(videos) && videos.some(v => v.status === 'Pending');
    
    if (hasPending) {
      interval = setInterval(async () => {
        try {
          const data = await apiClient.get(`/feed?category=${encodeURIComponent(homeCategory)}&guestId=${getGuestId()}&page=1&limit=${page * 20}`);
          const list = Array.isArray(data) ? data : (data && Array.isArray(data.videos) ? data.videos : []);
          setVideos(list);
        } catch (err) {
          console.error('Error polling pending video status:', err);
        }
      }, 3000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [videos, homeCategory, page, setVideos]);

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const filteredVideos = Array.isArray(videos) ? videos : [];
  const showHero = homeCategory === 'All' && !loading && filteredVideos.length >= 3;

  // Auto-advance hero carousel every 6s (Apple TV style)
  useEffect(() => {
    if (!showHero || heroPaused) return;
    const interval = setInterval(() => {
      setHeroIndex(prev => (prev + 1) % Math.min(filteredVideos.length, 8));
    }, 6000);
    return () => clearInterval(interval);
  }, [showHero, heroPaused, filteredVideos.length]);

  useEffect(() => {
    setHeroIndex(0);
  }, [homeCategory]);

  const heroVideos = showHero ? filteredVideos.slice(0, 8) : [];
  const heroVideo = showHero ? heroVideos[heroIndex] : null;

  const handleHeroNav = (dir) => {
    setHeroPaused(true);
    setTimeout(() => setHeroPaused(false), 12000);
    setHeroIndex(prev => (prev + dir + heroVideos.length) % heroVideos.length);
  };

  return (
    <div className="home">
      <Navbar onMenuClick={toggleSidebar} />
      <Sidebar isOpen={sidebarOpen} />
      
      <main className={`main-content ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>

        {showHero && heroVideo && (
          <div className="hero-carousel" onMouseEnter={() => setHeroPaused(true)} onMouseLeave={() => setHeroPaused(false)}>
            <div className="hero-slides">
              {heroVideos.map((v, i) => (
                <div
                  key={v.id}
                  className={`hero-slide ${i === heroIndex ? 'active' : ''}`}
                  onClick={() => {
                    const vidId = v.id || v.youtube_id || v._id;
                    if (typeof window !== 'undefined') {
                      const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
                      try {
                        useVideoStore.getState().setFeedScrollPos(scrollY);
                        window.history.pushState({ modal: 'watch', videoId: vidId }, '', '#watch');
                      } catch {}
                    }
                    setCurrentVideo(v);
                  }}
                >
                  <div className="hero-backdrop">
                    <img
                      src={(v.thumbnail || '').replace(/(\/vi\/[^/]+\/)(hqdefault|mqdefault|sddefault)(\.jpg)/, '$1maxresdefault$3')}
                      alt={v.title}
                      className="hero-backdrop-img"
                      loading={i === 0 ? 'eager' : 'lazy'}
                    />
                    <div className="hero-gradient-overlay" />
                  </div>
                  <div className="hero-content">
                    <span className="hero-badge">
                      <svg viewBox="0 0 24 24" width="14" height="14">
                        <path fill="currentColor" d="M10 16.5l6-4.5-6-4.5v9zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
                      </svg>
                      Featured
                    </span>
                    <h2 className="hero-title">{v.title}</h2>
                    <div className="hero-meta">
                      <span className="hero-channel">
                        {(v.channel && (v.channel.name || v.channel.channelName)) || (v.uploader && (v.uploader.channelName || v.uploader.username)) || 'YouTube'}
                      </span>
                      <span className="hero-dot">•</span>
                      <span className="hero-category">{v.category || 'Video'}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button className="hero-nav hero-prev" onClick={(e) => { e.stopPropagation(); handleHeroNav(-1); }} aria-label="Previous">
              <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
            </button>
            <button className="hero-nav hero-next" onClick={(e) => { e.stopPropagation(); handleHeroNav(1); }} aria-label="Next">
              <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
            </button>

            <div className="hero-dots">
              {heroVideos.map((v, i) => (
                <button
                  key={v.id}
                  className={`hero-dot-btn ${i === heroIndex ? 'active' : ''}`}
                  onClick={() => { setHeroIndex(i); setHeroPaused(true); setTimeout(() => setHeroPaused(false), 12000); }}
                  aria-label={`Slide ${i + 1}`}
                />
              ))}
            </div>
          </div>
        )}

        <div className="category-chips">
          {categories.map((category) => (
             <button
              key={category.id}
              className={`category-chip ${homeCategory === category.name ? 'active' : ''}`}
              onClick={() => {
                if (homeCategory !== category.name) {
                  setVideos([]);
                  setHomeCategory(category.name);
                }
              }}
            >
              <span>{category.name}</span>
            </button>
          ))}
        </div>

        <div className="video-grid">
          {loading ? (
            Array(8).fill(null).map((_, i) => <VideoCardSkeleton key={i} />)
          ) : (
            filteredVideos.map((video, idx) => (
              <React.Fragment key={video.id}>
                <VideoCard video={video} />
                {idx === 2 && <div style={{ gridColumn: '1 / -1' }}><ShortsShelf /></div>}
              </React.Fragment>
            ))
          )}
        </div>

        {loadingMore && (
          <div className="load-more-spinner">
            <div className="spinner"></div>
            <span>Loading more videos...</span>
          </div>
        )}
      </main>

      {/* Seamless in-place Watch Sheet: preserves exact feed scroll position */}
      {currentVideo && (
        <div className="watch-overlay-modal">
          <WatchClient
            activeVideo={currentVideo}
            standalone={false}
            onClose={() => {
              setCurrentVideo(null);
              if (typeof window !== 'undefined') {
                try {
                  if (window.location.hash === '#watch' || window.history.state?.modal === 'watch') {
                    window.history.back();
                  }
                } catch {}
                setTimeout(() => {
                  const pos = useVideoStore.getState().feedScrollPos || 0;
                  if (pos > 0) {
                    window.scrollTo({ top: pos, behavior: 'instant' });
                  }
                }, 20);
              }
            }}
            onSelectVideo={(newVid) => {
              setCurrentVideo(newVid);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default Home;

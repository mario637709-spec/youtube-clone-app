"use client";
// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useRouter } from 'next/navigation';
import { getApiBaseUrl } from '@/config';
import '@/pages/Shorts.css';

const Shorts = () => {
  const router = useRouter();
  const [shorts, setShorts] = useState([]);
  const [currentShortIndex, setCurrentShortIndex] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'foryou' | 'subs'>('foryou');
  const containerRef = useRef(null);

  useEffect(() => {
    const fetchShorts = async (pageNum) => {
      try {
        setLoading(true);
        const API_BASE_URL = getApiBaseUrl();
        const res = await axios.get(`${API_BASE_URL}/videos/shorts`, { params: { page: pageNum, limit: 20 } });
        const data = res.data;
        const newShorts = Array.isArray(data) ? data : (data?.videos || []);
        setShorts(prev => pageNum === 1 ? newShorts : [...prev, ...newShorts]);
        setHasMore(Array.isArray(data) ? data.length >= 20 : !!data?.hasMore);
      } catch (err) {
        console.error('Error fetching shorts:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchShorts(1);
  }, []);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, clientHeight } = containerRef.current;
    const index = Math.round(scrollTop / clientHeight);
    if (index !== currentShortIndex && index >= 0 && index < shorts.length) {
      setCurrentShortIndex(index);
    }
    const nearEnd = scrollTop + clientHeight >= containerRef.current.scrollHeight - clientHeight * 2;
    if (nearEnd && hasMore && !loading) {
      setPage(prev => {
        const next = prev + 1;
        fetchNextPage(next);
        return next;
      });
    }
  };

  const fetchNextPage = (pageNum) => {
    const API_BASE_URL = getApiBaseUrl();
    axios.get(`${API_BASE_URL}/videos/shorts`, { params: { page: pageNum, limit: 20 } })
      .then(res => {
        const data = res.data;
        const newShorts = Array.isArray(data) ? data : (data?.videos || []);
        setShorts(prev => [...prev, ...newShorts]);
        setHasMore(Array.isArray(data) ? data.length >= 20 : !!data?.hasMore);
      })
      .catch(err => console.error('Error fetching more shorts:', err));
  };

  return (
    <div className="shorts-immersion-container">
      {/* 1. TOP HEADER OVERLAY */}
      <header className="shorts-top-header">
        <div className="shorts-top-left">
          <button
            className="shorts-glass-icon-btn"
            onClick={() => router.back()}
            aria-label="Go back"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <button
            className="shorts-glass-icon-btn"
            onClick={() => router.push('/upload')}
            aria-label="Create short"
          >
            <span className="material-symbols-outlined">photo_camera</span>
          </button>
        </div>

        {/* Center Subscriptions vs For You Tabs */}
        <div className="shorts-pill-tabs">
          <button
            className={`shorts-tab-btn ${activeTab === 'subs' ? 'active' : ''}`}
            onClick={() => setActiveTab('subs')}
          >
            Subscriptions
          </button>
          <button
            className={`shorts-tab-btn ${activeTab === 'foryou' ? 'active' : ''}`}
            onClick={() => setActiveTab('foryou')}
          >
            <span>For You</span>
            {activeTab === 'foryou' && <span className="tab-red-dot" />}
          </button>
        </div>

        <div className="shorts-top-right">
          <button
            className="shorts-glass-icon-btn"
            onClick={() => router.push('/search')}
            aria-label="Search"
          >
            <span className="material-symbols-outlined">search</span>
          </button>
          <button
            className="shorts-glass-icon-btn"
            onClick={() => alert("Options: Captions, Quality, Report")}
            aria-label="More options"
          >
            <span className="material-symbols-outlined">more_vert</span>
          </button>
        </div>
      </header>

      {/* 2. FULL SCREEN VERTICAL VIDEO FEED */}
      <main
        className="shorts-scroll-feed no-scrollbar"
        ref={containerRef}
        onScroll={handleScroll}
      >
        {shorts.length === 0 && !loading ? (
          <div className="no-shorts-placeholder">
            <span className="material-symbols-outlined text-5xl mb-2 text-[#ff0033]">
              play_circle
            </span>
            <h2>No Shorts available right now!</h2>
            <p>Upload a video under 60 seconds to see it here.</p>
          </div>
        ) : (
          shorts.map((short, index) => (
            <ShortVideoItem
              key={short.id || short.youtube_id || index}
              video={short}
              isActive={index === currentShortIndex}
            />
          ))
        )}
      </main>
    </div>
  );
};

interface ShortVideoProps {
  video: any;
  isActive: boolean;
}

const ShortVideoItem = ({ video, isActive }: ShortVideoProps) => {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [likes, setLikes] = useState(() => video.likes || 12400);
  const [isLiked, setIsLiked] = useState(false);
  const [isDisliked, setIsDisliked] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [showHeart, setShowHeart] = useState(false);
  const [heartCoords, setHeartCoords] = useState({ x: 0, y: 0 });
  const [progress, setProgress] = useState(0);
  const lastTapRef = useRef(0);

  const formatCount = (count: number) => {
    if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M';
    if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
    return String(count);
  };

  const getShortVideoSrc = () => {
    const ytId = video.youtube_id || video.id || (video.videoUrl && video.videoUrl.match(/(?:watch\?v=|shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1]);
    const apiBase = getApiBaseUrl();
    if (ytId && /^[a-zA-Z0-9_-]{11}$/.test(ytId)) {
      return `${apiBase}/stream/auto/${ytId}?quality=360p`;
    }
    let src = video.videoUrl || '';
    if (src && src.includes('/api/videos/stream/')) {
      const poToken = window.youtubePoToken || localStorage.getItem('youtube_po_token') || '';
      const visitorData = window.youtubeVisitorData || localStorage.getItem('youtube_visitor_data') || '';
      if (poToken && visitorData) {
        src += `${src.includes('?') ? '&' : '?'}poToken=${encodeURIComponent(poToken)}&visitorData=${encodeURIComponent(visitorData)}`;
      }
    }
    return src;
  };

  useEffect(() => {
    if (hasError) return;
    if (isActive) {
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        const playPromise = videoRef.current.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => setIsPlaying(true))
            .catch((err) => {
              console.log('[Shorts] Autoplay unmuted failed, trying muted:', err.message);
              if (videoRef.current) {
                videoRef.current.muted = true;
                videoRef.current.play()
                  .then(() => setIsPlaying(true))
                  .catch(() => setIsPlaying(false));
              }
            });
        }
      }
    } else {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
        setIsPlaying(false);
        setProgress(0);
      }
    }
  }, [isActive, hasError]);

  const togglePlay = () => {
    if (hasError) return;
    if (isPlaying) {
      videoRef.current?.pause();
      setIsPlaying(false);
    } else {
      videoRef.current?.play();
      setIsPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const { currentTime, duration } = videoRef.current;
      if (duration > 0) {
        setProgress((currentTime / duration) * 100);
      }
    }
  };

  const handleDoubleTap = (e: React.MouseEvent) => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      // Double tap detected!
      setHeartCoords({ x: e.clientX, y: e.clientY });
      setShowHeart(true);
      if (!isLiked) {
        setIsLiked(true);
        setLikes(prev => prev + 1);
      }
      setTimeout(() => setShowHeart(false), 800);
    } else {
      togglePlay();
    }
    lastTapRef.current = now;
  };

  const handleLikeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLiked) {
      setIsLiked(false);
      setLikes(prev => prev - 1);
    } else {
      setIsLiked(true);
      setIsDisliked(false);
      setLikes(prev => prev + 1);
    }
  };

  const handleDislikeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDisliked(!isDisliked);
    if (isLiked) {
      setIsLiked(false);
      setLikes(prev => prev - 1);
    }
  };

  const channel = video.channel || video.uploader || {};
  const channelName = channel.name || video.uploaderName || 'CodeWithVishu';
  const channelAvatar =
    channel.avatar ||
    video.uploaderAvatar ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(channelName)}&background=ff0033&color=fff`;

  return (
    <div className="short-slide-card" onClick={handleDoubleTap}>
      {/* Video element or fallback */}
      {hasError ? (
        <div className="short-video-fallback">
          <img
            src={video.thumbnail || 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=720&auto=format&fit=crop&q=80'}
            alt={video.title}
            className="short-bg-fallback-img"
          />
          <div className="fallback-error-text">Video Stream Offline</div>
        </div>
      ) : (
        <video
          ref={videoRef}
          className="short-video-element"
          src={getShortVideoSrc()}
          loop
          playsInline
          onTimeUpdate={handleTimeUpdate}
          onError={() => setHasError(true)}
          poster={video.thumbnail || undefined}
        />
      )}

      {/* Ambient OLED Vignette Scrim */}
      <div className="short-scrim-top" />
      <div className="short-scrim-bottom" />

      {/* Floating Animated Heart on Double Tap */}
      {showHeart && (
        <div
          className="double-tap-heart animate-ping"
          style={{ left: `${heartCoords.x - 30}px`, top: `${heartCoords.y - 30}px` }}
        >
          <span className="material-symbols-outlined text-6xl text-[#ff0033] fill-icon drop-shadow-[0_0_20px_#ff0033]">
            favorite
          </span>
        </div>
      )}

      {/* Pause indicator overlay */}
      {!isPlaying && !hasError && (
        <div className="short-center-pause-indicator">
          <span className="material-symbols-outlined text-5xl text-white/90 fill-icon">
            play_arrow
          </span>
        </div>
      )}

      {/* RIGHT ACTION RAIL (Vertical Stack) */}
      <aside className="short-action-rail" onClick={(e) => e.stopPropagation()}>
        {/* Like */}
        <div className="rail-btn-wrap">
          <button
            className={`rail-action-btn ${isLiked ? 'liked' : ''}`}
            onClick={handleLikeClick}
            aria-label="Like short"
          >
            <span className={`material-symbols-outlined ${isLiked ? 'fill-icon text-[#ff0033]' : ''}`}>
              thumb_up
            </span>
          </button>
          <span className="rail-btn-label">{formatCount(likes)}</span>
        </div>

        {/* Dislike */}
        <div className="rail-btn-wrap">
          <button
            className={`rail-action-btn ${isDisliked ? 'disliked' : ''}`}
            onClick={handleDislikeClick}
            aria-label="Dislike short"
          >
            <span className={`material-symbols-outlined ${isDisliked ? 'fill-icon' : ''}`}>
              thumb_down
            </span>
          </button>
          <span className="rail-btn-label">Dislike</span>
        </div>

        {/* Comments */}
        <div className="rail-btn-wrap">
          <button
            className="rail-action-btn"
            onClick={() => alert("Comments Drawer: 1,428 reactions")}
            aria-label="View comments"
          >
            <span className="material-symbols-outlined fill-icon">chat_bubble</span>
          </button>
          <span className="rail-btn-label">28.4K</span>
        </div>

        {/* Share */}
        <div className="rail-btn-wrap">
          <button
            className="rail-action-btn"
            onClick={() => {
              if (navigator.share) {
                navigator.share({ title: video.title, url: window.location.href });
              } else {
                navigator.clipboard?.writeText(window.location.href);
                alert("Link copied to clipboard!");
              }
            }}
            aria-label="Share short"
          >
            <span className="material-symbols-outlined">share</span>
          </button>
          <span className="rail-btn-label">Share</span>
        </div>

        {/* Remix / Audio Spinning Vinyl Record */}
        <div className="rail-btn-wrap">
          <div className="sound-vinyl-wrapper">
            <div className="spinning-vinyl-disc">
              <div className="vinyl-groove">
                <div className="vinyl-center" />
              </div>
            </div>
            <div className="vinyl-equalizer-badge">
              <span className="material-symbols-outlined text-[10px] text-[#ff0033]">
                graphic_eq
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* BOTTOM CREATOR & METADATA OVERLAY */}
      <div className="short-bottom-metadata" onClick={(e) => e.stopPropagation()}>
        {/* Creator Row */}
        <div className="short-creator-row">
          <div className="creator-avatar-ring">
            <img src={channelAvatar} alt={channelName} className="creator-avatar-img" />
          </div>
          <div className="creator-names">
            <span className="creator-handle">@{channelName}</span>
            <span className="material-symbols-outlined verified-badge fill-icon">
              check_circle
            </span>
          </div>
          <button
            className={`short-subscribe-pill ${isSubscribed ? 'subscribed' : ''}`}
            onClick={() => setIsSubscribed(!isSubscribed)}
          >
            {isSubscribed ? 'Subscribed' : 'Subscribe'}
          </button>
        </div>

        {/* Video Title & Hashtags */}
        <div className="short-title-container">
          <p className="short-text-title">
            {video.title} <span className="hashtag-accent">#coding #tech #shorts #viral</span>
          </p>
        </div>

        {/* Audio Marquee Ticker */}
        <div className="short-audio-ticker">
          <span className="material-symbols-outlined music-note-icon fill-icon">
            music_note
          </span>
          <div className="marquee-viewport">
            <div className="marquee-content">
              <span>Original Sound - @{channelName} • Trending Sound</span>
              <span className="marquee-dot">•</span>
              <span>Original Sound - @{channelName} • Trending Sound</span>
            </div>
          </div>
          <div className="audio-wave-bars">
            <span className="wave-bar bar-1" />
            <span className="wave-bar bar-2" />
            <span className="wave-bar bar-3" />
          </div>
        </div>
      </div>

      {/* GLOWING CRIMSON SCRUBBER PROGRESS LINE */}
      <div className="short-scrubber-track">
        <div
          className="short-scrubber-fill"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};

export default Shorts;

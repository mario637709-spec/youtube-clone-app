"use client";
// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useRouter } from 'next/navigation';
import { getApiBaseUrl } from '@/config';
import { getClientDirectStream } from '@/utils/clientStream';
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
  const [resolvedUrl, setResolvedUrl] = useState('');
  const [resolvedAudioUrl, setResolvedAudioUrl] = useState('');
  const [loadingStream, setLoadingStream] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const lastTapRef = useRef(0);
  const retryRef = useRef(0);
  const audioRef = useRef(null);

  const ytId = video.youtube_id || video.id || (video.videoUrl && video.videoUrl.match(/(?:watch\?v=|shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1]);
  const isYoutube = !!(ytId && /^[a-zA-Z0-9_-]{11}$/.test(ytId));
  const isNativeApp = process.env.NEXT_PUBLIC_IS_CAPACITOR === 'true';

  const formatCount = (count: number) => {
    if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M';
    if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
    return String(count);
  };

  const getShortVideoSrc = () => {
    if (resolvedUrl) return resolvedUrl;
    if (isYoutube) return '';
    return video.videoUrl || '';
  };

  const handleVideoError = () => {
    if (!isYoutube) {
      setHasError(true);
      return;
    }
    if (retryRef.current === 0) {
      retryRef.current = 1;
      console.warn('[Shorts] Direct CDN failed - re-extracting once from device...');
      setHasError(false);
      setResolvedUrl('');
      setResolvedAudioUrl('');
      setRetryTick((t) => t + 1);
      return;
    }
    setHasError(true);
  };

  // Resolve YouTube Shorts directly from the device (same Tier 0 as the
  // main player). No /stream/auto, no server proxy.
  useEffect(() => {
    if (!isActive || !isYoutube) return;
    let active = true;
    setLoadingStream(true);
    setHasError(false);
    setResolvedUrl('');
    setResolvedAudioUrl('');

    (async () => {
      try {
        const res = await getClientDirectStream(ytId, '360p', {
          skipCache: retryRef.current > 0,
          deadlineMs: 30000
        });
        if (!active || !res?.bestUrl) return;

        const entry = res.qualityMap?.['360p'] ||
          Object.values(res.qualityMap || {}).find((e: any) => e && e.url === res.bestUrl);
        const url = entry?.url || res.bestUrl;
        const isCombined = Object.values(res.qualityMap || {}).some(
          (e: any) => e && e.url === url && e.type === 'combined'
        );
        setResolvedUrl(url);
        setResolvedAudioUrl(!isCombined ? (res.audioOnlyFormats?.[0]?.url || '') : '');
      } catch (err: any) {
        console.warn('[Shorts] Direct stream failed:', err?.message || err);
        if (active) setHasError(true);
      } finally {
        if (active) setLoadingStream(false);
      }
    })();

    return () => { active = false; };
  }, [isActive, isYoutube, ytId, retryTick]);

  // Last-resort timer: if direct extraction hangs, show the iframe.
  useEffect(() => {
    if (!isActive || !isYoutube || resolvedUrl || hasError) return;
    const timer = setTimeout(() => {
      if (!resolvedUrl) {
        console.warn('[Shorts] Direct extraction timed out - enabling embed fallback');
        setHasError(true);
      }
    }, 30000);
    return () => clearTimeout(timer);
  }, [isActive, isYoutube, resolvedUrl, hasError]);

  useEffect(() => {
    if (hasError) return;
    if (isActive) {
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        const playPromise = videoRef.current.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              setIsPlaying(true);
              if (audioRef.current && resolvedAudioUrl) {
                audioRef.current.currentTime = videoRef.current.currentTime;
                audioRef.current.muted = videoRef.current.muted;
                audioRef.current.play().catch(() => {});
              }
            })
            .catch((err) => {
              console.log('[Shorts] Autoplay unmuted failed, trying muted:', err.message);
              if (videoRef.current) {
                videoRef.current.muted = true;
                videoRef.current.play()
                  .then(() => {
                    setIsPlaying(true);
                    if (audioRef.current && resolvedAudioUrl) {
                      audioRef.current.muted = true;
                      audioRef.current.currentTime = videoRef.current.currentTime;
                      audioRef.current.play().catch(() => {});
                    }
                  })
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
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    }
  }, [isActive, hasError, resolvedAudioUrl, resolvedUrl]);

  const togglePlay = () => {
    if (hasError) return;
    if (isPlaying) {
      videoRef.current?.pause();
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      if (videoRef.current) videoRef.current.muted = false;
      if (audioRef.current) audioRef.current.muted = false;
      videoRef.current?.play();
      if (audioRef.current && resolvedAudioUrl) {
        audioRef.current.currentTime = videoRef.current?.currentTime || 0;
        audioRef.current.play().catch(() => {});
      }
      setIsPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const { currentTime, duration } = videoRef.current;
      if (duration > 0) {
        setProgress((currentTime / duration) * 100);
      }
      if (audioRef.current && resolvedAudioUrl) {
        if (Math.abs(audioRef.current.currentTime - currentTime) > 0.3) {
          audioRef.current.currentTime = currentTime;
        }
        audioRef.current.muted = videoRef.current.muted;
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
      {(() => {
        const ytId = video.youtube_id || video.id || (video.videoUrl && video.videoUrl.match(/(?:watch\?v=|shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1]);
        if (hasError && ytId) {
          if (isNativeApp) {
            return (
              <div className="short-video-fallback">
                <img
                  src={video.thumbnail || 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=720&auto=format&fit=crop&q=80'}
                  alt={video.title}
                  className="short-bg-fallback-img"
                />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center', zIndex: 11 }}>
                  <p style={{ color: '#fff', fontSize: 14, fontWeight: 600, margin: '0 0 10px 0' }}>Playback could not start</p>
                  <a
                    href={`https://www.youtube.com/shorts/${ytId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'inline-block', background: '#ff0000', color: '#fff', padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
                  >
                    Open in YouTube
                  </a>
                </div>
              </div>
            );
          }
          return (
            <div style={{ position: 'absolute', inset: 0 }}>
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&controls=0&loop=1&playlist=${ytId}&modestbranding=1&playsinline=1&rel=0`}
                className="short-video-element"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                style={{ width: '100%', height: '100%', border: 'none', objectFit: 'cover' }}
              />
              <a
                href={`https://www.youtube.com/shorts/${ytId}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  position: 'absolute',
                  right: 12,
                  bottom: 96,
                  zIndex: 10,
                  background: 'rgba(0,0,0,0.78)',
                  color: '#fff',
                  padding: '6px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  textDecoration: 'none'
                }}
              >
                Open in YouTube
              </a>
            </div>
          );
        }
        if (hasError) {
          return (
            <div className="short-video-fallback">
              <img
                src={video.thumbnail || 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=720&auto=format&fit=crop&q=80'}
                alt={video.title}
                className="short-bg-fallback-img"
              />
              <div className="fallback-error-text">Video Stream Offline</div>
            </div>
          );
        }
        if (isYoutube && !resolvedUrl) {
          return (
            <div className="short-video-fallback">
              <img
                src={video.thumbnail || 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=720&auto=format&fit=crop&q=80'}
                alt={video.title}
                className="short-bg-fallback-img"
              />
              <div className="fallback-error-text">{loadingStream ? 'Loading video...' : 'Preparing video...'}</div>
            </div>
          );
        }
        return (
          <>
            <video
              ref={videoRef}
              className="short-video-element"
              src={getShortVideoSrc() || undefined}
              loop
              playsInline
              onTimeUpdate={handleTimeUpdate}
              onError={handleVideoError}
              poster={video.thumbnail || undefined}
            />
            {resolvedAudioUrl && (
              <audio
                ref={audioRef}
                src={resolvedAudioUrl}
                loop
                style={{ display: 'none' }}
              />
            )}
          </>
        );
      })()}

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

"use client";
// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getClientDirectStream } from '@/utils/clientStream';
import useVideoStore from '@/store/videoStore';
import './VideoCard.css';

const VideoCard = ({ video }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [videoSrc, setVideoSrc] = useState(null);
  const videoRef = React.useRef(null);
  const router = useRouter();
  const { setCurrentVideo } = useVideoStore();

  const formatViews = (views) => {
    if (views >= 1000000) {
      return (views / 1000000).toFixed(1) + 'M';
    } else if (views >= 1000) {
      return (views / 1000).toFixed(1) + 'K';
    }
    return views;
  };

  const handleVideoClick = (e) => {
    if (e && e.preventDefault) {
      e.preventDefault();
      e.stopPropagation();
    }
    const vidId = video.id || video.youtube_id || video._id;
    if (!vidId) return;

    // Save exact feed scroll position so returning to feed is 100% seamless
    if (typeof window !== 'undefined') {
      const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
      try {
        useVideoStore.getState().setFeedScrollPos(scrollY);
        // Using hash prevents Capacitor WebView from trying to load a non-existent /watch file
        window.history.pushState({ modal: 'watch', videoId: vidId }, '', '#watch');
      } catch {}
    }

    // In-place playback: opens the watch sheet overlay smoothly WITHOUT reloading
    // the page or destroying the home feed scroll position!
    setCurrentVideo(video);
  };

  // 2026-08-14: Playback speed fix — pre-warm the client-side stream
  // extraction on hover (YouTube-style). Only for desktop mouse hover, not touchscreens.
  const handleMouseEnter = () => {
    if (typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
      return;
    }
    if (video.status === 'Pending') return; // Disable hover preview for pending uploads
    let url = video.videoUrl;
    if (url && url.includes('/api/videos/stream/')) {
      const poToken = window.youtubePoToken || localStorage.getItem('youtube_po_token') || '';
      const visitorData = window.youtubeVisitorData || localStorage.getItem('youtube_visitor_data') || '';
      if (poToken && visitorData) {
        url += `${url.includes('?') ? '&' : '?'}poToken=${encodeURIComponent(poToken)}&visitorData=${encodeURIComponent(visitorData)}`;
      }
    }
    setVideoSrc(url || null);

    // Fire-and-forget warm-up (in-flight dedupe inside clientStream prevents
    // duplicate player calls). Only for real YouTube IDs.
    const ytId = video.youtube_id || (video.videoUrl && video.videoUrl.match(/(?:embed\/|v\/|v=)([a-zA-Z0-9_-]{11})/)?.[1]);
    if (ytId) {
      getClientDirectStream(ytId, '360p', {}).then((direct) => {
        if (direct && direct.bestUrl) {
          const warmSrc = direct.bestUrl;
          // Update the hover preview to the actual playable CDN URL too.
          if (videoRef.current) {
            videoRef.current.src = warmSrc;
            videoRef.current.load();
            videoRef.current.play().catch(() => {});
          }
        }
      }).catch(() => {});
    }
  };

  const handleMouseLeave = () => {
    setVideoSrc(null);
  };

  useEffect(() => {
    if (videoRef.current && videoSrc) {
      videoRef.current.load();
      videoRef.current.play().catch(() => {});
    }
  }, [videoSrc]);

  const channel = video.channel || video.uploader || {};
  const channelName = channel.name || channel.channelName || channel.username || 'Anonymous';
  const channelAvatar = channel.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(channelName)}`;

  const isPending = video.status === 'Pending';
  const uploadProgress = video.uploadProgress || 0;
  const uploadStatus = video.uploadStatus || 'Processing...';

  // 2026-08-14: Thumbnail quality fix — old crawls stored hqdefault.jpg
  // (480x360). Upgrade to maxresdefault.jpg (1280x720) when possible.
  // Some videos have no maxres, so keep hqdefault as the onError fallback.
  const upgradeThumb = (url) => {
    if (!url || typeof url !== 'string') return url;
    const m = url.match(/(https?:\/\/[^/]+\/vi\/[^/]+\/)(hqdefault|mqdefault|sddefault)(\.jpg)/);
    return m ? `${m[1]}maxresdefault${m[3]}` : url;
  };
  const [thumbSrc, setThumbSrc] = useState(() => upgradeThumb(video.thumbnail));
  const fallbackThumb = video.thumbnail || undefined;

  return (
    <div 
      className="video-card" 
      onClick={handleVideoClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="video-thumbnail-wrapper">
        {/* Only render video element when we have a valid src — avoids empty src="" warning */}
        {videoSrc ? (
          <video 
            ref={videoRef}
            src={videoSrc}
            poster={thumbSrc || undefined}
            className="video-thumbnail"
            muted
            loop
            playsInline
            preload="none"
          />
        ) : (
          <img
            src={thumbSrc || undefined}
            alt={video.title || 'Video thumbnail'}
            className="video-thumbnail"
            style={{ objectFit: 'cover', width: '100%', height: '100%' }}
            onError={() => { if (thumbSrc !== fallbackThumb) setThumbSrc(fallbackThumb); }}
          />
        )}
        {isPending ? (
          <div className="pending-upload-overlay">
            <div className="pending-upload-icon"></div>
            <span className="pending-upload-text">{uploadStatus}</span>
            <div className="pending-upload-progress-bar">
              <div className="pending-upload-progress-fill" style={{ width: `${uploadProgress}%` }}></div>
            </div>
          </div>
        ) : video.isLive ? (
          <span className="video-live-badge">Live</span>
        ) : (
          !video.isShort && 
          video.duration && 
          !['0:00', '00:00', '00', '0', '0:00:00', '00:00:00'].includes(String(video.duration).trim()) && (
            <span className="video-duration">{video.duration}</span>
          )
        )}
      </div>

      <div className="video-info">
        <img 
          src={channelAvatar} 
          alt={channelName}
          className="channel-avatar-small"
        />
        
        <div className="video-details">
          <h3 className="video-title">{video.title}</h3>
          <div className="video-meta">
            <span className="channel-name">{channelName}</span>
            <span className="video-stats">
              {isPending ? (
                <span style={{ color: 'var(--yt-accent)', fontWeight: '500' }}>Uploading...</span>
              ) : (
                `${formatViews(video.views)} views`
              )}
              {!isPending && video.uploadTime && (
                <>
                  <span className="dot-separator"></span>
                  <span>{video.uploadTime}</span>
                </>
              )}
            </span>
          </div>
        </div>

        {!isPending && (
          <button 
            className="video-menu-btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
          >
            <svg viewBox="0 0 24 24" width="24" height="24">
              <path fill="currentColor" d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
            </svg>
          </button>
        )}

        {showMenu && (
          <div className="video-menu">
            <div className="menu-item">
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path fill="currentColor" d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/>
              </svg>
              <span>Add to queue</span>
            </div>
            <div className="menu-item">
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
              <span>Save to Watch Later</span>
            </div>
            <div className="menu-item">
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path fill="currentColor" d="M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm19.5-4.5L23 13l-6.99 7-4.51-4.5L13 14l3.01 3 5.49-5.5z"/>
              </svg>
              <span>Save to playlist</span>
            </div>
            <div className="menu-item">
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path fill="currentColor" d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/>
              </svg>
              <span>Share</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const VideoCardSkeleton = () => {
  return (
    <div className="video-skeleton">
      <div className="skeleton-thumbnail pulse"></div>
      <div className="skeleton-info">
        <div className="skeleton-avatar pulse"></div>
        <div className="skeleton-details">
          <div className="skeleton-title pulse"></div>
          <div className="skeleton-text pulse"></div>
        </div>
      </div>
    </div>
  );
};

export default VideoCard;

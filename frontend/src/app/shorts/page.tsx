"use client";
// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Link } from 'next/navigation';
import Navbar from '@/components/Navbar/Navbar';
import Sidebar from '@/components/Sidebar/Sidebar';
import { getApiBaseUrl } from '@/config';
import '@/pages/Shorts.css';

const Shorts = () => {
  const [shorts, setShorts] = useState([]);
  const [currentShortIndex, setCurrentShortIndex] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  useEffect(() => {
    const fetchShorts = async (pageNum) => {
      try {
        setLoading(true);
        const API_BASE_URL = getApiBaseUrl();
        const res = await axios.get(`${API_BASE_URL}/videos/shorts`, { params: { page: pageNum, limit: 20 } });
        const data = res.data;
        const newShorts = data.videos || [];
        setShorts(prev => pageNum === 1 ? newShorts : [...prev, ...newShorts]);
        setHasMore(!!data.hasMore);
      } catch (err) {
        console.error('Error fetching shorts:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchShorts(1);
  }, []);

  // Infinite scroll: load the next page as the user approaches the end
  const handleScroll = (e) => {
    if (!containerRef.current) return;
    const { scrollTop, clientHeight } = containerRef.current;
    const index = Math.round(scrollTop / clientHeight);
    if (index !== currentShortIndex) {
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
        const newShorts = data.videos || [];
        setShorts(prev => [...prev, ...newShorts]);
        setHasMore(!!data.hasMore);
      })
      .catch(err => console.error('Error fetching more shorts:', err));
  };

  return (
    <div className="shorts-page">
      <Navbar onMenuClick={toggleSidebar} />
      <Sidebar isOpen={sidebarOpen} />
      
      <main className={`shorts-content ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
        <div 
          className="shorts-scroll-container" 
          ref={containerRef}
          onScroll={handleScroll}
        >
          {shorts.length === 0 ? (
            <div className="no-shorts">
              <h2>No Shorts available right now!</h2>
              <p>Upload a video under 60 seconds to see it here.</p>
            </div>
          ) : (
            shorts.map((short, index) => (
              <ShortVideo 
                key={short.id} 
                video={short} 
                isActive={index === currentShortIndex} 
              />
            ))
          )}
        </div>
      </main>
    </div>
  );
};

const ShortVideo = ({ video, isActive }) => {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [likes, setLikes] = useState(video.likes || 0);
  const [isLiked, setIsLiked] = useState(false);

  const [hasError, setHasError] = useState(false);

  const getShortVideoSrc = () => {
    let src = video.videoUrl;
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
        videoRef.current.play().then(() => {
          setIsPlaying(true);
        }).catch(err => console.error("Autoplay prevented", err));
      }
    } else {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
        setIsPlaying(false);
      }
    }
  }, [isActive, hasError]);

  const togglePlay = () => {
    if (hasError) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleLike = () => {
    if (isLiked) {
      setLikes(likes - 1);
    } else {
      setLikes(likes + 1);
    }
    setIsLiked(!isLiked);
  };

  return (
    <div className="short-video-container">
      {hasError ? (
        <div className="short-error" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'white', background: '#000', fontSize: '1.2rem' }}>
          Video Unavailable
        </div>
      ) : (
        <video
          ref={videoRef}
          className="short-video-player"
          src={getShortVideoSrc()}
          loop
          onClick={togglePlay}
          playsInline
          onError={() => setHasError(true)}
        />
      )}
      
      {!isPlaying && !hasError && (
        <div className="short-play-button" onClick={togglePlay}>
          â–¶
        </div>
      )}

      <div className="short-info-overlay">
        <div className="short-author">
          <img src={video.uploaderAvatar || `https://ui-avatars.com/api/?name=${video.uploaderName}`} alt="avatar" />
          <span>@{video.uploaderName}</span>
        </div>
        <h3 className="short-title">{video.title}</h3>
        <p className="short-description">{video.description}</p>
      </div>

      <div className="short-actions">
        <button className="short-action-btn" onClick={handleLike}>
          <span className="icon">{isLiked ? 'â¤ï¸' : 'ðŸ¤'}</span>
          <span className="count">{likes}</span>
        </button>
        <button className="short-action-btn">
          <span className="icon">ðŸ’¬</span>
          <span className="count">0</span>
        </button>
        <button className="short-action-btn">
          <span className="icon">â†—ï¸</span>
          <span className="text">Share</span>
        </button>
        <div className="short-avatar-bottom">
          <img src={video.uploaderAvatar || `https://ui-avatars.com/api/?name=${video.uploaderName}`} alt="avatar" />
        </div>
      </div>
    </div>
  );
};

export default Shorts;

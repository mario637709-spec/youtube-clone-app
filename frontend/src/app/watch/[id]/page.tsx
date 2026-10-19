"use client";
// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar/Navbar';
import Sidebar from '@/components/Sidebar/Sidebar';
import VideoPlayer from '@/components/VideoPlayer/VideoPlayer';
import Comments from '@/components/Comments/Comments';
import useAuthStore from '@/store/authStore';
import { apiClient } from '@/utils/api';
import { fireEvent } from '@/utils/analytics';
import { getApiBaseUrl } from '@/config';
import { getClientDirectStream } from '@/utils/clientStream';
import { initialFeed } from '@/data/initialFeed';
import '@/pages/Watch.css';

export function generateStaticParams() {
  return initialFeed.map(v => ({ id: v.id }));
}

const Watch = () => {
  const { id } = useParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [video, setVideo] = useState(null);
  const [relatedVideos, setRelatedVideos] = useState([]);
  const [comments, setComments] = useState([]);
  const isLoading = !video || (video.id !== id && video.youtube_id !== id);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [theaterMode, setTheaterMode] = useState(false);
  const [pageError, setPageError] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [activeChapter, setActiveChapter] = useState(-1);
  const { user, setUser } = useAuthStore();

  // Sync user actions from DB on user or video change
  useEffect(() => {
    if (user && video) {
      setLiked(user.likedVideos?.includes(id) || false);
      setDisliked(user.dislikedVideos?.includes(id) || false);
      
      const channel = video.channel || video.uploader || {};
      const channelId = channel.id || channel._id;
      if (channelId) {
        setIsSubscribed(user.subscriptions?.includes(channelId) || false);
      }
    } else {
      setLiked(false);
      setDisliked(false);
      setIsSubscribed(false);
    }
  }, [user, video, id]);

  // AI Panel States
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiMessages, setAiMessages] = useState([
    { sender: 'ai', text: "Hi there! I am your AI video assistant. Ask me anything about this video, its main concepts, or request a summary." }
  ]);
  const [aiInput, setAiInput] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);

  const aiChatEndRef = useRef(null);

  const formatUploadTime = (dateStr) => {
    if (!dateStr) return 'some time ago';
    const date = new Date(dateStr);
    const seconds = Math.floor((new Date() - date) / 1000);
    
    let interval = Math.floor(seconds / 31536000);
    if (interval >= 1) return interval + (interval === 1 ? ' year ago' : ' years ago');
    interval = Math.floor(seconds / 2592000);
    if (interval >= 1) return interval + (interval === 1 ? ' month ago' : ' months ago');
    interval = Math.floor(seconds / 86400);
    if (interval >= 1) return interval + (interval === 1 ? ' day ago' : ' days ago');
    interval = Math.floor(seconds / 3600);
    if (interval >= 1) return interval + (interval === 1 ? ' hour ago' : ' hours ago');
    interval = Math.floor(seconds / 60);
    if (interval >= 1) return interval + (interval === 1 ? ' minute ago' : ' minutes ago');
    return 'just now';
  };

  useEffect(() => {
    // Clear related list and comments to show their skeletons during transitions
    setRelatedVideos([]);
    setComments([]);

    // Save to guest watch history if not logged in
    if (id) {
      try {
        let localHistory = JSON.parse(localStorage.getItem('guest_watch_history') || '[]');
        localHistory = localHistory.filter(vidId => vidId !== id);
        localHistory.unshift(id);
        if (localHistory.length > 30) localHistory = localHistory.slice(0, 30);
        localStorage.setItem('guest_watch_history', JSON.stringify(localHistory));
      } catch (e) {
        console.warn('Failed to save guest watch history:', e);
      }

      // ⚠️ 2026-08 FIX (pre-warm): start the Tier-0 extraction in the
      // background while metadata is being fetched — the player's first
      // call then hits IndexedDB (6h TTL) instead of paying the full
      // extraction cost on mount. With inFlightExtractions coalescing in
      // clientStream.ts, the player's later call SHARES this promise
      // (single sandbox round trip, not two).
      if (/^[a-zA-Z0-9_-]{11}$/.test(id)) {
        getClientDirectStream(id, 'auto', {}).catch(() => {});
      }
    }

    const fetchVideoData = async () => {
      try {
        const videoData = await apiClient.get(`/videos/${id}`);
        setVideo(videoData);
        setChapters(parseChapters(videoData.description));
        
        const relatedData = await apiClient.get(`/videos/${id}/related`);
        setRelatedVideos(relatedData);
        
        const commentsData = await apiClient.get(`/comments/${id}`);
        setComments(commentsData);

        // Reset AI panel state
        setAiMessages([
          { sender: 'ai', text: "Hi there! I am your AI video assistant. Ask me anything about this video, its main concepts, or request a summary." }
        ]);
        setAiInput('');
        setIsAiTyping(false);
      } catch (err) {
        console.warn('Backend unavailable on watch page, using fallback video data:', err);
        const found = initialFeed.find(v => v.id === id || v.youtube_id === id);
        if (found) {
          setVideo(found);
          setChapters(parseChapters(found.description));
          setRelatedVideos(initialFeed.filter(v => v.id !== id).slice(0, 8));
        } else {
          setVideo({
            id: id,
            youtube_id: id,
            title: 'YouTube Video',
            description: 'Direct streaming from YouTube CDN',
            category: 'Video',
            uploader: { channelName: 'YouTube Creator' },
            views: 245000,
            likes: 12000,
            thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            storageLocation: 'YouTube',
            status: 'Live'
          });
          setRelatedVideos(initialFeed.slice(0, 8));
        }
        setComments([
          { id: 1, userName: 'Aman Verma', avatar: 'https://ui-avatars.com/api/?name=Aman+Verma', text: 'Video is playing super smooth in APK! 🔥', likes: 45, time: '2 hours ago' },
          { id: 2, userName: 'Priya Sharma', avatar: 'https://ui-avatars.com/api/?name=Priya', text: 'Direct streaming quality is amazing!', likes: 18, time: '5 hours ago' }
        ]);
      }
    };
    fetchVideoData();
  }, [id]);

  // Real-time polling for pending video on Watch page
  useEffect(() => {
    let interval = null;
    const isPending = video && video.status === 'Pending';

    if (isPending) {
      interval = setInterval(async () => {
        try {
          const videoData = await apiClient.get(`/videos/${id}`);
          setVideo(videoData);
        } catch (err) {
          console.error('Error polling watch video status:', err);
        }
      }, 3000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [video, id]);

  // Scroll to bottom of AI chat
  useEffect(() => {
    if (aiChatEndRef.current) {
      aiChatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [aiMessages, isAiTyping]);

  // Keyboard Shortcuts Support
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if user is writing in any inputs
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.isContentEditable)
      ) {
        return;
      }

      const videoEl = document.querySelector('.video-player-element');
      if (!videoEl) return;

      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault();
          if (videoEl.paused) {
            videoEl.play().catch(() => {});
          } else {
            videoEl.pause();
          }
          break;
        case 'm':
          e.preventDefault();
          videoEl.muted = !videoEl.muted;
          // Trigger a fake click on controls volume button to update its internal state if needed
          break;
        case 'f':
          e.preventDefault();
          const container = document.querySelector('.video-player-container');
          if (container) {
            if (!document.fullscreenElement) {
              container.requestFullscreen().catch(() => {});
            } else {
              document.exitFullscreen().catch(() => {});
            }
          }
          break;
        case 'arrowleft':
          e.preventDefault();
          videoEl.currentTime = Math.max(0, videoEl.currentTime - 5);
          break;
        case 'arrowright':
          e.preventDefault();
          videoEl.currentTime = Math.min(videoEl.duration || 0, videoEl.currentTime + 5);
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Track active chapter as video plays
  useEffect(() => {
    if (chapters.length === 0) return;
    let frame = null;
    const check = () => {
      const videoEl = document.querySelector('.video-player-element');
      if (videoEl) {
        const t = videoEl.currentTime;
        let idx = -1;
        for (let i = 0; i < chapters.length; i++) {
          if (t >= chapters[i].time) idx = i;
        }
        setActiveChapter(prev => (prev === idx ? prev : idx));
      }
      frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [chapters, id]);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  const seekToChapter = (seconds) => {
    const videoEl = document.querySelector('.video-player-element');
    if (videoEl) {
      videoEl.currentTime = seconds;
      videoEl.play().catch(() => {});
      window.dispatchEvent(new CustomEvent('yt-chapter-seek', { detail: { seconds } }));
    }
  };

  const handleLike = async () => {
    if (!user) {
      alert("Please sign in to like videos!");
      return;
    }
    if (!video) return;

    let newLikes = video.likes || 0;
    let newDislikes = video.dislikes || 0;
    let updatedLikedVideos = user.likedVideos || [];
    let updatedDislikedVideos = user.dislikedVideos || [];

    const currentlyLiked = updatedLikedVideos.includes(id);
    const currentlyDisliked = updatedDislikedVideos.includes(id);

    if (currentlyLiked) {
      newLikes = Math.max(0, newLikes - 1);
      updatedLikedVideos = updatedLikedVideos.filter(vidId => vidId !== id);
      setLiked(false);
    } else {
      newLikes += 1;
      updatedLikedVideos = [...updatedLikedVideos, id];
      setLiked(true);
      fireEvent('like', id);
      if (currentlyDisliked) {
        newDislikes = Math.max(0, newDislikes - 1);
        updatedDislikedVideos = updatedDislikedVideos.filter(vidId => vidId !== id);
        setDisliked(false);
      }
    }

    setVideo(prev => ({ ...prev, likes: newLikes, dislikes: newDislikes }));

    try {
      await apiClient.put(`/videos/${id}`, { likes: newLikes, dislikes: newDislikes });
      const updatedUser = await apiClient.put('/users', {
        likedVideos: updatedLikedVideos,
        dislikedVideos: updatedDislikedVideos
      });
      setUser(updatedUser);
    } catch (err) {
      console.error('Failed to update likes:', err);
    }
  };

  const handleDislike = async () => {
    if (!user) {
      alert("Please sign in to dislike videos!");
      return;
    }
    if (!video) return;

    let newLikes = video.likes || 0;
    let newDislikes = video.dislikes || 0;
    let updatedLikedVideos = user.likedVideos || [];
    let updatedDislikedVideos = user.dislikedVideos || [];

    const currentlyLiked = updatedLikedVideos.includes(id);
    const currentlyDisliked = updatedDislikedVideos.includes(id);

    if (currentlyDisliked) {
      newDislikes = Math.max(0, newDislikes - 1);
      updatedDislikedVideos = updatedDislikedVideos.filter(vidId => vidId !== id);
      setDisliked(false);
    } else {
      newDislikes += 1;
      updatedDislikedVideos = [...updatedDislikedVideos, id];
      setDisliked(true);
      fireEvent('dislike', id);
      if (currentlyLiked) {
        newLikes = Math.max(0, newLikes - 1);
        updatedLikedVideos = updatedLikedVideos.filter(vidId => vidId !== id);
        setLiked(false);
      }
    }

    setVideo(prev => ({ ...prev, likes: newLikes, dislikes: newDislikes }));

    try {
      await apiClient.put(`/videos/${id}`, { likes: newLikes, dislikes: newDislikes });
      const updatedUser = await apiClient.put('/users', {
        likedVideos: updatedLikedVideos,
        dislikedVideos: updatedDislikedVideos
      });
      setUser(updatedUser);
    } catch (err) {
      console.error('Failed to update dislikes:', err);
    }
  };

  const handleSubscribeToggle = async () => {
    if (!user) {
      alert("Please sign in to subscribe to channels!");
      return;
    }
    const channel = video.channel || video.uploader || {};
    const channelId = channel.id || channel._id;
    if (!channelId) return;

    try {
      const result = await apiClient.post(`/users/subscribe/${channelId}`);
      setIsSubscribed(result.subscribed);
      setUser(result.user);
      if (result.subscribed) {
        fireEvent('subscribe', id, { channelId });
      }
    } catch (err) {
      console.error('Failed to toggle subscription:', err);
    }
  };

  const handleAddComment = async (text) => {
    try {
      const newComment = await apiClient.post(`/comments/${id}`, { text });
      setComments(prev => [newComment, ...prev]);
      fireEvent('comment', id);
    } catch (err) {
      alert(`Could not post comment: ${err.message}`);
    }
  };

  const handleDownload = () => {
    if (!video) return;
    // Download route directly pipes raw video stream
    const apiBase = getApiBaseUrl();
    const serverUrl = apiBase.replace('/api', '');
    const downloadUrl = `${serverUrl}/api/videos/stream/${video.id}?download=true`;
    
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.setAttribute('download', `${video.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp4`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleAiSend = async (e) => {
    if (e) e.preventDefault();
    if (!aiInput.trim() || isAiTyping) return;

    const query = aiInput;
    setAiMessages(prev => [...prev, { sender: 'user', text: query }]);
    setAiInput('');
    setIsAiTyping(true);

    const contextPrompt = `You are a helpful YouTube Clone video AI Assistant. The user is watching a video with:
Title: "${video.title}"
Category: "${video.category}"
Description: "${video.description || 'No description provided'}"
Uploader: "${video.uploader?.channelName || 'User'}"

Please answer the user's questions about this video in a clean, helpful, and concise manner.`;

    try {
      const response = await apiClient.post('/ai/ask', {
        prompt: query,
        systemPrompt: contextPrompt
      });

      if (response.success && response.answer) {
        setAiMessages(prev => [...prev, { sender: 'ai', text: response.answer }]);
      } else {
        setAiMessages(prev => [...prev, { sender: 'ai', text: "Sorry, I couldn't process that request. Please try again." }]);
      }
    } catch (err) {
      console.error('AI Request Error:', err);
      setAiMessages(prev => [...prev, { sender: 'ai', text: `Error: ${err.message || 'AI service unavailable.'}` }]);
    } finally {
      setIsAiTyping(false);
    }
  };

  const handleQuickPrompt = (promptText) => {
    setAiInput(promptText);
    setTimeout(() => {
      // Trigger send automatically
      const mockEvent = { preventDefault: () => {} };
      // Perform state updates and call API directly
      setIsAiTyping(true);
      setAiMessages(prev => [...prev, { sender: 'user', text: promptText }]);
      
      const contextPrompt = `You are a helpful YouTube Clone video AI Assistant. The user is watching a video with:
Title: "${video.title}"
Category: "${video.category}"
Description: "${video.description || 'No description provided'}"

Please answer the user's question about this video in a concise manner.`;

      apiClient.post('/ai/ask', {
        prompt: promptText,
        systemPrompt: contextPrompt
      }).then(response => {
        if (response.success && response.answer) {
          setAiMessages(prev => [...prev, { sender: 'ai', text: response.answer }]);
        } else {
          setAiMessages(prev => [...prev, { sender: 'ai', text: "Error fetching response." }]);
        }
      }).catch(err => {
        setAiMessages(prev => [...prev, { sender: 'ai', text: `Error: ${err.message}` }]);
      }).finally(() => {
        setIsAiTyping(false);
      });
    }, 50);
  };

  return (
    <div className="watch-page">
      <Navbar onMenuClick={toggleSidebar} />
      <Sidebar isOpen={sidebarOpen} />
      
      <main className={`watch-content ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'} ${theaterMode ? 'theater-mode' : ''}`}>
        {theaterMode && (
          <div className="theater-player-container">
            <VideoPlayer 
              video={isLoading ? null : video} 
              isTheaterMode={theaterMode}
              onTheaterModeToggle={() => setTheaterMode(!theaterMode)}
              isLoading={isLoading}
            />
          </div>
        )}
        
        <div className="watch-main">
          {!theaterMode && (
            <VideoPlayer 
              video={isLoading ? null : video} 
              isTheaterMode={theaterMode}
              onTheaterModeToggle={() => setTheaterMode(!theaterMode)}
              isLoading={isLoading}
            />
          )}
          
          {pageError ? (
            <div className="watch-error">
              <h2>Something went wrong</h2>
              <p>{pageError}</p>
              <button onClick={() => window.location.reload()} style={{ marginTop: '15px', padding: '10px 20px', cursor: 'pointer', background: 'var(--yt-accent-gradient)', color: 'white', border: 'none', borderRadius: '10px', boxShadow: '0 4px 14px rgba(10,132,255,0.35)' }}>Retry</button>
            </div>
          ) : isLoading ? (
            <>
              <div className="skeleton-watch-title pulse" style={{ height: '28px', width: '80%', marginTop: '20px', borderRadius: '4px', backgroundColor: 'var(--yt-skeleton-bg)' }}></div>
              <div className="skeleton-watch-meta pulse" style={{ height: '40px', width: '100%', marginTop: '15px', borderRadius: '20px', backgroundColor: 'var(--yt-skeleton-bg)' }}></div>
              <div className="skeleton-watch-desc pulse" style={{ height: '80px', width: '100%', marginTop: '15px', borderRadius: '12px', backgroundColor: 'var(--yt-skeleton-bg)' }}></div>
              <div className="skeleton-watch-comments pulse" style={{ height: '200px', width: '100%', marginTop: '24px', borderRadius: '12px', backgroundColor: 'var(--yt-skeleton-bg)' }}></div>
            </>
          ) : (
            <>
              <h1 className="video-title-large">{video.title}</h1>
              
              {/* Channel Info & Actions Pill row - desktop YouTube layout */}
              <div className="watch-metadata-actions-row">
                {(() => {
                  const channel = video.channel || video.uploader || {};
                  const channelName = channel.name || channel.channelName || channel.username || 'Anonymous';
                  const channelAvatar = channel.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(channelName)}`;
                  
                  return (
                    <div className="watch-channel-info">
                      <img src={channelAvatar} alt={channelName} className="channel-avatar-large" />
                      <div className="channel-details">
                        <h3 className="channel-name-large">{channelName}</h3>
                        <span className="subscriber-count">{formatSubscribers(channel.subscriberCount)}</span>
                      </div>
                      <button 
                        className={`subscribe-btn ${isSubscribed ? 'subscribed' : ''}`}
                        onClick={handleSubscribeToggle}
                      >
                        {isSubscribed ? 'Subscribed' : 'Subscribe'}
                      </button>
                    </div>
                  );
                })()}

                <div className="watch-actions-row">
                  {/* Combined Like/Dislike Pill */}
                  <div className="like-dislike-pill">
                    <button className={`like-btn ${liked ? 'active' : ''}`} onClick={handleLike} title="Like">
                      <svg viewBox="0 0 24 24" width="18" height="18">
                        <path fill="currentColor" d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/>
                      </svg>
                      <span className="likes-count">{video.likes || 0}</span>
                    </button>
                    <span className="like-dislike-divider"></span>
                    <button className={`dislike-btn ${disliked ? 'active' : ''}`} onClick={handleDislike} title="Dislike">
                      <svg viewBox="0 0 24 24" width="18" height="18">
                        <path fill="currentColor" d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/>
                      </svg>
                    </button>
                  </div>

                  {/* Share Pill */}
                  <button className="action-pill" onClick={() => {
                    navigator.clipboard.writeText(window.location.href);
                    fireEvent('share', id);
                    alert("Link copied to clipboard!");
                  }}>
                    <svg viewBox="0 0 24 24" width="18" height="18">
                      <path fill="currentColor" d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/>
                    </svg>
                    <span>Share</span>
                  </button>

                  {/* Ask AI Pill */}
                  <button className={`action-pill ${aiPanelOpen ? 'active-blue' : ''}`} onClick={() => setAiPanelOpen(!aiPanelOpen)}>
                    <svg viewBox="0 0 24 24" width="18" height="18" className="sparkle-ai-icon">
                      <path fill="currentColor" d="M12 2L9.12 9.12 2 12l7.12 2.88L12 22l2.88-7.12L22 12l-7.12-2.88z"/>
                    </svg>
                    <span>Ask AI</span>
                  </button>

                  {/* Download Pill */}
                  <button className="action-pill" onClick={handleDownload}>
                    <svg viewBox="0 0 24 24" width="18" height="18">
                      <path fill="currentColor" d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
                    </svg>
                    <span>Download</span>
                  </button>

                  {/* More Pill */}
                  <button className="action-pill-more" onClick={() => alert("Reported! Thank you for keeping YouTube safe.")}>
                    <span>...</span>
                  </button>
                </div>
              </div>

              {/* Description Section Styled as card */}
              <div className="description-card-section" onClick={() => !showFullDescription && setShowFullDescription(true)}>
                <div className="description-meta-stats">
                  <span>{(video.views || 0).toLocaleString()} views</span>
                  <span>•</span>
                  <span>{formatUploadTime(video.createdAt)}</span>
                </div>
                <div className={`description-text-content ${showFullDescription ? 'expanded' : ''}`}>
                  <p className="desc-paragraph">{video.description || 'Our trip to Las Vegas, USA. Check out how we explore the beautiful places and eat amazing food. Subscribing helps us create more videos for you guys!'}</p>
                  {showFullDescription && (
                    <div className="desc-extra-info animate-fade-in">
                      <p>Don't forget to like, share, and subscribe for more content!</p>
                      <p><strong>Category:</strong> {video.category}</p>
                      {video.tags && video.tags.length > 0 && (
                        <p className="desc-tags">
                          {video.tags.map(tag => <span key={tag} className="desc-tag">#{tag} </span>)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <button 
                  className="show-more-toggle-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowFullDescription(!showFullDescription);
                  }}
                >
                  {showFullDescription ? 'Show less' : '...more'}
                </button>
              </div>

              {chapters.length > 0 && (
                <div className="chapters-timeline-section">
                  <div className="chapters-header">
                    <h3 className="chapters-title">Chapters</h3>
                    <span className="chapters-count">{chapters.length} key moments</span>
                  </div>
                  <div className="chapters-segment-bar">
                    {chapters.map((chapter, i) => {
                      const duration = (video.durationSec || video.durationSeconds || 0);
                      const next = chapters[i + 1] ? chapters[i + 1].time : duration;
                      const width = duration > 0 ? Math.max(4, ((next - chapter.time) / duration) * 100) : 100 / chapters.length;
                      return (
                        <div
                          key={i}
                          className="chapter-segment"
                          style={{ width: `${width}%`, background: `hsl(${205 + (i * 18) % 40}, 85%, ${58 - (i * 3) % 12}%)` }}
                          title={chapter.title}
                          onClick={() => seekToChapter(chapter.time)}
                        />
                      );
                    })}
                  </div>
                  <div className="chapters-list">
                    {chapters.map((chapter, i) => (
                      <button key={i} className={`chapter-row ${activeChapter === i ? 'active' : ''}`} onClick={() => seekToChapter(chapter.time)}>
                        <span className="chapter-time">{chapter.time >= 3600 ? `${Math.floor(chapter.time / 3600)}:${String(Math.floor((chapter.time % 3600) / 60)).padStart(2, '0')}:${String(chapter.time % 60).padStart(2, '0')}` : `${Math.floor(chapter.time / 60)}:${String(chapter.time % 60).padStart(2, '0')}`}</span>
                        <span className="chapter-title-text">{chapter.title}</span>
                        <svg viewBox="0 0 24 24" width="14" height="14" className="chapter-arrow">
                          <path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/>
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Comments comments={comments} videoId={id} onAddComment={handleAddComment} />
            </>
          )}
        </div>

        {/* Right column - sidebar & Ask AI Panel */}
        <aside className="related-videos-sidebar">
          {/* Ask AI chat box slider */}
          {aiPanelOpen && (
            <div className="ask-ai-panel animate-slide-in">
              <div className="ai-panel-header">
                <div className="ai-header-title">
                  <svg viewBox="0 0 24 24" width="20" height="20" className="sparkle-ai-icon">
                    <path fill="currentColor" d="M12 2L9.12 9.12 2 12l7.12 2.88L12 22l2.88-7.12L22 12l-7.12-2.88z"/>
                  </svg>
                  <span>Ask AI Assistant</span>
                </div>
                <button className="close-ai-panel" onClick={() => setAiPanelOpen(false)}>&times;</button>
              </div>
              
              <div className="ai-chat-messages">
                {aiMessages.map((msg, index) => (
                  <div key={index} className={`ai-message ${msg.sender === 'user' ? 'msg-user' : 'msg-ai'}`}>
                    <div className="msg-avatar">
                      {msg.sender === 'user' ? 'U' : 'AI'}
                    </div>
                    <div className="msg-text">{msg.text}</div>
                  </div>
                ))}
                
                {isAiTyping && (
                  <div className="ai-message msg-ai">
                    <div className="msg-avatar">AI</div>
                    <div className="msg-text typing-indicator">
                      <span></span><span></span><span></span>
                    </div>
                  </div>
                )}
                <div ref={aiChatEndRef} />
              </div>

              {/* Quick suggestions */}
              <div className="ai-quick-prompts">
                <button onClick={() => handleQuickPrompt("Summarize this video in 3 points.")}>Summarize video</button>
                <button onClick={() => handleQuickPrompt("What are the key points?")}>Key points</button>
                <button onClick={() => handleQuickPrompt("What is the category and tone?")}>Category & tone</button>
              </div>

              <form onSubmit={handleAiSend} className="ai-chat-input-row">
                <input
                  type="text"
                  placeholder="Ask a question about this video..."
                  value={aiInput}
                  onChange={e => setAiInput(e.target.value)}
                  disabled={isAiTyping}
                />
                <button type="submit" disabled={isAiTyping || !aiInput.trim()}>
                  <svg viewBox="0 0 24 24" width="20" height="20">
                    <path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                  </svg>
                </button>
              </form>
            </div>
          )}

          {/* Related Videos pill bar */}
          <div className="related-categories-bar">
            <span className="category-pill active">All</span>
            <span className="category-pill">From this series</span>
            <span className="category-pill">Related</span>
          </div>

          <div className="related-videos-list">
            {isLoading || relatedVideos.length === 0 ? (
              Array(6).fill(null).map((_, i) => (
                <div className="skeleton-related-card" key={i}>
                  <div className="skeleton-related-thumb pulse"></div>
                  <div className="skeleton-related-details">
                    <div className="skeleton-related-title pulse"></div>
                    <div className="skeleton-related-text pulse"></div>
                  </div>
                </div>
              ))
            ) : (
              relatedVideos.map(relatedVideo => (
                <RelatedVideoCard key={relatedVideo.id} relatedVideo={relatedVideo} />
              ))
            )}
          </div>
        </aside>
      </main>
    </div>
  );
};

const formatSubscribers = (count) => {
  if (!count || count === 0) return null;
  if (count >= 1000000000) return (count / 1000000000).toFixed(2).replace(/\.?0+$/, '') + 'B subscribers';
  if (count >= 1000000) return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M subscribers';
  if (count >= 1000) return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K subscribers';
  return count + ' subscribers';
};

const parseChapters = (description) => {
  if (!description) return [];
  const chapters = [];
  const lines = String(description).split('\n');
  for (const line of lines) {
    const match = line.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(.{2,120})$/);
    if (!match) continue;
    const h = match[1] ? parseInt(match[1], 10) : 0;
    const m = parseInt(match[2], 10);
    const s = parseInt(match[3], 10);
    if (m > 59) continue;
    const time = h * 3600 + m * 60 + s;
    if (chapters.length && time <= chapters[chapters.length - 1].time) continue;
    chapters.push({ time, title: match[4].trim() });
    if (chapters.length >= 20) break;
  }
  return chapters.filter((c, i) => i === 0 || c.time > chapters[i - 1].time).length >= 2 ? chapters : [];
};

const RelatedVideoCard = ({ relatedVideo }) => {
  const router = useRouter();

  const formatViews = (views) => {
    if (views >= 1000000) {
      return (views / 1000000).toFixed(1) + 'M';
    } else if (views >= 1000) {
      return (views / 1000).toFixed(1) + 'K';
    }
    return views;
  };

  return (
    <div 
      className="related-video-card"
      onClick={() => router.push(`/watch/${relatedVideo.id}`)}
    >
      <img 
        src={relatedVideo.thumbnail}
        alt={relatedVideo.title}
        className="related-thumbnail" 
        loading="lazy"
      />
      <div className="related-info">
        <h4 className="related-title">{relatedVideo.title}</h4>
        <p className="related-channel">
          {(relatedVideo.channel && relatedVideo.channel.name) || 
           (relatedVideo.uploader && (relatedVideo.uploader.channelName || relatedVideo.uploader.username)) || 
           'Anonymous'}
        </p>
        <p className="related-stats">{formatViews(relatedVideo.views)} views</p>
      </div>
    </div>
  );
};

const WatchPageSkeleton = ({ sidebarOpen }) => {
  return (
    <div className="watch-page skeleton-watch">
      <Navbar onMenuClick={() => {}} />
      <Sidebar isOpen={sidebarOpen} />
      
      <main className={`watch-content ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
        <div className="watch-main">
          <div className="skeleton-player pulse"></div>
          <div className="skeleton-watch-title pulse"></div>
          <div className="skeleton-watch-meta pulse"></div>
        </div>
        
        <aside className="related-videos-sidebar">
          <div className="skeleton-related-list">
            {Array(6).fill(null).map((_, i) => (
              <div className="skeleton-related-card" key={i}>
                <div className="skeleton-related-thumb pulse"></div>
                <div className="skeleton-related-details">
                  <div className="skeleton-related-title pulse"></div>
                  <div className="skeleton-related-text pulse"></div>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </main>
    </div>
  );
};

export default Watch;

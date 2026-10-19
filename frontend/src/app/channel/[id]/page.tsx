"use client";
// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Navbar from '@/components/Navbar/Navbar';
import Sidebar from '@/components/Sidebar/Sidebar';
import VideoCard from '@/components/VideoCard/VideoCard';
import { dummyChannels } from '@/data/dummyData';
import { apiClient } from '@/utils/api';
import '@/pages/Channel.css';

const Channel = () => {
  const { id } = useParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('videos');
  const [channel, setChannel] = useState(null);
  const [channelVideos, setChannelVideos] = useState([]);
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    const fetchChannelData = async () => {
      try {
        const channelData = dummyChannels.find(c => c.id === parseInt(id)) || dummyChannels[0];
        setChannel(channelData);
        
        const allVideos = await apiClient.get('/videos');
        const filteredVideos = allVideos.filter(v => v.uploader.channelName === channelData.name);
        setChannelVideos(filteredVideos);
      } catch (err) {
        console.error('Error fetching channel data:', err);
      }
    };
    fetchChannelData();
  }, [id]);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  if (!channel) return <div>Loading...</div>;

  return (
    <div className="channel-page">
      <Navbar onMenuClick={toggleSidebar} />
      <Sidebar isOpen={sidebarOpen} />
      
      <main className={`channel-content ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
        <div className="channel-header">
          <div className="channel-cover"></div>
          
          <div className="channel-info-bar">
            <img src={channel.avatar} alt={channel.name} className="channel-avatar-xl" />
            
            <div className="channel-info-details">
              <h1 className="channel-name-xl">
                {channel.name}
                <svg className="verification-badge" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
              </h1>
              <p className="channel-handle">@{channel.name.toLowerCase().replace(/\s/g, '')}</p>
              <p className="channel-stats">
                <span>{channel.subscribers} subscribers</span>
                <span>•</span>
                <span>{channelVideos.length} videos</span>
              </p>
            </div>
            
            <button 
              className={`subscribe-btn-large ${isSubscribed ? 'subscribed' : ''}`}
              onClick={() => setIsSubscribed(!isSubscribed)}
            >
              {isSubscribed ? 'Subscribed' : 'Subscribe'}
            </button>
          </div>
        </div>

        <div className="channel-tabs">
          <button 
            className={`channel-tab ${activeTab === 'home' ? 'active' : ''}`}
            onClick={() => setActiveTab('home')}
          >
            Home
          </button>
          <button 
            className={`channel-tab ${activeTab === 'videos' ? 'active' : ''}`}
            onClick={() => setActiveTab('videos')}
          >
            Videos
          </button>
          <button 
            className={`channel-tab ${activeTab === 'playlists' ? 'active' : ''}`}
            onClick={() => setActiveTab('playlists')}
          >
            Playlists
          </button>
          <button 
            className={`channel-tab ${activeTab === 'about' ? 'active' : ''}`}
            onClick={() => setActiveTab('about')}
          >
            About
          </button>
        </div>

        <div className="channel-tab-content">
          {activeTab === 'videos' && (
            <div className="channel-videos-grid">
              {channelVideos.map(video => (
                <VideoCard key={video.id} video={video} />
              ))}
            </div>
          )}

          {activeTab === 'about' && (
            <div className="channel-about-section">
              <div className="about-section">
                <h3>Description</h3>
                <p>Welcome to {channel.name}! We create amazing content about technology, gaming, and adventure. Subscribe for weekly uploads!</p>
                <p>Business inquiries: contact@{channel.name.toLowerCase().replace(/\s/g, '')}.com</p>
              </div>

              <div className="about-section">
                <h3>Channel Stats</h3>
                <div className="channel-stats-grid">
                  <div className="stat-item">
                    <span className="stat-value">{channel.subscribers}</span>
                    <span className="stat-label">Subscribers</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">{channelVideos.length}</span>
                    <span className="stat-label">Videos</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">10M+</span>
                    <span className="stat-label">Total Views</span>
                  </div>
                </div>
              </div>

              <div className="about-section">
                <h3>Links</h3>
                <p>🌐 Website: www.{channel.name.toLowerCase().replace(/\s/g, '')}.com</p>
                <p>🐦 Twitter: @{channel.name.toLowerCase().replace(/\s/g, '')}</p>
                <p>📷 Instagram: @{channel.name.toLowerCase().replace(/\s/g, '')}</p>
              </div>
            </div>
          )}

          {activeTab === 'home' && (
            <div className="channel-videos-grid">
              {channelVideos.slice(0, 8).map(video => (
                <VideoCard key={video.id} video={video} />
              ))}
            </div>
          )}

          {activeTab === 'playlists' && (
            <div style={{ color: '#aaaaaa', padding: '40px', textAlign: 'center' }}>
              <p>No playlists available yet.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Channel;

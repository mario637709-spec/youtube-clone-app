"use client";
// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar/Navbar';
import Sidebar from '@/components/Sidebar/Sidebar';
import useAuthStore from '@/store/authStore';
import { apiClient } from '@/utils/api';
import '@/pages/Profile.css';

const Profile = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const { user, logout, setUser } = useAuthStore();
  const router = useRouter();

  const [profileData, setProfileData] = useState({
    channelName: '',
    email: '',
    username: ''
  });

  const [analytics, setAnalytics] = useState({
    totalUploads: 0,
    totalViews: 0,
    totalLikes: 0,
    videos: []
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      router.push('/');
      return;
    }

    setProfileData({
      channelName: user.channelName || '',
      email: user.email || '',
      username: user.username || ''
    });

    const fetchAnalytics = async () => {
      try {
        const data = await apiClient.get('/users/analytics');
        setAnalytics(data);
      } catch (err) {
        console.error('Error fetching analytics:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [user, router]);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  const handleInputChange = (e) => {
    setProfileData({
      ...profileData,
      [e.target.name]: e.target.value
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      const updatedUser = await apiClient.put('/users', {
        channelName: profileData.channelName,
        email: profileData.email,
        username: profileData.username
      });
      setUser({
        id: updatedUser.id || updatedUser._id,
        username: updatedUser.username,
        email: updatedUser.email,
        channelName: updatedUser.channelName,
        avatar: updatedUser.avatar
      });
      alert('Profile updated successfully!');
    } catch (err) {
      alert(`Update failed: ${err.message}`);
    }
  };

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  if (!user) return null;

  return (
    <div className="profile-page">
      <Navbar onMenuClick={toggleSidebar} />
      <Sidebar isOpen={sidebarOpen} />
      
      <main className={`profile-content ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
        <div className="profile-container">
          <h1 className="profile-title">Settings & Dashboard</h1>
          
          <div className="profile-tabs">
            <button 
              className={`profile-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
            >
              Dashboard
            </button>
            <button 
              className={`profile-tab ${activeTab === 'profile' ? 'active' : ''}`}
              onClick={() => setActiveTab('profile')}
            >
              Channel Settings
            </button>
            <button 
              className={`profile-tab ${activeTab === 'privacy' ? 'active' : ''}`}
              onClick={() => setActiveTab('privacy')}
            >
              Privacy
            </button>
          </div>

          {activeTab === 'dashboard' && (
            <div className="profile-section">
              <h2>Channel Performance</h2>
              {loading ? (
                <div>Loading analytics...</div>
              ) : (
                <>
                  <div className="analytics-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '32px', marginTop: '16px' }}>
                    <div className="analytics-card" style={{ background: 'var(--yt-bg-card)', border: '1px solid var(--yt-border-color)', padding: '24px', borderRadius: '8px', textAlign: 'center' }}>
                      <h3 style={{ fontSize: '32px', color: 'var(--yt-brand-red)', marginBottom: '8px' }}>{analytics.totalUploads}</h3>
                      <p style={{ color: 'var(--yt-text-secondary)', fontSize: '14px' }}>Total Uploads</p>
                    </div>
                    <div className="analytics-card" style={{ background: 'var(--yt-bg-card)', border: '1px solid var(--yt-border-color)', padding: '24px', borderRadius: '8px', textAlign: 'center' }}>
                      <h3 style={{ fontSize: '32px', color: 'var(--yt-brand-red)', marginBottom: '8px' }}>{analytics.totalViews.toLocaleString()}</h3>
                      <p style={{ color: 'var(--yt-text-secondary)', fontSize: '14px' }}>Total Views</p>
                    </div>
                    <div className="analytics-card" style={{ background: 'var(--yt-bg-card)', border: '1px solid var(--yt-border-color)', padding: '24px', borderRadius: '8px', textAlign: 'center' }}>
                      <h3 style={{ fontSize: '32px', color: 'var(--yt-brand-red)', marginBottom: '8px' }}>{analytics.totalLikes.toLocaleString()}</h3>
                      <p style={{ color: 'var(--yt-text-secondary)', fontSize: '14px' }}>Total Likes</p>
                    </div>
                  </div>

                  <h2>Your Uploads</h2>
                  {analytics.videos.length === 0 ? (
                    <p style={{ color: 'var(--yt-text-secondary)', marginTop: '12px' }}>You haven't uploaded any videos yet.</p>
                  ) : (
                    <div className="uploads-list" style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {analytics.videos.map(v => (
                        <div key={v.id} className="uploaded-video-item" onClick={() => router.push(`/watch?v=${v.id}`)} style={{ display: 'flex', gap: '16px', background: 'var(--yt-bg-card)', padding: '12px', borderRadius: '8px', cursor: 'pointer', border: '1px solid var(--yt-border-color)' }}>
                          <img src={v.thumbnail} alt={v.title} style={{ width: '120px', height: '68px', borderRadius: '4px', objectFit: 'cover' }} />
                          <div style={{ flex: 1 }}>
                            <h4 style={{ color: 'var(--yt-text-primary)', fontSize: '16px', marginBottom: '4px' }}>{v.title}</h4>
                            <p style={{ color: 'var(--yt-text-secondary)', fontSize: '12px' }}>{v.views} views • {v.category}</p>
                            <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '100px', background: v.status === 'Flagged' ? 'rgba(255, 68, 68, 0.2)' : 'rgba(95, 255, 95, 0.2)', color: v.status === 'Flagged' ? '#f55' : '#5f5', display: 'inline-block', marginTop: '8px' }}>
                              {v.status || 'Approved'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="profile-section">
              <h2>Channel Settings</h2>
              
              <div className="profile-avatar-section">
                <img 
                  src={user.avatar} 
                  alt="Avatar"
                  className="profile-avatar-large"
                />
              </div>

              <form className="profile-form" onSubmit={handleSave}>
                <div className="form-group">
                  <label htmlFor="channelName">Channel Name</label>
                  <input
                    id="channelName"
                    type="text"
                    name="channelName"
                    value={profileData.channelName}
                    onChange={handleInputChange}
                    maxLength="50"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="username">Username</label>
                  <input
                    id="username"
                    type="text"
                    name="username"
                    value={profileData.username}
                    onChange={handleInputChange}
                    maxLength="50"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="email">Email Address</label>
                  <input
                    id="email"
                    type="email"
                    name="email"
                    value={profileData.email}
                    onChange={handleInputChange}
                  />
                </div>

                <div style={{ display: 'flex', gap: '16px', marginTop: '16px' }}>
                  <button type="submit" className="save-btn">Save Changes</button>
                  <button type="button" className="danger-btn" onClick={handleLogout} style={{ background: '#333', color: '#f55', border: '1px solid #444', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer', fontWeight: '600' }}>Log Out</button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'privacy' && (
            <div className="profile-section">
              <h2>Privacy Settings</h2>
              
              <div className="privacy-options">
                <div className="privacy-item">
                  <div className="privacy-info">
                    <h3>Subscriptions</h3>
                    <p>Keep all my subscriptions private</p>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

                <div className="privacy-item">
                  <div className="privacy-info">
                    <h3>Liked Videos</h3>
                    <p>Keep all my liked videos private</p>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

                <div className="privacy-item">
                  <div className="privacy-info">
                    <h3>Watch History</h3>
                    <p>Save my watch history</p>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" defaultChecked />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Profile;

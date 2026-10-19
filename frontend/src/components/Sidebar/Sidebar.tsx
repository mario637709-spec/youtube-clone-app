"use client";
// @ts-nocheck
import React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import './Sidebar.css';

const Sidebar = ({ isOpen }) => {
  const router = useRouter();
  const pathname = usePathname();

  const handleNavigation = (text) => {
    if (text === 'Home') {
      router.push('/');
    } else if (text === 'Shorts') {
      router.push('/shorts');
    } else if (text === 'Trending') {
      router.push('/');
    } else if (text === 'Subscriptions') {
      alert("Subscriptions: You are subscribed to 3 channels (Tech Explorer, Gaming World, and Adventure).");
    } else if (text === 'Library') {
      alert("Library: Access your playlists, watch history, and liked videos here.");
    } else if (text === 'History') {
      alert("History: Your watch history is enabled in Settings (Profile).");
    } else if (text === 'Watch Later') {
      alert("Watch Later: No videos saved yet.");
    } else if (text === 'Liked Videos') {
      alert("Liked Videos: You can like videos on the Watch page to see them here.");
    }
  };

  const handleCategoryClick = (categoryName) => {
    router.push(`/search?q=${encodeURIComponent(categoryName)}`);
  };

  const handleChannelClick = (id) => {
    router.push(`/channel/${id}`);
  };

  const menuItems = [
    { icon: '🏠', text: 'Home', active: pathname === '/' },
    { icon: '⚡', text: 'Shorts', active: pathname === '/shorts' },
    { icon: '🔥', text: 'Trending' },
    { icon: '📺', text: 'Subscriptions' },
    { icon: '📚', text: 'Library' },
  ];

  const secondaryItems = [
    { icon: '🕒', text: 'History' },
    { icon: '⏰', text: 'Watch Later' },
    { icon: '👍', text: 'Liked Videos' },
  ];

  const categories = [
    { icon: '🎵', text: 'Music' },
    { icon: '⚽', text: 'Sports' },
    { icon: '🎮', text: 'Gaming' },
    { icon: '📰', text: 'News' },
  ];

  return (
    <aside className={`sidebar ${isOpen ? 'open' : 'closed'}`}>
      <div className="sidebar-section">
        {menuItems.map((item, index) => (
          <div 
            key={index} 
            className={`sidebar-item ${item.active ? 'active' : ''}`}
            onClick={() => handleNavigation(item.text)}
            style={{ cursor: 'pointer' }}
          >
            <span className="sidebar-icon">{item.icon}</span>
            {isOpen && <span className="sidebar-text">{item.text}</span>}
          </div>
        ))}
      </div>

      <div className="sidebar-divider"></div>

      <div className="sidebar-section">
        {secondaryItems.map((item, index) => (
          <div 
            key={index} 
            className="sidebar-item"
            onClick={() => handleNavigation(item.text)}
            style={{ cursor: 'pointer' }}
          >
            <span className="sidebar-icon">{item.icon}</span>
            {isOpen && <span className="sidebar-text">{item.text}</span>}
          </div>
        ))}
      </div>

      <div className="sidebar-divider"></div>

      {isOpen && (
        <>
          <div className="sidebar-section">
            <div className="sidebar-title">Subscriptions</div>
            <div className="sidebar-item" onClick={() => handleChannelClick(1)} style={{ cursor: 'pointer' }}>
              <img src="https://ui-avatars.com/api/?name=Tech+Explorer&background=random" alt="" className="channel-avatar" />
              <span className="sidebar-text">Tech Explorer</span>
            </div>
            <div className="sidebar-item" onClick={() => handleChannelClick(2)} style={{ cursor: 'pointer' }}>
              <img src="https://ui-avatars.com/api/?name=Gaming+World&background=random" alt="" className="channel-avatar" />
              <span className="sidebar-text">Gaming World</span>
            </div>
            <div className="sidebar-item" onClick={() => handleChannelClick(3)} style={{ cursor: 'pointer' }}>
              <img src="https://ui-avatars.com/api/?name=Adventure&background=random" alt="" className="channel-avatar" />
              <span className="sidebar-text">Adventure</span>
            </div>
          </div>

          <div className="sidebar-divider"></div>
        </>
      )}

      <div className="sidebar-section">
        {isOpen && <div className="sidebar-title">Explore</div>}
        {categories.map((item, index) => (
          <div 
            key={index} 
            className="sidebar-item"
            onClick={() => handleCategoryClick(item.text)}
            style={{ cursor: 'pointer' }}
          >
            <span className="sidebar-icon">{item.icon}</span>
            {isOpen && <span className="sidebar-text">{item.text}</span>}
          </div>
        ))}
      </div>
    </aside>
  );
};

export default Sidebar;

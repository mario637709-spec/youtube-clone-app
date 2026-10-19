"use client";
// @ts-nocheck
import React, { useState } from 'react';
import useAuthStore from '@/store/authStore';
import AuthModal from '../AuthModal/AuthModal';
import './Comments.css';

const Comments = ({ comments = [], videoId, onAddComment }) => {
  const { user } = useAuthStore();
  const [commentText, setCommentText] = useState('');
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const formatCommentTime = (dateStr) => {
    if (!dateStr) return 'just now';
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

  const handleSubmitComment = (e) => {
    e.preventDefault();
    if (!user) {
      setAuthModalOpen(true);
      return;
    }
    if (commentText.trim()) {
      if (onAddComment) {
        onAddComment(commentText);
      }
      setCommentText('');
      setShowCommentBox(false);
    }
  };

  const handleInputFocus = () => {
    if (!user) {
      setAuthModalOpen(true);
    } else {
      setShowCommentBox(true);
    }
  };

  const userAvatar = user ? user.avatar : 'https://ui-avatars.com/api/?name=Guest&background=888&color=fff';

  return (
    <div className="comments-section">
      <div className="comments-header">
        <h3 className="comments-count">{comments.length} Comments</h3>
        <div className="sort-dropdown">
          <button className="sort-btn">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="currentColor" d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z"/>
            </svg>
            <span>Sort by</span>
          </button>
        </div>
      </div>

      <div className="add-comment-section">
        <img 
          src={userAvatar} 
          alt="User" 
          className="comment-avatar"
        />
        <div className="comment-input-wrapper">
          <input
            type="text"
            className={`comment-input ${showCommentBox ? 'focused' : ''}`}
            placeholder="Add a comment..."
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onFocus={handleInputFocus}
          />
          {showCommentBox && (
            <div className="comment-actions">
              <button 
                className="comment-btn cancel"
                onClick={() => {
                  setShowCommentBox(false);
                  setCommentText('');
                }}
              >
                Cancel
              </button>
              <button 
                className="comment-btn submit"
                onClick={handleSubmitComment}
                disabled={!commentText.trim()}
              >
                Comment
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="comments-list">
        {comments.map((comment) => {
          const author = comment.user || {};
          const authorName = author.username || author.channelName || 'Anonymous';
          const authorAvatar = author.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(authorName)}`;
          
          return (
            <div key={comment.id} className="comment-item">
              <img 
                src={authorAvatar} 
                alt={authorName}
                className="comment-avatar"
              />
              <div className="comment-content">
                <div className="comment-header-info">
                  <span className="comment-user-name">{authorName}</span>
                  <span className="comment-time">{formatCommentTime(comment.createdAt)}</span>
                </div>
                <p className="comment-text">{comment.text}</p>
                <div className="comment-actions-row">
                  <button className="comment-action-btn">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                      <path fill="currentColor" d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/>
                    </svg>
                    <span>0</span>
                  </button>
                  <button className="comment-action-btn">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                      <path fill="currentColor" d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/>
                    </svg>
                  </button>
                  <button className="reply-btn">Reply</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </div>
  );
};

export default Comments;

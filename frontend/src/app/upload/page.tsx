"use client";
// @ts-nocheck
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar/Navbar';
import Sidebar from '@/components/Sidebar/Sidebar';
import { getApiBaseUrl } from '@/config';
import '@/pages/Upload.css';

const Upload = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreview, setVideoPreview] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [thumbnailPreview, setThumbnailPreview] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [duration, setDuration] = useState('0:00');
  const [isShort, setIsShort] = useState(false);
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'Gaming',
    tags: '',
    visibility: 'public',
  });
  
  const [progress, setProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  
  const router = useRouter();

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (file) => {
    if (file.type.startsWith('video/')) {
      setVideoFile(file);
      const videoUrl = URL.createObjectURL(file);
      setVideoPreview(videoUrl);
      
      // Calculate video duration and shorts status using HTML5 Video
      const tempVideo = document.createElement('video');
      tempVideo.src = videoUrl;
      tempVideo.onloadedmetadata = () => {
        const minutes = Math.floor(tempVideo.duration / 60);
        const seconds = Math.floor(tempVideo.duration % 60);
        setDuration(`${minutes}:${seconds.toString().padStart(2, '0')}`);
        
        // Shorts Algorithm: If duration is < 60 seconds, it's a Short!
        setIsShort(tempVideo.duration < 60);
      };
      
      // Seed default title
      const cleanName = file.name.replace(/\.[^/.]+$/, "");
      setFormData(prev => ({
        ...prev,
        title: cleanName
      }));
    } else {
      alert('Please upload a video file (MP4, WebM, etc.)');
    }
  };

  const handleThumbnailInput = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type.startsWith('image/')) {
        setThumbnailFile(file);
        setThumbnailPreview(URL.createObjectURL(file));
      } else {
        alert('Please upload a valid image file for the thumbnail');
      }
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const removeVideo = () => {
    setVideoFile(null);
    setVideoPreview('');
    setDuration('');
    setIsShort(false);
    setFormData(prev => ({ ...prev, title: '' }));
  };

  const removeThumbnail = () => {
    setThumbnailFile(null);
    setThumbnailPreview('');
  };

  const handlePublish = async (e) => {
    e.preventDefault();
    if (!videoFile) {
      alert('Please select a video file to upload.');
      return;
    }

    setIsUploading(true);
    setProgress(0);

    const token = localStorage.getItem('token');
    const API_BASE_URL = getApiBaseUrl();
    const uploadId = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    const chunkSize = 5 * 1024 * 1024; // 5 MB chunks
    const totalChunks = Math.ceil(videoFile.size / chunkSize);

    try {
      // 1. Upload chunks one by one
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, videoFile.size);
        const chunkBlob = videoFile.slice(start, end);

        const chunkData = new FormData();
        chunkData.append('chunk', chunkBlob, `chunk_${i}`);
        chunkData.append('chunkIndex', i);
        chunkData.append('totalChunks', totalChunks);
        chunkData.append('uploadId', uploadId);

        console.log(`[Uploader] Uploading chunk ${i + 1}/${totalChunks}...`);
        const response = await fetch(`${API_BASE_URL}/videos/upload-chunk`, {
          method: 'POST',
          headers: {
            'Authorization': token ? `Bearer ${token}` : ''
          },
          body: chunkData
        });

        if (!response.ok) {
          const errRes = await response.json().catch(() => ({}));
          throw new Error(errRes.message || `Failed uploading chunk ${i + 1}`);
        }

        // Progress up to 90%
        const percent = Math.round(((i + 1) / totalChunks) * 90);
        setProgress(percent);
      }

      // 2. Call upload-complete to trigger merge & background jobs (transcoding, youtube upload)
      setProgress(95);
      console.log('[Uploader] Finalizing upload, merging chunks on server...');

      const completeData = new FormData();
      completeData.append('uploadId', uploadId);
      completeData.append('title', formData.title);
      completeData.append('description', formData.description);
      completeData.append('category', formData.category);
      completeData.append('visibility', formData.visibility);
      completeData.append('duration', duration);
      completeData.append('isShort', isShort ? 'true' : 'false');
      if (thumbnailFile) {
        completeData.append('thumbnail', thumbnailFile);
      }

      const completeResponse = await fetch(`${API_BASE_URL}/videos/upload-complete`, {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: completeData
      });

      if (!completeResponse.ok) {
        const errRes = await completeResponse.json().catch(() => ({}));
        throw new Error(errRes.message || 'Failed to merge video chunks on server');
      }

      setProgress(100);
      const savedVideo = await completeResponse.json();
      alert('Video uploaded and processed successfully! Multi-quality transcoding (360p-4K) and YouTube sync are executing in the background.');
      router.push('/');

    } catch (err) {
      console.error('[Upload Error]:', err);
      alert(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveDraft = () => {
    alert('Draft saved locally! (Simulation)');
  };

  return (
    <div className="upload-page">
      <Navbar onMenuClick={toggleSidebar} />
      <Sidebar isOpen={sidebarOpen} />
      
      <main className={`upload-content ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
        <div className="upload-container">
          <h1 className="upload-title">Upload Video</h1>
          
          {!videoFile ? (
            <div
              className={`upload-dropzone ${dragActive ? 'drag-active' : ''}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <svg className="upload-icon" viewBox="0 0 24 24" width="64" height="64">
                <path fill="currentColor" d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/>
              </svg>
              <h2>Drag and drop video files to upload</h2>
              <p className="upload-subtitle">Your videos will be private until you publish them.</p>
              <p className="upload-note">Accepted formats: MP4, WebM, QuickTime (up to 100MB)</p>
              
              <label className="file-select-btn">
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleFileInput}
                  style={{ display: 'none' }}
                />
                Select Files
              </label>
            </div>
          ) : (
            <div className="upload-form-container">
              {isUploading ? (
                <div className="upload-progress-wrapper" style={{ padding: '40px', textAlign: 'center', background: 'var(--yt-bg-card)', borderRadius: '12px', border: '1px solid var(--yt-border-color)' }}>
                  <h3 style={{ marginBottom: '16px', color: 'var(--yt-text-primary)' }}>Uploading Video...</h3>
                  <div className="progress-bar-container" style={{ width: '100%', height: '8px', background: 'var(--yt-bg-pill)', borderRadius: '4px', overflow: 'hidden', marginBottom: '12px' }}>
                    <div className="progress-bar-fill" style={{ width: `${progress}%`, height: '100%', background: 'var(--yt-brand-red)', transition: 'width 0.1s ease' }}></div>
                  </div>
                  <p style={{ color: 'var(--yt-text-secondary)', fontSize: '14px' }}>{progress}% Uploaded ({duration})</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '32px' }} className="upload-flex-container">
                  <div className="upload-preview-section">
                    <h3 style={{ marginBottom: '12px' }}>Preview</h3>
                    <div className="preview-image-wrapper" style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', background: '#000', aspectRatio: '16/9' }}>
                      <video src={videoPreview} controls className="preview-video" style={{ width: '100%', display: 'block' }} />
                    </div>
                    <p className="file-info" style={{ marginTop: '12px', color: 'var(--yt-text-secondary)', fontSize: '13px', wordBreak: 'break-all' }}>
                      File: {videoFile.name} ({(videoFile.size / (1024 * 1024)).toFixed(2)} MB)
                    </p>
                    
                    <button 
                      className="change-file-btn"
                      onClick={() => {
                        setVideoFile(null);
                        setVideoPreview(null);
                        setThumbnailFile(null);
                        setThumbnailPreview(null);
                      }}
                      style={{ marginTop: '16px', padding: '8px 16px', background: 'var(--yt-bg-pill)', border: 'none', color: 'var(--yt-text-primary)', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      Change Video
                    </button>
                  </div>

                  <div className="upload-details-section">
                    <h3 style={{ marginBottom: '16px' }}>Details</h3>
                    
                    <div className="form-group">
                      <label htmlFor="title">Title (required) *</label>
                      <input
                        type="text"
                        id="title"
                        name="title"
                        maxLength="100"
                        value={formData.title}
                        onChange={handleInputChange}
                        placeholder="Add a title that describes your video"
                        className="form-input"
                      />
                      <span className="char-count" style={{ position: 'absolute', right: '12px', bottom: '12px', color: 'var(--yt-text-secondary)', fontSize: '11px' }}>{formData.title.length}/100</span>
                    </div>

                    <div className="form-group">
                      <label htmlFor="description">Description</label>
                      <textarea
                        id="description"
                        name="description"
                        maxLength="5000"
                        value={formData.description}
                        onChange={handleInputChange}
                        placeholder="Tell viewers about your video"
                        className="form-textarea"
                        rows="4"
                      />
                      <span className="char-count" style={{ position: 'absolute', right: '12px', bottom: '12px', color: 'var(--yt-text-secondary)', fontSize: '11px' }}>{formData.description.length}/5000</span>
                    </div>

                    <div className="form-group">
                      <label style={{ display: 'block', marginBottom: '8px' }}>Thumbnail Image (Optional)</label>
                      <div className="thumbnail-upload-zone" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                        <div className="thumbnail-option selected" style={{ width: '120px', height: '68px', borderRadius: '6px', overflow: 'hidden', background: 'var(--yt-bg-card)', border: '1px solid var(--yt-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {thumbnailPreview ? (
                            <img src={thumbnailPreview} alt="Custom Thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <span style={{ fontSize: '11px', color: 'var(--yt-text-secondary)', textAlign: 'center', padding: '4px' }}>No Thumbnail Selected</span>
                          )}
                        </div>
                        <label className="file-select-btn" style={{ padding: '8px 16px', fontSize: '13px', background: 'var(--yt-bg-pill)', color: 'var(--yt-text-primary)', borderRadius: '4px', cursor: 'pointer', fontWeight: '500' }}>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleThumbnailInput}
                            style={{ display: 'none' }}
                          />
                          Select Thumbnail
                        </label>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div className="form-group">
                        <label htmlFor="category">Category</label>
                        <select
                          id="category"
                          name="category"
                          value={formData.category}
                          onChange={handleInputChange}
                          className="form-select"
                        >
                          <option value="Gaming">Gaming</option>
                          <option value="Music">Music</option>
                          <option value="Sports">Sports</option>
                          <option value="Education">Education</option>
                          <option value="Tech">Tech</option>
                          <option value="Entertainment">Entertainment</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label htmlFor="visibility">Visibility</label>
                        <select
                          id="visibility"
                          name="visibility"
                          value={formData.visibility}
                          onChange={handleInputChange}
                          className="form-select"
                        >
                          <option value="public">Public</option>
                          <option value="unlisted">Unlisted</option>
                          <option value="private">Private</option>
                        </select>
                      </div>
                    </div>

                    <div className="form-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                      <button className="btn-secondary" onClick={handleSaveDraft} style={{ padding: '10px 20px', background: 'var(--yt-bg-pill)', border: 'none', color: 'var(--yt-text-primary)', borderRadius: '4px', cursor: 'pointer', fontWeight: '600' }}>
                        Save Draft
                      </button>
                      <button className="btn-primary" onClick={handlePublish} style={{ padding: '10px 20px', background: 'var(--yt-brand-red)', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontWeight: '600' }}>
                        Publish Video
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Upload;

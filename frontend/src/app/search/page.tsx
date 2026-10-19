"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Navbar from '@/components/Navbar/Navbar';
import Sidebar from '@/components/Sidebar/Sidebar';
import VideoCard from '@/components/VideoCard/VideoCard';
import { apiClient } from '@/utils/api';
import { initialFeed } from '@/data/initialFeed';
import '@/pages/Search.css';

const SearchContent = () => {
  const searchParams = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const query = searchParams.get('q') || '';

  useEffect(() => {
    const fetchSearchResults = async () => {
      setLoading(true);
      try {
        const data = await apiClient.get(`/videos?search=${encodeURIComponent(query)}`);
        const list = Array.isArray(data) ? data : (data && Array.isArray(data.videos) ? data.videos : []);
        if (list.length > 0) {
          setSearchResults(list);
        } else {
          throw new Error('No backend results');
        }
      } catch (err) {
        console.warn('Backend search unavailable, searching initialFeed catalog:', err);
        const q = query.toLowerCase().trim();
        const matches = initialFeed.filter(v =>
          (v.title || '').toLowerCase().includes(q) ||
          (v.description || '').toLowerCase().includes(q) ||
          (v.category || '').toLowerCase().includes(q) ||
          (v.channel?.name || '').toLowerCase().includes(q)
        );
        setSearchResults(matches.length > 0 ? matches : initialFeed.slice(0, 10));
      } finally {
        setLoading(false);
      }
    };
    fetchSearchResults();
  }, [query]);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  return (
    <div className="search-page">
      <Navbar onMenuClick={toggleSidebar} />
      <Sidebar isOpen={sidebarOpen} />
      
      <main className={`search-content ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
        <div className="search-results-container">
          {query && (
            <h2 className="search-results-title">
              Search results for: "{query}"
            </h2>
          )}
          
          {searchResults.length > 0 ? (
            <div className="search-results-grid">
              {searchResults.map(video => (
                <VideoCard key={video.id} video={video} />
              ))}
            </div>
          ) : (
            <div className="no-results">
              <svg viewBox="0 0 24 24" width="96" height="96">
                <path fill="currentColor" d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
              <h3>No results found</h3>
              <p>Try different keywords or check your spelling</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

const Search = () => {
  return (
    <Suspense fallback={<div className="loading-container">Loading...</div>}>
      <SearchContent />
    </Suspense>
  );
};

export default Search;

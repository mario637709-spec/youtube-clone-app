"use client";
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getApiBaseUrl } from '@/config';
import axios from 'axios';
import './ShortsShelf.css';

interface ShortItem {
  id: string;
  title: string;
  thumbnail?: string;
  views?: number | string;
  uploaderName?: string;
}

const FALLBACK_SHORTS: ShortItem[] = [
  {
    id: 'short-1',
    title: 'Insane CSS Glassmorphism Trick! 🔥',
    thumbnail: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=400&auto=format&fit=crop&q=80',
    views: '4.8M views',
  },
  {
    id: 'short-2',
    title: 'iPhone 16 Pro Max Hidden Features 📱',
    thumbnail: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=400&auto=format&fit=crop&q=80',
    views: '2.1M views',
  },
  {
    id: 'short-3',
    title: 'Day in the Life of a Google Designer 💻',
    thumbnail: 'https://images.unsplash.com/photo-1531403009284-440f080d1e12?w=400&auto=format&fit=crop&q=80',
    views: '890K views',
  },
  {
    id: 'short-4',
    title: 'Coding a Cyberpunk UI with Next.js ⚡',
    thumbnail: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=400&auto=format&fit=crop&q=80',
    views: '1.4M views',
  },
  {
    id: 'short-5',
    title: 'Fastest Database Query in 2025 🚀',
    thumbnail: 'https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=400&auto=format&fit=crop&q=80',
    views: '650K views',
  },
];

export default function ShortsShelf() {
  const [shorts, setShorts] = useState<ShortItem[]>(FALLBACK_SHORTS);
  const router = useRouter();

  useEffect(() => {
    const fetchShorts = async () => {
      try {
        const API_BASE_URL = getApiBaseUrl();
        const res = await axios.get(`${API_BASE_URL}/videos/shorts`, { params: { page: 1, limit: 8 } });
        const raw = res.data;
        const list = Array.isArray(raw) ? raw : (raw?.videos || []);
        if (list.length > 0) {
          setShorts(
            list.map((item: any) => ({
              id: item.id || item.youtube_id,
              title: item.title,
              thumbnail: item.thumbnail || (item.thumbnails && item.thumbnails[0]?.url) || `https://i.ytimg.com/vi/${item.youtube_id || item.id}/hqdefault.jpg`,
              views: typeof item.views === 'number' ? `${(item.views / 1000).toFixed(0)}K views` : item.views || '120K views',
              uploaderName: item.uploaderName || item.channel?.name || 'Creator',
            }))
          );
        }
      } catch (e) {
        // Fallback already set
      }
    };
    fetchShorts();
  }, []);

  return (
    <section className="shorts-shelf-section">
      <div className="shorts-shelf-header">
        <div className="shorts-shelf-brand">
          <div className="shorts-badge-icon">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path
                fill="#ffffff"
                d="M17.77 10.32l-1.2-.5L18 9.06a3.74 3.74 0 0 0-3.5-6.62L6 6.94a3.74 3.74 0 0 0 .23 6.74l1.2.49L6 14.93a3.75 3.75 0 0 0 3.5 6.63l8.5-4.5a3.74 3.74 0 0 0-.23-6.74zm-9.55-2.66l8.5-4.5a1.75 1.75 0 0 1 1.01 3.33l-8.5 4.5a1.75 1.75 0 0 1-1.01-3.33zm9.32 8.68l-8.5 4.5a1.75 1.75 0 0 1-1.01-3.33l8.5-4.5a1.75 1.75 0 0 1 1.01 3.33z"
              />
            </svg>
          </div>
          <h3 className="shorts-shelf-title">Shorts</h3>
        </div>
        <Link href="/shorts" className="shorts-view-all">
          <span>View all</span>
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
          </svg>
        </Link>
      </div>

      <div className="shorts-carousel-track no-scrollbar">
        {shorts.map((item) => (
          <div
            key={item.id}
            className="short-card"
            onClick={() => router.push('/shorts')}
            role="button"
            tabIndex={0}
          >
            <div className="short-thumb-wrapper">
              <img
                src={item.thumbnail || 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=400&auto=format&fit=crop&q=80'}
                alt={item.title}
                className="short-thumb-img"
              />
              <div className="short-scrim" />
              <button
                className="short-overflow-btn"
                onClick={(e) => {
                  e.stopPropagation();
                }}
                aria-label="Short options"
              >
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <path
                    fill="currentColor"
                    d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"
                  />
                </svg>
              </button>
              <div className="short-meta-overlay">
                <p className="short-item-title">{item.title}</p>
                <span className="short-item-views">{item.views}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

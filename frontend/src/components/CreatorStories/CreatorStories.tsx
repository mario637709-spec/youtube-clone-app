"use client";
import React from 'react';
import './CreatorStories.css';

interface CreatorStory {
  id: string;
  name: string;
  avatar: string;
  hasUnseen: boolean;
  handle?: string;
}

const FEATURED_CREATORS: CreatorStory[] = [
  {
    id: 'mkbhd',
    name: 'MKBHD',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
    hasUnseen: true,
  },
  {
    id: 'verge',
    name: 'Verge',
    avatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&auto=format&fit=crop&q=80',
    hasUnseen: true,
  },
  {
    id: 'fireship',
    name: 'Fireship',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80',
    hasUnseen: true,
  },
  {
    id: 'mrbeast',
    name: 'MrBeast',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&auto=format&fit=crop&q=80',
    hasUnseen: true,
  },
  {
    id: 'codewithvishu',
    name: 'Vishu',
    avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120&auto=format&fit=crop&q=80',
    hasUnseen: true,
  },
  {
    id: 'lex',
    name: 'Lex',
    avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=120&auto=format&fit=crop&q=80',
    hasUnseen: false,
  },
  {
    id: 'studio-neat',
    name: 'Studio Neat',
    avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=120&auto=format&fit=crop&q=80',
    hasUnseen: false,
  },
];

interface CreatorStoriesProps {
  onSelectCreator?: (creatorName: string) => void;
  activeCreator?: string;
}

export default function CreatorStories({ onSelectCreator, activeCreator }: CreatorStoriesProps) {
  return (
    <section className="creator-stories-container no-scrollbar" aria-label="Subscribed creator channels">
      <div className="creator-stories-track">
        {FEATURED_CREATORS.map((c) => {
          const isActive = activeCreator === c.name;
          return (
            <button
              key={c.id}
              className={`creator-story-item ${isActive ? 'active-selected' : ''}`}
              onClick={() => onSelectCreator && onSelectCreator(c.name)}
              type="button"
            >
              <div className={`story-ring ${c.hasUnseen ? 'ring-glow' : 'ring-seen'}`}>
                <div className="story-avatar-wrap">
                  <img src={c.avatar} alt={c.name} className="story-avatar-img" />
                </div>
              </div>
              <span className="story-name">{c.name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

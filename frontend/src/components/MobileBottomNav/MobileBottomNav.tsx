"use client";
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import './MobileBottomNav.css';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  isCreate?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/shorts', label: 'Shorts', icon: 'play_arrow' },
  { href: '/upload', label: 'Create', icon: 'add', isCreate: true },
  { href: '/', label: 'Subscriptions', icon: 'subscriptions' },
  { href: '/profile', label: 'You', icon: 'account_circle' },
];

export default function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-nav" aria-label="Mobile Navigation Dock">
      <div className="mb-nav-inner">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);

          if (item.isCreate) {
            return (
              <Link
                key={item.label}
                href={item.href}
                className="mb-nav-create-btn"
                aria-label="Create content"
              >
                <div className="create-plus-circle">
                  <span className="material-symbols-outlined plus-icon">add</span>
                </div>
                <span className="mb-create-label">Create</span>
              </Link>
            );
          }

          return (
            <Link
              key={item.label}
              href={item.href}
              className={`mb-nav-tab ${isActive ? 'active' : ''}`}
            >
              <div className="mb-tab-icon-wrap">
                <span
                  className={`material-symbols-outlined mb-tab-icon ${
                    isActive ? 'fill-icon' : ''
                  }`}
                >
                  {item.icon}
                </span>
                {item.label === 'Shorts' && isActive && (
                  <span className="shorts-active-dot" />
                )}
              </div>
              <span className="mb-tab-label">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

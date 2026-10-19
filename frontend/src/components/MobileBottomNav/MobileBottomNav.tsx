"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import './MobileBottomNav.css';

const items = [
  { href: '/', label: 'Home', icon: 'M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3l9-8z' },
  { href: '/shorts', label: 'Shorts', icon: 'M17.77 10.32l-1.2-.5L18 9.06a3.74 3.74 0 0 0-3.5-6.62L6 6.94a3.74 3.74 0 0 0 .23 6.74l1.2.49L6 14.93a3.75 3.75 0 0 0 3.5 6.63l8.5-4.5a3.74 3.74 0 0 0-.23-6.74zm-9.55-2.66l8.5-4.5a1.75 1.75 0 0 1 1.01 3.33l-8.5 4.5a1.75 1.75 0 0 1-1.01-3.33zm9.32 8.68l-8.5 4.5a1.75 1.75 0 0 1-1.01-3.33l8.5-4.5a1.75 1.75 0 0 1 1.01 3.33z' },
  { href: '/upload', label: 'Create', icon: 'M12 5v14M5 12h14', special: true },
  { href: '/', label: 'Subscriptions', icon: 'M10 18h4v-2h-4v2zM3 6v2h18V6H3zm2 6h14v-2H5v2z' },
  { href: '/profile', label: 'You', icon: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' },
];

export default function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-nav">
      {items.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link key={item.label} href={item.href} className={`mb-nav-item${active ? ' active' : ''}`}>
            {item.special ? (
              <span className="mb-nav-create">
                <svg viewBox="0 0 24 24" width="22" height="22">
                  <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M12 5v14M5 12h14" />
                </svg>
              </span>
            ) : (
              <svg viewBox="0 0 24 24" width="24" height="24">
                <path fill="currentColor" d={item.icon} />
              </svg>
            )}
            <span className="mb-nav-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

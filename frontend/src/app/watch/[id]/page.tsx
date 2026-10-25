import { Suspense } from 'react';
import WatchClient from './WatchClient';
import { initialFeed } from '@/data/initialFeed';

export function generateStaticParams() {
  return initialFeed.map(v => ({ id: v.id }));
}

export default function WatchPage() {
  return (
    <Suspense fallback={<div className="watch-loading-skeleton" />}>
      <WatchClient />
    </Suspense>
  );
}

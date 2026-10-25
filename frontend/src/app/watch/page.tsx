import { Suspense } from 'react';
import WatchClient from './[id]/WatchClient';

export default function WatchPage() {
  return (
    <Suspense fallback={<div className="watch-loading-skeleton" />}>
      <WatchClient />
    </Suspense>
  );
}

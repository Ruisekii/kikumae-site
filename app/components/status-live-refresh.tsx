'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const REFRESH_INTERVAL_MS = 5_000;

const japanTime = (value: Date) => new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit',
}).format(value);

/** Keep the resident's status page current while staff work on the issue. */
export function StatusLiveRefresh() {
  const router = useRouter();
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      setLastCheckedAt(new Date());
      router.refresh();
    };
    refresh();
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router]);

  return <p className="status-live-note" role="status">このページは自動で更新されます。約5秒ごとに確認{lastCheckedAt ? `（最終確認 ${japanTime(lastCheckedAt)}）` : '中…'}</p>;
}

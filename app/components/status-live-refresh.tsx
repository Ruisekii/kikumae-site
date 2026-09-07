'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUserI18n } from '../user-i18n';

const REFRESH_INTERVAL_MS = 5_000;

/** Keep the resident's status page current while staff work on the issue. */
export function StatusLiveRefresh() {
  const { t, language } = useUserI18n();
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

  const locale = language === 'ja' ? 'ja-JP' : language === 'zh' ? 'zh-CN' : language === 'ko' ? 'ko-KR' : 'en-US';
  const time = lastCheckedAt ? new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(lastCheckedAt) : '';
  return <p className="status-live-note" role="status">{t('statusPage.live', { time })}</p>;
}

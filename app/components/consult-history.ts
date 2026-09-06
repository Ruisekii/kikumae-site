export type ConsultHistoryEntry = { id: number; checkUrl: string; title: string; savedAt: number };

const HISTORY_STORAGE_KEY = 'kikumae-consult-history';
const HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function loadConsultHistory(): ConsultHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const fresh = (parsed as ConsultHistoryEntry[]).filter((entry) => {
      if (!entry || typeof entry.id !== 'number' || typeof entry.checkUrl !== 'string' || typeof entry.title !== 'string' || typeof entry.savedAt !== 'number' || Date.now() - entry.savedAt > HISTORY_MAX_AGE_MS) return false;
      try {
        const url = new URL(entry.checkUrl, window.location.origin);
        return url.origin === window.location.origin && /^\/questions\/[0-9a-f-]{32,80}$/i.test(url.pathname);
      } catch {
        return false;
      }
    });
    if (fresh.length !== parsed.length) window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  } catch {
    return [];
  }
}

export function appendConsultHistory(entry: ConsultHistoryEntry) {
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify([entry, ...loadConsultHistory()].slice(0, 30)));
  } catch {
    /* 共用端末やプライベートモードでは保存しない */
  }
}

export function clearConsultHistory() {
  try {
    window.localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    /* 保存されていない場合は何もしない */
  }
}

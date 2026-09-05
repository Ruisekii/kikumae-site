'use client';

import { FormEvent, useEffect, useState } from 'react';
import type { Faq } from '../../db/repository';
// 避難所版のカテゴリ定義（db/local-ai.ts）をそのまま使う。旧「きくまえ」版のカテゴリと混在させない。
import { SHELTER_CATEGORIES } from '../../db/local-ai';

const categories = SHELTER_CATEGORIES;
type Props = { apiBase: string; title?: string };
type FormState = { question: string; answer: string; category: string };
const emptyForm: FormState = { question: '', answer: '', category: 'その他' };

export function FaqManagement({ apiBase, title = 'FAQ管理' }: Props) {
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [message, setMessage] = useState('FAQを読み込んでいます…');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchFaqs() {
      try {
        const response = await fetch(apiBase, { cache: 'no-store' });
        const body = await response.json() as { faqs?: Faq[]; message?: string };
        if (cancelled) return;
        if (!response.ok) { setMessage(body.message ?? 'FAQを読み込めませんでした。'); return; }
        setFaqs(body.faqs ?? []); setMessage('');
      } catch {
        if (!cancelled) setMessage('FAQの取得に失敗しました。');
      }
    }
    void fetchFaqs();
    return () => { cancelled = true; };
  }, [apiBase]);

  function edit(faq: Faq) {
    setEditingId(faq.id); setForm({ question: faq.question, answer: faq.answer, category: faq.category }); setMessage('');
  }

  function cancelEdit() { setEditingId(null); setForm(emptyForm); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(editingId ? 'FAQを更新しています…' : 'FAQを追加しています…');
    try {
      const response = await fetch(editingId ? `${apiBase}/${editingId}` : apiBase, { method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const body = await response.json() as { faq?: Faq; message?: string };
      if (!response.ok || !body.faq) { setMessage(body.message ?? 'FAQを保存できませんでした。'); return; }
      setFaqs((current) => editingId ? current.map((faq) => faq.id === body.faq!.id ? body.faq! : faq) : [body.faq!, ...current]);
      cancelEdit(); setMessage(editingId ? 'FAQを更新しました。' : 'FAQを追加しました。');
    } catch { setMessage('FAQの保存に失敗しました。'); }
    finally { setBusy(false); }
  }

  async function remove(faq: Faq) {
    if (!window.confirm(`「${faq.question}」をFAQから削除しますか？\nこの操作は元に戻せません。`)) return;
    setBusy(true); setMessage('FAQを削除しています…');
    try {
      const response = await fetch(`${apiBase}/${faq.id}`, { method: 'DELETE' });
      const body = await response.json() as { message?: string };
      if (!response.ok) { setMessage(body.message ?? 'FAQを削除できませんでした。'); return; }
      setFaqs((current) => current.filter((item) => item.id !== faq.id));
      if (editingId === faq.id) cancelEdit();
      setMessage('FAQを削除しました。');
    } catch { setMessage('FAQの削除に失敗しました。'); }
    finally { setBusy(false); }
  }

  return <section className="faq-management" id="faq-management" aria-labelledby="faq-management-title">
    <div className="section-heading"><div><p className="eyebrow">管理者用</p><h2 id="faq-management-title">{title}</h2></div><span className="input-hint">公開FAQ {faqs.length}件</span></div>
    <form className="faq-editor" onSubmit={submit}>
      <h3>{editingId ? 'FAQを編集' : 'FAQを追加'}</h3>
      <label htmlFor="faq-edit-question">質問<input id="faq-edit-question" value={form.question} onChange={(event) => setForm({ ...form, question: event.target.value })} maxLength={300} required placeholder="例：見学は予約なしでもできますか？" /></label>
      <label htmlFor="faq-edit-answer">回答<textarea id="faq-edit-answer" value={form.answer} onChange={(event) => setForm({ ...form, answer: event.target.value })} maxLength={2000} required placeholder="確認済みの案内を入力してください。" /></label>
      <label htmlFor="faq-edit-category">カテゴリ<select id="faq-edit-category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
      <div className="form-actions"><button className="button accent" type="submit" disabled={busy}>{busy ? '保存中…' : editingId ? 'FAQを更新' : 'FAQを追加'}</button>{editingId && <button className="button secondary" type="button" onClick={cancelEdit} disabled={busy}>キャンセル</button>}</div>
    </form>
    {message && <p className="form-status" role="status">{message}</p>}
    <div className="faq-admin-list">{faqs.map((faq) => <article className="faq-admin-row" key={faq.id}><div><span className="tag">{faq.category}</span><h3>{faq.question}</h3><p>{faq.answer}</p><time dateTime={new Date(faq.updatedAt).toISOString()}>作成：{new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium' }).format(new Date(faq.createdAt))}　更新：{new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium' }).format(new Date(faq.updatedAt))}</time></div><div className="form-actions"><button className="button secondary" type="button" onClick={() => edit(faq)} disabled={busy}>編集</button><button className="button danger" type="button" onClick={() => void remove(faq)} disabled={busy}>削除</button></div></article>)}{!faqs.length && !message.includes('読み込んで') && <p className="empty">まだFAQがありません。よく聞かれる質問を追加すると、次の人が聞く前に解決できます。</p>}</div>
  </section>;
}

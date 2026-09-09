'use client';

import Link from 'next/link';
import { UserHeader, useUserI18n } from '../user-i18n';

export function UserNotFound() {
  const { t } = useUserI18n();
  return <main className="evac-theme public-page"><UserHeader brand={`◌ ${t('shelter.name')}`} brandHref="/" faqHref="/#reception-faq" statusHref="/questions" /><section className="status-card"><h1>{t('common.notFoundTitle')}</h1><p>{t('statusPage.missingLead')}</p><Link className="button primary" href="/">{t('common.backHome')}</Link></section></main>;
}

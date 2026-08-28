import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'きくまえ | 聞きにくいを、聞きやすく。',
  description: 'AIがFAQ検索・質問整理・回答案作成を支援し、人の承認でFAQが育つ匿名質問サービスです。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

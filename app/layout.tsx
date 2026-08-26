import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'きくまえ | 聞きにくいを、聞きやすく。',
  description: '個人情報を収集せず、質問を短期間だけ保存するプライバシー重視の質問窓口です。',
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

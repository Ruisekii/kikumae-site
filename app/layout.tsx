import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '避難所の相談窓口 | 声が届き、対応が見える',
  description: '避難者の声を受け止め、職員が事実を確認し、対応状況を返す避難所向け相談サービスです。',
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

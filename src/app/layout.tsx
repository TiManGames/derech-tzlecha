import type { Metadata, Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#ffffff',
};

export const metadata: Metadata = {
  title: 'דרך צלחה - מסלול הליכה בטוח',
  description: 'מצא את המסלול הבטוח ביותר עם מקלטים ציבוריים',
  keywords: ['מקלטים', 'תל אביב', 'ירושלים', 'מסלול בטוח', 'הליכה', 'מיגון'],
  authors: [{ name: 'דרך צלחה' }],
  manifest: '/derech-tzlecha/manifest.json',
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link
          href="https://unpkg.com/maplibre-gl@4.1.2/dist/maplibre-gl.css"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
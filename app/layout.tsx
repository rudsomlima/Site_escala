import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Escala de Acompanhamento',
  description: 'Organização da escala semanal de acompanhamento hospitalar',
  appleWebApp: {
    title: 'Escala',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#4f46e5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-slate-100 text-slate-800 min-h-screen">{children}</body>
    </html>
  );
}

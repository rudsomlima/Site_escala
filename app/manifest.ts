import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Escala de Acompanhamento',
    short_name: 'Escala',
    description: 'Organização da escala semanal de acompanhamento hospitalar',
    start_url: '/',
    display: 'standalone',
    background_color: '#f1f5f9',
    theme_color: '#4f46e5',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}

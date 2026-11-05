import type { Metadata } from 'next';
import 'katex/dist/katex.min.css';
import './globals.css';
import { ThemeProvider } from '@/features/theme/theme-provider';
import { themeScript } from '@/features/theme/theme-script';
import { Toaster } from '@/components/ui/sonner';
export const metadata: Metadata = {
  title: 'Aula · Un espacio para aprender',
  description: 'Tus asignaturas, clases y laboratorios, en un solo lugar.',
  icons: {
    icon: [
      {
        url: '/favicon-light.svg',
        type: 'image/svg+xml',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/favicon-dark.svg',
        type: 'image/svg+xml',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: [
      {
        url: '/apple-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  },
  manifest: '/manifest.webmanifest',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}

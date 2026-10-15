import './globals.css';

export const metadata = {
  title: 'Blank PFP Studio',
  description: 'Monte sua foto de perfil sem foto, do seu jeito.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=JetBrains+Mono:wght@600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

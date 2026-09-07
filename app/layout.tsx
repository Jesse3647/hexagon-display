import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Honeycomb Workshop',
  icons: { icon: '/favicon.svg' },
  description:
    'Build your own modular display. Customize pods and export printable models locally.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

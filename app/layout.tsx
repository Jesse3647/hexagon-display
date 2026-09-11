import type { Metadata } from 'next';
import './globals.css';
/** Browser tab title, icon and description shared by all editor pages. */
export const metadata: Metadata = {
  title: 'Honeycomb Workshop',
  icons: {
    icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/favicon.svg`,
  },
  description:
    'Build your own modular display. Customize pods and export printable models locally.',
};
/** Minimal document shell; children are route content and geometry remains client-side. */
export default function RootLayout({
  children,
}: {
  /** Active route content rendered within the shared document shell. */
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

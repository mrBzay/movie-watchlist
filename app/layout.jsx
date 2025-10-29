import './globals.css';

export const metadata = {
  title: 'Movie Watchlist',
  description: 'Track movies to watch next with scores and notes.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-white">{children}</body>
    </html>
  );
}

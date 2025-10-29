import { NextResponse } from 'next/server';
import {
  createWatchlistEntry,
  getDefaultUser,
  listWatchlist,
} from '@/lib/db';

export async function GET() {
  try {
    const user = await getDefaultUser();
    const movies = await listWatchlist(user.id);
    return NextResponse.json({ movies });
  } catch (error) {
    console.error('GET /api/watchlist failed', error);
    return NextResponse.json(
      { error: 'Failed to load watchlist' },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const user = await getDefaultUser();
    const payload = await request.json();
    const movie = await createWatchlistEntry(user.id, payload ?? {});
    return NextResponse.json({ movie }, { status: 201 });
  } catch (error) {
    const status = error?.status ?? 500;
    const message =
      status === 400
        ? error.message || 'Invalid payload'
        : 'Failed to save movie';
    console.error('POST /api/watchlist failed', error);
    return NextResponse.json({ error: message }, { status });
  }
}

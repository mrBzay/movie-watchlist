import { NextResponse } from 'next/server';
import {
  deleteWatchlistEntry,
  getDefaultUser,
  updateWatchlistEntry,
} from '@/lib/db';

export async function PATCH(request, { params }) {
  try {
    const user = await getDefaultUser();
    const payload = await request.json();
    const movie = await updateWatchlistEntry(user.id, params.id, payload ?? {});
    return NextResponse.json({ movie });
  } catch (error) {
    const status = error?.status ?? 500;
    const message =
      status === 404 || status === 400
        ? error.message || 'Invalid payload'
        : 'Failed to update movie';
    console.error(`PATCH /api/watchlist/${params.id} failed`, error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request, { params }) {
  try {
    const user = await getDefaultUser();
    await deleteWatchlistEntry(user.id, params.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const status = error?.status ?? 500;
    const message = status === 404 ? 'Movie not found' : 'Failed to delete movie';
    console.error(`DELETE /api/watchlist/${params.id} failed`, error);
    return NextResponse.json({ error: message }, { status });
  }
}

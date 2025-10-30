import { NextResponse } from 'next/server';

import { logoutUser } from '@/lib/auth';

export async function POST() {
  try {
    await logoutUser();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('POST /api/auth/logout failed', error);
    return NextResponse.json({ error: 'Unable to sign out' }, { status: 500 });
  }
}

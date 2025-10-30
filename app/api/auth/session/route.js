import { NextResponse } from 'next/server';

import { getCurrentSession } from '@/lib/auth';

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session?.user) {
      return NextResponse.json({ user: null }, { status: 200 });
    }

    return NextResponse.json({
      user: {
        id: session.user.id,
        email: session.user.email,
        role: session.user.role,
        omdbKey: session.user.omdbKey ?? '',
      },
    });
  } catch (error) {
    console.error('GET /api/auth/session failed', error);
    return NextResponse.json({ error: 'Unable to load session' }, { status: 500 });
  }
}

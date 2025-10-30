import { NextResponse } from 'next/server';

import { requireAdminUser } from '@/lib/auth';
import { listUsers } from '@/lib/db';

export async function GET() {
  try {
    await requireAdminUser();
    const users = await listUsers();

    return NextResponse.json({
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt ? user.createdAt.toISOString() : null,
        updatedAt: user.updatedAt ? user.updatedAt.toISOString() : null,
      })),
    });
  } catch (error) {
    const status = error?.status ?? 500;
    const message =
      status === 401
        ? 'Authentication required'
        : status === 403
          ? 'Admin role required'
          : 'Unable to load users';
    console.error('GET /api/users failed', error);
    return NextResponse.json({ error: message }, { status });
  }
}

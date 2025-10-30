import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdminUser } from '@/lib/auth';
import { updateUserRole } from '@/lib/db';

const schema = z.object({
  role: z.enum(['user', 'admin'], {
    errorMap: () => ({ message: 'Role must be either "user" or "admin"' }),
  }),
});

export async function PATCH(request, { params }) {
  try {
    await requireAdminUser();
    const body = await request.json();
    const { role } = schema.parse(body ?? {});

    const updated = await updateUserRole(params.id, role);

    return NextResponse.json({
      user: {
        id: updated.id,
        email: updated.email,
        role: updated.role,
        updatedAt: updated.updatedAt ? updated.updatedAt.toISOString() : null,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = error.errors[0]?.message ?? 'Invalid role value';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const status = error?.status ?? 500;
    const message =
      status === 401
        ? 'Authentication required'
        : status === 403
          ? 'Admin role required'
          : status === 404
            ? 'User not found'
            : 'Unable to update user';

    console.error(`PATCH /api/users/${params?.id} failed`, error);
    return NextResponse.json({ error: message }, { status });
  }
}

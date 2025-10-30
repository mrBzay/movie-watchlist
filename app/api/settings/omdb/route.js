import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireCurrentUser, setUserOmdbKey } from '@/lib/auth';

const schema = z.object({
  omdbKey: z
    .string()
    .trim()
    .max(64, 'OMDb key should be 64 characters or fewer')
    .optional(),
});

export async function GET() {
  try {
    const user = await requireCurrentUser();
    return NextResponse.json({ omdbKey: user.omdbKey ?? '' });
  } catch (error) {
    const status = error?.status ?? 500;
    const message = status === 401 ? 'Authentication required' : 'Unable to load OMDb key';
    console.error('GET /api/settings/omdb failed', error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(request) {
  try {
    const user = await requireCurrentUser();
    const body = (await request.json()) ?? {};
    const { omdbKey = '' } = schema.parse(body);

    const updated = await setUserOmdbKey(user.id, omdbKey);

    return NextResponse.json({ omdbKey: updated.omdbKey ?? '' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = error.errors[0]?.message ?? 'Invalid OMDb key';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const status = error?.status ?? 500;
    const message =
      status === 401
        ? 'Authentication required'
        : status === 404
          ? 'User not found'
          : 'Unable to save OMDb key';

    console.error('PUT /api/settings/omdb failed', error);
    return NextResponse.json({ error: message }, { status });
  }
}

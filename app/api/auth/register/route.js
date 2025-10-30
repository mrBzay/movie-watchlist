import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createUser, findUserByEmail, setUserPassword } from '@/lib/db';
import { createUserSession, hashPassword } from '@/lib/auth';

const schema = z.object({
  email: z.string().email('Please provide a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
});

function toClientUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    omdbKey: user.omdbKey ?? '',
  };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, password } = schema.parse(body);

    const existing = await findUserByEmail(email);
    if (existing?.passwordHash) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Please sign in.' },
        { status: 409 },
      );
    }

    const passwordHash = await hashPassword(password);
    const user = existing
      ? await setUserPassword(existing.id, passwordHash)
      : await createUser({ email, passwordHash, role: 'user' });

    await createUserSession(user.id);

    const status = existing ? 200 : 201;
    return NextResponse.json({ user: toClientUser(user) }, { status });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = error.errors[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const status = error?.status ?? 500;
    const message =
      status === 400 || status === 409
        ? error.message || 'Unable to create account'
        : 'Unable to create account';

    console.error('POST /api/auth/register failed', error);
    return NextResponse.json({ error: message }, { status });
  }
}

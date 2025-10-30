import { NextResponse } from 'next/server';
import { z } from 'zod';

import { loginWithCredentials } from '@/lib/auth';

const schema = z.object({
  email: z.string().email('Please provide a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, password } = schema.parse(body);

    const user = await loginWithCredentials(email, password);

    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = error.errors[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const status = error?.status ?? 500;
    const message =
      status === 401
        ? error.message || 'Invalid email or password'
        : 'Unable to sign in';

    console.error('POST /api/auth/login failed', error);
    return NextResponse.json({ error: message }, { status });
  }
}

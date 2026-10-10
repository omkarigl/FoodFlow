import { NextResponse } from 'next/server';

export const badRequest = (message: string) =>
  NextResponse.json({ error: message }, { status: 400 });

export const unauthorized = () =>
  NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

export const forbidden = () =>
  NextResponse.json({ error: 'Forbidden' }, { status: 403 });

export const serverError = (message = 'Server error') =>
  NextResponse.json({ error: message }, { status: 500 });

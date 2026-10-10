'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useSessionToken } from '@/lib/auth-client';

export default function SignupPage() {
  const { supabase } = useSessionToken();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;

    const { error } = await supabase.auth.signUp({ email, password });
    setMessage(error ? error.message : 'Signup complete. Verify email if required, then login.');
  }

  return (
    <section className="rounded-xl border border-[var(--sand-400)] bg-white p-5">
      <h1 className="text-xl font-semibold">Student Signup</h1>
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <input className="w-full rounded border p-2" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="w-full rounded border p-2" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className="rounded bg-[var(--terracotta-600)] px-4 py-2 text-white" disabled={!supabase}>Create account</button>
      </form>
      <p className="mt-3 text-sm">{message}</p>
      <Link href="/login" className="mt-2 inline-block text-sm text-[var(--terracotta-600)] underline">Already have an account?</Link>
    </section>
  );
}

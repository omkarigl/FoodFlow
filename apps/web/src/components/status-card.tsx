import { ReactNode } from 'react';

export function StatusCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--sand-400)] bg-white p-5 shadow-sm" role="status" aria-live="polite">
      <h2 className="mb-2 text-lg font-semibold text-[var(--chocolate-700)]">{title}</h2>
      <div className="text-sm text-[var(--cocoa-600)]">{children}</div>
    </section>
  );
}

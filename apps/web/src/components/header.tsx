'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'Menu' },
  { href: '/checkout', label: 'Checkout' },
  { href: '/orders/track', label: 'Track Order' },
  { href: '/login', label: 'Login' },
  { href: '/signup', label: 'Signup' },
  { href: '/account', label: 'Account' },
  { href: '/admin', label: 'Admin' },
];

export function Header() {
  const pathname = usePathname();
  return (
    <header className="border-b border-[var(--sand-400)] bg-[var(--ivory-50)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-3" aria-label="FoodFlow home">
          <Image src="/ssgmce-logo.svg" alt="SSGMCE logo" width={44} height={44} priority />
          <div>
            <p className="text-lg font-bold text-[var(--chocolate-700)]">FoodFlow</p>
            <p className="text-xs text-[var(--cocoa-600)]">SSGMCE Canteen Ordering</p>
          </div>
        </Link>
        <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-2">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-2 text-sm ${
                  active
                    ? 'bg-[var(--terracotta-600)] text-white'
                    : 'text-[var(--chocolate-700)] hover:bg-[var(--sand-200)]'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

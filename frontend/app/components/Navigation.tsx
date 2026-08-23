"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/* Filled blue pills were the most dated thing in the old header. A ledger
   marks its current column with a rule, not a lozenge. */

const ITEMS = [
  ["/dashboard", "Overview"],
  ["/dashboard/customers", "Members"],
  ["/dashboard/funnel", "Journeys"],
  ["/dashboard/alerts", "Risk"],
  ["/dashboard/unresolved", "Review queue"],
  ["/dashboard/repeat-contacts", "Repeat contact"],
] as const;

export function Navigation() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 flex-wrap justify-end" aria-label="Primary">
      {ITEMS.map(([href, label]) => {
        const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="relative px-2.5 py-2 t-label font-medium transition-colors"
            style={{ color: active ? "var(--ink)" : "var(--ink-2)" }}
          >
            {label}
            <span
              aria-hidden
              className="absolute left-2.5 right-2.5 -bottom-px h-[2px] transition-opacity"
              style={{ background: "var(--blue)", opacity: active ? 1 : 0 }}
            />
          </Link>
        );
      })}
    </nav>
  );
}

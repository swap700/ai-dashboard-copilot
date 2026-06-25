"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Dashboard" },
  { href: "/outcomes", label: "Outcomes" },
  { href: "/faq", label: "FAQ" },
];

export default function NavTabs() {
  const pathname = usePathname();

  return (
    <div className="flex gap-0 border-b-2 border-border mb-8">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-5 py-2.5 text-sm font-medium -mb-0.5 border-b-2 transition-colors ${
              active
                ? "text-accent border-accent font-semibold"
                : "text-text-dim border-transparent hover:text-accent hover:bg-accent-bg-soft"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

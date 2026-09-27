"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Tooltip from "@/components/Tooltip";

// BUG FIX (2026-09): a first-time visitor has no way to know what "Memory"
// or "Inbox" mean before clicking in -- these are Nixara-specific concepts
// (a decision log and a due-date queue), not generic nav labels a new user
// already has a mental model for. Each tab now carries a one-line
// explanation, shown on hover/focus, worded to match the subtitle already
// shown at the top of that tab's own page (see app/memory/page.tsx,
// app/inbox/page.tsx, app/outcomes/page.tsx) so the tooltip and the page you
// land on never say two different things about what it is.
const TABS = [
  { href: "/", label: "Dashboard", description: "Upload a CSV or Excel file, generate a role-calibrated report, and see anomaly and data-quality signals." },
  { href: "/memory", label: "Memory", description: "Every decision from this browser, in one place: what was recommended, who owns it, and whether it worked." },
  { href: "/inbox", label: "Inbox", description: "Every approved decision that hasn't had its outcome logged yet, soonest due first." },
  { href: "/outcomes", label: "Outcomes", description: "Log what actually happened after a decision, so Nixara can show whether its analysis was accurate." },
  { href: "/faq", label: "FAQ", description: "Common questions about how Nixara works, your data, and security." },
];

export default function NavTabs() {
  const pathname = usePathname();

  return (
    <div className="flex gap-0 border-b-2 border-border mb-8">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Tooltip key={tab.href} content={tab.description}>
            <Link
              href={tab.href}
              className={`px-5 py-2.5 text-sm font-medium -mb-0.5 border-b-2 transition-colors ${
                active
                  ? "text-accent border-accent font-semibold"
                  : "text-text-dim border-transparent hover:text-accent hover:bg-accent-bg-soft"
              }`}
            >
              {tab.label}
            </Link>
          </Tooltip>
        );
      })}
    </div>
  );
}

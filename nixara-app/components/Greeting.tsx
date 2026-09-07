"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getVisitorId } from "@/lib/visitor";
import { checkinAndGetGreeting, buildGreeting, timeOfDay, type Greeting as GreetingValue } from "@/lib/greeting";

const FALLBACK_SALUTATION: Record<string, string> = {
  morning: "Good morning.",
  afternoon: "Good afternoon.",
  evening: "Good evening.",
  "late-night": "Still here?",
};

/**
 * Sits above BIConnector on the Dashboard tab, so it renders before any
 * dataset is uploaded -- deliberately: the whole point is that Nixara says
 * something true about open decisions before the user has done anything
 * this visit, not after.
 *
 * Fetches on mount, independent of the upload flow -- see lib/greeting.ts's
 * checkinAndGetGreeting. This is a client-rendered fetch, not a zero-flash
 * server-rendered one: the persistent visitor identity this needs lives in
 * localStorage (see lib/visitor.ts), which only exists once the page is
 * already running in the browser, so there's a brief moment before the
 * real, data-driven line is known. That moment shows a plain time-of-day
 * salutation -- true on its own, never a placeholder number -- rather than
 * a blank space or a guess.
 */
export default function Greeting() {
  const [greeting, setGreeting] = useState<GreetingValue | null>(null);

  useEffect(() => {
    let cancelled = false;
    const visitorId = getVisitorId();
    checkinAndGetGreeting(visitorId).then((ctx) => {
      if (cancelled) return;
      setGreeting(buildGreeting(new Date(), ctx));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!greeting) {
    const tod = timeOfDay(new Date());
    return (
      <div className="bg-surface border border-border rounded-xl px-5 py-4 mb-6">
        <p className="text-text text-[1.05rem] font-medium">{FALLBACK_SALUTATION[tod]}</p>
      </div>
    );
  }

  const cardClass = greeting.highlight
    ? "bg-accent-bg-soft border border-accent-border rounded-xl px-5 py-4 mb-6"
    : "bg-surface border border-border rounded-xl px-5 py-4 mb-6";
  const triggerClass = greeting.highlight
    ? "text-accent text-[0.68rem] font-bold uppercase tracking-wider mb-1.5"
    : "text-text-dim text-[0.68rem] font-bold uppercase tracking-wider mb-1.5";

  const body = (
    <div className={cardClass}>
      <p className={triggerClass}>{greeting.trigger}</p>
      <p className="text-text text-[1.1rem] font-medium leading-snug">
        {greeting.segments.map((seg, i) =>
          seg.bold ? (
            <b key={i} className="text-accent-dk font-semibold">
              {seg.text}
            </b>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </p>
    </div>
  );

  if (!greeting.href) return body;

  return (
    <Link href={greeting.href} className="block hover:opacity-90 transition-opacity">
      {body}
    </Link>
  );
}

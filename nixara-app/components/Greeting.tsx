"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getVisitorId } from "@/lib/visitor";
import { checkinAndGetGreeting, buildGreeting, timeOfDay, type Greeting as GreetingValue } from "@/lib/greeting";

const FALLBACK_HEADLINE: Record<string, string> = {
  morning: "Good morning.",
  afternoon: "Good afternoon.",
  evening: "Good evening.",
  "late-night": "Still here?",
};

/** Eight-point sparkle -- same spot every render, no library, just a path. */
function SparkleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.35em"
      height="1.35em"
      fill="currentColor"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M 12.0 2.0 L 13.22 9.04 L 19.07 4.93 L 14.96 10.78 L 22.0 12.0 L 14.96 13.22 L 19.07 19.07 L 13.22 14.96 L 12.0 22.0 L 10.78 14.96 L 4.93 19.07 L 9.04 13.22 L 2.0 12.0 L 9.04 10.78 L 4.93 4.93 L 10.78 9.04 Z" />
    </svg>
  );
}

/**
 * Sits above BIConnector on the Dashboard tab, so it renders before any
 * dataset is uploaded -- deliberately: the whole point is that Nixara says
 * something true about open decisions before the user has done anything
 * this visit, not after.
 *
 * Styled as a hero line -- icon + large headline, small detail line under it
 * -- rather than a bordered notification card, so it reads as a platform
 * greeting (think: the line an assistant opens a session with) and not as
 * an alert. Deliberately carries no name: there's no login yet, so nothing
 * here should imply a personal identity that isn't real yet.
 *
 * Fetches on mount, independent of the upload flow -- see lib/greeting.ts's
 * checkinAndGetGreeting. This is a client-rendered fetch, not a zero-flash
 * server-rendered one: the persistent visitor identity this needs lives in
 * localStorage (see lib/visitor.ts), which only exists once the page is
 * already running in the browser, so there's a brief moment before the
 * real, data-driven line is known. That moment shows the plain time-of-day
 * headline alone -- true on its own, never a placeholder number -- rather
 * than a blank space or a guess.
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
      <div className="flex items-center gap-3 py-6 mb-6">
        <span className="text-accent">
          <SparkleIcon />
        </span>
        <h1 className="font-serif text-text text-[1.65rem] sm:text-[1.9rem] tracking-tight">
          {FALLBACK_HEADLINE[tod]}
        </h1>
      </div>
    );
  }

  const headlineClass = greeting.highlight
    ? "font-serif text-accent-dk text-[1.65rem] sm:text-[1.9rem] tracking-tight"
    : "font-serif text-text text-[1.65rem] sm:text-[1.9rem] tracking-tight";

  const body = (
    <div className="py-6 mb-6">
      <div className="flex items-center gap-3">
        <span className="text-accent">
          <SparkleIcon />
        </span>
        <h1 className={headlineClass}>{greeting.headline}</h1>
      </div>
      <p className="text-text-mute text-[0.98rem] sm:text-[1.02rem] leading-relaxed mt-1.5 pl-[calc(1.35em+0.75rem)]">
        {greeting.detail.map((seg, i) =>
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
    <Link href={greeting.href} className="block hover:opacity-80 transition-opacity">
      {body}
    </Link>
  );
}

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

/**
 * Classic trishul silhouette -- straight center shaft, a crossbar, two
 * outer prongs curving outward. Chosen over a generic sparkle/letterform
 * after review; drawn as an open stroke (no fill, no background badge) so
 * it sits directly on the page the same way the rest of this hero line does.
 */
function TrishulIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.35em"
      height="1.35em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M12 2 L12 21" />
      <path d="M7 9 L17 9" />
      <path d="M9 9 Q5 8 6 3" />
      <path d="M15 9 Q19 8 18 3" />
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
 * The detail line ends in a small arrow whenever the greeting is a link
 * (href set) -- so the click target is visible at rest, not only revealed
 * by hovering over an otherwise plain-looking sentence.
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
          <TrishulIcon />
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
          <TrishulIcon />
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
        {greeting.href && <span className="text-accent font-semibold ml-1">→</span>}
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

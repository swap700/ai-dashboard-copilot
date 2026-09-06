/**
 * Decision Inbox — scoped down from "Nixara proactively chases open items"
 * (no cron/background jobs exist in this architecture — same constraint
 * documented in lib/drift.ts) to: a plain queue, computed client-side from
 * the session's own decision history, of approved decisions that don't have
 * an outcome logged yet. Sorted soonest-due-first; overdue ones are flagged
 * against today's date at render/compute time, not by any stored status.
 */

import type { DecisionWithOutcome } from "./decisions";

export interface InboxItem extends DecisionWithOutcome {
  /** Whole days until due; negative means overdue. Null if no due date set. */
  daysUntilDue: number | null;
  overdue: boolean;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Filters a session's decisions down to the inbox: approved, and not yet
 * outcome-scored (an outcome-scored decision is done — Memory/Outcomes
 * already cover it). Sorts soonest due date first; items with no due date
 * sort after every dated item, most-recently-decided first among themselves.
 */
export function buildInbox(decisions: DecisionWithOutcome[]): InboxItem[] {
  const today = startOfToday();

  const items: InboxItem[] = decisions
    .filter((d) => d.decision === "approved" && !d.outcome)
    .map((d) => {
      let daysUntilDue: number | null = null;
      if (d.dueDate) {
        const due = new Date(d.dueDate + "T00:00:00");
        daysUntilDue = Math.round((due.getTime() - today.getTime()) / 86_400_000);
      }
      return { ...d, daysUntilDue, overdue: daysUntilDue !== null && daysUntilDue < 0 };
    });

  return items.sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

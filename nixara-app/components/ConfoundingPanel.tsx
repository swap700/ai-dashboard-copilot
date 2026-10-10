"use client";

/**
 * What Nixara held steady, and the one thing it needs the user to tell it.
 *
 * Two faults, one panel.
 *
 * FIRST: the adjustment was invisible. Nixara holds at most eight columns
 * steady at once, chosen from however many the file offers, and that choice IS
 * the analysis - the first question any actuary or clinician asks about an
 * adjusted number is "what did you adjust for?". An adjusted gap of 13,991
 * means one thing if age and BMI were held steady and much less if they were
 * quietly left out. The prompt summary has always said which, but that text
 * goes to the model and never reaches the screen.
 *
 * SECOND: Nixara cannot tell a cause from a consequence. Smoking makes people
 * sicker, sicker people see the doctor more, more visits cost more. Doctor
 * visits are a step on smoking's own path to cost, not a rival explanation for
 * it, so holding them steady throws away part of the effect being measured.
 * From the data's side, age-causes-smoking and smoking-causes-visits look
 * identical. Only someone who knows the domain can separate them, so this is
 * the one place the product asks.
 *
 * Marking a column here drops it from every controlled comparison and the
 * figures recompute. Nothing is marked by default: Nixara suggests candidates
 * (the columns a grouping all but determines) and leaves the call to the user.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import type { Dataset } from "@/lib/data-analysis";
import { collectConfounding, humanizeColumnName } from "@/lib/data-analysis";
import { mediatorShift, type ConfoundingResult } from "@/lib/confounding";
import { formatNumber } from "@/lib/format";
import Tooltip from "@/components/Tooltip";

interface Props {
  dataset: Dataset;
  /** What the user typed, so the panel adjusts the same comparison the report will. */
  decisionText: string;
  /** Columns the user has marked as consequences. */
  consequenceColumns: string[];
  onToggleConsequence: (column: string) => void;
}

function Chip({
  label,
  tone,
}: {
  label: string;
  tone: "held" | "checked" | "excluded";
}) {
  const className =
    tone === "held"
      ? "bg-accent-bg-soft text-accent-text-dk border-accent-border"
      : tone === "excluded"
        ? "bg-warn-bg text-warn border-warn-border"
        : "bg-surface text-text-mute border-border";
  return (
    <span
      className={`inline-block text-[0.7rem] font-medium px-2 py-0.5 rounded-full border mr-1.5 mb-1.5 ${className}`}
    >
      {label}
    </span>
  );
}

function Comparison({
  result,
  consequenceColumns,
  onToggleConsequence,
}: {
  result: ConfoundingResult;
  consequenceColumns: string[];
  onToggleConsequence: (column: string) => void;
}) {
  const shift = mediatorShift(result);
  const held = [...result.confounders, ...result.categoricalConfounders];
  const marked = new Set(consequenceColumns);

  return (
    <div className="py-4 border-b border-border last:border-b-0">
      <p className="text-text text-[0.95rem] font-semibold mb-1">
        {humanizeColumnName(result.group)}: {result.highGroup} against {result.lowGroup}
      </p>

      {/* The range, not the point estimate. A single number implies a precision
          the row count does not support, and the verdict rests on whether the
          range excludes zero. */}
      <p className="text-text text-[0.85rem] leading-relaxed mb-1">
        {humanizeColumnName(result.metric)} differs by{" "}
        <b>{formatNumber(result.adjustedGap)}</b> after adjustment, somewhere between{" "}
        {formatNumber(result.adjustedGapLow)} and {formatNumber(result.adjustedGapHigh)}{" "}
        <span className="text-text-mute">
          (95% range, {result.rows.toLocaleString()} rows)
        </span>
        .
      </p>
      {!result.distinguishableFromZero && (
        <p className="text-warn text-[0.82rem] leading-relaxed mb-1">
          That range includes zero, so this difference cannot be told apart from no
          difference. It should not be used to size a saving.
        </p>
      )}
      <p className="text-text-mute text-[0.8rem] leading-relaxed mb-2">
        Before adjustment it was {formatNumber(result.rawGap)}.
      </p>

      <p className="text-text-mute text-[0.7rem] font-bold uppercase tracking-wider mb-1.5">
        Held steady
        <Tooltip content="The columns Nixara controlled for. A difference that survives these is not explained by them.">
          <span className="ml-1 cursor-help text-text-dim" aria-hidden>
            ⓘ
          </span>
        </Tooltip>
      </p>
      <div>
        {held.length === 0 ? (
          <span className="text-text-mute text-[0.8rem]">Nothing.</span>
        ) : (
          held.map((c) => <Chip key={c} label={humanizeColumnName(c)} tone="held" />)
        )}
      </div>

      {result.checkedOnly.length > 0 && (
        <>
          <p className="text-text-mute text-[0.7rem] font-bold uppercase tracking-wider mb-1.5 mt-2">
            Checked, not adjusted for
            <Tooltip content="Nixara compared the groups on these and they could not carry the difference. The adjustment is capped at eight columns so it stays stable.">
              <span className="ml-1 cursor-help text-text-dim" aria-hidden>
                ⓘ
              </span>
            </Tooltip>
          </p>
          <div>
            {result.checkedOnly.map((c) => (
              <Chip key={c} label={humanizeColumnName(c)} tone="checked" />
            ))}
          </div>
        </>
      )}

      {result.excludedByUser.length > 0 && (
        <>
          <p className="text-text-mute text-[0.7rem] font-bold uppercase tracking-wider mb-1.5 mt-2">
            You marked as consequences
          </p>
          <div>
            {result.excludedByUser.map((c) => (
              <Chip key={c} label={humanizeColumnName(c)} tone="excluded" />
            ))}
          </div>
        </>
      )}

      {/* Only shown where the two fits actually disagree. On one real file the
          with-and-without figures were 1% apart, and a caveat for that is
          noise dressed as rigour. */}
      {shift && (
        <div className="mt-3 rounded-lg border border-warn-border bg-warn-bg px-3 py-2.5">
          <p className="text-warn text-[0.8rem] font-semibold mb-1">
            Is any of this caused by {humanizeColumnName(result.group)} itself?
          </p>
          <p className="text-text-mute text-[0.8rem] leading-relaxed mb-2">
            {humanizeColumnName(result.group)} all but decides the columns below. If they are
            steps on its own path to {humanizeColumnName(result.metric)} rather than separate
            explanations, holding them steady removes part of the effect. The answer is between{" "}
            {formatNumber(shift.low)} and {formatNumber(shift.high)} depending on the call.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {result.mediatorCandidates.map((c) => (
              <label key={c} className="flex items-center gap-1.5 text-[0.8rem] text-text cursor-pointer">
                <input
                  type="checkbox"
                  checked={marked.has(c)}
                  onChange={() => onToggleConsequence(c)}
                  className="accent-warn"
                />
                {humanizeColumnName(c)} is a consequence
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConfoundingPanel({
  dataset,
  decisionText,
  consequenceColumns,
  onToggleConsequence,
}: Props) {
  // Least squares over up to three groupings is real work, so it is not
  // recomputed on every keystroke elsewhere on the page. decisionText is
  // already debounced by the caller, as it is for Charts.
  const results = useMemo(
    () => collectConfounding(dataset, decisionText, consequenceColumns),
    [dataset, decisionText, consequenceColumns]
  );
  if (results.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="bg-surface border border-border rounded-xl px-5 py-4 mb-8"
      aria-label="Controlled comparison"
    >
      <p className="text-text-mute text-[0.72rem] font-bold uppercase tracking-wider mb-1">
        What survives when the rest is held steady
      </p>
      <p className="text-text-mute text-[0.8rem] leading-relaxed mb-2">
        A group difference can be the thing named or something travelling with it. These figures
        hold the other columns still and show what is left.
      </p>
      <div>
        {results.map((r) => (
          <Comparison
            key={`${r.group}-${r.metric}`}
            result={r}
            consequenceColumns={consequenceColumns}
            onToggleConsequence={onToggleConsequence}
          />
        ))}
      </div>
      <p className="text-text-mute text-[0.78rem] leading-relaxed mt-3 mb-0">
        Adjustment removes only the columns named above. This file records what happened, not
        what caused it, so a difference that survives may still come from something the file
        does not contain. None of these figures establish that one thing causes another.
      </p>
    </motion.section>
  );
}

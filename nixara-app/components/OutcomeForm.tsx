"use client";

import { useMemo, useState } from "react";
import type { OutcomeRating } from "@/lib/decisions";
import type { RecordedOutcome } from "@/lib/session-context";
import { businessMetricColumns, categoricalColumns, numericStats, smartAgg, type Dataset } from "@/lib/data-analysis";

const UNITS = ["$", "%", "units", "leads", "customers", "€", "£", "other"];
const RATINGS: { value: OutcomeRating; label: string }[] = [
  { value: "exceeded", label: "✅ Exceeded expectations" },
  { value: "met", label: "🎯 Met expectations" },
  { value: "missed", label: "⚠️ Fell short" },
];

/** Sentinel values for the dataset-aware selects below -- kept out of the
 *  space of real column/value names so they can never collide with one. */
const NO_SLICE = "__whole_dataset__";
const CUSTOM_METRIC = "__custom_metric__";

interface Props {
  onSubmit: (outcome: RecordedOutcome & { notes?: string }) => Promise<void>;
  /**
   * The dataset currently loaded in this session, when there is one.
   *
   * When present, this form stops being pure free-text entry: the metric
   * comes from the dataset's real business-metric columns, an optional
   * "slice by" dimension (Category, Region, ...) can narrow it to a single
   * value, and "Value AFTER" auto-computes from the live data instead of
   * defaulting to blank. That closes the original Decision Drift bug --
   * an outcome logged with an empty "Value AFTER" gave detectDrift()
   * (lib/drift.ts) nothing to compare against, so drift silently never
   * fired regardless of how much the metric actually moved.
   *
   * Omitted on flows where the dataset that produced the decision may not
   * be the one currently loaded (the cross-session "find a decision by ID"
   * lookup on the Outcomes page, and Decision Inbox, which lists decisions
   * from any past session/day) -- those fall back to the original free-text
   * behavior rather than risk slicing against the wrong dataset.
   */
  dataset?: Dataset;
}

export default function OutcomeForm({ onSubmit, dataset }: Props) {
  const metricColumns = useMemo(() => (dataset ? businessMetricColumns(dataset) : []), [dataset]);

  // Only columns with a manageable number of distinct values make a sensible
  // "slice by" picker -- same cardinality cap selectChartColumns() uses for
  // the same reason (data-analysis.ts).
  const dimensionColumns = useMemo(() => {
    if (!dataset) return [];
    return categoricalColumns(dataset).filter((col) => {
      const distinct = new Set(dataset.rows.map((r) => r[col])).size;
      return distinct >= 2 && distinct <= 25;
    });
  }, [dataset]);

  const usingDataset = Boolean(dataset) && metricColumns.length > 0;

  const [selectedMetric, setSelectedMetric] = useState<string>(usingDataset ? metricColumns[0] : CUSTOM_METRIC);
  const [customMetric, setCustomMetric] = useState("");
  const [dimension, setDimension] = useState(NO_SLICE);
  const [dimensionValue, setDimensionValue] = useState("");
  const [manualAfter, setManualAfter] = useState<string | null>(null);
  const [before, setBefore] = useState("");
  const [unit, setUnit] = useState(UNITS[0]);
  const [rating, setRating] = useState<OutcomeRating>("met");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Derived, not stored: if `dataset`/`metricColumns` were not yet available
  // at mount (usingDataset was false, so selectedMetric defaulted to
  // CUSTOM_METRIC) and later become available, prefer a real column over the
  // stale custom-text fallback -- computed at render time instead of synced
  // via an effect.
  const effectiveSelectedMetric =
    usingDataset && selectedMetric === CUSTOM_METRIC && !customMetric ? metricColumns[0] : selectedMetric;
  const effectiveMetricName = usingDataset && effectiveSelectedMetric !== CUSTOM_METRIC ? effectiveSelectedMetric : customMetric;

  const dimensionValues = useMemo(() => {
    if (!dataset || dimension === NO_SLICE) return [];
    return Array.from(new Set(dataset.rows.map((r) => String(r[dimension] ?? "")).filter(Boolean))).sort();
  }, [dataset, dimension]);

  // Live-computed current value for the chosen metric/slice -- this is the
  // actual fix for the missing-baseline bug: previously "Value AFTER" simply
  // defaulted to blank and nothing stopped submitting it that way. Purely
  // derived (useMemo, not an effect + setState) so it never fights with a
  // manual edit; `manualAfter` (set only once the person types in the field)
  // wins once present, and resets to null (falls back to the computed value)
  // whenever the metric/slice selection changes.
  const computedAfter = useMemo(() => {
    if (!dataset || !effectiveMetricName) return null;
    if (dimension !== NO_SLICE && !dimensionValue) return null;
    const rows =
      dimension === NO_SLICE ? dataset.rows : dataset.rows.filter((r) => String(r[dimension] ?? "") === dimensionValue);
    const values = rows.map((r) => r[effectiveMetricName]).filter((v): v is number => typeof v === "number");
    if (values.length === 0) return null;
    const stats = numericStats(values);
    const agg = smartAgg(effectiveMetricName, values);
    const computed = agg === "sum" ? stats.total : stats.mean;
    return String(Number(computed.toFixed(4)));
  }, [dataset, effectiveMetricName, dimension, dimensionValue]);

  const after = manualAfter ?? computedAfter ?? "";
  const canSubmit = effectiveMetricName.trim() !== "" && after !== "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    await onSubmit({
      metricName: effectiveMetricName,
      metricBefore: before ? Number(before) : null,
      metricAfter: Number(after),
      metricUnit: unit,
      outcomeRating: rating,
      notes,
      metricDimension: dimension === NO_SLICE ? null : dimension,
      metricDimensionValue: dimension === NO_SLICE ? null : dimensionValue || null,
    });
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 mt-3">
      <div>
        <label className="block text-xs font-medium text-text-mute mb-1">Metric tracked</label>
        {usingDataset ? (
          <>
            <select
              value={effectiveSelectedMetric}
              onChange={(e) => {
                setSelectedMetric(e.target.value);
                setManualAfter(null);
              }}
              className="w-full rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text"
            >
              {metricColumns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value={CUSTOM_METRIC}>Other / not in this dataset…</option>
            </select>
            {effectiveSelectedMetric === CUSTOM_METRIC && (
              <input
                type="text"
                value={customMetric}
                onChange={(e) => setCustomMetric(e.target.value)}
                placeholder="e.g. Monthly Revenue"
                required
                className="w-full rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text mt-2"
              />
            )}
          </>
        ) : (
          <input
            type="text"
            value={customMetric}
            onChange={(e) => setCustomMetric(e.target.value)}
            placeholder="e.g. Monthly Revenue"
            required
            className="w-full rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text"
          />
        )}
      </div>

      {usingDataset && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-text-mute mb-1">
              Slice by <span className="opacity-60">(optional)</span>
            </label>
            <select
              value={dimension}
              onChange={(e) => {
                setDimension(e.target.value);
                setDimensionValue("");
                setManualAfter(null);
              }}
              className="w-full rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text"
            >
              <option value={NO_SLICE}>Whole dataset</option>
              {dimensionColumns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {dimension !== NO_SLICE && (
            <div>
              <label className="block text-xs font-medium text-text-mute mb-1">Value</label>
              <select
                value={dimensionValue}
                onChange={(e) => {
                  setDimensionValue(e.target.value);
                  setManualAfter(null);
                }}
                className="w-full rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text"
              >
                <option value="">Select…</option>
                {dimensionValues.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-mute mb-1">Value BEFORE</label>
          <input
            type="number"
            step="0.01"
            value={before}
            onChange={(e) => setBefore(e.target.value)}
            className="w-full rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-mute mb-1">Unit</label>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="w-full rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text"
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-mute mb-1">Value AFTER</label>
          <input
            type="number"
            step="0.01"
            value={after}
            onChange={(e) => setManualAfter(e.target.value)}
            required
            className="w-full rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text"
          />
        </div>
      </div>
      {usingDataset && (
        <p className="text-text-dim text-xs -mt-2">
          Value AFTER is auto-filled from the current dataset{dimension !== NO_SLICE ? " and slice" : ""} — override it if needed.
          Decision Drift compares this exact value{dimension !== NO_SLICE ? " and slice" : ""} against future uploads.
        </p>
      )}

      <div>
        <label className="block text-xs font-medium text-text-mute mb-1">Outcome rating</label>
        <div className="flex gap-4">
          {RATINGS.map((r) => (
            <label key={r.value} className="flex items-center gap-1.5 text-sm text-text">
              <input
                type="radio"
                name="rating"
                checked={rating === r.value}
                onChange={() => setRating(r.value)}
              />
              {r.label}
            </label>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-text-mute mb-1">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text"
        />
      </div>
      <button
        type="submit"
        disabled={!canSubmit || submitting}
        className="bg-accent text-white font-semibold text-sm rounded-lg px-4 py-2 hover:bg-accent-dk disabled:opacity-40 transition-colors"
      >
        {submitting ? "Saving…" : "Log Outcome"}
      </button>
    </form>
  );
}

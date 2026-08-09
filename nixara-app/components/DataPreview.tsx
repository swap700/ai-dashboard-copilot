"use client";

import type { Dataset } from "@/lib/data-analysis";
import { formatCell } from "@/lib/format";

export default function DataPreview({ dataset }: { dataset: Dataset }) {
  const preview = dataset.rows.slice(0, 10);

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.05)] mb-8">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-accent-bg-soft">
              {dataset.columns.map((col) => (
                <th key={col} className="text-left px-3 py-2 font-semibold text-text-mute whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, i) => (
              <tr key={i} className="border-t border-border">
                {dataset.columns.map((col) => (
                  <td key={col} className="px-3 py-1.5 text-text whitespace-nowrap">
                    {formatCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useRef, useState } from "react";
import { loadFile } from "@/lib/file-parser";
import type { Dataset } from "@/lib/data-analysis";

interface Props {
  onLoaded: (dataset: Dataset, fileName: string) => void;
}

export default function FileUploader({ onLoaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setLoading(true);
      try {
        const dataset = await loadFile(file);
        onLoaded(dataset, file.name);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to parse file.");
      } finally {
        setLoading(false);
      }
    },
    [onLoaded]
  );

  return (
    <div className="mb-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        className={`rounded-xl border-[1.5px] border-dashed cursor-pointer transition-colors px-6 py-10 text-center ${
          dragging ? "border-accent bg-accent-bg-soft" : "border-accent-lt bg-accent-bg-soft"
        }`}
      >
        <p className="text-accent-lt font-semibold text-sm">
          {loading ? "Parsing…" : "Drop a CSV or Excel file here, or click to browse"}
        </p>
        <p className="text-text-dim text-xs mt-1">.csv, .xlsx, .xls</p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>
      {error && (
        <p className="text-danger text-xs mt-2 text-center" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

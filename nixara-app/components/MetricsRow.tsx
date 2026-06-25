"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface Metric {
  label: string;
  value: number;
}

function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const duration = 900;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(eased * value));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{display.toLocaleString()}</>;
}

export default function MetricsRow({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      {metrics.map((m, i) => (
        <motion.div
          key={m.label}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: i * 0.05, ease: "easeOut" }}
          whileHover={{ y: -3 }}
          className="bg-surface border border-border border-t-[3px] border-t-accent rounded-xl px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
        >
          <p className="text-text-dim text-[0.72rem] uppercase tracking-[0.08em] font-semibold mb-1">
            {m.label}
          </p>
          <p className="text-text text-[1.75rem] font-semibold tracking-tight">
            <CountUp value={m.value} />
          </p>
        </motion.div>
      ))}
    </div>
  );
}

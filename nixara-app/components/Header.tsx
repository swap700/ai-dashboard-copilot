"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

function useTypewriter(text: string, speed = 70) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i++;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return shown;
}

export default function Header() {
  const title = useTypewriter("Nixara");

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: "easeOut" }}
      className="border-b-[1.5px] border-border pb-5 mb-8"
    >
      <a
        href="https://nixara-landing.vercel.app"
        aria-label="Back to the Nixara landing page"
        className="inline-block no-underline hover:opacity-80 transition-opacity"
      >
        <p className="font-sans text-[clamp(2.5rem,6vw,4.5rem)] font-black text-text m-0 leading-[1.1] tracking-tight">
          {title}
          <span className="inline-block w-[2px] h-[0.8em] bg-accent ml-1 animate-pulse align-middle" />
        </p>
      </a>
      <p className="text-sm text-text-dim uppercase tracking-[0.08em] font-medium mt-1 mb-2">
        nik·sa·ra /nɪkˈsɑːrə/ ·{" "}
        <em className="italic normal-case tracking-normal text-[0.95em]">
          from <strong className="text-accent">nix</strong> (clarity, light) +{" "}
          <strong className="text-accent">ara</strong> (direction) — illuminating the path forward in your data
        </em>
      </p>
      <div className="w-9 h-[3px] rounded bg-gradient-to-r from-accent to-accent-lt my-2" />
      <p className="text-text-mute text-base mt-1">
        Upload CSV / Excel &nbsp;·&nbsp; Connect Tableau or Power BI &nbsp;·&nbsp; Get executive-grade AI reports
      </p>
    </motion.div>
  );
}

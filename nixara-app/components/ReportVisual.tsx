"use client";

import type { VisualSection, Severity, ActionItem } from "@/lib/report-visual";

/* ── Shared: inline number/currency emphasis in running prose ── */
function Prose({ text }: { text: string }) {
  const parts = text.split(/(\$[\d,]+\.\d{2}|\d+(?:\.\d+)?%)/g);
  return (
    <p className="text-text text-[0.95rem] leading-7">
      {parts.map((p, i) =>
        /^\$[\d,]+\.\d{2}$|^\d+(?:\.\d+)?%$/.test(p) ? (
          <b key={i} className="text-accent-dk font-semibold">{p}</b>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </p>
  );
}

function Card({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5 md:p-6 mb-3">
      <p className="text-accent text-[0.68rem] font-bold uppercase tracking-wider mb-3">{heading}</p>
      {children}
    </div>
  );
}

/* ── Recommended Actions: verb-colored cards ── */
const VERB_STYLE: Record<NonNullable<ActionItem["verb"]>, { bg: string; border: string; text: string; icon: string }> = {
  Restrict: { bg: "bg-danger-bg", border: "border-danger-border", text: "text-danger", icon: "\u{1F6AB}" },
  Approve: { bg: "bg-success-bg", border: "border-success-border", text: "text-success", icon: "\u2705" },
  Mandate: { bg: "bg-warn-bg", border: "border-warn-border", text: "text-warn", icon: "\u{1F4CB}" },
  Decide: { bg: "bg-accent-bg-soft", border: "border-accent-border", text: "text-accent-text-dk", icon: "\u26A1" },
};

function ActionsSection({ heading, items }: Extract<VisualSection, { kind: "actions" }>) {
  return (
    <Card heading={heading}>
      <div className="grid sm:grid-cols-3 gap-3">
        {items.map((item, i) => {
          const style = item.verb ? VERB_STYLE[item.verb] : { bg: "bg-bg", border: "border-border", text: "text-text-mute", icon: "\u2022" };
          return (
            <div key={i} className={`rounded-lg border p-3.5 ${style.bg} ${style.border}`}>
              <div className="text-base mb-1">{style.icon}</div>
              {item.verb && <div className={`text-[0.68rem] font-bold uppercase tracking-wide mb-1 ${style.text}`}>{item.verb}</div>}
              <div className="text-[0.85rem] leading-snug text-text">{item.body}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RiskWaitSection({ heading, items }: Extract<VisualSection, { kind: "riskWait" }>) {
  return (
    <Card heading={`\u26A0 ${heading}`}>
      <div className="grid sm:grid-cols-2 gap-3">
        {items.map((item, i) => (
          <div key={i} className="bg-danger-bg border border-danger-border rounded-lg p-3.5 text-[0.85rem] leading-snug flex gap-2">
            <span>\u26A0</span><span>{item.text}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function EfficiencyGapsSection({ heading, lines }: Extract<VisualSection, { kind: "efficiencyGaps" }>) {
  return (
    <Card heading={heading}>
      {lines.map((l, i) => (
        <p key={i} className="text-text text-[0.95rem] leading-7 mb-2 last:mb-0">
          {l.inferred && (
            <span className="inline-block text-[0.62rem] font-bold uppercase tracking-wide text-text-mute border border-dashed border-text-dim rounded px-1.5 py-0.5 mr-2 align-middle">
              Inferred
            </span>
          )}
          {l.text}
        </p>
      ))}
    </Card>
  );
}

function ProcessRecSection({ heading, items }: Extract<VisualSection, { kind: "processRec" }>) {
  const lanes = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.timeframe ?? "Other";
    if (!lanes.has(key)) lanes.set(key, []);
    lanes.get(key)!.push(item);
  }
  return (
    <Card heading={heading}>
      <div className="flex flex-col sm:flex-row gap-5">
        {Array.from(lanes.entries()).map(([timeframe, laneItems]) => (
          <div key={timeframe} className="flex-1">
            <div className="text-[0.7rem] font-bold uppercase tracking-wide text-text-mute mb-2 flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${timeframe === "This week" ? "bg-accent" : "bg-text-dim"}`} />
              {timeframe}
            </div>
            {laneItems.map((item, i) => (
              <div key={i} className="bg-bg border border-border rounded-lg p-3 mb-2 text-[0.85rem] leading-snug">
                {item.role && (
                  <div className="inline-flex items-center gap-1 bg-accent-bg-soft text-accent-text-dk border border-accent-border rounded-full px-2.5 py-0.5 text-[0.72rem] font-semibold mb-1.5">
                    {"\u{1F464}"} {item.role}
                  </div>
                )}
                <div>{item.body}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

function QuickWinsSection({ heading, items }: Extract<VisualSection, { kind: "quickWins" }>) {
  return (
    <Card heading={heading}>
      <div className="grid sm:grid-cols-2 gap-3">
        {items.map((item, i) => (
          <div key={i} className="bg-success-bg border border-success-border rounded-lg p-3.5">
            {item.stat && <div className="text-2xl font-extrabold text-success mb-1">{item.stat}</div>}
            <div className="text-[0.83rem] leading-snug text-text">{item.body}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── Risk matrix: 3x3 severity-gradient grid with the specific risk's cell marked ── */
const RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };
const ROWS: Severity[] = ["high", "medium", "low"];
const COLS: Severity[] = ["low", "medium", "high"];
const TIER_CLASS = { g: "bg-success", a: "bg-warn", r: "bg-danger" };

function RiskMatrix({ likelihood, impact }: { likelihood: Severity; impact: Severity }) {
  const cells: { tier: keyof typeof TIER_CLASS; here: boolean }[] = [];
  for (const r of ROWS) {
    for (const c of COLS) {
      const sum = RANK[r] + RANK[c];
      const tier = sum <= 3 ? "g" : sum === 4 ? "a" : "r";
      cells.push({ tier, here: r === likelihood && c === impact });
    }
  }
  return (
    <div className="grid grid-cols-3 grid-rows-3 gap-0.5 w-[46px] h-[46px] shrink-0">
      {cells.map((cell, i) => (
        <div
          key={i}
          className={`rounded-sm ${TIER_CLASS[cell.tier]} ${cell.here ? "opacity-100 outline outline-2 outline-text outline-offset-1" : "opacity-30"}`}
        />
      ))}
    </div>
  );
}

const SEVERITY_LABEL: Record<Severity, string> = { low: "Low", medium: "Medium", high: "High" };
const SEVERITY_TEXT_CLASS: Record<Severity, string> = { low: "text-success", medium: "text-warn", high: "text-danger" };

function TopRisksSection({ heading, risks }: Extract<VisualSection, { kind: "topRisks" }>) {
  return (
    <Card heading={heading}>
      {risks.map((risk, i) => (
        <div key={i} className={`flex gap-4 py-4 ${i < risks.length - 1 ? "border-b border-border" : ""}`}>
          <div className="w-6 h-6 rounded-full bg-text text-surface flex items-center justify-center text-[0.72rem] font-bold shrink-0 mt-0.5">
            {i + 1}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <div className="font-bold text-text">{risk.name}</div>
              {risk.type && (
                <span
                  className={`text-[0.62rem] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                    risk.type === "Strategic Risk"
                      ? "bg-accent-bg-soft text-accent-text-dk border-accent-border"
                      : "bg-warn-bg text-warn border-warn-border"
                  }`}
                >
                  {risk.type === "Strategic Risk" ? "Strategic" : "Operational"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 mb-2">
              <RiskMatrix likelihood={risk.likelihood} impact={risk.impact} />
              <div className="text-[0.8rem] text-text-mute">
                Likelihood <b className={SEVERITY_TEXT_CLASS[risk.likelihood]}>{SEVERITY_LABEL[risk.likelihood]}</b>
                {"  \u00B7  "}
                Impact <b className={SEVERITY_TEXT_CLASS[risk.impact]}>{SEVERITY_LABEL[risk.impact]}</b>
              </div>
            </div>
            {risk.signal && <div className="text-[0.85rem] leading-snug mb-1"><span className="text-text-mute">Signal:</span> <b className="text-text">{risk.signal}</b></div>}
            {risk.consequence && <div className="text-[0.85rem] leading-snug"><span className="text-text-mute">Consequence:</span> <b className="text-text">{risk.consequence}</b></div>}
          </div>
        </div>
      ))}
    </Card>
  );
}

function EarlyWarningSection({ heading, items }: Extract<VisualSection, { kind: "earlyWarning" }>) {
  return (
    <Card heading={heading}>
      <div className="flex flex-wrap gap-2.5">
        {items.map((text, i) => (
          <div key={i} className="flex-1 min-w-[200px] bg-warn-bg border border-warn-border rounded-lg px-3.5 py-2.5 text-[0.8rem] flex items-center gap-2">
            <span className="text-warn">{"\u{1F4C8}"}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function MitigationSection({ heading, items }: Extract<VisualSection, { kind: "mitigation" }>) {
  return (
    <Card heading={heading}>
      {items.map((item, i) => (
        <div key={i} className={`flex items-center gap-3 py-2.5 text-[0.85rem] ${i < items.length - 1 ? "border-b border-border" : ""}`}>
          {item.role && (
            <span className="inline-flex items-center gap-1 bg-accent-bg-soft text-accent-text-dk border border-accent-border rounded-full px-2.5 py-0.5 text-[0.72rem] font-semibold shrink-0">
              {"\u{1F464}"} {item.role}
            </span>
          )}
          <span className="flex-1">{item.action}</span>
          {item.timeframe && <b className="text-accent-dk shrink-0">{"Start within " + item.timeframe}</b>}
        </div>
      ))}
    </Card>
  );
}

function DataQualitySection({ heading, text, score }: Extract<VisualSection, { kind: "dataQuality" }>) {
  return (
    <Card heading={heading}>
      <div className="flex items-center gap-4 bg-success-bg border border-success-border rounded-lg px-4 py-3.5">
        {score !== null && (
          <div
            className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center"
            style={{ background: `conic-gradient(var(--success) ${score}%, var(--border) ${score}% 100%)` }}
          >
            <div className="w-9 h-9 rounded-full bg-success-bg flex items-center justify-center text-[0.65rem] font-extrabold text-success">
              {score}
            </div>
          </div>
        )}
        <div className="text-[0.85rem] leading-snug text-text">{text}</div>
      </div>
    </Card>
  );
}

function ProseSection({ heading, lines }: Extract<VisualSection, { kind: "prose" }>) {
  return (
    <Card heading={heading}>
      {lines.map((line, i) => <Prose key={i} text={line} />)}
    </Card>
  );
}

export default function ReportVisualBody({ sections }: { sections: VisualSection[] }) {
  return (
    <div>
      {sections.map((s, i) => {
        switch (s.kind) {
          case "actions": return <ActionsSection key={i} {...s} />;
          case "riskWait": return <RiskWaitSection key={i} {...s} />;
          case "efficiencyGaps": return <EfficiencyGapsSection key={i} {...s} />;
          case "processRec": return <ProcessRecSection key={i} {...s} />;
          case "quickWins": return <QuickWinsSection key={i} {...s} />;
          case "topRisks": return <TopRisksSection key={i} {...s} />;
          case "earlyWarning": return <EarlyWarningSection key={i} {...s} />;
          case "mitigation": return <MitigationSection key={i} {...s} />;
          case "dataQuality": return <DataQualitySection key={i} {...s} />;
          default: return <ProseSection key={i} {...s} />;
        }
      })}
    </div>
  );
}

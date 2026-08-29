"use client";

import { useState } from "react";

function Expander({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-lg mb-2 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-4 py-3 text-sm font-medium text-text bg-surface hover:bg-accent-bg-soft transition-colors flex items-center justify-between"
      >
        {title}
        <span className="text-text-dim">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-4 py-3 text-sm text-text-mute leading-relaxed bg-surface border-t border-border space-y-2">
          {children}
        </div>
      )}
    </div>
  );
}

function Category({ title }: { title: string }) {
  return (
    <p className="text-base font-semibold text-text mt-9 mb-2 border-l-[3px] border-accent pl-3 -tracking-[0.01em]">
      {title}
    </p>
  );
}

const TRUST_PILLARS = [
  { label: "Data Privacy", text: "Your data is processed in-session only. Nothing is stored, logged, or retained after you close the browser." },
  { label: "Your API Key", text: "Reports run through your own OpenAI account. You control access, usage, and spend — not us." },
  { label: "No Account Required", text: "No sign-up, no login, no tracking. Open the app and start working immediately." },
  { label: "Speed", text: "Three executive-grade reports — Executive, Operational, and Risk — generated in under 30 seconds." },
];

export default function Faq() {
  return (
    <div>
      <div className="border-b-[1.5px] border-border pb-6 mb-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent mb-2">Help &amp; Documentation</p>
        <p className="text-2xl font-semibold text-text mb-1 -tracking-[0.02em]">Frequently Asked Questions</p>
        <p className="text-sm text-text-mute">
          Everything you need to know about how Nixara works, how your data is handled, and how to get the most from it.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-7">
        {TRUST_PILLARS.map((p) => (
          <div key={p.label} className="bg-surface border border-border border-t-[3px] border-t-accent rounded-[10px] px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-accent mb-1">{p.label}</p>
            <p className="text-[0.85rem] text-[#334155] leading-snug">{p.text}</p>
          </div>
        ))}
      </div>

      <Category title="Getting Started" />
      <Expander title="What is Nixara?">
        <p><strong>Nixara is a built-in AI analyst for your business data</strong> — no prompting skills required.</p>
        <p>Upload any CSV or Excel file, or connect your live Tableau / Power BI dashboard, and get three decision-ready reports in under 30 seconds:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Executive Summary</strong> — Strategic narrative written for the boardroom: situation, implications, recommended actions</li>
          <li><strong>Operational Detail</strong> — Efficiency gaps, process recommendations, and quick wins for team managers</li>
          <li><strong>Risk Report</strong> — Early warning signs, data quality flags, and mitigation actions</li>
        </ul>
        <p>Each report is generated for your specific role, decision context, and time horizon — then delivered as a formatted Word or PDF document you can share immediately.</p>
      </Expander>
      <Expander title="What data formats are supported?">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>CSV</strong> (.csv) — any standard comma-separated file</li>
          <li><strong>Excel</strong> (.xlsx, .xls) — single-sheet workbooks work best</li>
          <li><strong>Tableau Server</strong> — connect via your Tableau credentials and pull live view data</li>
          <li><strong>Power BI</strong> — connect via Azure AD credentials and pull dataset exports</li>
        </ul>
        <p>Your data must be <strong>tabular</strong> (rows and columns) with at least one numeric column. It works best with structured business data: sales figures, operational KPIs, HR metrics, financial reports, healthcare outcomes.</p>
        <p className="italic">Tip: If your Excel file has merged cells or multi-row headers, flatten it to a simple table first.</p>
      </Expander>
      <Expander title="How do I get an OpenAI API key?">
        <ol className="list-decimal pl-5 space-y-1">
          <li>Go to <strong>platform.openai.com</strong> and sign in (or create a free account)</li>
          <li>Click your profile → <strong>API Keys</strong> → <strong>Create new secret key</strong></li>
          <li>Copy the key (starts with <code>sk-proj-...</code>) and paste it into the sidebar</li>
        </ol>
        <p><strong>Cost:</strong> A typical three-report run uses approximately 2,000–5,000 tokens. At current GPT-4o pricing, that&apos;s roughly <strong>$0.01–$0.05 per run</strong> — less than a cup of coffee per week for daily use. You can monitor usage at platform.openai.com/usage at any time.</p>
      </Expander>

      <Category title="Privacy & Security" />
      <Expander title="Is my data safe? Where does it go?">
        <p>Your data is handled with the following guarantees:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Processed in memory only</strong> — data lives in your active session and is discarded when you close the tab</li>
          <li><strong>Never stored or logged</strong> — we do not write your data to any database or file system</li>
          <li><strong>Never used for AI training</strong> — OpenAI&apos;s API terms prohibit using API inputs for model training</li>
          <li><strong>Single external touchpoint</strong> — the only service your data reaches is OpenAI&apos;s API, and only when you click Generate Reports</li>
        </ul>
        <p>Think of it like a calculator: it processes your numbers and returns a result, but it doesn&apos;t remember what you typed.</p>
      </Expander>
      <Expander title="Why do I need my own OpenAI API key? Why not just use the app's key?">
        <p>We deliberately chose <strong>not</strong> to embed a shared API key. Here&apos;s why this is actually better for you:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Your data only passes through your OpenAI account</strong> — not a pooled account with other users&apos; data</li>
          <li><strong>You control your own spend</strong> — you can set monthly budget limits directly in OpenAI&apos;s dashboard</li>
          <li><strong>You can revoke access instantly</strong> — delete the key anytime from OpenAI without affecting anyone else</li>
          <li><strong>No trust required</strong> — you don&apos;t have to trust that we&apos;re handling a shared key responsibly, because there isn&apos;t one</li>
        </ul>
        <p>It&apos;s the same reason you wouldn&apos;t want your bank to share a login with everyone in the branch.</p>
        <p>You can also optionally check &quot;Remember key in this browser&quot; in the sidebar — the key is stored in your browser&apos;s local storage (like a password manager), so you only paste it once.</p>
      </Expander>
      <Expander title='Can I trust that the "Remember key" feature is secure?'>
        <p>Yes. Here&apos;s exactly what happens:</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>When you check Remember key in this browser, the key is saved to <strong>your browser&apos;s localStorage</strong> — the same mechanism used by password managers and banking apps</li>
          <li>The key is <strong>never sent to our server</strong> — the JavaScript runs in your browser only</li>
          <li>It is <strong>never visible in logs, analytics, or network requests</strong> on our side</li>
          <li>You can remove it any time by unchecking the box, or by clearing your browser&apos;s site data</li>
        </ol>
        <p>If you&apos;re using a shared or public computer, simply leave the box unchecked.</p>
      </Expander>

      <Category title="How It Works" />
      <Expander title="How is this different from pasting my data into ChatGPT?">
        <p>Five meaningful differences:</p>
        <p><strong>1. Direct connection, no copy-paste</strong><br />Upload once or connect your BI tool — no manual copying, no hitting character limits, no worrying about whether the AI saw all your rows.</p>
        <p><strong>2. Pre-engineered prompts</strong><br />Instead of you figuring out how to ask for analysis, the prompts are pre-built for business decision-making — calibrated by role (CFO vs. Operations Manager) and time horizon (next 30 days vs. next quarter). ChatGPT gives you what you ask for; this gives you what you need.</p>
        <p><strong>3. Anomaly detection before the AI sees your data</strong><br />Statistical outliers in your dataset are flagged before the report is generated, so the AI&apos;s recommendations account for dirty or unusual data.</p>
        <p><strong>4. Structured, shareable output</strong><br />Reports are formatted and downloadable as Word or PDF — ready to drop into a board deck or email. No reformatting required.</p>
        <p><strong>5. Your data stays in your account</strong><br />When you paste into ChatGPT, OpenAI&apos;s default data handling applies. Here, you&apos;re using your own API key — your data flows through your OpenAI account, subject to your organization&apos;s data agreements with OpenAI.</p>
      </Expander>
      <Expander title="What do the three report types mean?">
        <p>Each report is written for a different audience and decision type:</p>
        <p><strong>Executive Summary</strong> — Written for the boardroom. Covers: Situation, What This Means For You, Recommended Actions, and Risks If You Wait. Best for: quarterly reviews, board presentations, investor updates.</p>
        <p><strong>Operational Detail</strong> — Written for team managers. Covers: Performance Breakdown by segment, Efficiency Gaps, Process Recommendations, and Quick Wins you can act on this week. Best for: weekly team syncs, department reviews, ops planning.</p>
        <p><strong>Risk Report</strong> — Written for risk officers and cautious decision-makers. Covers: Top Risks Identified, Early Warning Signs in the data, Mitigation Actions, and Data Quality Risks. Best for: audits, compliance reviews, risk committee updates.</p>
      </Expander>
      <Expander title="How accurate are the AI reports?">
        <p>The reports are as accurate as your data and your decision context.</p>
        <p>The AI performs <strong>pattern recognition and business reasoning</strong> — it identifies trends, comparisons, outliers, and implications based on your dataset. It does not perform statistical hypothesis testing or make guarantees about future outcomes.</p>
        <p><strong>To get the best results:</strong></p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Be specific in the Decision Context field (e.g., &quot;Should we expand into the Northeast market given Q2 performance?&quot; is better than &quot;What should I do?&quot;)</li>
          <li>Select the right role — the report language and depth change significantly between CFO and Analyst</li>
          <li>Upload clean, well-labelled data with clear column names</li>
        </ul>
        <p>Always use AI reports as <strong>decision support</strong>, not as a substitute for domain expertise.</p>
      </Expander>

      <Category title="Enterprise & Teams" />
      <Expander title="Does this work with Tableau or Power BI?">
        <p>Yes. In the sidebar, switch the data source to <strong>Tableau</strong> or <strong>Power BI</strong>:</p>
        <p><strong>Tableau Server / Tableau Cloud</strong><br />Enter your server URL, username, and password (or Personal Access Token). The app lists your available workbooks and views — select one and it pulls the underlying data live. No file export needed — the connection reads directly from your published dashboard data.</p>
        <p><strong>Power BI</strong><br />Enter your Azure tenant ID, client ID, client secret, and workspace/dataset IDs. The app exports the dataset and loads it for analysis, keeping your data within your Microsoft tenant&apos;s security boundary.</p>
        <p>Both connections are stateless — credentials are used only to fetch data during your active session and are never stored, logged, or retained after you close the browser.</p>
        <p className="italic">Enterprise note: If your organization has questions about connecting to internal Tableau Server or Power BI on-premises deployments, reach out directly for guidance on network and credential configuration.</p>
      </Expander>

      <div className="border-t border-border pt-5 mt-8 text-text-dim text-xs text-center leading-relaxed">
        Built by <strong className="text-text">Swapnil Sakorkar</strong> &nbsp;·&nbsp; AI Application Developer &nbsp;·&nbsp;
        {" "}
        <a href="https://www.linkedin.com/in/sakorkar-s/" target="_blank" rel="noreferrer" className="text-accent no-underline">
          LinkedIn
        </a>
        &nbsp;·&nbsp;
        <em>This tool uses your own OpenAI API key. Your data is processed in-session only and is never stored.</em>
      </div>
    </div>
  );
}

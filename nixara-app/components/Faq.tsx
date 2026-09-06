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

/**
 * These four claims are load-bearing: they are the first thing a buyer reads
 * and the first thing their security reviewer will check. Three of the
 * original four did not match what the code does - the app persists decision
 * records and analytics events to Supabase, and the free tier runs on
 * Nixara's own OpenAI key. Claims that are provably false are worse than no
 * claims at all, so these now state what actually happens.
 *
 * If you change data handling, change this first.
 */
const TRUST_PILLARS = [
  { label: "Your Data", text: "Your uploaded rows are parsed in your browser and never sent to Nixara. Only a statistical summary reaches the AI." },
  { label: "Bring Your Key", text: "Paste your own OpenAI key and reports run entirely through your account. The free trial runs on ours." },
  { label: "No Account Required", text: "No sign-up and no login. Nixara records anonymous usage counts, and the decisions you choose to log." },
  { label: "Speed", text: "Three reports - Executive, Operational and Risk - generated from one dataset in under a minute." },
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
        <p><strong>Nixara is a built-in AI analyst for your business data</strong> - no prompting skills required.</p>
        <p>Upload any CSV or Excel file, or connect your live Tableau / Power BI dashboard, and get three decision-ready reports in under 30 seconds:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Executive Summary</strong> - Strategic narrative written for the boardroom: situation, implications, recommended actions</li>
          <li><strong>Operational Detail</strong> - Efficiency gaps, process recommendations, and quick wins for team managers</li>
          <li><strong>Risk Report</strong> - Early warning signs, data quality flags, and mitigation actions</li>
        </ul>
        <p>Each report is generated for your specific role, decision context, and time horizon - then delivered as a formatted Word or PDF document you can share immediately.</p>
      </Expander>
      <Expander title="What data formats are supported?">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>CSV</strong> (.csv) - any standard comma-separated file</li>
          <li><strong>Excel</strong> (.xlsx, .xls) - single-sheet workbooks work best</li>
          <li><strong>Tableau Server</strong> - connect via your Tableau credentials and pull live view data</li>
          <li><strong>Power BI</strong> - connect via Azure AD credentials and pull dataset exports</li>
        </ul>
        <p>Your data must be <strong>tabular</strong> (rows and columns) with at least one numeric column. It works best with structured business data: sales figures, operational KPIs, HR metrics, financial reports, healthcare outcomes.</p>
        <p className="italic">Tip: If your Excel file has merged cells or multi-row headers, flatten it to a simple table first.</p>
      </Expander>
      <Expander title="How do I get an OpenAI API key?">
        <ol className="list-decimal pl-5 space-y-1">
          <li>Go to <strong>platform.openai.com</strong> and sign in (or create a free account)</li>
          <li>Click your profile → <strong>API Keys</strong> → <strong>Create new secret key</strong></li>
          <li>Copy the key (starts with <code>sk-proj-...</code>) and paste it into the OpenAI API Key field under Report Setup</li>
        </ol>
        <p><strong>Cost:</strong> One click generates three reports, so it is three calls to GPT-4o. Depending on how wide your dataset is, that is roughly <strong>6,000 to 9,000 tokens per run, on the order of $0.03 to $0.08</strong> - less than a cup of coffee per week for daily use. You can monitor usage at platform.openai.com/usage at any time.</p>
      </Expander>

      <Category title="Privacy & Security" />
      <Expander title="Is my data safe? Where does it go?">
        <p>The precise answer, rather than a reassuring one.</p>
        <p><strong>Your file never leaves your browser.</strong> Parsing, charting and the statistical summary all happen locally. Nixara&apos;s server never receives your rows.</p>
        <p><strong>What does reach the AI</strong> is that summary: column names, totals and averages per column, breakdowns by category, and a data quality score. Not individual records. If a column name or a category label is itself sensitive (a client name, a person&apos;s name), it will appear in that summary, so treat column headers and category values as the things to check before uploading.</p>
        <p><strong>What Nixara stores.</strong> Being straight about this:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Anonymous usage counts</strong> - a random session ID, the role and time horizon you picked, the report type, whether the source was a file or a BI connector, and the row and column counts. No file contents, no file data.</li>
          <li><strong>Decisions you explicitly log</strong> - if you click Approve, Reject or Postpone, Nixara saves that choice with your decision question, the file name, the recommendation you selected and the owner you named, so you can look it up later by its ID. Nothing is saved unless you click one of those buttons.</li>
          <li><strong>Nothing else.</strong> Your rows are never written to a database or a file on our side.</li>
        </ul>
        <p><strong>Never used for AI training</strong> - OpenAI&apos;s API terms prohibit using API inputs to train their models.</p>
        <p className="italic">Because decision records are looked up by an ID rather than an account, treat that ID like a password: anyone who has it can read that record.</p>
      </Expander>
      <Expander title="Do I need my own OpenAI API key?">
        <p>Not to start. Your first few runs are on Nixara&apos;s key, so you can try it without signing up for anything.</p>
        <p>After that you paste your own key, and it is worth knowing exactly what changes when you do:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Your summary goes through your OpenAI account</strong>, not a pooled one, so it falls under your organisation&apos;s own agreement with OpenAI</li>
          <li><strong>You control the spend</strong> - set a monthly budget limit in OpenAI&apos;s dashboard</li>
          <li><strong>You can revoke it instantly</strong> - delete the key at OpenAI and Nixara loses access immediately</li>
        </ul>
        <p><strong>How the key is handled.</strong> It is held in memory for the life of the browser tab and sent to Nixara&apos;s server only to make the OpenAI call. It is never written to disk, never saved in your browser&apos;s storage, and never logged. Close or refresh the tab and it is gone, which is deliberate: an API key sitting in browser storage is readable by any script on the page and survives until someone clears it by hand.</p>
        <p>That does mean pasting it again each session. That is the trade, and we would rather make it than keep your key on disk.</p>
      </Expander>

      <Category title="How It Works" />
      <Expander title="How is this different from pasting my data into ChatGPT?">
        <p>Five meaningful differences:</p>
        <p><strong>1. Direct connection, no copy-paste</strong><br />Upload once or connect your BI tool - no manual copying, no hitting character limits, no worrying about whether the AI saw all your rows.</p>
        <p><strong>2. Pre-engineered prompts</strong><br />Instead of you figuring out how to ask for analysis, the prompts are pre-built for business decision-making - calibrated by role (CFO vs. Operations Manager) and time horizon (next 30 days vs. next quarter). ChatGPT gives you what you ask for; this gives you what you need.</p>
        <p><strong>3. Anomaly detection before the AI sees your data</strong><br />Statistical outliers in your dataset are flagged before the report is generated, so the AI&apos;s recommendations account for dirty or unusual data.</p>
        <p><strong>4. Structured, shareable output</strong><br />Reports are formatted and downloadable as Word or PDF - ready to drop into a board deck or email. No reformatting required.</p>
        <p><strong>5. Only a summary leaves your machine</strong><br />Pasting into ChatGPT means pasting your actual rows. Here the file is parsed in your browser and only the aggregate summary is sent. And once you are on your own API key, that summary goes through your OpenAI account, under your organisation&apos;s own agreement with OpenAI.</p>
      </Expander>
      <Expander title="What do the three report types mean?">
        <p>Each report is written for a different audience and decision type:</p>
        <p><strong>Executive Summary</strong> - Written for the boardroom. Covers: Situation, What This Means For You, Recommended Actions, and Risks If You Wait. Best for: quarterly reviews, board presentations, investor updates.</p>
        <p><strong>Operational Detail</strong> - Written for team managers. Covers: Performance Breakdown by segment, Efficiency Gaps, Process Recommendations, and Quick Wins you can act on this week. Best for: weekly team syncs, department reviews, ops planning.</p>
        <p><strong>Risk Report</strong> - Written for risk officers and cautious decision-makers. Covers: Top Risks Identified, Early Warning Signs in the data, Mitigation Actions, and Data Quality Risks. Best for: audits, compliance reviews, risk committee updates.</p>
      </Expander>
      <Expander title="How accurate are the AI reports?">
        <p>The reports are as accurate as your data and your decision context.</p>
        <p>The AI performs <strong>pattern recognition and business reasoning</strong> - it identifies trends, comparisons, outliers, and implications based on your dataset. It does not perform statistical hypothesis testing or make guarantees about future outcomes.</p>
        <p><strong>To get the best results:</strong></p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Be specific in the Decision Context field (e.g., &quot;Should we expand into the Northeast market given Q2 performance?&quot; is better than &quot;What should I do?&quot;)</li>
          <li>Select the right role - the report language and depth change significantly between CFO and Analyst</li>
          <li>Upload clean, well-labelled data with clear column names</li>
        </ul>
        <p>Always use AI reports as <strong>decision support</strong>, not as a substitute for domain expertise.</p>
      </Expander>

      <Category title="Enterprise & Teams" />
      <Expander title="Does this work with Tableau or Power BI?">
        <p>Yes. Above the upload box, switch the source tab to <strong>Tableau</strong> or <strong>Power BI</strong>:</p>
        <p><strong>Tableau Server / Tableau Cloud</strong><br />Enter your server URL, site, and a Personal Access Token (token name and secret). Type the name of the view you want and Nixara pulls that view&apos;s data live, so there is no file to export. The server must be reachable over HTTPS from the public internet; an internal-only Tableau Server behind your VPN will not be reachable.</p>
        <p><strong>Power BI</strong><br />Enter your Azure tenant ID, client ID, client secret, and workspace and dataset IDs for a service principal. Nixara lists the tables in that dataset and loads the one you pick.</p>
        <p><strong>Where the data actually goes.</strong> Unlike a file upload, connector data is fetched by Nixara&apos;s server, summarised there, and passed to OpenAI. It is not written to disk and not retained after the request, but it does transit our server, which a file upload does not. If that distinction matters to your security team, use a file export instead.</p>
        <p>Credentials are used only for that one fetch and are never stored, logged, or retained.</p>
        <p className="italic">Enterprise note: If your organization has questions about connecting to internal Tableau Server or Power BI on-premises deployments, reach out directly for guidance on network and credential configuration.</p>
      </Expander>

      <div className="border-t border-border pt-5 mt-8 text-text-dim text-xs text-center leading-relaxed">
        Built by <strong className="text-text">Swapnil Sakorkar</strong> &nbsp;·&nbsp; AI Application Developer &nbsp;·&nbsp;
        {" "}
        <a href="https://www.linkedin.com/in/sakorkar-s/" target="_blank" rel="noreferrer" className="text-accent no-underline">
          LinkedIn
        </a>
      </div>
    </div>
  );
}

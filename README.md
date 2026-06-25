# Nixara — AI Dashboard Copilot

Upload any business dataset and get instant AI-generated executive reports in seconds. Download as Word or PDF, ready to share.

**Live app →** [nixara-app.vercel.app](https://nixara-app.vercel.app)
**Marketing site →** [nixara-landing.vercel.app](https://nixara-landing.vercel.app)

---

## What it does

- Upload a CSV or Excel file
- Tell the AI who you are (CEO, CFO, Sales Lead…) and what decision you're trying to make
- Get three structured reports instantly: Executive Summary, Operational Detail, and Risk Report
- Download each report as a Word doc or PDF
- Approve, reject, or postpone each recommendation — every decision gets a unique ID
- Come back later and log what actually happened, to track whether Nixara's analysis was accurate

---

## Try it now — no setup needed

1. Open [nixara-app.vercel.app](https://nixara-app.vercel.app)
2. Download the sample file included in this repo: **`superstore_data.csv`**
   > This is a fictional retail dataset included purely as a trial — it lets you explore how the app works before connecting your own data. It is not real business data.
3. Upload it
4. Type a decision like *"Which product category should we invest in next quarter?"*
5. Pick your role and click **Generate Reports**

---

## Use your own data

Works with any CSV or Excel spreadsheet — export from Excel, Google Sheets, or any tool and upload directly. No accounts or API keys needed for your first 3 reports per session; paste your own OpenAI key for unlimited use.

> Live Tableau and Power BI connectors exist in the original Streamlit version (see below) and are being ported to the new app — not yet available in `nixara-app`.

---

## Tech stack

**Current app** (`nixara-app/`):
- **Framework:** Next.js (App Router) + TypeScript, deployed on Vercel
- **AI reports:** OpenAI GPT-4o, generated server-side via Next.js API routes
- **Charts:** Recharts
- **File parsing:** Papaparse (CSV), ExcelJS (Excel) — done client-side
- **Decision/outcome tracking:** Supabase (Postgres + RLS)
- **Export:** `docx` (Word), `pdfkit` (PDF)
- **Animation:** Framer Motion

**Marketing site** (`nixara-landing/`): React + Vite + Framer Motion, deployed on Vercel.

**Original implementation** (`dashboard_ai_app.py`, repo root): the first version of this product, a Streamlit app with the same core feature set plus working Tableau and Power BI connectors. Kept in this repo as reference while those connectors get ported to the Next.js app; no longer the deployed/live version.

---

## Project structure

```
ai-dashboard-copilot/
├── nixara-app/              # Current app — Next.js, deployed at nixara-app.vercel.app
├── nixara-landing/          # Marketing site — React/Vite, deployed at nixara-landing.vercel.app
├── dashboard_ai_app.py       # Original Streamlit app (reference; Tableau/Power BI connectors not yet ported)
├── tableau_connector.py      # Tableau REST API integration (Streamlit version)
├── insight_engine.py         # Data analysis utilities (Streamlit version)
├── requirements.txt          # Python dependencies (Streamlit version)
├── superstore_data.csv       # Sample dataset (trial use only)
└── market_trend.csv          # Sample dataset (trial use only)
```

---

## Built by

**Swapnil Sakorkar** — AI Application Developer
[LinkedIn](https://www.linkedin.com/in/sakorkar-s) · [GitHub](https://github.com/swap700)

---

## License

© 2025 Swapnil Sakorkar. All rights reserved.

This project is shared publicly for portfolio and demonstration purposes only.
You may view and reference the code, but you may not copy, deploy, or distribute
it — in whole or in part — without explicit written permission from the author.

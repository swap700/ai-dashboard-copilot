# AI Dashboard Copilot

Upload any business dataset — or connect your Tableau / Power BI workspace — and get instant AI-generated executive reports in seconds. Download as Word or PDF, ready to share.

**Live demo →** [ai-dashboard-copilot.streamlit.app](https://ai-dashboard-copilot.streamlit.app)  

---

## What it does

- Upload a CSV or Excel file (or connect a live BI tool)
- Tell the AI who you are (CEO, CFO, Sales Lead…) and what decision you're trying to make
- Get three structured reports instantly: Executive Summary, Operational Detail, and Risk Report
- Download each report as a Word doc or PDF

---

## Try it now — no setup needed

The fastest way to see it in action:

1. Open the live demo link above
2. Download the sample file included in this repo: **`superstore_data.csv`**
   > This is a fictional retail dataset included purely as a trial — it lets you explore how the app works before connecting your own data. It is not real business data.
3. Upload it in the sidebar
4. Type a decision like *"Which product category should we invest in next quarter?"*
5. Pick your role and click **Generate Reports**

---

## Use your own data

### Option A — CSV or Excel (easiest)
Works with any spreadsheet. Export from Excel, Google Sheets, or any tool and upload directly. No accounts or API keys needed.

### Option B — Connect Tableau

**What you need:**
- Access to a Tableau Server or Tableau Cloud workspace
- A Personal Access Token (your IT team or Tableau admin can create one for you)

**Steps:**
1. Log in to your Tableau Server or Tableau Cloud
2. Go to your account settings and create a **Personal Access Token** — give it any name (e.g. `ai-dashboard`)
3. Note down:
   - Your server URL (e.g. `https://us-east-1.online.tableau.com`)
   - Your site name (shown in the URL after `/site/`)
   - The token name and token secret
4. In the app sidebar, select **Connect to Tableau** from the data source dropdown
5. Paste your credentials and the name of the view you want to analyse
6. Click **Connect** — your live Tableau data loads directly into the report engine

**For non-tech users:** Ask your Tableau admin to create a Personal Access Token for you and share the server URL and site name. You only need those four values — no coding required.

### Option C — Connect Power BI

**What you need:**
- A Microsoft 365 or Power BI Pro account
- Access to a published Power BI report
- An Azure App Registration (your IT admin can set this up — takes about 5 minutes)

**Steps:**
1. Ask your IT team to register an Azure app with Power BI read access and share:
   - **Tenant ID** (found in Azure Active Directory)
   - **Client ID** (the app registration ID)
   - **Client Secret** (generated in the app registration)
   - **Workspace ID** and **Report ID** (from the Power BI report URL)
2. In the app sidebar, select **Connect to Power BI**
3. Paste those five values and click **Connect**
4. The app fetches your report data and feeds it straight into the AI engine

**For non-tech users:** Forward this section to your IT team and ask for a read-only Azure app registration for Power BI. They will be familiar with the process. You just need to paste what they give you.

---

## Run it locally (for developers)

```bash
# Clone the repo
git clone https://github.com/swap700/ai-dashboard-copilot.git
cd ai-dashboard-copilot

# Install dependencies
pip install -r requirements.txt

# Add your secrets
mkdir -p .streamlit
cat > .streamlit/secrets.toml << EOF
OPENAI_API_KEY = "sk-your-key-here"
TABLEAU_TOKEN_NAME = "your-token-name"
TABLEAU_TOKEN_SECRET = "your-token-secret"
TABLEAU_SERVER = "https://your-server.online.tableau.com"
TABLEAU_SITE = "your-site-id"
EOF

# Launch
streamlit run dashboard_ai_app.py
```

---

## Project structure

```
ai-dashboard-copilot/
├── dashboard_ai_app.py     # Main Streamlit app
├── tableau_connector.py    # Tableau REST API integration
├── insight_engine.py       # Data analysis utilities
├── requirements.txt        # Python dependencies
├── superstore_data.csv     # Sample dataset (trial use only)
└── market_trend.csv        # Sample dataset (trial use only)
```

---

## Tech stack

- **Frontend & app:** Streamlit
- **AI reports:** OpenAI GPT-4o
- **Charts:** Altair
- **Tableau integration:** Tableau Server Client (TSC)
- **Power BI integration:** Microsoft Power BI REST API
- **Export:** python-docx (Word), ReportLab (PDF)

---

## Deploying your own instance

[![Deploy to Streamlit](https://static.streamlit.io/badges/streamlit_badge_black_white.svg)](https://share.streamlit.io)

1. Fork this repo
2. Go to [share.streamlit.io](https://share.streamlit.io) and connect your fork
3. Add your `OPENAI_API_KEY` and Tableau credentials in the Secrets panel
4. Click Deploy — you'll have a live URL in under 2 minutes

---

## Built by

**Swapnil Sakorkar** — AI Application Developer
[LinkedIn](https://www.linkedin.com/in/sakorkar-s) · [GitHub](https://github.com/swap700)

import io
import re

import streamlit as st
import pandas as pd
import numpy as np
import altair as alt
from openai import OpenAI
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
# ---------------------------------------------------
# PAGE CONFIG
# ---------------------------------------------------

st.set_page_config(
    page_title="AI Dashboard Copilot",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ---------------------------------------------------
# CUSTOM CSS — Light professional executive theme
# ---------------------------------------------------

st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=IBM+Plex+Sans:wght@300;400;500&display=swap');

/* ── Global ── */
html, body, [class*="css"] {
    font-family: 'IBM Plex Sans', sans-serif;
    background-color: #F7F6F2;
    color: #1A1A2E;
}

/* ── Hide Streamlit chrome ── */
#MainMenu, footer, header { visibility: hidden; }
.block-container {
    padding-top: 2rem;
    padding-bottom: 3rem;
    max-width: 1200px;
}

/* ── Sidebar ── */
[data-testid="stSidebar"] {
    background-color: #FFFFFF;
    border-right: 1px solid #E8E5DC;
}
[data-testid="stSidebar"] .stMarkdown p {
    color: #9B8FA8;
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 500;
}
[data-testid="stSidebar"] label {
    color: #3A3A5A !important;
    font-size: 0.82rem !important;
    font-weight: 400 !important;
}
[data-testid="stSidebar"] .stTextArea textarea {
    background-color: #F7F6F2 !important;
    border: 1px solid #D8D4CC !important;
    color: #1A1A2E !important;
    border-radius: 6px !important;
    font-family: 'IBM Plex Sans', sans-serif !important;
    font-size: 0.85rem !important;
}
[data-testid="stSidebar"] select,
[data-testid="stSidebar"] .stSelectbox > div > div {
    background-color: #F7F6F2 !important;
    border: 1px solid #D8D4CC !important;
    color: #1A1A2E !important;
    border-radius: 6px !important;
}

/* ── Logo placeholder ── */
.logo-placeholder {
    width: 100%;
    height: 52px;
    border: 1.5px dashed #C8C4BC;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #A8A4A0;
    font-size: 0.68rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 500;
    transition: all 0.2s;
    background: #FAFAF8;
    cursor: pointer;
}
.logo-placeholder:hover { border-color: #B8975A; color: #B8975A; background: #FBF8F2; }

/* ── App header ── */
.app-header {
    border-bottom: 2px solid #E8E5DC;
    padding-bottom: 1.25rem;
    margin-bottom: 2rem;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
}
.app-title {
    font-family: 'Playfair Display', serif;
    font-size: 1.9rem;
    font-weight: 600;
    color: #1A1A2E;
    margin: 0;
    line-height: 1.2;
}
.app-subtitle {
    color: #6B6B8A;
    font-size: 0.83rem;
    margin-top: 0.3rem;
    font-weight: 300;
    letter-spacing: 0.02em;
}
.accent-bar {
    width: 36px;
    height: 3px;
    background: #B8975A;
    border-radius: 2px;
    margin: 0.5rem 0 0.35rem;
}
.header-tag {
    font-size: 0.7rem;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #B8975A;
    border: 1px solid #B8975A;
    border-radius: 20px;
    padding: 0.2rem 0.75rem;
    margin-bottom: 0.5rem;
}

/* ── Section labels ── */
.section-label {
    font-size: 0.68rem;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #B8975A;
    margin-bottom: 0.6rem;
    margin-top: 0.25rem;
}

/* ── Metric cards ── */
[data-testid="metric-container"] {
    background: #FFFFFF;
    border: 1px solid #E8E5DC;
    border-radius: 10px;
    padding: 1.1rem 1.3rem !important;
    box-shadow: 0 1px 4px rgba(26,26,46,0.06);
}
[data-testid="metric-container"] label {
    color: #8B8FA8 !important;
    font-size: 0.72rem !important;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 500 !important;
}
[data-testid="metric-container"] [data-testid="stMetricValue"] {
    color: #1A1A2E !important;
    font-size: 1.65rem !important;
    font-weight: 300 !important;
    font-family: 'Playfair Display', serif !important;
}

/* ── Dataframe ── */
[data-testid="stDataFrame"] {
    border: 1px solid #E8E5DC !important;
    border-radius: 8px !important;
    overflow: hidden;
    box-shadow: 0 1px 4px rgba(26,26,46,0.05);
}

/* ── Tabs ── */
[data-testid="stTabs"] [role="tablist"] {
    border-bottom: 2px solid #E8E5DC;
    gap: 0;
    background: transparent;
}
[data-testid="stTabs"] button[role="tab"] {
    background: transparent !important;
    color: #8B8FA8 !important;
    font-size: 0.82rem !important;
    font-weight: 500 !important;
    letter-spacing: 0.04em;
    padding: 0.65rem 1.4rem !important;
    border-bottom: 2px solid transparent !important;
    border-radius: 0 !important;
    transition: all 0.2s;
    font-family: 'IBM Plex Sans', sans-serif !important;
}
[data-testid="stTabs"] button[role="tab"]:hover {
    color: #1A1A2E !important;
    background: #F0EDE6 !important;
}
[data-testid="stTabs"] button[role="tab"][aria-selected="true"] {
    color: #1A1A2E !important;
    border-bottom: 2px solid #B8975A !important;
    font-weight: 500 !important;
}

/* ── Report body ── */
.report-body {
    background: #FFFFFF;
    border: 1px solid #E8E5DC;
    border-radius: 10px;
    padding: 2rem 2.5rem;
    line-height: 1.8;
    font-size: 0.92rem;
    color: #2E2E4A;
    box-shadow: 0 1px 4px rgba(26,26,46,0.05);
}
.report-body h3 {
    font-family: 'Playfair Display', serif;
    color: #1A1A2E;
    font-size: 1rem;
    font-weight: 600;
    margin-top: 1.6rem;
    margin-bottom: 0.5rem;
    border-left: 3px solid #B8975A;
    padding-left: 0.7rem;
}

/* ── Download buttons ── */
[data-testid="stDownloadButton"] button {
    background: #FFFFFF !important;
    border: 1px solid #D4D0C8 !important;
    color: #4A4A6A !important;
    font-size: 0.78rem !important;
    font-weight: 500 !important;
    letter-spacing: 0.04em;
    border-radius: 6px !important;
    transition: all 0.2s !important;
    font-family: 'IBM Plex Sans', sans-serif !important;
}
[data-testid="stDownloadButton"] button:hover {
    border-color: #B8975A !important;
    color: #B8975A !important;
    background: #FBF8F2 !important;
}

/* ── Generate button ── */
[data-testid="stSidebar"] [data-testid="stButton"] button {
    background: #1A1A2E !important;
    color: #FFFFFF !important;
    border: none !important;
    font-weight: 500 !important;
    font-size: 0.85rem !important;
    letter-spacing: 0.06em;
    border-radius: 6px !important;
    transition: opacity 0.2s !important;
    font-family: 'IBM Plex Sans', sans-serif !important;
}
[data-testid="stSidebar"] [data-testid="stButton"] button:hover {
    opacity: 0.85 !important;
}

/* ── Alerts ── */
[data-testid="stAlert"] {
    background: #FDF8F0 !important;
    border: 1px solid #E8D9B8 !important;
    border-radius: 8px !important;
    color: #5A4A2A !important;
}

/* ── Divider ── */
hr { border-color: #E8E5DC !important; }

/* ── Empty state ── */
.empty-state {
    text-align: center;
    padding: 5rem 2rem;
    color: #B0ADC0;
}
.empty-state .icon {
    font-size: 2rem;
    margin-bottom: 1rem;
    color: #D4D0C8;
}
.empty-state p {
    font-size: 0.82rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 500;
}

/* ── File uploader ── */
[data-testid="stFileUploader"] {
    background: #F7F6F2 !important;
    border: 1px solid #D8D4CC !important;
    border-radius: 8px !important;
}
[data-testid="stFileUploader"] section {
    background: #F7F6F2 !important;
    border: none !important;
}
[data-testid="stFileUploader"] [data-testid="stFileUploaderDropzoneInstructions"] {
    color: #6B6B8A !important;
}
/* uploaded file pill */
[data-testid="stFileUploader"] [data-testid="stFileUploaderFile"] {
    background: #EEEAE4 !important;
    border: 1px solid #D8D4CC !important;
    border-radius: 6px !important;
    color: #1A1A2E !important;
}
[data-testid="stFileUploader"] [data-testid="stFileUploaderFile"] span {
    color: #3A3A5A !important;
}
</style>
""", unsafe_allow_html=True)

# ---------------------------------------------------
# CLIENT
# ---------------------------------------------------

client = OpenAI(api_key=st.secrets["OPENAI_API_KEY"])

# ---------------------------------------------------
# FILE LOADER
# ---------------------------------------------------

def load_file(uploaded):
    name = uploaded.name.lower()
    if name.endswith(".csv"):
        return pd.read_csv(uploaded)
    elif name.endswith(".xlsx") or name.endswith(".xls"):
        return pd.read_excel(uploaded)
    return None


# ---------------------------------------------------
# CLEAN NUMERIC
# ---------------------------------------------------

def clean_dataframe(df):
    for col in df.columns:
        if df[col].dtype == object:
            cleaned = pd.to_numeric(
                df[col].astype(str)
                .str.strip()
                .str.replace(r"[\$,]", "", regex=True),
                errors="coerce",
            )
            # Lower threshold to 0.5 — if half the values parse as numbers, treat as numeric
            if cleaned.notna().mean() > 0.5:
                df[col] = cleaned
    return df


# ---------------------------------------------------
# ANALYSIS HELPERS
# ---------------------------------------------------

def detect_anomalies(df, col):
    s = df[col].dropna()
    if len(s) < 5 or s.std() == 0:
        return pd.DataFrame()
    z = (s - s.mean()) / s.std()
    # Use .loc with the index from s to avoid misalignment
    anomaly_idx = z[np.abs(z) > 2].index
    return df.loc[anomaly_idx].copy()


def dashboard_score(df):
    score = 100
    if df.isna().mean().mean() > 0.2:
        score -= 20
    if len(df.columns) > 20:
        score -= 10
    if len(df) < 10:
        score -= 10
    return max(score, 0)


def smart_agg(col_name):
    """Use mean for averages/rates/margins, sum for everything else."""
    keywords = ["average", "avg", "mean", "rate", "ratio", "margin", "score", "pct", "percent"]
    return "mean" if any(k in col_name.lower() for k in keywords) else "sum"


def build_data_summary(df, filter_col=None, filter_val=None):
    if filter_col and filter_val and filter_col in df.columns:
        df = df[df[filter_col] == filter_val]

    numeric_cols = df.select_dtypes(include=np.number).columns.tolist()
    cat_cols = df.select_dtypes(exclude=np.number).columns.tolist()

    lines = []
    lines.append(f"Rows: {len(df)} | Columns: {len(df.columns)}")
    if filter_col and filter_val:
        lines.append(f"Filtered to: {filter_col} = {filter_val}")
    lines.append(f"Numeric columns: {numeric_cols}")
    lines.append(f"Categorical columns: {cat_cols}")
    lines.append("")

    if numeric_cols:
        lines.append("NUMERIC SUMMARY")
        lines.append(df[numeric_cols].describe().round(2).to_string())
        lines.append("")

    for cat in cat_cols[:3]:
        if df[cat].nunique() <= 20:
            grp_parts = {}
            for nc in numeric_cols[:3]:
                grp_parts[nc] = df.groupby(cat)[nc].agg(smart_agg(nc)).round(2)
            if grp_parts:
                grp = pd.DataFrame(grp_parts)
                lines.append(f"BREAKDOWN BY {cat.upper()}")
                lines.append(grp.to_string())
                lines.append("")

    anomaly_lines = []
    for col in numeric_cols[:3]:
        anom = detect_anomalies(df, col)
        if not anom.empty:
            anomaly_lines.append(f"  {col}: {len(anom)} anomalous rows (z > 2)")
            preview_cols = [col] + cat_cols[:2]
            anomaly_lines.append(anom[preview_cols].head(3).to_string())
    if anomaly_lines:
        lines.append("ANOMALIES DETECTED")
        lines.extend(anomaly_lines)
        lines.append("")

    if len(numeric_cols) >= 2:
        corr = df[numeric_cols].corr().round(3)
        corr_pairs = (
            corr.where(np.triu(np.ones(corr.shape), k=1).astype(bool))
            .stack()
            .sort_values(key=abs, ascending=False)
            .head(5)
        )
        lines.append("TOP CORRELATIONS")
        lines.append(corr_pairs.to_string())
        lines.append("")

    lines.append(f"Data Quality Score: {dashboard_score(df)}/100")
    return "\n".join(lines)


# ---------------------------------------------------
# REPORT CONFIGS
# ---------------------------------------------------

REPORT_CONFIGS = {
    "Executive Summary": """Structure your response EXACTLY as:

Situation
(2-3 sentences on what the data shows at the highest level)

What This Means For You
(connect to the decision and role — 2-3 sentences)

Recommended Actions
(3 numbered actions, each specific and time-bound)

Risks If You Wait
(2 bullet points on what gets worse without action)

Rules: under 350 words, every action references a number, never say consider monitoring.""",

    "Operational Detail": """Structure your response EXACTLY as:

Performance Breakdown
(by the main dimensions in the data — categories, regions, segments, etc.)

Efficiency Gaps
(where effort or cost is not matching return — specific numbers)

Process Recommendations
(4-5 numbered operational changes implementable this quarter)

Quick Wins
(2 things doable in the next 2 weeks with zero new resources)

Rules: under 500 words, operational language, every point references data.""",

    "Risk Report": """Structure your response EXACTLY as:

Top Risks Identified
(3 risks ranked by severity — each with: what it is, what signals it, potential impact)

Early Warning Signs
(specific metrics to watch as leading indicators)

Mitigation Actions
(one concrete action per risk — specific, assignable, time-bound)

Data Quality Risks
(flag any gaps, anomalies, or quality issues masking bigger problems)

Rules: under 450 words, risk language, reference specific numbers, write to prompt escalation.""",
}


# ---------------------------------------------------
# PROMPT + AI CALL
# ---------------------------------------------------

def generate_report(summary, who, decision, timeframe, report_type):
    instruction = REPORT_CONFIGS[report_type]
    prompt = f"""You are advising a {who} who needs to make a decision about:
"{decision}"

Time horizon: {timeframe}
Report type: {report_type}

{instruction}

Write for a {who} — direct and specific, not academic.

Dashboard data:
{summary}
"""
    response = client.chat.completions.create(
        model="gpt-4o",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return clean_ai_output(response.choices[0].message.content)


def clean_ai_output(text):
    text = re.sub(r"\*\*", "", text)
    headers = [
        "Situation", "What This Means For You", "Recommended Actions",
        "Risks If You Wait", "Performance Breakdown", "Efficiency Gaps",
        "Process Recommendations", "Quick Wins", "Top Risks Identified",
        "Early Warning Signs", "Mitigation Actions", "Data Quality Risks",
    ]
    for h in headers:
        text = re.sub(h, f"\n### {h}", text, flags=re.IGNORECASE)
    return text.strip()


# ---------------------------------------------------
# DOWNLOAD: WORD
# ---------------------------------------------------

def report_to_docx(report_text, title, who, decision, timeframe):
    doc = Document()
    for section in doc.sections:
        section.top_margin = Inches(1)
        section.bottom_margin = Inches(1)
        section.left_margin = Inches(1.2)
        section.right_margin = Inches(1.2)

    heading = doc.add_heading(title, level=0)
    heading.alignment = WD_ALIGN_PARAGRAPH.LEFT

    meta = doc.add_paragraph()
    run = meta.add_run(f"Role: {who}   |   Decision: {decision}   |   Horizon: {timeframe}")
    run.font.size = Pt(9)

    doc.add_paragraph()

    for line in report_text.split("\n"):
        line = line.strip()
        if not line:
            doc.add_paragraph()
        elif line.startswith("### "):
            doc.add_heading(line[4:], level=2)
        elif re.match(r"^\d+\.", line):
            doc.add_paragraph(line, style="List Number")
        elif line.startswith("- ") or line.startswith("• "):
            doc.add_paragraph(line[2:], style="List Bullet")
        else:
            doc.add_paragraph(line)

    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf


# ---------------------------------------------------
# DOWNLOAD: PDF
# ---------------------------------------------------

def report_to_pdf(report_text, title, who, decision, timeframe):
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=1.2 * inch,
        rightMargin=1.2 * inch,
        topMargin=1 * inch,
        bottomMargin=1 * inch,
    )

    styles = getSampleStyleSheet()

    style_title = ParagraphStyle(
        "ReportTitle", parent=styles["Title"],
        fontSize=18, spaceAfter=4,
        textColor=colors.HexColor("#111111"),
    )
    style_meta = ParagraphStyle(
        "Meta", parent=styles["Normal"],
        fontSize=9, spaceAfter=14,
        textColor=colors.HexColor("#666666"),
    )
    style_h2 = ParagraphStyle(
        "H2", parent=styles["Heading2"],
        fontSize=12, spaceBefore=12, spaceAfter=4,
        textColor=colors.HexColor("#1D3557"),
    )
    style_body = ParagraphStyle(
        "Body", parent=styles["Normal"],
        fontSize=10, leading=15, spaceAfter=4,
    )

    story = [
        Paragraph(title, style_title),
        Paragraph(
            f"Role: {who} &nbsp;|&nbsp; Decision: {decision} &nbsp;|&nbsp; Horizon: {timeframe}",
            style_meta,
        ),
    ]

    for line in report_text.split("\n"):
        line = line.strip()
        if not line:
            story.append(Spacer(1, 4))
        elif line.startswith("### "):
            story.append(Paragraph(line[4:], style_h2))
        else:
            safe = line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            story.append(Paragraph(safe, style_body))

    doc.build(story)
    buf.seek(0)
    return buf


# ---------------------------------------------------
# SIDEBAR
# ---------------------------------------------------

with st.sidebar:

    st.markdown('<p class="section-label">Data Source</p>', unsafe_allow_html=True)
    uploaded_file = st.file_uploader(
        "Upload your data file",
        type=["csv", "xlsx", "xls"],
        label_visibility="collapsed",
        help="CSV or Excel — any dataset works",
    )

    st.markdown("---")
    st.markdown('<p class="section-label">Analysis Context</p>', unsafe_allow_html=True)

    decision = st.text_area(
        "Decision",
        placeholder='e.g. "Which sub-category sells best in Texas?"',
        height=90,
        label_visibility="collapsed",
    )

    who = st.selectbox(
        "Role",
        ["COO", "CEO", "CFO", "Sales Lead", "Operations Lead", "Board"],
        label_visibility="visible",
    )

    timeframe = st.selectbox(
        "Time horizon",
        ["Next 30 days", "This quarter", "This year"],
        index=1,
    )

    st.markdown("---")
    st.markdown('<p class="section-label">Filter (optional)</p>', unsafe_allow_html=True)

    filter_col = None
    filter_val = None

    if "df_for_filter" in st.session_state:
        df_f = st.session_state["df_for_filter"]
        cat_cols_f = df_f.select_dtypes(exclude=np.number).columns.tolist()
        if cat_cols_f:
            filter_col = st.selectbox("Filter by column", ["None"] + cat_cols_f)
            if filter_col != "None":
                filter_val = st.selectbox(
                    "Filter value",
                    sorted(df_f[filter_col].dropna().unique().tolist())
                )
            else:
                filter_col = None

    st.markdown("---")
    run = st.button("Generate Reports", use_container_width=True)

# ---------------------------------------------------
# APP HEADER
# ---------------------------------------------------

st.markdown("""
    <div style="border-bottom: 1.5px solid #E8E5DC; padding-bottom: 1.25rem; margin-bottom: 2rem;">
        <p class="app-title">AI Dashboard Copilot</p>
        <div class="accent-bar"></div>
        <p class="app-subtitle">Upload any dataset &nbsp;·&nbsp; Get executive-grade AI reports &nbsp;·&nbsp; Download as PDF or Word</p>
    </div>
""", unsafe_allow_html=True)

# ---------------------------------------------------
# MAIN
# ---------------------------------------------------

if not uploaded_file:
    st.markdown("""
        <div class="empty-state">
            <div class="icon">↓</div>
            <p>Upload a CSV or Excel file in the sidebar to begin</p>
        </div>
    """, unsafe_allow_html=True)
    st.stop()

df_raw = load_file(uploaded_file)

if df_raw is None:
    st.error("Could not read that file. Please upload a CSV or Excel file.")
    st.stop()

df = clean_dataframe(df_raw.copy())
st.session_state["df_for_filter"] = df

numeric_cols = df.select_dtypes(include=np.number).columns.tolist()
cat_cols = df.select_dtypes(exclude=np.number).columns.tolist()

# Apply filter for display
df_display = df.copy()
if filter_col and filter_val:
    df_display = df[df[filter_col] == filter_val]

# --- DATA PREVIEW ---
st.markdown('<p class="section-label">Dataset Overview</p>', unsafe_allow_html=True)

c1, c2, c3, c4 = st.columns(4)
c1.metric("Rows", f"{len(df_display):,}")
c2.metric("Columns", f"{len(df_display.columns)}")
c3.metric("Numeric fields", len(numeric_cols))
c4.metric("Quality Score", f"{dashboard_score(df_display)}/100")

st.dataframe(
    df_display.head(10),
    use_container_width=True,
    hide_index=True,
)

# --- CHARTS ---
if cat_cols and numeric_cols and df_display[cat_cols[0]].nunique() <= 25:

    chart_col1, chart_col2 = st.columns(2)

    with chart_col1:
        primary_cat = cat_cols[0]
        primary_num = numeric_cols[0]
        agg = smart_agg(primary_num)
        chart_df = df_display.groupby(primary_cat)[primary_num].agg(agg).reset_index()
        chart_df.columns = ["category", "value"]
        chart_df = chart_df.sort_values("value", ascending=False)

        bar = (
            alt.Chart(chart_df)
            .mark_bar(cornerRadiusTopRight=4, cornerRadiusBottomRight=4)
            .encode(
                x=alt.X("value:Q", title=f"{agg.title()} of {primary_num}",
                         axis=alt.Axis(labelColor="#8B8FA8", titleColor="#8B8FA8",
                                       gridColor="#E8E5DC", domainColor="#E8E5DC",
                                       tickColor="#E8E5DC")),
                y=alt.Y("category:N", sort="-x", title="",
                         axis=alt.Axis(labelColor="#2E2E4A", domainColor="#E8E5DC",
                                       tickColor="#E8E5DC")),
                color=alt.condition(
                    alt.datum.value >= 0,
                    alt.value("#B8975A"),
                    alt.value("#C0392B"),
                ),
                tooltip=["category", alt.Tooltip("value:Q", format=",.2f")],
            )
            .properties(
                title=alt.TitleParams(
                    f"{agg.title()} {primary_num} by {primary_cat}",
                    color="#1A1A2E",
                    fontSize=13,
                    font="IBM Plex Sans",
                ),
                height=max(min(52 * df_display[primary_cat].nunique(), 400), 160),
                background="#FFFFFF",
                padding={"top": 16, "left": 16, "right": 16, "bottom": 16},
            )
        )
        st.altair_chart(bar, use_container_width=True)

    with chart_col2:
        if len(numeric_cols) >= 2:
            second_num = numeric_cols[1]
            agg2 = smart_agg(second_num)
            chart_df2 = df_display.groupby(cat_cols[0])[second_num].agg(agg2).reset_index()
            chart_df2.columns = ["category", "value"]
            chart_df2 = chart_df2.sort_values("value", ascending=False)

            bar2 = (
                alt.Chart(chart_df2)
                .mark_bar(cornerRadiusTopRight=4, cornerRadiusBottomRight=4)
                .encode(
                    x=alt.X("value:Q", title=f"{agg2.title()} of {second_num}",
                             axis=alt.Axis(labelColor="#8B8FA8", titleColor="#8B8FA8",
                                           gridColor="#E8E5DC", domainColor="#E8E5DC",
                                           tickColor="#E8E5DC")),
                    y=alt.Y("category:N", sort="-x", title="",
                             axis=alt.Axis(labelColor="#2E2E4A", domainColor="#E8E5DC",
                                           tickColor="#E8E5DC")),
                    color=alt.condition(
                        alt.datum.value >= 0,
                        alt.value("#2E6DA4"),
                        alt.value("#C0392B"),
                    ),
                    tooltip=["category", alt.Tooltip("value:Q", format=",.2f")],
                )
                .properties(
                    title=alt.TitleParams(
                        f"{agg2.title()} {second_num} by {cat_cols[0]}",
                        color="#1A1A2E",
                        fontSize=13,
                        font="IBM Plex Sans",
                    ),
                    height=max(min(52 * df_display[cat_cols[0]].nunique(), 400), 160),
                    background="#FFFFFF",
                    padding={"top": 16, "left": 16, "right": 16, "bottom": 16},
                )
            )
            st.altair_chart(bar2, use_container_width=True)

# Anomaly warnings
for col in numeric_cols[:2]:
    anom = detect_anomalies(df_display, col)
    if not anom.empty:
        st.warning(f"{len(anom)} anomalous rows detected in **{col}** — flagged in the Risk Report.")

# --- REPORTS ---
if run:

    if not decision.strip():
        st.warning("Please describe the decision you are trying to make before generating reports.")
        st.stop()

    summary = build_data_summary(df, filter_col=filter_col, filter_val=filter_val)

    st.markdown("---")
    st.markdown('<p class="section-label">AI Reports</p>', unsafe_allow_html=True)

    tab1, tab2, tab3 = st.tabs(["Executive Summary", "Operational Detail", "Risk Report"])

    for tab, report_type in zip(
        [tab1, tab2, tab3],
        ["Executive Summary", "Operational Detail", "Risk Report"]
    ):
        with tab:
            with st.spinner(f"Generating {report_type}..."):
                report_text = generate_report(summary, who, decision, timeframe, report_type)

            # Clean up raw markdown artifacts before rendering
            clean = report_text
            # Ensure ### headers have a blank line before them for proper rendering
            clean = re.sub(r'([^\n])\n(### )', r'\1\n\n\2', clean)

            # FIX: old code rendered an empty div then put content outside it.
            # Now we convert to HTML and inject it inside the styled .report-body card.
            html_lines = []
            for line in clean.split("\n"):
                line = line.strip()
                if not line:
                    html_lines.append("<br>")
                elif line.startswith("### "):
                    html_lines.append(f"<h3>{line[4:]}</h3>")
                elif re.match(r"^\d+\.", line):
                    html_lines.append(f"<p>{line}</p>")
                elif line.startswith("- ") or line.startswith("• "):
                    html_lines.append(f"<p>• {line[2:]}</p>")
                else:
                    safe = line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                    html_lines.append(f"<p>{safe}</p>")
            html_body = "\n".join(html_lines)
            st.markdown(
                f'<div class="report-body">{html_body}</div>',
                unsafe_allow_html=True
            )

            st.markdown("<br>", unsafe_allow_html=True)
            dl1, dl2 = st.columns([1, 1])

            with dl1:
                st.download_button(
                    label="↓  Download as Word",
                    data=report_to_docx(report_text, report_type, who, decision, timeframe),
                    file_name=f"{report_type.lower().replace(' ', '_')}.docx",
                    mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    key=f"docx_{report_type}",
                    use_container_width=True,
                )

            with dl2:
                st.download_button(
                    label="↓  Download as PDF",
                    data=report_to_pdf(report_text, report_type, who, decision, timeframe),
                    file_name=f"{report_type.lower().replace(' ', '_')}.pdf",
                    mime="application/pdf",
                    key=f"pdf_{report_type}",
                    use_container_width=True,
                )

elif uploaded_file:
    st.markdown("""
        <div style="text-align:center; padding: 2rem; color: #B0ADC0;
                    border: 1px dashed #D4D0C8; border-radius: 10px; margin-top: 1rem;
                    background: #FAFAF8;">
            <p style="font-size: 0.82rem; letter-spacing: 0.08em;
                      text-transform: uppercase; margin: 0; font-weight: 500;">
                Fill in the sidebar and click Generate Reports
            </p>
        </div>
    """, unsafe_allow_html=True)
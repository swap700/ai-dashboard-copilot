import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { buildPrompt, cleanAiOutput, REPORT_TYPES, type ReportType } from "@/lib/report";
import { resolveApiKey } from "@/lib/openai-key";

export const runtime = "nodejs";

interface Body {
  who: string;
  decision: string;
  timeframe: string;
  reportType: ReportType;
  summary: string;
  userKey?: string;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { who, decision, timeframe, reportType, summary, userKey } = body;

  if (!who || !decision || !timeframe || !summary) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }
  if (!REPORT_TYPES.includes(reportType)) {
    return NextResponse.json({ error: "Invalid report type." }, { status: 400 });
  }

  const { apiKey, tier } = resolveApiKey(userKey);
  if (!apiKey) {
    return NextResponse.json(
      { error: "No OpenAI API key available. Paste your own key, or contact the admin." },
      { status: 401 }
    );
  }

  const prompt = buildPrompt({ who, decision, timeframe, reportType, summary });

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = response.choices[0]?.message?.content ?? "";
    const text = cleanAiOutput(raw);
    return NextResponse.json({ text, tier });
  } catch (err) {
    const message = err instanceof Error ? err.message : "OpenAI request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

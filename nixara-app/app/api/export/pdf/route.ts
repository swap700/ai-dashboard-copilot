import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { parseReportLines } from "@/lib/report";

export const runtime = "nodejs";

interface Body {
  reportText: string;
  title: string;
  who: string;
  decision: string;
  timeframe: string;
}

export async function POST(req: NextRequest) {
  const { reportText, title, who, decision, timeframe }: Body = await req.json();

  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 72, bottom: 72, left: 86.4, right: 86.4 },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  doc.fontSize(18).fillColor("#111111").text(title, { lineGap: 4 });
  doc
    .fontSize(9)
    .fillColor("#666666")
    .text(`Role: ${who}   |   Decision: ${decision}   |   Horizon: ${timeframe}`, { lineGap: 14 });
  doc.moveDown(0.5);

  for (const line of parseReportLines(reportText)) {
    switch (line.kind) {
      case "blank":
        doc.moveDown(0.4);
        break;
      case "heading":
        doc.moveDown(0.6).fontSize(12).fillColor("#7A3414").text(line.text, { lineGap: 4 });
        break;
      case "tag":
        doc
          .font("Helvetica-BoldOblique")
          .fontSize(8)
          .fillColor("#C2542A")
          .text(line.text.toUpperCase(), { lineGap: 4 });
        doc.font("Helvetica");
        break;
      default:
        doc.fontSize(10).fillColor("#111111").text(line.text, { lineGap: 4 });
        break;
    }
  }

  doc.end();
  const buffer = await done;

  return new NextResponse(new Blob([Uint8Array.from(buffer)]), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${title.toLowerCase().replace(/ /g, "_")}.pdf"`,
    },
  });
}

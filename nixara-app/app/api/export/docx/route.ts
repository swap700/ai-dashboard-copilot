import { NextRequest, NextResponse } from "next/server";
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
} from "docx";
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

  const children: Paragraph[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Role: ${who}   |   Decision: ${decision}   |   Horizon: ${timeframe}`,
          size: 18,
        }),
      ],
    }),
    new Paragraph({ text: "" }),
  ];

  for (const line of parseReportLines(reportText)) {
    switch (line.kind) {
      case "blank":
        children.push(new Paragraph({ text: "" }));
        break;
      case "heading":
        children.push(new Paragraph({ text: line.text, heading: HeadingLevel.HEADING_2 }));
        break;
      case "numbered":
        // The AI's own output already includes the "1. " prefix — render as plain text
        // rather than also applying Word's auto-numbering (which would double it).
        children.push(new Paragraph({ text: line.text }));
        break;
      case "bullet":
        children.push(new Paragraph({ text: line.text, bullet: { level: 0 } }));
        break;
      case "text":
        children.push(new Paragraph({ text: line.text }));
        break;
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: { margin: { top: 1440, bottom: 1440, left: 1728, right: 1728 } },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);

  return new NextResponse(new Blob([Uint8Array.from(buffer)]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${title.toLowerCase().replace(/ /g, "_")}.docx"`,
    },
  });
}

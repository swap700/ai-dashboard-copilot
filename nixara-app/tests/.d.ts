import { findUnverifiedFigures } from "../lib/evidence.ts";
const facts = [{ value: 13363704.06, isPercent: false, description: "Duplicate billing" }];
for (const t of ["Duplicates carry $13.4 million in billing.", "Duplicates carry $19.8 million in billing.", "Duplicates carry $13,363,704.00 in billing."]) {
  console.log(JSON.stringify(t.slice(16, 40)), "->", JSON.stringify(findUnverifiedFigures(t, facts)));
}

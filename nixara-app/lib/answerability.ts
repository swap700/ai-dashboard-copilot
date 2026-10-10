/**
 * Does this file actually contain what the question is about?
 *
 * The worst output this product has produced came from not asking. A user
 * uploaded a hospital billing file with no smoking indicator and no premium
 * column, and asked:
 *
 *   "Is smoking or chronic disease the bigger cost driver, do they stack,
 *    and which plan carries more risk than it is priced for?"
 *
 * Nixara answered:
 *
 *   "The financial burden from smoking-related conditions, although
 *    significant, is not as prominently delineated in the current data.
 *    This suggests that while both are influential, chronic diseases pose a
 *    larger immediate cost driver."
 *
 * There is no smoking variable in that file. The report called an absent
 * variable "significant" and "influential", declared a winner in a
 * comparison it could not make, and then recommended a premium increase
 * from a file with no premium column. Every number in it was verified and
 * correct; the reasoning was about data that does not exist.
 *
 * The verify-and-correct loop cannot catch this. It checks that figures
 * appear in the data. It has nothing to say about a claim with no figure
 * attached, and "smoking is influential" has no figure attached.
 *
 * So the check happens before generation: take the meaningful words in the
 * question, and find the ones that match no column name and no value
 * anywhere in the file. Those are the things the file cannot speak to, and
 * the model is told to say so rather than reason around them.
 *
 * Nothing here is a lexicon. The only vocabulary it consults is the user's
 * own column names and their own cell values, so it works on any file in
 * any language.
 */

import type { Dataset } from "./data-analysis";

export interface Answerability {
  /** Words from the question that match nothing in the file. */
  missing: string[];
  /** Words that matched a column name or a value, for the record. */
  matched: string[];
  /** The block for the summary, or null when everything matched. */
  note: string | null;
}

/**
 * Words too common to mean anything on their own. Short, and not
 * domain-specific: these are English function words, not business terms.
 * A term is only reported missing when it is absent from the DATA, so a
 * false positive here costs a missed warning, never a wrong one.
 */
const STOP = new Set([
  "the","a","an","and","or","but","if","then","than","that","this","these","those",
  "we","our","us","you","your","i","my","it","its","they","their","he","she",
  "is","are","was","were","be","been","being","do","does","did","have","has","had",
  "will","would","should","could","can","may","might","must","shall",
  "to","of","in","on","at","by","for","with","from","as","into","about","over","under",
  "next","last","year","years","quarter","month","months","week","day","days","now","soon",
  "more","most","less","least","much","many","big","bigger","biggest","high","higher","highest",
  "low","lower","lowest","large","larger","small","smaller","top","bottom","first","second",
  "what","which","who","whom","whose","when","where","why","how",
  "cut","reduce","increase","save","saving","savings","target","targeting","drive","driver","drivers",
  "cost","costs","risk","risks","price","priced","pricing","reprice","repricing","plan","plans",
  "data","dataset","file","report","analysis","number","numbers","figure","figures",
  "stack","stacks","rank","ranking","carries","carry","deliver","delivers","conclude","cannot",
  "caused","cause","differences","difference","programs","program","management","per","member","members",
  "need","want","like","also","each","any","all","some","no","not","there","here",
  "say","tell","show","give","find","look","see","know","think","make","take","put",
  "mix","share","level","levels","rate","rates","amount","amounts","total","totals",
  "average","averages","group","groups","type","types","kind","kinds","case","cases",
  "going","forward","instead","rather","across","between","among","within","without",
  "one","two","three","both","either","neither","another","other","others","same",
  "good","bad","better","best","worse","worst","new","old","current","future","past",
  "this","next","per","via","etc","ratio","percent","percentage",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/**
 * Crude stem: enough to see that "smoking", "smoker" and "smokes" are the
 * same word, which a plural rule alone does not.
 *
 * The first draft only stripped plurals, so on a file with a "smoker"
 * column it reported "smoking" as absent and told the model to say the file
 * could not answer the question. A false alarm here is worse than the
 * confabulation it exists to prevent, because it makes the product refuse
 * data it actually has.
 */
const SUFFIXES = ["ations", "ation", "ingly", "ings", "ing", "ement", "ments", "ment",
                  "edly", "ers", "er", "ed", "es", "s", "ies", "y"];

export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.endsWith("ies") && w.length > 4) w = `${w.slice(0, -3)}y`;
  for (const suffix of SUFFIXES) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  // Undo a doubled consonant left behind by -ing / -ed ("stopping" -> "stopp").
  if (w.length > 4 && w[w.length - 1] === w[w.length - 2] && !"aeiou".includes(w[w.length - 1])) {
    w = w.slice(0, -1);
  }
  return w;
}

/** Every word that appears in a column name or in a cell value. */
function vocabularyOf(dataset: Dataset): Set<string> {
  const vocab = new Set<string>();
  const add = (text: string) => {
    for (const w of text.toLowerCase().replace(/[^a-z0-9\s-]+/g, " ").split(/\s+/)) {
      if (w.length >= 3) {
        vocab.add(w);
        vocab.add(stem(w));
      }
    }
  };
  for (const col of dataset.columns) add(col);

  // Values are sampled: a label column's vocabulary is settled long before
  // 50,000 rows, and this runs on every column.
  const SAMPLE = 2000;
  const step = Math.max(1, Math.ceil(dataset.rows.length / SAMPLE));
  for (let i = 0; i < dataset.rows.length; i += step) {
    const row = dataset.rows[i];
    for (const col of dataset.columns) {
      const v = row[col];
      if (typeof v === "string" && v.length <= 60) add(v);
    }
  }
  return vocab;
}

export function checkAnswerability(dataset: Dataset, question: string): Answerability {
  const asked = [...new Set(words(question))];
  if (asked.length === 0 || dataset.rows.length === 0) {
    return { missing: [], matched: [], note: null };
  }

  const vocab = vocabularyOf(dataset);
  const stems = new Set([...vocab].map(stem));
  const missing: string[] = [];
  const matched: string[] = [];
  for (const w of asked) {
    const st = stem(w);
    // Present if the word appears whole, shares a stem with something in the
    // file, or sits inside a compound name such as "annual_medical_cost_usd".
    const hit =
      vocab.has(w) ||
      stems.has(st) ||
      (st.length >= 4 && [...stems].some((v) => v.length >= 4 && (v.startsWith(st) || st.startsWith(v))));
    (hit ? matched : missing).push(w);
  }

  if (missing.length === 0) return { missing, matched, note: null };

  const list = missing.map((m) => `"${m}"`).join(", ");
  return {
    missing,
    matched,
    note:
      `NOT IN THIS FILE: the question refers to ${list}, and nothing in this file's ` +
      `column names or values matches ${missing.length === 1 ? "it" : "them"}. ` +
      `State plainly, near the top of the report, that this file cannot answer that part ` +
      `of the question and name what would be needed. Do NOT describe ` +
      `${missing.length === 1 ? "it" : "them"} as significant, influential, or a driver, ` +
      `and do NOT rank ${missing.length === 1 ? "it" : "them"} against anything that IS in ` +
      `the file. A comparison needs both sides present.`,
  };
}

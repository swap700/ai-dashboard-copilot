/**
 * Every word list in Nixara that depends on what language a file is written in.
 *
 * They are here together because they keep going wrong together. The
 * aggregation lexicon was English only, so a German export's Umsatz column was
 * averaged instead of totalled and every figure built on it was wrong in a way
 * that looks right. The identifier lexicon had the same hole, which is how
 * "Bestellnummer" was ranked as a business metric. Then outcomeRegion's
 * confounder lead-ins turned out to be English only too - the same trap, found
 * a third time, in a third file.
 *
 * So: one place. When the next language has to be supported, or the next
 * list added, this is the file to open. Nothing here knows about datasets or
 * columns; it is vocabulary and nothing else.
 *
 * Coverage is deliberately uneven and that is fine. These lists are hints
 * that value SHAPE overrules (see column-roles.ts), so a missing word costs a
 * worse guess, never a wrong parse. Shape travels across languages; words do
 * not.
 */

/** Naive English singularization, applied to both the lists and the input. */
export function singularize(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  // Only strip "-es" for the sibilant-plural pattern (boxes->box, matches->match,
  // wishes->wish) — NOT for words that just add "s" to a base ending in "e"
  // (rates->rate, sales->sale), which the "s"-strip rule below already handles.
  if (word.length > 4 && /(?:[sxz]|[cs]h)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export const SUM_KEYWORDS = new Set(
  [
    "sales", "revenue", "profit", "income", "earnings", "cost", "costs", "price",
    "amount", "total", "spend", "spending", "expense", "expenses", "budget",
    "quantity", "qty", "units", "volume", "billing", "charge", "charges", "fee",
    "fees", "payment", "payments", "count", "visits", "orders", "transactions",
    // Additive things whose names are single compound words, so they can no
    // longer be caught by a substring match on "count" and friends.
    "headcount", "hours", "items", "tickets", "claims", "invoices",

    // Not English. A German export's "Umsatz" column is revenue, and it was
    // being AVERAGED, because the default for an unrecognised name is mean.
    // Every figure downstream of that is wrong and none of them look wrong:
    // an average revenue per row is a perfectly plausible number. The
    // column-role resolver was already made language-aware for identifiers
    // (Bestellnummer); this is the same gap on the aggregation side.
    // German
    "umsatz", "erloes", "erlös", "einnahmen", "kosten", "preis", "betrag", "summe",
    "menge", "anzahl", "gebuehr", "gebühr", "zahlung", "ausgaben", "gewinn",
    "verkauf", "stueck", "stück", "honorar", "rechnung", "aufwand",
    // Spanish and Portuguese
    "ventas", "venta", "ingresos", "ingreso", "receita", "receitas", "beneficio",
    "lucro", "coste", "costo", "custo", "precio", "preco", "preço", "importe",
    "cantidad", "quantidade", "monto", "gasto", "gastos", "pago", "pagos",
    "factura", "facturacion", "despesa", "despesas", "unidades", "faturamento",
    // French
    "ventes", "vente", "recettes", "recette", "revenu", "revenus", "cout", "coût",
    "couts", "coûts", "prix", "montant", "quantite", "quantité", "depense",
    "dépense", "depenses", "dépenses", "paiement", "benefice", "bénéfice",
    "frais", "honoraires", "chiffre",
    // Italian
    "vendite", "ricavi", "costi", "prezzo", "quantita", "quantità", "spesa",
    "spese", "pagamento", "utile", "fatturato",
    // Dutch
    "omzet", "opbrengst", "prijs", "bedrag", "aantal", "hoeveelheid", "uitgaven",
    "winst", "betaling",
    // Nordic
    "omsaettning", "omsättning", "omsetning", "intaekter", "intäkter", "indtaegter",
    "kostnad", "kostnader", "pris", "belop", "beløp", "belopp", "antal", "antall",
    "mengde", "utgifter", "vinst", "fortjeneste",
  ].map(singularize)
);

export const MEAN_KEYWORDS = new Set(
  [
    "average", "avg", "mean", "rate", "ratio", "margin", "score", "pct", "percent",
    "percentage", "age", "duration", "tenure", "bmi", "height", "weight", "index",
    "level", "days", "years", "months", "rating", "satisfaction", "length",
    "distance", "temperature", "speed", "density", "concentration",

    // Not English, same reason as the sum list above. These are checked
    // FIRST, so anything here beats the sum list on a collision.
    // German
    "durchschnitt", "mittelwert", "quote", "anteil", "prozent", "alter", "dauer",
    "groesse", "größe", "gewicht", "bewertung", "stufe", "tage", "jahre", "monate",
    "geschwindigkeit", "laenge", "länge", "verhaeltnis", "verhältnis",
    // Spanish and Portuguese
    "promedio", "media", "medio", "medio", "medios", "tasa", "porcentaje",
    "percentual", "proporcion", "proporción", "proporcao", "proporção", "margen",
    "margem", "edad", "idade", "duracion", "duración", "duracao", "duração",
    "altura", "puntuacion", "puntuación", "nota", "calificacion", "nivel", "dias",
    "días", "anos", "años", "meses", "velocidad", "velocidade",
    // French
    "moyenne", "moyen", "taux", "pourcentage", "proportion", "marge", "âge",
    "duree", "durée", "poids", "taille", "niveau", "jours", "annees", "années",
    "mois", "vitesse",
    // Italian
    "tasso", "percentuale", "proporzione", "margine", "eta", "età", "durata",
    "altezza", "voto", "livello", "giorni", "anni", "mesi", "velocita", "velocità",
    // Dutch
    "gemiddelde", "gemiddeld", "tarief", "percentage", "verhouding", "leeftijd",
    "duur", "lengte", "niveau", "dagen", "jaren", "maanden", "snelheid",
  ].map(singularize)
);

export const MEAN_SUBSTRINGS = [
  "durchschnitt", "mittelwert", "gemiddeld", "promedio", "moyenne",
  "percent", "prozent", "prosent", "percentuale", "porcentaje",
];
export const SUM_SUBSTRINGS = [
  "umsatz", "betrag", "kosten", "erloes", "erlös", "einnahme", "ausgabe",
  "gewinn", "anzahl", "gebuehr", "gebühr", "zahlung", "rechnung", "honorar",
  "fatturato", "faturamento", "omzet", "opbrengst", "importe", "montant",
  "bedrag", "omsaettning", "omsättning", "omsetning", "kostnad",
];


export const NON_IDENTIFYING_NAME_WORDS = new Set([
  "year", "years", "yearly", "annual", "annually", "month", "monthly", "months",
  "week", "weekly", "weeks", "day", "daily", "days", "quarter", "quarterly",
  "date", "time", "period", "ytd", "mtd", "qtd", "fy",
  "usd", "eur", "gbp", "inr", "cad", "aud", "jpy", "chf", "sek", "nok", "dkk",
  "amt", "num", "no", "qty", "pct", "percent", "total", "sum", "avg", "average",
  "value", "values", "val", "data", "field", "column", "col",
]);

export const CONFOUNDER_LEAD_INS = [
  // English
  "caused by", "explained by", "due to", "because of", "driven by",
  "controlling for", "controlled for", "adjusting for", "adjusted for",
  "accounting for", "accounted for by", "attributable to", "attributed to",
  "confounded by", "net of", "after allowing for", "allowing for",
  "holding", "once you allow for", "once we allow for", "independent of",
  // German
  "verursacht durch", "bedingt durch", "aufgrund von", "wegen",
  "unter beruecksichtigung von", "unter berücksichtigung von",
  "bereinigt um", "kontrolliert fuer", "kontrolliert für", "erklaert durch",
  "erklärt durch",
  // Spanish
  "causado por", "causada por", "explicado por", "explicada por",
  "debido a", "ajustado por", "ajustada por", "controlando por",
  "teniendo en cuenta",
  // Portuguese
  "causado pelo", "causado pela", "explicado por", "devido a", "devido ao",
  "ajustado por", "controlando por", "tendo em conta",
  // French
  "cause par", "causé par", "causee par", "causée par", "explique par",
  "expliqué par", "du a", "dû à", "en raison de", "ajuste pour",
  "ajusté pour", "en tenant compte de", "net de",
  // Italian
  "causato da", "causata da", "spiegato da", "spiegata da", "dovuto a",
  "dovuta a", "aggiustato per", "tenendo conto di",
  // Dutch
  "veroorzaakt door", "verklaard door", "vanwege", "gecorrigeerd voor",
  "rekening houdend met",
];

/**
 * German and Dutch are verb-final: the confounder sits BETWEEN the preposition
 * and the verb ("welche Unterschiede durch das Alter verursacht werden"), so a
 * lead-in match on "verursacht durch" never fires and a trailer match on
 * modal-then-verb does not either. These catch the sandwich.
 */
export const CONFOUNDER_SANDWICH =
  /\b(?:durch|door)\s+([^.?!;]*?)\s+(?:verursacht|bedingt|erklaert|erklärt|veroorzaakt|verklaard)\b/gi;

/** Verb-final modal order: "erklaeren kann" rather than "kann erklaeren". */
export const CONFOUNDER_TRAILERS_VERB_FINAL =
  /\b([^.?!;]*?)\s+(?:erklaeren|erklären|verklaren|erklaert|erklärt)\s+(?:kann|koennte|könnte|kunnen|kan)\b/gi;

export const CONFOUNDER_TRAILERS =
  /\b([^.?!;]*?)\s+(?:might|may|could|would|kann|koennte|könnte|puede|podria|podría|pourrait|peut|potrebbe|kan)\s+(?:explain|explains|account for|be behind|be driving|be the cause|erklaeren|erklären|explicar|expliquer|spiegare|verklaren)\b/gi;

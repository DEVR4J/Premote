// eCourts import helpers.
//
// The eCourts website protects its search with a captcha and rotating anti-automation headers, so the
// app does NOT call it behind the scenes. Instead the advocate searches on the official site in the
// phone's browser, copies the result list, and pastes it here. This file turns that pasted text into
// case records and works out which ones are new.

export const ECOURTS_URL = 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index';

export type EcCase = { key: string; cnr: string; caseNumber: string; title: string; court: string; status: string };

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
// e.g. "CC/123/2021", "Regular Civil Suit/45/2019", "Cri. Misc. Bail Application/ 7 /2024"
const CASE_NO = /([A-Za-z][A-Za-z0-9 .&()'-]{0,60}?)\s*\/\s*(\d{1,7})\s*\/\s*((?:19|20)\d{2})\b/;
const NOISE = /^(view|sr\.?\s*no\.?|s\.?\s*no\.?|case\s*(type\s*\/\s*)?number|case\s*no\.?|party\s*name|petitioner\s*(vs|v\/s)\s*respondent|advocate|status|\d{1,4})$/i;
const COURT = /\b(court|judge|magistrate|munsif|sessions|tribunal|commission|collector)\b/i;
const CNR = /\b([A-Z]{4}\d{12})\b/;

/** Turns text copied from the eCourts advocate-search result page into case records. */
export function parsePasted(text: string, status = 'Pending'): EcCase[] {
  const lines = text.replace(/\r/g, '').split(/\n/).flatMap(l => l.split(/\t+/)).map(clean).filter(Boolean);
  const out: EcCase[] = [];
  let court = '';
  let cur: { caseNumber: string; parts: string[]; court: string; cnr: string } | null = null;
  const flush = () => {
    if (!cur) return;
    const title = clean(cur.parts.join(' ')).replace(/\s*\b(?:vs\.?|v\/s|versus)\b\s*/i, ' vs ').trim();
    out.push({ key: cur.cnr || `${cur.court}|${cur.caseNumber}`, cnr: cur.cnr, caseNumber: cur.caseNumber, title, court: cur.court, status });
    cur = null;
  };
  for (const line of lines) {
    const cnr = line.match(CNR)?.[1] || '';
    const m = line.match(CASE_NO);
    if (m && !/\bvs\b/i.test(m[1] ?? '')) {
      flush();
      const caseNumber = `${clean(m[1] ?? '')}/${m[2]}/${m[3]}`;
      cur = { caseNumber, parts: [], court, cnr };
      const rest = clean(line.replace(m[0], ' '));
      if (rest && !NOISE.test(rest)) cur.parts.push(rest);
      continue;
    }
    if (COURT.test(line) && !/\bvs\b/i.test(line) && line.length < 120 && !NOISE.test(line)) { flush(); court = line; continue; }
    if (cur && cnr && !cur.cnr) cur.cnr = cnr;
    if (cur && !NOISE.test(line) && !/^(page|showing|total|records?)\b/i.test(line)) cur.parts.push(line);
  }
  flush();
  return out.filter(c => c.caseNumber && (c.title || c.caseNumber));
}

/** Which found cases are new vs already in the app (matched by CNR, else court + case number). */
export function splitNewAndKnown(found: EcCase[], existing: { cnr?: string; caseNumber?: string; court: string }[]) {
  const known = new Set<string>();
  existing.forEach(c => { if (c.cnr) known.add(c.cnr); if (c.caseNumber) known.add(`${c.court}|${c.caseNumber}`); });
  const isKnown = (f: EcCase) => (f.cnr && known.has(f.cnr)) || known.has(`${f.court}|${f.caseNumber}`);
  return { fresh: found.filter(f => !isKnown(f)), known: found.filter(isKnown) };
}

// ---------------------------------------------------------------------------------------------
// One case: text copied from a single case's "Case Details" page on eCourts.
// ---------------------------------------------------------------------------------------------
export type CaseDetails = { cnr: string; caseNumber: string; title: string; court: string; status: string; initialDate: string; nextHearing: string; stage: string };

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '');
/** Understands "26th November 2026", "26-11-2026" and "26/11/2026". Returns YYYY-MM-DD or ''. */
export function parseCourtDate(s: string): string {
  const a = s.match(/(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{4})/);
  if (a) { const m = MONTHS[(a[2] ?? '').slice(0, 3).toLowerCase()]; if (m) return iso(+(a[3] ?? 0), m, +(a[1] ?? 0)); }
  const b = s.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  return b ? iso(+(b[3] ?? 0), +(b[2] ?? 0), +(b[1] ?? 0)) : '';
}

const LABELS = /^(case type|filing number|filing date|registration number|registration date|cnr number|first hearing date|decision date|next hearing date|case stage|nature of disposal|court number and judge|petitioner and advocate|respondent and advocate|acts|subordinate court information|fir details|case history|interim orders|orders|objections|process details|business on date)\b/i;

/** Reads the details page of one case. Returns null when the text doesn't look like one. */
export function parseCaseDetails(text: string): CaseDetails | null {
  const lines = text.replace(/\r/g, '').split('\n').flatMap(l => l.split(/\t+/)).map(clean).filter(Boolean);
  const value = (label: RegExp) => {
    const i = lines.findIndex(l => label.test(l));
    if (i < 0) return '';
    const line = lines[i] ?? '';
    const same = clean(line.replace(label, '').replace(/^[\s:\-–]+/, ''));
    if (same) return same;
    const next = lines[i + 1] ?? '';
    return LABELS.test(next) ? '' : next;
  };
  const cnr = text.match(CNR)?.[1] || '';
  const caseType = value(/^case type\b/i);
  const regNo = value(/^registration number\b/i) || value(/^filing number\b/i);
  const caseNumber = regNo ? (/[A-Za-z]/.test(regNo) ? regNo : `${caseType ? `${caseType}/` : ''}${regNo}`) : '';
  const section = (start: RegExp) => {
    const i = lines.findIndex(l => start.test(l)); if (i < 0) return '';
    const out: string[] = [];
    const first = clean((lines[i] ?? '').replace(start, '').replace(/^[\s:\-–]+/, '')); if (first) out.push(first);
    for (let j = i + 1; j < lines.length; j++) { const l = lines[j] ?? ''; if (LABELS.test(l)) break; out.push(l); }
    return out.filter(l => !/^advocate\b/i.test(l)).map(l => l.replace(/^\d+\s*[).]\s*/, '').replace(/\s*Advocate\s*[-–:].*$/i, '')).filter(Boolean).join(', ');
  };
  const pet = section(/^petitioner and advocate\b/i), res = section(/^respondent and advocate\b/i);
  const title = pet && res ? `${pet} vs ${res}` : pet || res;
  const initialDate = parseCourtDate(value(/^registration date\b/i)) || parseCourtDate(value(/^filing date\b/i));
  const nextHearing = parseCourtDate(value(/^next hearing date\b/i));
  const decided = /\bdecision date\b/i.test(text) && parseCourtDate(value(/^decision date\b/i)) !== '' || /case disposed/i.test(text);
  if (!title && !caseNumber && !cnr) return null;
  if (!title) return null;
  return { cnr, caseNumber, title, court: value(/^court number and judge\b/i), status: decided ? 'Disposed' : 'Pending', initialDate, nextHearing, stage: value(/^case stage\b/i) };
}

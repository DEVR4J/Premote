// eCourts (services.ecourts.gov.in) case-status client for advocate search.
//
// IMPORTANT
// - This is NOT an official API. It talks to the same pages a person uses in a browser, so the
//   endpoint/field names below can change without notice. Everything that is site-specific is in
//   the ENDPOINTS / FIELDS constants so it is easy to adjust after testing on a real device.
// - The site requires a captcha for every search. This client never solves or bypasses it: the
//   captcha image is shown to the advocate, who types it in.
// - Requests use CapacitorHttp (native HTTP) so they work inside the Android app. In a normal
//   browser the site's CORS rules block them, so sync only works in the installed app.
import { Capacitor, CapacitorHttp } from '@capacitor/core';

export const BASE = 'https://services.ecourts.gov.in/ecourtindia_v6/';

const ENDPOINTS = {
  home: `${BASE}?p=casestatus/index`,
  districts: `${BASE}?p=casestatus/fillDistrict`,
  complexes: `${BASE}?p=casestatus/fillcomplex`,
  captcha: `${BASE}vendor/securimage/securimage_show.php`,
  advocateSearch: `${BASE}?p=casestatus/submitAdvName`,
};

export type SearchBy = 'name' | 'bar';
export type StatusFilter = 'Pending' | 'Disposed' | 'Both';
export type Option = { value: string; label: string };
export type EcCase = { key: string; cnr: string; caseNumber: string; title: string; court: string; status: StatusFilter | string };
export type Session = { token: string };

export class EcourtsError extends Error {}

export const canSyncHere = () => Capacitor.isNativePlatform();

const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';

async function http(url: string, opts: { method?: 'GET' | 'POST'; body?: Record<string, string>; binary?: boolean } = {}) {
  if (!canSyncHere()) throw new EcourtsError('Court sync works only in the installed Android app (a web browser is blocked by the court site).');
  try {
    const res = await CapacitorHttp.request({
      url,
      method: opts.method || 'GET',
      headers: { 'User-Agent': UA, Accept: '*/*', 'X-Requested-With': 'XMLHttpRequest', ...(opts.body ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}) },
      data: opts.body ? new URLSearchParams(opts.body).toString() : undefined,
      responseType: opts.binary ? 'blob' : 'text',
      connectTimeout: 20000,
      readTimeout: 30000,
    });
    if (res.status >= 400) throw new EcourtsError(`The court website returned an error (${res.status}). Try again later.`);
    return res.data as unknown;
  } catch (e) {
    if (e instanceof EcourtsError) throw e;
    throw new EcourtsError('Could not reach the court website. Check your internet connection and try again.');
  }
}

/** Parses an eCourts reply that is normally JSON, but may be JSON-looking text or raw HTML. */
export function parseReply(data: unknown): Record<string, unknown> {
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  const text = String(data ?? '').replace(/^﻿/, '').trim();
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { html: text }; }
}

const htmlOf = (reply: Record<string, unknown>) => Object.values(reply).filter((v): v is string => typeof v === 'string' && /<(table|tr|option)\b/i.test(v)).join('\n');

export function parseOptions(html: string): Option[] {
  const doc = new DOMParser().parseFromString(`<select>${html}</select>`, 'text/html');
  return Array.from(doc.querySelectorAll('option'))
    .map(o => ({ value: (o.getAttribute('value') || '').trim(), label: (o.textContent || '').trim() }))
    .filter(o => o.value && o.value !== '0' && !/^select/i.test(o.label));
}

const clean = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();

/** Turns the result tables returned by an advocate search into case records. */
export function parseCases(html: string, status: string): EcCase[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: EcCase[] = [];
  let court = '';
  doc.querySelectorAll('tr').forEach(tr => {
    const cells = Array.from(tr.querySelectorAll('td,th'));
    const text = cells.map(c => clean(c.textContent));
    if (cells.length <= 1 || cells.some(c => c.hasAttribute('colspan') && Number(c.getAttribute('colspan')) > 2)) {
      const t = text.join(' ').trim();
      if (t && !/^(sr|case)/i.test(t)) court = t;
      return;
    }
    if (cells[0]?.tagName === 'TH') return;
    const onclick = Array.from(tr.querySelectorAll('[onclick]')).map(e => e.getAttribute('onclick') || '').find(s => /viewHistory/i.test(s)) || '';
    const args = (onclick.match(/viewHistory\(([^)]*)\)/i)?.[1] || '').split(',').map(a => a.replace(/['"\s]/g, ''));
    const cnr = args[1] || '';
    const dataCells = text.filter(t => t && !/^view$/i.test(t));
    const caseNumber = dataCells.find((t, i) => i > 0 && /\d/.test(t) && /[\/-]\s*\d{4}/.test(t)) || dataCells[1] || '';
    const title = dataCells.find((t, i) => i > 0 && t !== caseNumber && /\bvs\b/i.test(t)) || dataCells.find((t, i) => i > 0 && t !== caseNumber) || '';
    if (!caseNumber && !title) return;
    out.push({ key: cnr || `${court}|${caseNumber}`, cnr, caseNumber, title: title.replace(/\s*vs\.?\s*/i, ' vs '), court, status });
  });
  return out;
}

/** Reads the home page ONCE: the session token and the state list must come from the same page load,
 *  because the site issues a new token on every page load and rejects older ones. */
export async function openSession(): Promise<{ session: Session; states: Option[] }> {
  const html = String(await http(ENDPOINTS.home));
  const tag = html.match(/<input[^>]*app_token[^>]*>/i)?.[0] || '';
  const token = tag.match(/value=["']([0-9a-f]{16,})["']/i)?.[1]
    || html.match(/app_token["']?\s*[:=]\s*["']?([0-9a-f]{32,})/i)?.[1]
    || html.match(/app_token=([0-9a-f]{32,})/i)?.[1] || '';
  const sel = html.match(/<select[^>]*(?:id|name)=["']sess_state_code["'][^>]*>([\s\S]*?)<\/select>/i)?.[1] || '';
  const states = parseOptions(sel);
  if (!states.length) throw new EcourtsError('Could not read the state list from the court website. The site layout may have changed.');
  return { session: { token }, states };
}

async function post(session: Session, url: string, body: Record<string, string>) {
  const reply = parseReply(await http(url, { method: 'POST', body: { ...body, ajax_req: 'true', app_token: session.token } }));
  if (typeof reply.app_token === 'string' && reply.app_token) session.token = reply.app_token;
  return reply;
}

const snippet = (r: Record<string, unknown>) => JSON.stringify(r).replace(/\s+/g, ' ').slice(0, 160);

async function loadList(session: Session, url: string, body: Record<string, string>, what: string) {
  const reply = await post(session, url, body);
  const opts = parseOptions(htmlOf(reply));
  if (!opts.length) {
    const msg = typeof reply.errormsg === 'string' ? clean(reply.errormsg.replace(/<[^>]*>/g, ' ')) : '';
    throw new EcourtsError(`${what} list came back empty${msg ? `: ${msg}` : ''}. Court site reply: ${snippet(reply)}`);
  }
  return opts;
}

export const loadDistricts = (session: Session, state: string) => loadList(session, ENDPOINTS.districts, { state_code: state }, 'District');
export const loadComplexes = (session: Session, state: string, district: string) => loadList(session, ENDPOINTS.complexes, { state_code: state, dist_code: district }, 'Court complex');

/** Returns a data: URL of a fresh captcha image tied to this session. */
export async function loadCaptcha(): Promise<string> {
  const data = await http(`${ENDPOINTS.captcha}?${Date.now()}`, { binary: true });
  const b64 = typeof data === 'string' ? data : '';
  if (!b64) throw new EcourtsError('Could not load the captcha image.');
  return `data:image/png;base64,${b64}`;
}

export type SearchInput = { by: SearchBy; value: string; status: StatusFilter; state: string; district: string; complex: string; captcha: string };

/** Validates the advocate-entered search text before any network call. */
export function validateSearch(by: SearchBy, value: string): string {
  const v = value.trim();
  if (by === 'name') return v.length < 3 ? 'Enter at least 3 characters of the advocate name.' : '';
  return /^[A-Za-z]{1,5}\s*\/\s*\d+\s*\/\s*\d{4}$/.test(v) ? '' : 'Enter the Bar ID like MAH/1234/1982 (State code / number / year).';
}

export async function searchAdvocate(session: Session, input: SearchInput): Promise<EcCase[]> {
  const err = validateSearch(input.by, input.value);
  if (err) throw new EcourtsError(err);
  if (!input.state || !input.district || !input.complex) throw new EcourtsError('Choose the state, district and court complex to search.');
  if (!input.captcha.trim()) throw new EcourtsError('Type the captcha shown in the picture.');
  const [complexCode, estCodes = ''] = input.complex.split('@');
  const body: Record<string, string> = {
    radAdvt: input.by === 'name' ? '1' : '2',
    case_status: input.status,
    fcaptcha_code: input.captcha.trim(),
    state_code: input.state,
    dist_code: input.district,
    court_complex_code: complexCode ?? '',
    est_code: estCodes.split(',')[0] || '',
  };
  if (input.by === 'name') body.advocate_name = input.value.trim();
  else {
    const [st, no, yr] = input.value.split('/').map(s => s.trim());
    body.bar_state_code = st ?? ''; body.bar_code = no ?? ''; body.bar_year = yr ?? ''; body.barcode = input.value.replace(/\s/g, '');
  }
  const reply = await post(session, ENDPOINTS.advocateSearch, body);
  const msg = typeof reply.errormsg === 'string' ? clean(reply.errormsg.replace(/<[^>]*>/g, ' ')) : '';
  const html = htmlOf(reply);
  const cases = html ? parseCases(html, input.status) : [];
  if (cases.length) return cases;
  if (/captcha/i.test(msg)) throw new EcourtsError('The captcha was wrong. A new one has been loaded — please try again.');
  if (msg) throw new EcourtsError(msg);
  if (html || reply.html !== undefined || Object.keys(reply).length) return [];
  throw new EcourtsError('The court website sent an unexpected reply.');
}

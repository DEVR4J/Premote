import React, { useEffect, useRef, useState } from 'react';
import { EcCase, EcourtsError, Option, SearchBy, Session, StatusFilter, canSyncHere, loadCaptcha, loadComplexes, loadDistricts, openSession, searchAdvocate, validateSearch } from './ecourts';

export type SyncedCase = { cnr: string; caseNumber: string; title: string; court: string; status: string };
const PREF_KEY = 'advocate-ecourts-v1';
type Prefs = { by: SearchBy; value: string; status: StatusFilter; state: string; district: string; complex: string };
const defaults: Prefs = { by: 'name', value: '', status: 'Pending', state: '', district: '', complex: '' };
const loadPrefs = (): Prefs => { try { return { ...defaults, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { return defaults; } };

/** Pure: which fetched cases are new vs already in the app (matched by CNR, else court + case number). */
export function splitNewAndKnown(found: EcCase[], existing: { cnr?: string; caseNumber?: string; court: string }[]) {
  const known = new Set<string>();
  existing.forEach(c => { if (c.cnr) known.add(c.cnr); if (c.caseNumber) known.add(`${c.court}|${c.caseNumber}`); });
  const isKnown = (f: EcCase) => (f.cnr && known.has(f.cnr)) || known.has(`${f.court}|${f.caseNumber}`);
  return { fresh: found.filter(f => !isKnown(f)), known: found.filter(isKnown) };
}

type Props = { defaultName: string; defaultBarId: string; existing: { cnr?: string; caseNumber?: string; court: string }[]; onImport: (cases: SyncedCase[]) => void };

export default function ECourtsSync({ defaultName, defaultBarId, existing, onImport }: Props) {
  const [p, setP] = useState<Prefs>(() => { const s = loadPrefs(); return s.value ? s : { ...s, value: defaultName && !/^your name$/i.test(defaultName) ? defaultName : '' }; });
  const [states, setStates] = useState<Option[]>([]); const [districts, setDistricts] = useState<Option[]>([]); const [complexes, setComplexes] = useState<Option[]>([]);
  const [captchaImg, setCaptchaImg] = useState(''); const [captcha, setCaptcha] = useState('');
  const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  const [found, setFound] = useState<EcCase[] | null>(null); const [picked, setPicked] = useState<Set<string>>(new Set());
  const session = useRef<Session>({ token: '' });
  const native = canSyncHere();
  const patch = (x: Partial<Prefs>) => setP(prev => { const next = { ...prev, ...x }; try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ } return next; });
  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => { setBusy(label); setError(''); try { return await fn(); } catch (e) { setError(e instanceof EcourtsError ? e.message : 'Something went wrong. Please try again.'); } finally { setBusy(''); } };
  const refreshCaptcha = () => run('Loading captcha…', async () => { setCaptcha(''); setCaptchaImg(await loadCaptcha()); });

  useEffect(() => { if (!native) return; run('Connecting to eCourts…', async () => { const opened = await openSession(); session.current = opened.session; setStates(opened.states); if (p.state) { setDistricts(await loadDistricts(session.current, p.state)); if (p.district) setComplexes(await loadComplexes(session.current, p.state, p.district)); } setCaptchaImg(await loadCaptcha()); }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const pickState = (v: string) => { patch({ state: v, district: '', complex: '' }); setDistricts([]); setComplexes([]); if (v) run('Loading districts…', async () => setDistricts(await loadDistricts(session.current, v))); };
  const pickDistrict = (v: string) => { patch({ district: v, complex: '' }); setComplexes([]); if (v) run('Loading court complexes…', async () => setComplexes(await loadComplexes(session.current, p.state, v))); };
  const switchBy = (by: SearchBy) => patch({ by, value: by === 'bar' ? defaultBarId.replace(/^bar council enrolment no\.?$/i, '') : defaultName.replace(/^your name$/i, '') });

  const search = () => {
    const problem = validateSearch(p.by, p.value); if (problem) { setError(problem); return; }
    run('Searching eCourts…', async () => {
      try { const res = await searchAdvocate(session.current, { ...p, captcha }); setFound(res); setPicked(new Set(splitNewAndKnown(res, existing).fresh.map(c => c.key))); }
      catch (e) { try { setCaptchaImg(await loadCaptcha()); setCaptcha(''); } catch { /* keep original error */ } throw e; }
      setCaptchaImg(await loadCaptcha()); setCaptcha('');
    });
  };

  const { fresh, known } = found ? splitNewAndKnown(found, existing) : { fresh: [], known: [] };
  const importPicked = () => { const chosen = fresh.filter(c => picked.has(c.key)); onImport(chosen.map(c => ({ cnr: c.cnr, caseNumber: c.caseNumber, title: c.title, court: c.court, status: c.status === 'Both' ? 'Pending' : c.status }))); setFound(null); };

  return <div className="ecourts-sync">
    <div className="notice-card">Your cases are fetched from the public eCourts website. You type the captcha each time, exactly as on the website. Results are only as complete as that site; check important dates there too.</div>
    {!native && <div className="notice-card">Court sync needs the installed Android app. Web browsers are blocked by the court website.</div>}
    <div className="settings-row"><span>Search by</span><select aria-label="Search by" value={p.by} onChange={e => switchBy(e.target.value as SearchBy)}><option value="name">Advocate name</option><option value="bar">Bar registration no.</option></select></div>
    <div className="settings-row"><span>{p.by === 'name' ? 'Name' : 'Bar ID'}</span><input type="text" aria-label={p.by === 'name' ? 'Advocate name' : 'Bar ID'} placeholder={p.by === 'name' ? 'Advocate name' : 'MAH/1234/1982'} value={p.value} onChange={e => patch({ value: e.target.value })} /></div>
    <div className="settings-row"><span>Cases</span><select aria-label="Case status" value={p.status} onChange={e => patch({ status: e.target.value as StatusFilter })}><option value="Pending">Pending</option><option value="Disposed">Disposed</option><option value="Both">Both</option></select></div>
    <div className="settings-row"><span>State</span><select aria-label="State" value={p.state} onChange={e => pickState(e.target.value)}><option value="">Select state</option>{states.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
    <div className="settings-row"><span>District</span><select aria-label="District" value={p.district} disabled={!districts.length} onChange={e => pickDistrict(e.target.value)}><option value="">Select district</option>{districts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
    <div className="settings-row"><span>Court complex</span><select aria-label="Court complex" value={p.complex} disabled={!complexes.length} onChange={e => patch({ complex: e.target.value })}><option value="">Select court complex</option>{complexes.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
    <div className="settings-row"><span>Captcha</span><span style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: '62%' }}>{captchaImg ? <img src={captchaImg} alt="Captcha" style={{ height: 40, borderRadius: 8, background: '#fff' }} /> : null}<button type="button" aria-label="New captcha" onClick={refreshCaptcha} disabled={!native || !!busy}>↻</button><input type="text" aria-label="Captcha text" autoComplete="off" autoCapitalize="off" value={captcha} onChange={e => setCaptcha(e.target.value)} style={{ minWidth: 0, width: '100%' }} /></span></div>
    <button className="wide-button" onClick={search} disabled={!native || !!busy}>{busy || 'Search my cases'}</button>
    {error && <div className="notice-card" role="alert">{error}</div>}
    <p className="body-copy">The court website searches one court complex at a time. To cover other courts, change the court complex and search again; cases already in the app are never duplicated.</p>
    {found && <section aria-label="Search results">
      {!found.length && <div className="empty-state">No cases found for this search in this court complex.</div>}
      {fresh.length > 0 && <><h2>New cases ({fresh.length})</h2>{fresh.map(c => <label key={c.key} className="settings-row"><input type="checkbox" checked={picked.has(c.key)} onChange={e => setPicked(prev => { const n = new Set(prev); if (e.target.checked) n.add(c.key); else n.delete(c.key); return n; })} /><span style={{ flex: 1 }}>{c.title || 'Untitled case'}<small style={{ display: 'block', opacity: .7 }}>{c.caseNumber}{c.court ? ` · ${c.court}` : ''}</small></span></label>)}<button className="wide-button" onClick={importPicked} disabled={!picked.size}>Add {picked.size} selected to my cases</button></>}
      {known.length > 0 && <p className="body-copy">{known.length} case{known.length > 1 ? 's' : ''} already in your app.</p>}
    </section>}
  </div>;
}

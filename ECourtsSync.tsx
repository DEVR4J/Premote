import React, { useState } from 'react';
import { CaseDetails, ECOURTS_URL, EcCase, parseCaseDetails, parsePasted, splitNewAndKnown } from './ecourts';

export type SyncedCase = { cnr: string; caseNumber: string; title: string; court: string; status: string; initialDate?: string; nextHearing?: string };
type Props = { defaultName: string; defaultBarId: string; existing: { cnr?: string; caseNumber?: string; court: string }[]; onImport: (cases: SyncedCase[]) => void };

export default function ECourtsSync({ defaultName, defaultBarId, existing, onImport }: Props) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('Pending');
  const [found, setFound] = useState<EcCase[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [one, setOne] = useState<CaseDetails | null>(null); const [oneMsg, setOneMsg] = useState('');
  const addFromClipboard = async () => {
    let t = ''; try { t = await navigator.clipboard.readText(); } catch { setOneMsg('Could not read the clipboard. Copy the case page again and allow pasting.'); return; }
    const d = parseCaseDetails(t); setOne(d); setOneMsg(d ? '' : 'This does not look like an eCourts case details page. Open one case on the website, Select all, Copy, then try again.');
  };
  const addOne = () => { if (!one) return; onImport([{ ...one }]); setOne(null); };
  const name = /^your name$/i.test(defaultName) ? '' : defaultName;
  const bar = /^bar council enrolment no\.?$/i.test(defaultBarId) ? '' : defaultBarId;

  const readPasted = () => { const res = parsePasted(text, status); setFound(res); setPicked(new Set(splitNewAndKnown(res, existing).fresh.map(c => c.key))); };
  const pasteFromClipboard = async () => { try { setText(await navigator.clipboard.readText()); } catch { /* user can paste manually */ } };
  const { fresh, known } = found ? splitNewAndKnown(found, existing) : { fresh: [], known: [] };
  const importPicked = () => { const chosen = fresh.filter(c => picked.has(c.key)); onImport(chosen.map(c => ({ cnr: c.cnr, caseNumber: c.caseNumber, title: c.title, court: c.court, status: c.status }))); setFound(null); setText(''); };

  return <div className="ecourts-sync">
    <div className="notice-card">The eCourts website blocks apps from searching for you, so you search on the official site and bring the list here. It takes about a minute.</div>
    <h2>Add one case with its dates</h2>
    <p className="body-copy">Open the case on the eCourts website (tap <b>View</b> next to it), Select all, Copy, then come back and tap below.</p>
    <button className="wide-button" onClick={addFromClipboard}>Add case from copied page</button>
    {oneMsg && <div className="notice-card" role="alert">{oneMsg}</div>}
    {one && <div className="notice-card" style={{ background: '#e6f4ea', color: '#1d5b34' }}><b>{one.title}</b><br />{one.caseNumber}{one.court ? ` · ${one.court}` : ''}<br />Next hearing: {one.nextHearing || 'not found'} · Status: {one.status}{one.cnr ? ` · CNR ${one.cnr}` : ''}<button className="wide-button" onClick={addOne}>Save this case</button></div>}
    <h2>Or import a whole list</h2>
    <h3>1. Search on eCourts</h3>
    <p className="body-copy">Open the site, choose <b>Advocate</b>, enter {name ? <>your name (<b>{name}</b>)</> : 'your name'}{bar ? <> or Bar ID (<b>{bar}</b>)</> : ' or Bar ID'}, pick your state, district and court complex, type the captcha and search.</p>
    <a className="wide-button" href={ECOURTS_URL} target="_blank" rel="noopener noreferrer">Open eCourts website</a>
    <h3>2. Copy the result list</h3>
    <p className="body-copy">On the results page, press and hold on the list, choose <b>Select all</b>, then <b>Copy</b>. Come back to this screen.</p>
    <h3>3. Paste here</h3>
    <div className="settings-row"><span>Cases are</span><select aria-label="Case status" value={status} onChange={e => setStatus(e.target.value)}><option value="Pending">Pending</option><option value="Disposed">Disposed</option></select></div>
    <textarea className="notes-area" style={{ height: 180 }} aria-label="Pasted eCourts results" placeholder="Paste the copied results here" value={text} onChange={e => setText(e.target.value)} />
    <button className="wide-button" onClick={pasteFromClipboard}>Paste from clipboard</button>
    <button className="wide-button" onClick={readPasted} disabled={!text.trim()}>Read my cases</button>
    {found && <section aria-label="Cases found">
      {!found.length && <div className="notice-card" role="alert">No cases were recognised. Make sure you copied the results list (with case numbers like CC/123/2021) and try again.</div>}
      {fresh.length > 0 && <><h2>New cases ({fresh.length})</h2>{fresh.map(c => <label key={c.key} className="settings-row"><input type="checkbox" checked={picked.has(c.key)} onChange={e => setPicked(prev => { const n = new Set(prev); if (e.target.checked) n.add(c.key); else n.delete(c.key); return n; })} /><span style={{ flex: 1 }}>{c.title || 'Untitled case'}<small style={{ display: 'block', opacity: .7 }}>{c.caseNumber}{c.court ? ` · ${c.court}` : ''}</small></span></label>)}<button className="wide-button" onClick={importPicked} disabled={!picked.size}>Add {picked.size} selected to my cases</button></>}
      {known.length > 0 && <p className="body-copy">{known.length} case{known.length > 1 ? 's' : ''} already in your app.</p>}
    </section>}
    <p className="body-copy">Imported cases have no next hearing date; set it in each case so it shows in the Diary. Check important dates on the official site.</p>
  </div>;
}

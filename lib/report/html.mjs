import { kuerze } from '../normalize.mjs';
import { QUELLE_KURZ } from './summary.mjs';
import { verlaufHtml, VERLAUF_CSS } from './verlauf.mjs';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const QUELLE_FARBE = { github: '#bd93f9', stackoverflow: '#ffb86c', discourse: '#8be9fd' };

// Nur http(s)-Links kommen ins HTML; alles andere wird zu einem toten Anker.
export const sichereUrl = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u)) ? String(u) : '#');

function balken(n, farbe) {
  const w = Math.max(0, Math.min(100, Number(n) || 0));
  return `<span class="bar" title="${w}"><i style="width:${w}%;background:${farbe}"></i><b>${w}</b></span>`;
}

function zeile(t) {
  const meta = [t.ort, t.sprache, t.alterTage == null ? null : `${Math.round(t.alterTage)} Tage`, t.codeVorhanden ? 'Code dabei' : null, t.fehlertext ? 'Fehlertext' : null]
    .filter(Boolean).map(esc).join(' · ');
  return `<tr>
<td class="g">${esc(t.gesamt)}</td>
<td>${balken(t.loesbarkeit, '#50fa7b')}</td>
<td>${balken(t.wirkung, '#ff79c6')}</td>
<td><span class="q" style="background:${QUELLE_FARBE[t.quelle] || '#6272a4'}">${esc(QUELLE_KURZ[t.quelle] || '??')}</span></td>
<td><a href="${esc(sichereUrl(t.url))}" rel="noopener noreferrer">${esc(kuerze(t.titel, 110))}</a><br><small>${meta}<br><code>${esc(t.id)}</code></small></td>
</tr>`;
}

export function toHtml(liste, meta = {}, verlauf = null) {
  const labels = (t) => (t.labels || []).join(', ');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Ungelöst – offene Fehler ohne Antwort</title><style>
:root{color-scheme:dark}
body{margin:0;background:#282a36;color:#f8f8f2;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:2rem}
h1{font-size:1.5rem;margin:0 0 .25rem}.sub{color:#6272a4;margin:0 0 1.5rem}
table{border-collapse:collapse;width:100%;max-width:1100px}
th,td{padding:.55rem .6rem;text-align:left;border-bottom:1px solid #44475a;vertical-align:top}
thead th{color:#bd93f9;font-weight:600;white-space:nowrap}
td.g{font-weight:700;font-size:1.1rem;color:#f1fa8c;text-align:center}
a{color:#8be9fd;text-decoration:none}a:hover{text-decoration:underline}
small{color:#6272a4}code{color:#6272a4;font-size:.8rem}
.q{display:inline-block;padding:.1rem .45rem;border-radius:4px;color:#282a36;font-weight:700;font-size:.8rem}
.bar{position:relative;display:inline-block;width:90px;height:1.1rem;background:#44475a;border-radius:3px;overflow:hidden;vertical-align:middle}
.bar i{position:absolute;left:0;top:0;bottom:0;opacity:.75}.bar b{position:relative;display:block;text-align:center;font-size:.8rem;line-height:1.1rem;color:#f8f8f2}
.leer{color:#6272a4;padding:2rem 0}
footer{color:#6272a4;font-size:.8rem;margin-top:2rem;max-width:1100px}
.err{color:#ff5555}${VERLAUF_CSS}
</style></head><body>
<h1>Ungelöst</h1>
<p class="sub">${esc(meta.when || '')} · ${esc(meta.gesamt ?? liste.length)} gefunden · ${esc(meta.neu ?? liste.length)} neu · Top ${liste.length}${meta.fehler?.length ? ` · <span class="err">${esc(meta.fehler.length)} Quelle(n) mit Fehler</span>` : ''}</p>
${verlaufHtml(verlauf)}
${liste.length ? `<table><thead><tr><th>Gesamt</th><th>Lösbarkeit</th><th>Wirkung</th><th>Quelle</th><th>Problem</th></tr></thead>
<tbody>${liste.map(zeile).join('\n')}</tbody></table>` : '<p class="leer">Nichts Neues gefunden.</p>'}
${meta.fehler?.length ? `<p class="err">${meta.fehler.map(esc).join('<br>')}</p>` : ''}
<footer>Lösbarkeit: Code/Stacktrace dabei, Sprache im Fokus, Alter, Labels. Wirkung: Sterne, Aufrufe, Forum-Gewicht. Gesamt = √(Lösbarkeit × Wirkung).
Antworten und Pull Requests schreibt Stefan selbst, nach eigener Reproduktion. Stack Overflow verbietet KI-generierte Antworten. ungeloest · MIT</footer>
</body></html>`;
}

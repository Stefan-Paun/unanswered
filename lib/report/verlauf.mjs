import { kuerze } from '../normalize.mjs';
import { esc, sichereUrl } from './html.mjs';
import { QUELLE_KURZ } from './summary.mjs';

export const VERLAUF_CSS = `
.vgl{color:#bd93f9;margin:0 0 1rem}.hinweis{background:#44475a;border-left:4px solid #ffb86c;padding:.6rem .9rem;max-width:1100px;margin:0 0 1.5rem}
h2{font-size:1.1rem;color:#bd93f9;margin:1.8rem 0 .4rem}
.vl{list-style:none;padding:0;margin:0;max-width:1100px}.vl li{display:flex;gap:.8rem;align-items:center;padding:.45rem 0;border-bottom:1px solid #44475a}
.vl .t{flex:1}.vl svg{flex:none}.vl small{color:#6272a4}
.ab{display:inline-block;padding:.05rem .4rem;border-radius:4px;font-size:.75rem;font-weight:700;color:#282a36;margin-right:.3rem}
.ab.neu{background:#50fa7b}.ab.steigt{background:#ffb86c}.ab.geloest{background:#8be9fd}.ab.lange{background:#ff79c6}.ab.weg{background:#6272a4;color:#f8f8f2}
.stat{max-width:1100px;color:#f8f8f2}`;

/** Kleine Verlaufslinie (Stimmen + Kommentare über die Zeit) als statisches SVG, ohne Script. */
export function linieSvg(verlauf = [], { breite = 120, hoehe = 28 } = {}) {
  const v = verlauf.filter((p) => Number.isFinite(Date.parse(p.zeit)));
  if (v.length < 2) return '';
  const werte = v.map((p) => (Number(p.stimmen) || 0) + (Number(p.kommentare) || 0));
  const t0 = Date.parse(v[0].zeit);
  const spanne = Math.max(1, Date.parse(v[v.length - 1].zeit) - t0);
  const max = Math.max(1, ...werte);
  const pad = 3;
  const xy = v.map((p, i) => `${(pad + ((Date.parse(p.zeit) - t0) / spanne) * (breite - 2 * pad)).toFixed(1)},${(hoehe - pad - (werte[i] / max) * (hoehe - 2 * pad)).toFixed(1)}`);
  const [lx, ly] = xy[xy.length - 1].split(',');
  return `<svg width="${breite}" height="${hoehe}" viewBox="0 0 ${breite} ${hoehe}" role="img" aria-label="Verlauf: ${werte[0]} → ${werte[werte.length - 1]} (${v.length} Messpunkte)">` +
    `<polyline points="${xy.join(' ')}" fill="none" stroke="#bd93f9" stroke-width="1.5"/><circle cx="${lx}" cy="${ly}" r="2.5" fill="#f1fa8c"/></svg>`;
}

const ab = (klasse, text) => `<span class="ab ${klasse}">${esc(text)}</span>`;

function eintrag(f, abzeichen, detail = '') {
  const titel = esc(kuerze(f.titel || f.id, 110));
  const link = f.url ? `<a href="${esc(sichereUrl(f.url))}" rel="noopener noreferrer">${titel}</a>` : titel;
  const q = QUELLE_KURZ[f.quelle] ? `${esc(QUELLE_KURZ[f.quelle])} · ` : '';
  return `<li><span class="t">${abzeichen} ${link}<br><small>${q}${detail ? esc(detail) + ' · ' : ''}<code>${esc(f.id)}</code></small></span>${linieSvg(f.verlauf)}</li>`;
}

const abschnitt = (titel, liste, bau) => (liste.length ? `<h2>${esc(titel)} (${liste.length})</h2><ul class="vl">${liste.map(bau).join('\n')}</ul>` : '');
const zahl = (n) => (Math.round(n * 10) / 10).toLocaleString('de-AT');

export function trefferlisteText(t) {
  if (!t || !t.topGesamt) return 'Noch keine Top-Funde im Verlauf.';
  if (!t.geloest) return `${t.topGesamt} Top-Funde beobachtet, bisher keiner von anderen gelöst.`;
  return `Von ${t.topGesamt} Top-Funden wurden ${t.geloest} von anderen gelöst, im Mittel nach ${zahl(t.mittelTage)} Tagen (gerechnet ab dem ersten Scan, in dem er auftauchte).`;
}

/** Kopfzeile + Abschnitte für den HTML-Bericht. */
export function verlaufHtml(a) {
  if (!a || !a.letzter) return '';
  const kopf = a.erster
    ? `<p class="hinweis">Das ist der erste Scan mit Verlauf. Es gibt noch nichts zu vergleichen – ab dem nächsten Scan erscheinen hier „Neu seit dem letzten Scan“, „Wird wichtiger“ und „Inzwischen gelöst“.</p>`
    : `<p class="vgl">Verglichen mit dem Scan vom ${esc(a.vergleichMit.slice(0, 16).replace('T', ' '))} UTC</p>`;
  if (a.erster) return kopf;
  return kopf +
    abschnitt('Neu seit dem letzten Scan', a.neu, (f) => eintrag(f, ab('neu', 'neu'))) +
    abschnitt('Wird wichtiger', a.steigt, (f) => eintrag(f, ab('steigt', `+${zahl(f.proTag)}/Tag`), `${f.zuwachs > 0 ? '+' : ''}${f.zuwachs} in ${zahl(f.tage)} Tagen`)) +
    abschnitt('Inzwischen gelöst', a.geloest, (f) => eintrag(f, ab('geloest', f.zustand === 'geschlossen' ? 'geschlossen' : 'beantwortet'))) +
    abschnitt('Nicht mehr gefunden (unsicher, nicht als gelöst gezählt)', a.verschwunden, (f) => eintrag(f, ab('weg', 'fehlt'), 'kann an Filtern oder Ratenlimit liegen')) +
    abschnitt('Liegt lange', a.liegtLange, (f) => eintrag(f, ab('lange', `${f.scansOffen} Scans`), 'unverändert offen, hoch bewertet')) +
    `<p class="stat">${esc(trefferlisteText(a.trefferliste))}</p>`;
}

/** Textform für Konsole und `verlauf`-Befehl. */
export function verlaufText(a) {
  if (!a || !a.letzter) return 'Noch kein Scan im Speicher – zuerst `ungeloest scan`.';
  if (a.erster) return 'Erster Scan mit Verlauf: noch nichts zu vergleichen. Ab dem nächsten Scan siehst du Veränderungen.';
  const z = [`Verlauf · letzter Scan ${a.letzter.slice(0, 16).replace('T', ' ')} UTC, verglichen mit ${a.vergleichMit.slice(0, 16).replace('T', ' ')} UTC`];
  const liste = (titel, l, fmt) => { if (l.length) { z.push('', `${titel} (${l.length})`); for (const f of l) z.push(`  ${f.id}  ${kuerze(f.titel || '', 70)}${fmt ? '  ' + fmt(f) : ''}`); } };
  liste('Neu seit dem letzten Scan', a.neu);
  liste('Wird wichtiger', a.steigt, (f) => `+${zahl(f.proTag)}/Tag`);
  liste('Inzwischen gelöst', a.geloest, (f) => f.zustand);
  liste('Nicht mehr gefunden (unsicher)', a.verschwunden);
  liste('Liegt lange', a.liegtLange, (f) => `${f.scansOffen} Scans`);
  z.push('', trefferlisteText(a.trefferliste));
  return z.join('\n');
}

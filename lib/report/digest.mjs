// Ausgaben für den Morgen-Digest: Terminal, Markdown, HTML-Karte. JSON ist das Digest-Objekt selbst.
// Fremdtext (Titel, Ort, ID) wird je Format maskiert; Adressen sind schon in lib/digest.mjs auf https beschränkt.
import { saeubere } from '../normalize.mjs';
import { alterText } from '../digest.mjs';
import { QUELLE_KURZ } from './summary.mjs';
import { esc, sichereUrl } from './html.mjs';

const F = { lila: '\x1b[38;2;189;147;249m', gruen: '\x1b[38;2;80;250;123m', gelb: '\x1b[38;2;241;250;140m',
  rot: '\x1b[38;2;255;85;85m', cyan: '\x1b[38;2;139;233;253m', grau: '\x1b[38;2;98;114;164m', fett: '\x1b[1m', aus: '\x1b[0m' };

/** Farbe nur an einem Terminal und nur, wenn NO_COLOR nicht gesetzt ist (https://no-color.org). */
export const mitFarbe = (strom = process.stdout, env = process.env) => !!strom?.isTTY && !env.NO_COLOR;

const scanZeit = (iso) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : null);

/** Eine Zeile zum Stand des Scans; bei veraltetem Scan die deutliche Warnung. */
export function standZeile(d) {
  const s = d.scan || {};
  if (!s.zeit) return 'Achtung: Alter des letzten Scans unbekannt – mit --frisch neu abfragen.';
  if (s.veraltet) return `Achtung: Der letzte Scan ist ${alterText(s.alterStunden)} (Stand ${scanZeit(s.zeit)}) – mit --frisch neu abfragen.`;
  return `Scan vom ${scanZeit(s.zeit)}, ${alterText(s.alterStunden)}.`;
}

const veraltet = (d) => !d.scan?.zeit || d.scan.veraltet;
const quelle = (c) => QUELLE_KURZ[c.quelle] || '??';
const werte = (c) => `Gesamt ${c.gesamt} · Lösbarkeit ${c.loesbarkeit ?? '?'} · Wirkung ${c.wirkung ?? '?'}`;
const LEER = 'Heute nichts Neues für den Digest: alles Lohnende stand schon in den letzten Ausgaben.';
const klar = (s) => saeubere(s ?? '').replace(/\s+/g, ' ').trim();

export function digestText(d, { farben = mitFarbe() } = {}) {
  const c = (code, s) => (farben ? code + s + F.aus : s);
  const z = [c(F.fett, `Ungelöst · Digest ${klar(d.datum)}`)];
  z.push(c(veraltet(d) ? F.rot : F.grau, standZeile(d)));
  for (const h of d.hinweise || []) z.push(c(F.rot, `Hinweis: ${klar(h)}`));
  if (!d.chancen.length) z.push('', c(F.grau, LEER));
  d.chancen.forEach((ch, i) => {
    z.push('');
    z.push(`${c(F.lila, `${i + 1}.`)} ${c(F.fett, klar(ch.titel))}${ch.wiederDabei ? c(F.gelb, ' (wieder dabei)') : ''}`);
    z.push(`   ${c(F.cyan, quelle(ch))} ${klar(ch.ort)} · ${werte(ch)} · Aufwand ${c(ch.aufwand.klasse === 'kurz' ? F.gruen : ch.aufwand.klasse === 'lang' ? F.rot : F.gelb, ch.aufwand.klasse)}`);
    z.push(`   Warum: ${klar(ch.warum)}.`);
    z.push(c(F.grau, `   ${klar(ch.id)} · ${ch.url || '(keine https-Adresse)'}`));
  });
  if (d.ausserdemNeu?.length) {
    z.push('', c(F.grau, 'Außerdem neu:'));
    for (const t of d.ausserdemNeu) z.push(c(F.grau, `   · ${klar(t.titel)} (${klar(t.id)})`));
  }
  return z.join('\n');
}

const mdText = (s) => klar(s).replace(/[\\`*_[\]()<>|#~&!]/g, (ch) => '\\' + ch);
// Fremdtext (Titel, Ort): zusätzlich ':', '@' und 'www.' maskieren, damit Renderer daraus keine Links machen (http:, mailto:).
const mdFremd = (s) => mdText(s).replace(/[:@]/g, (ch) => '\\' + ch).replace(/\bwww\./gi, (m) => m.slice(0, 3) + '\\.');
const mdUrl = (u) => String(u).replace(/[\s()<>[\]\\`]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
const mdCode = (s) => klar(s).replace(/`/g, '');
const mdLink = (t) => (t.url ? `[${mdFremd(t.titel)}](${mdUrl(t.url)})` : mdFremd(t.titel));

export function digestMarkdown(d) {
  const z = [`# Ungelöst – Digest ${mdText(d.datum)}`, ''];
  z.push(veraltet(d) ? `> **${standZeile(d)}**` : `_${standZeile(d)}_`, '');
  for (const h of d.hinweise || []) z.push(`> Hinweis: ${mdText(h)}`, '');
  if (!d.chancen.length) z.push(LEER, '');
  d.chancen.forEach((ch, i) => {
    z.push(`## ${i + 1}. ${mdLink(ch)}`, '');
    z.push(`- **Warum diese:** ${mdText(ch.warum)}.`);
    z.push(`- **Aufwand:** ${ch.aufwand.klasse} (${mdText(ch.aufwand.gruende.join(', '))})`);
    z.push(`- **Bewertung:** ${mdText(werte(ch))}`);
    z.push(`- **Wo:** ${quelle(ch)} · ${mdFremd(ch.ort)} · \`${mdCode(ch.id)}\`${ch.wiederDabei ? ' · wieder dabei' : ''}`, '');
  });
  if (d.ausserdemNeu?.length) {
    z.push('## Außerdem neu', '');
    for (const t of d.ausserdemNeu) z.push(`- ${mdLink(t)} \`${mdCode(t.id)}\``);
    z.push('');
  }
  z.push('---', '', 'Antworten schreibst du selbst, nach eigener Reproduktion. ungeloest sendet nichts.', '');
  return z.join('\n');
}

const htmlLink = (t) => {
  const u = t.url ? sichereUrl(t.url) : '#';
  return u === '#' ? esc(klar(t.titel)) : `<a href="${esc(u)}" rel="noopener noreferrer">${esc(klar(t.titel))}</a>`;
};

/** Eine einzelne, ruhige Seite: kein Script, keine externen Verweise, hell und dunkel nach Systemeinstellung. */
export function digestHtml(d) {
  const karte = (ch, i) => `<article>
<h2><span class="nr">${i + 1}</span> ${htmlLink(ch)}</h2>
<p class="wo">${esc(quelle(ch))} · ${esc(klar(ch.ort))} · <code>${esc(klar(ch.id))}</code>${ch.wiederDabei ? ' · wieder dabei' : ''}</p>
<p class="warum"><b>Warum diese:</b> ${esc(klar(ch.warum))}.</p>
<p class="zahlen"><span class="aufwand ${esc(ch.aufwand.klasse)}" title="${esc(ch.aufwand.gruende.join(', '))}">Aufwand: ${esc(ch.aufwand.klasse)}</span> ${esc(werte(ch))}</p>
</article>`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Ungelöst – Digest ${esc(klar(d.datum))}</title><style>
:root{color-scheme:light dark;--bg:#f6f5f1;--karte:#fff;--text:#22252b;--leise:#6b7280;--linie:#e2e0d8;--akzent:#5b4bc4;--warn:#b42318;--kurz:#1a7f4b;--mittel:#9a6700;--lang:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#1e1f29;--karte:#282a36;--text:#f8f8f2;--leise:#8b93b5;--linie:#3b3e51;--akzent:#bd93f9;--warn:#ff6e6e;--kurz:#50fa7b;--mittel:#f1fa8c;--lang:#ff6e6e}}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:2rem 1rem}
main{max-width:640px;margin:0 auto}
h1{font-size:1.35rem;margin:0}.stand{color:var(--leise);margin:.2rem 0 1.5rem}.stand.alt,.hinweis{color:var(--warn);font-weight:600}
article{background:var(--karte);border:1px solid var(--linie);border-radius:10px;padding:1rem 1.2rem;margin:0 0 1rem}
h2{font-size:1.05rem;margin:0 0 .3rem;overflow-wrap:anywhere}.nr{color:var(--akzent);margin-right:.3rem}
a{color:var(--akzent);text-decoration:none}a:hover{text-decoration:underline}
p{margin:.35rem 0}.wo,.zahlen{color:var(--leise);font-size:.85rem;overflow-wrap:anywhere}code{font-size:.8rem}
.aufwand{display:inline-block;border:1px solid currentColor;border-radius:999px;padding:0 .6rem;margin-right:.5rem;font-weight:600}
.kurz{color:var(--kurz)}.mittel{color:var(--mittel)}.lang{color:var(--lang)}
h3{font-size:.9rem;color:var(--leise);margin:1.5rem 0 .3rem}ul{margin:0;padding-left:1.2rem}li{margin:.15rem 0;overflow-wrap:anywhere}
.leer{color:var(--leise)}footer{color:var(--leise);font-size:.8rem;margin-top:2rem}
</style></head><body><main>
<h1>Ungelöst · Digest ${esc(klar(d.datum))}</h1>
<p class="stand${veraltet(d) ? ' alt' : ''}">${esc(standZeile(d))}</p>
${(d.hinweise || []).map((h) => `<p class="hinweis">Hinweis: ${esc(klar(h))}</p>`).join('\n')}
${d.chancen.length ? d.chancen.map(karte).join('\n') : `<p class="leer">${esc(LEER)}</p>`}
${d.ausserdemNeu?.length ? `<h3>Außerdem neu</h3>\n<ul>\n${d.ausserdemNeu.map((t) => `<li>${htmlLink(t)} <code>${esc(klar(t.id))}</code></li>`).join('\n')}\n</ul>` : ''}
<footer>Auswahl: Gesamtwert plus Interessen, höchstens ein Fund je Repo oder Forum, nichts aus den letzten Ausgaben. Antworten schreibst du selbst, nach eigener Reproduktion. ungeloest sendet nichts.</footer>
</main></body></html>
`;
}

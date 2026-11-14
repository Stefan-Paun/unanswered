import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baueDigest } from '../lib/digest.mjs';
import { digestText, digestMarkdown, digestHtml, standZeile, mitFarbe } from '../lib/report/digest.mjs';

const JETZT = new Date('2026-11-10T06:00:00.000Z');
const SCAN = '2026-11-10T05:30:00.000Z';
const ESC = '\x1b';

function fund(id, gesamt, mehr = {}) {
  return { id, quelle: 'github', ort: id.slice(3).split('#')[0], titel: `Titel ${id}`, url: `https://example.org/${gesamt}`, text: 'kurz',
    sprache: 'python', tags: [], labels: [], antworten: 0, kommentare: 0, alterTage: 12, wirkungRoh: { reaktionen: 2 },
    codeVorhanden: true, fehlertext: true, gesamt, loesbarkeit: gesamt, wirkung: gesamt, ...mehr };
}

// Böser Fremdtext: HTML, Markdown, Terminal-Sequenzen, gefährliche Adressen.
const BOESE = [
  fund('gh:acme/widget#1', 90, { titel: `<script>alert(1)</script> [klick](javascript:x) ${ESC}[31mrot${ESC}]0;Titel\x07 | \`code\` # *fett*` }),
  fund('gh:b/"onmouseover="x#2', 80, { titel: 'Zweiter & <img src=x onerror=y>', url: 'https://example.org/a b(c)<d>"e' }),
  fund('gh:c/c#3', 70, { titel: 'Dritter', url: 'javascript:alert(1)' }),
  fund('gh:d/d#4', 60, { titel: '</li><script>neu()</script>', url: 'data:text/html,x' }),
  fund('gh:e/e#5', 50, { titel: 'Fünfter ](https://boese.example/) [x' }),
];
const digest = (mehr = {}) => baueDigest(BOESE, { jetzt: JETZT, scanZeit: SCAN, ...mehr });

// Einfache Wohlgeformtheit: jedes geöffnete Element wird in der richtigen Reihenfolge geschlossen.
function pruefeHtml(html) {
  const leer = new Set(['meta', 'br', 'hr', 'img', 'link', 'input']);
  const stapel = [];
  const ohneStil = html.replace(/<style>[\s\S]*?<\/style>/, '<style></style>');
  for (const m of ohneStil.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)) {
    const name = m[2].toLowerCase();
    if (leer.has(name)) continue;
    if (!m[1]) stapel.push(name);
    else assert.equal(stapel.pop(), name, `</${name}> passt nicht`);
  }
  assert.deepEqual(stapel, []);
}

test('Terminal: drei kompakte Blöcke, keine fremden Steuerzeichen, Farbe nur auf Wunsch', () => {
  const ohne = digestText(digest(), { farben: false });
  assert.ok(!ohne.includes(ESC) && !ohne.includes('\x07'), 'Fremde ESC-Sequenzen sind entfernt');
  assert.match(ohne, /^Ungelöst · Digest \d{4}-\d{2}-\d{2}\nScan vom 2026-11-10 05:30 UTC, unter einer Stunde alt\./);
  assert.equal((ohne.match(/^\d\. /gm) || []).length, 3);
  assert.match(ohne, /Warum: 12 Tage ohne Antwort, 2 Stimmen, klare Fehlermeldung im Text, Code oder Stacktrace dabei\.\n/);
  assert.match(ohne, /Aufwand kurz/);
  assert.match(ohne, /gh:c\/c#3 · \(keine https-Adresse\)/);
  assert.ok(!ohne.includes('javascript:alert'));
  assert.match(ohne, /Außerdem neu:\n {3}· /);
  for (const zeile of ohne.split('\n')) assert.ok(zeile.length < 400);
  const mit = digestText(digest(), { farben: true });
  assert.ok(mit.includes(`${ESC}[1m`));
  assert.equal(mit.replace(/\x1b\[[0-9;]*m/g, ''), ohne, 'mit Farbe steht derselbe Text da');
});

test('mitFarbe: nur am Terminal und nie mit NO_COLOR', () => {
  assert.equal(mitFarbe({ isTTY: true }, {}), true);
  assert.equal(mitFarbe({ isTTY: true }, { NO_COLOR: '1' }), false);
  assert.equal(mitFarbe({ isTTY: false }, {}), false);
  assert.equal(mitFarbe({}, {}), false);
});

test('Markdown: Datum, drei Chancen, außerdem neu; Fremdtext maskiert, Links nur https', () => {
  const md = digestMarkdown(digest());
  assert.match(md, /^# Ungelöst – Digest \d{4}-\d{2}-\d{2}\n/);
  assert.equal((md.match(/^## \d\. /gm) || []).length, 3);
  assert.match(md, /^## Außerdem neu$/m);
  assert.match(md, /- \*\*Warum diese:\*\* 12 Tage ohne Antwort/);
  assert.match(md, /- \*\*Aufwand:\*\* kurz \(kurze Frage, Code enthalten\)/);
  assert.ok(!md.includes(ESC));
  assert.ok(!/(?<!\\)</.test(md), 'kein unmaskiertes <');
  assert.ok(!/(?<!\\)\[klick\]/.test(md), 'fremde Link-Syntax ist maskiert');
  const ziele = [...md.matchAll(/(?<!\\)\]\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(ziele.length >= 2);
  for (const z of ziele) assert.match(z, /^https:\/\/example\.org\/[^\s()<>]*$/, z);
  assert.match(md, /^## 2\. Zweiter /m, 'Adresse mit Leerzeichen und Anführungszeichen wird gar nicht verlinkt');
  assert.ok(!md.includes('javascript:alert') && !md.includes('data:text'));
});

test('HTML: eine Seite ohne Script und ohne externe Verweise, hell/dunkel, alles maskiert', () => {
  const html = digestHtml(digest());
  pruefeHtml(html);
  assert.match(html, /^<!doctype html><html lang="de">/);
  assert.ok(!/<script/i.test(html) && !/<img/i.test(html) && !/onerror=y>/.test(html.replace(/&[a-z#0-9]+;/g, '')));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('gh:b/&quot;onmouseover=&quot;x#2'));
  assert.ok(!html.includes(ESC));
  assert.match(html, /default-src 'none'; style-src 'unsafe-inline'/);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(html, /color-scheme:light dark/);
  const verweise = [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(verweise, ['https://example.org/90', 'https://example.org/50'], 'nur saubere https-Adressen werden verlinkt');
  assert.ok(!/url\(|@import|<link/i.test(html), 'nichts wird nachgeladen');
  assert.equal((html.match(/<article>/g) || []).length, 3);
  assert.match(html, /<h3>Außerdem neu<\/h3>/);
  assert.match(html, /class="aufwand kurz" title="kurze Frage, Code enthalten"/);
});

test('JSON: lässt sich lesen, ohne Steuerzeichen, Adressen https oder null', () => {
  const d = JSON.parse(JSON.stringify(digest()));
  assert.equal(d.chancen.length, 3);
  assert.deepEqual(d.chancen.map((c) => c.url), ['https://example.org/90', null, null]);
  assert.deepEqual(Object.keys(d), ['datum', 'erstellt', 'scan', 'chancen', 'ausserdemNeu', 'gesperrt', 'hinweise']);
  assert.ok(!JSON.stringify(d).includes('\\u001b'));
  assert.equal(d.chancen[0].aufwand.klasse, 'kurz');
  assert.equal(typeof d.chancen[0].warum, 'string');
});

test('Veralteter Scan steht deutlich in jedem Format', () => {
  const alt = digest({ scanZeit: '2026-11-07T05:30:00.000Z' });
  assert.equal(alt.scan.veraltet, true);
  assert.equal(standZeile(alt), 'Achtung: Der letzte Scan ist 3 Tage alt (Stand 2026-11-07 05:30 UTC) – mit --frisch neu abfragen.');
  assert.match(digestText(alt, { farben: false }), /\nAchtung: Der letzte Scan ist 3 Tage alt/);
  assert.match(digestMarkdown(alt), /^> \*\*Achtung: Der letzte Scan ist 3 Tage alt/m);
  assert.match(digestHtml(alt), /<p class="stand alt">Achtung: Der letzte Scan ist 3 Tage alt/);
  assert.ok(!/Achtung/.test(digestText(digest(), { farben: false }) + digestMarkdown(digest()) + digestHtml(digest())));
  const unbekannt = digest({ scanZeit: null });
  assert.match(digestText(unbekannt, { farben: false }), /Alter des letzten Scans unbekannt/);
});

test('Leerer Digest und Hinweise in jedem Format', () => {
  const leer = baueDigest([], { jetzt: JETZT, scanZeit: SCAN, hinweise: ['github: <b>abgebrochen</b>'] });
  const t = digestText(leer, { farben: false });
  assert.match(t, /Heute nichts Neues für den Digest/);
  assert.match(t, /Hinweis: github: <b>abgebrochen<\/b>/);
  assert.match(digestMarkdown(leer), /> Hinweis: github: \\<b\\>abgebrochen\\<\/b\\>/);
  const html = digestHtml(leer);
  pruefeHtml(html);
  assert.match(html, /<p class="hinweis">Hinweis: github: &lt;b&gt;abgebrochen&lt;\/b&gt;<\/p>/);
  assert.match(html, /<p class="leer">Heute nichts Neues/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHtml } from '../lib/report/html.mjs';
import { linieSvg, verlaufHtml, verlaufText, trefferlisteText } from '../lib/report/verlauf.mjs';
import { uebernimm, auswerten } from '../lib/verlauf.mjs';
import { leererSpeicher } from '../lib/verlauf-speicher.mjs';

const T = (tag) => new Date(Date.UTC(2026, 10, tag, 8));
const gh = (n, o = {}) => ({ id: `gh:a/b#${n}`, quelle: 'github', titel: `Issue ${n}`, url: `https://github.com/a/b/issues/${n}`, ort: 'a/b', kommentare: 0, antworten: 0, wirkungRoh: { reaktionen: 0 }, gesamt: 50, ...o });

// Prüft, dass alle Nicht-Void-Tags sauber geschachtelt sind.
export function wohlgeformt(html) {
  const leer = new Set(['meta', 'br', 'img', 'input', 'link', 'hr', 'circle', 'polyline']);
  const stapel = [];
  const body = html.replace(/<!doctype[^>]*>/i, '').replace(/<style>[\s\S]*?<\/style>/g, '<style></style>');
  for (const m of body.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*?)(\/?)>/gi)) {
    const [, zu, name, , selbst] = m;
    const n = name.toLowerCase();
    if (selbst || leer.has(n)) continue;
    if (zu) { assert.equal(stapel.pop(), n, `schließendes </${n}> passt nicht`); } else stapel.push(n);
  }
  assert.deepEqual(stapel, [], 'nicht geschlossene Tags');
}

function szenario() {
  let s = uebernimm(leererSpeicher(), [gh(1), gh(2), gh(3), gh(5)], { quellen: ['github'], jetzt: T(1), topIds: ['gh:a/b#2'] });
  s = uebernimm(s, [gh(1, { wirkungRoh: { reaktionen: 8 } }), gh(2, { kommentare: 1 }), gh(4, { titel: '<img src=x onerror=alert(1)> neu' }), gh(5)], { quellen: ['github'], jetzt: T(3) });
  return s;
}

test('Bericht: Abschnitte, Kopfzeile mit Vergleichszeitpunkt, Abzeichen, Linie', () => {
  const a = auswerten(szenario());
  const h = toHtml([], { when: 'x', gesamt: 4, neu: 1 }, a);
  for (const t of ['Neu seit dem letzten Scan', 'Wird wichtiger', 'Inzwischen gelöst', 'Nicht mehr gefunden']) assert.ok(h.includes(t), t);
  assert.ok(h.includes('Verglichen mit dem Scan vom 2026-11-01 08:00'));
  assert.ok(h.includes('class="ab neu"') && h.includes('class="ab steigt"') && h.includes('class="ab geloest"'));
  assert.ok(h.includes('<svg') && h.includes('<polyline'));
  assert.ok(h.includes('Von 1 Top-Funden wurden 1 von anderen gelöst'));
  assert.ok(!/<script/i.test(h));
  wohlgeformt(h);
});

test('Bericht: Fremdtext bleibt maskiert, gefährliche URLs werden tot', () => {
  const s = szenario();
  s.funde['gh:a/b#4'].url = 'javascript:alert(1)';
  s.funde['gh:a/b#1'].titel = 'x" onmouseover="alert(1)';
  const h = toHtml([], {}, auswerten(s));
  assert.ok(!h.includes('<img src=x'), 'Titel nicht als HTML');
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt; neu'));
  assert.ok(h.includes('href="#"'));
  assert.ok(!h.includes('" onmouseover="'));
  wohlgeformt(h);
});

test('Erster Scan: ehrlicher Hinweis, keine leeren Abschnitte', () => {
  const s = uebernimm(leererSpeicher(), [gh(1)], { quellen: ['github'], jetzt: T(1) });
  const h = toHtml([], {}, auswerten(s));
  assert.ok(h.includes('erste Scan mit Verlauf'));
  assert.ok(!h.includes('<h2>'));
  assert.match(verlaufText(auswerten(s)), /Erster Scan/);
  wohlgeformt(h);
});

test('Ohne Verlauf bleibt der Bericht wie bisher (keine Abschnitte)', () => {
  const h = toHtml([], {});
  assert.ok(!h.includes('<h2>') && h.includes('Nichts Neues'));
  assert.equal(verlaufHtml(null), '');
  assert.match(verlaufText(auswerten(leererSpeicher())), /Noch kein Scan/);
});

test('Linie: statisches SVG, nur Zahlen; unter zwei Punkten nichts', () => {
  assert.equal(linieSvg([{ zeit: T(1).toISOString(), stimmen: 1, kommentare: 0 }]), '');
  const svg = linieSvg([{ zeit: T(1).toISOString(), stimmen: 0, kommentare: 0 }, { zeit: T(2).toISOString(), stimmen: 4, kommentare: 1 }, { zeit: T(5).toISOString(), stimmen: '<x>', kommentare: 0 }]);
  assert.match(svg, /^<svg [^>]*><polyline points="[0-9., ]+"/);
  assert.ok(!svg.includes('<x>'));
  assert.equal(trefferlisteText({ topGesamt: 0 }), 'Noch keine Top-Funde im Verlauf.');
});

test('verlaufText listet die Kategorien', () => {
  const t = verlaufText(auswerten(szenario()));
  assert.match(t, /Neu seit dem letzten Scan \(1\)/);
  assert.match(t, /Wird wichtiger \(1\)/);
  assert.match(t, /Inzwischen gelöst \(1\)/);
  assert.match(t, /Nicht mehr gefunden \(unsicher\) \(1\)/);
});

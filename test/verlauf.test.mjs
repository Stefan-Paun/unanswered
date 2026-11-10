import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uebernimm, auswerten, zustandVon, zuwachsProTag } from '../lib/verlauf.mjs';
import { leererSpeicher } from '../lib/verlauf-speicher.mjs';

const T = (tag, std = 8) => new Date(Date.UTC(2026, 10, tag, std));
const gh = (n, o = {}) => ({ id: `gh:a/b#${n}`, quelle: 'github', titel: `Issue ${n}`, url: `https://github.com/a/b/issues/${n}`, ort: 'a/b', kommentare: 0, antworten: 0, wirkungRoh: { reaktionen: 0 }, gesamt: 50, ...o });
const so = (n, o = {}) => ({ id: `so:${n}`, quelle: 'stackoverflow', titel: `Frage ${n}`, url: `https://stackoverflow.com/q/${n}`, ort: 'stackoverflow.com', antworten: 0, wirkungRoh: { punkte: 0 }, gesamt: 50, ...o });
const scan = (s, treffer, tag, quellen = ['github', 'stackoverflow'], extra = {}) => uebernimm(s, treffer, { quellen, jetzt: T(tag), ...extra });

test('erster Scan: Hinweis statt Kategorien', () => {
  const s = scan(leererSpeicher(), [gh(1), so(2)], 1);
  const a = auswerten(s);
  assert.equal(a.erster, true);
  assert.equal(a.vergleichMit, null);
  assert.deepEqual([a.neu, a.geloest, a.steigt, a.verschwunden], [[], [], [], []]);
  assert.equal(s.scans.length, 1);
  assert.equal(s.funde['gh:a/b#1'].verlauf.length, 1);
});

test('neu: nur zum ersten Mal gesehene Funde seit dem letzten Scan', () => {
  let s = scan(leererSpeicher(), [gh(1)], 1);
  s = scan(s, [gh(1), gh(2)], 2);
  const a = auswerten(s);
  assert.equal(a.erster, false);
  assert.equal(a.vergleichMit, T(1).toISOString());
  assert.deepEqual(a.neu.map((f) => f.id), ['gh:a/b#2']);
});

test('beantwortet: nur sicher, wenn die Quelle es hergibt; „nicht mehr gefunden“ zählt nicht als gelöst', () => {
  let s = scan(leererSpeicher(), [gh(1), gh(2), gh(3), so(4)], 1);
  s = scan(s, [gh(1, { kommentare: 2 }), gh(2, { zustand: 'geschlossen' }), so(4)], 2);
  const a = auswerten(s);
  assert.deepEqual(a.geloest.map((f) => f.id).sort(), ['gh:a/b#1', 'gh:a/b#2']);
  assert.deepEqual(a.verschwunden.map((f) => f.id), ['gh:a/b#3'], 'fehlt, aber unsicher');
  assert.equal(s.funde['gh:a/b#3'].zustand, 'offen');
  assert.equal(a.trefferliste.geloest, 0, 'ohne Top-Mitgliedschaft keine Trefferliste');
  assert.equal(zustandVon({ antworten: 1 }), 'beantwortet');
  assert.equal(zustandVon({ zustand: 'geschlossen' }), 'geschlossen');
  assert.equal(zustandVon({}), 'offen');
});

test('Teil-Scan: Funde anderer Quellen gelten nicht als verschwunden', () => {
  let s = scan(leererSpeicher(), [gh(1), so(2)], 1);
  s = scan(s, [gh(1)], 2, ['github']); // nur GitHub gelaufen
  assert.deepEqual(auswerten(s).verschwunden, []);
  assert.equal(s.funde['so:2'].fehlt, 0);
  s = scan(s, [gh(1)], 3, ['github', 'stackoverflow']); // jetzt hat SO geantwortet und nichts geliefert
  assert.deepEqual(auswerten(s).verschwunden.map((f) => f.id), ['so:2']);
  // ausgefallene Quelle (nicht in quellen) → nichts verschwunden
  let s2 = scan(leererSpeicher(), [gh(1), so(2)], 1);
  s2 = scan(s2, [gh(1)], 2, ['github']);
  assert.equal(s2.funde['so:2'].fehlt, 0);
});

test('wird wichtiger: Rate über Schwelle, Mindestabstand schützt vor Rauschen', () => {
  let s = scan(leererSpeicher(), [gh(1), gh(2), gh(3)], 1);
  s = uebernimm(s, [gh(1, { wirkungRoh: { reaktionen: 6 } }), gh(2, { wirkungRoh: { reaktionen: 1 } }), gh(3, { wirkungRoh: { reaktionen: 9 } })],
    { quellen: ['github'], jetzt: T(3) });
  const a = auswerten(s);
  assert.deepEqual(a.steigt.map((f) => f.id), ['gh:a/b#1'.replace('1', '3'), 'gh:a/b#1'], 'sortiert nach Rate; #2 mit 0,5/Tag liegt darunter');
  assert.ok(Math.abs(a.steigt[0].proTag - 4.5) < 1e-9);
  // Mindestabstand: zwei Messpunkte nur 1 Stunde auseinander → keine Aussage
  let r = scan(leererSpeicher(), [gh(1)], 1);
  r = uebernimm(r, [gh(1, { wirkungRoh: { reaktionen: 50 } })], { quellen: ['github'], jetzt: T(1, 9) });
  assert.equal(zuwachsProTag(r.funde['gh:a/b#1']), null);
  assert.deepEqual(auswerten(r).steigt, []);
  // gelöste zählen nicht als „wird wichtiger“
  let g = scan(leererSpeicher(), [gh(1)], 1);
  g = scan(g, [gh(1, { kommentare: 5, wirkungRoh: { reaktionen: 40 } })], 3);
  assert.deepEqual(auswerten(g).steigt, []);
});

test('liegt lange: seit N Scans unverändert offen und hoch bewertet', () => {
  let s = leererSpeicher();
  for (let i = 1; i <= 5; i++) s = scan(s, [gh(1, { gesamt: 80 }), gh(2, { gesamt: 30 }), gh(3, { gesamt: 80 })], i);
  s = scan(s, [gh(1, { gesamt: 80 }), gh(2, { gesamt: 30 }), gh(3, { gesamt: 80, wirkungRoh: { reaktionen: 3 } })], 6);
  const a = auswerten(s);
  assert.deepEqual(a.liegtLange.map((f) => f.id), ['gh:a/b#1']);
  assert.equal(a.liegtLange[0].scansOffen, 6);
  assert.deepEqual(auswerten(s, { cfg: { langeScans: 7 } }).liegtLange, []);
});

test('Trefferliste: Top-Funde, die von anderen gelöst wurden, und mittlere Dauer', () => {
  let s = scan(leererSpeicher(), [gh(1), gh(2), gh(3), gh(4)], 1, ['github'], { topIds: ['gh:a/b#1', 'gh:a/b#2', 'gh:a/b#3'] });
  s = scan(s, [gh(1, { kommentare: 1 }), gh(2), gh(3), gh(4)], 3, ['github']);
  s = scan(s, [gh(2), gh(3, { zustand: 'geschlossen' }), gh(4)], 7, ['github']);
  const t = auswerten(s).trefferliste;
  assert.equal(t.topGesamt, 3);
  assert.equal(t.geloest, 2);
  assert.equal(t.mittelTage, (2 + 6) / 2);
});

test('Verlauf je Fund bleibt auf 30 Punkte begrenzt', () => {
  let s = leererSpeicher();
  for (let i = 0; i < 45; i++) s = uebernimm(s, [gh(1, { wirkungRoh: { reaktionen: i } })], { quellen: ['github'], jetzt: new Date(Date.UTC(2026, 9, 1) + i * 86_400_000) });
  const v = s.funde['gh:a/b#1'].verlauf;
  assert.equal(v.length, 30);
  assert.equal(v[0].stimmen, 0);
  assert.equal(v.at(-1).stimmen, 44);
  assert.equal(s.scans.length, 45);
});

test('Ohne Scans: leere Auswertung, Eingabe bleibt unverändert', () => {
  const leer = leererSpeicher();
  const a = auswerten(leer);
  assert.equal(a.letzter, null);
  const s = scan(leer, [gh(1)], 1);
  assert.deepEqual(leer, leererSpeicher(), 'uebernimm ändert nicht den alten Speicher');
  assert.ok(s !== leer);
});

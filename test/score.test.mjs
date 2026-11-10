import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loesbarkeit, wirkung, bewerte, sortiere, verteile } from '../lib/score.mjs';

const cfg = { sprachen: ['javascript', 'python'], alterTage: { min: 2, max: 60 } };
const basis = { quelle: 'github', titel: 't', text: 'x'.repeat(200), sprache: 'javascript', alterTage: 10, labels: [], wirkungRoh: { sterne: 100 } };

test('Code, Fehlertext und Fokus-Sprache heben die Lösbarkeit', () => {
  const schwach = loesbarkeit({ ...basis, sprache: 'cobol', codeVorhanden: false, fehlertext: false }, cfg);
  const stark = loesbarkeit({ ...basis, codeVorhanden: true, fehlertext: true }, cfg);
  assert.ok(stark > schwach + 40);
  assert.ok(stark <= 100 && schwach >= 0);
});

test('zu frisch, zu alt, wontfix und leere Texte senken die Lösbarkeit', () => {
  const ok = loesbarkeit(basis, cfg);
  assert.ok(loesbarkeit({ ...basis, alterTage: 0.5 }, cfg) < ok);
  assert.ok(loesbarkeit({ ...basis, alterTage: 200 }, cfg) < ok);
  assert.ok(loesbarkeit({ ...basis, labels: ['wontfix'] }, cfg) < ok);
  assert.ok(loesbarkeit({ ...basis, text: 'kurz' }, cfg) < ok);
  assert.ok(loesbarkeit({ ...basis, labels: ['good first issue'] }, cfg) > ok);
});

test('Wirkung skaliert mit Sternen/Aufrufen und ist 0 für Forks/Archive', () => {
  assert.ok(wirkung({ quelle: 'github', wirkungRoh: { sterne: 10000 } }) > wirkung({ quelle: 'github', wirkungRoh: { sterne: 30 } }));
  assert.equal(wirkung({ quelle: 'github', wirkungRoh: { sterne: 10000, fork: true } }), 0);
  assert.equal(wirkung({ quelle: 'github', wirkungRoh: { sterne: 10000, archiviert: true } }), 0);
  assert.ok(wirkung({ quelle: 'stackoverflow', wirkungRoh: { aufrufe: 2000, punkte: 1 } }) > wirkung({ quelle: 'stackoverflow', wirkungRoh: { aufrufe: 5, punkte: -2 } }));
  assert.equal(wirkung({ quelle: 'discourse', wirkungRoh: { gewicht: 40 } }), 40);
  assert.ok(wirkung({ quelle: 'unbekannt' }) >= 5);
});

test('bewerte liefert gesamt als geometrisches Mittel, sortiere absteigend', () => {
  const a = bewerte({ ...basis, codeVorhanden: true, fehlertext: true }, cfg);
  const b = bewerte({ ...basis, wirkungRoh: { sterne: 0 }, codeVorhanden: false }, cfg);
  assert.equal(a.gesamt, Math.round(Math.sqrt(a.loesbarkeit * a.wirkung)));
  assert.deepEqual(sortiere([b, a]).map((x) => x.gesamt), [a.gesamt, b.gesamt]);
});

test('verteile lässt höchstens n pro Ort nach vorne, Rest hinten in Reihenfolge', () => {
  const l = [{ ort: 'a', g: 1 }, { ort: 'a', g: 2 }, { ort: 'a', g: 3 }, { ort: 'b', g: 4 }, { ort: 'a', g: 5 }];
  assert.deepEqual(verteile(l, 2).map((x) => x.g), [1, 2, 4, 3, 5]);
  assert.deepEqual(verteile(l, 10).map((x) => x.g), [1, 2, 3, 4, 5]);
  const so = Array.from({ length: 5 }, (_, i) => ({ quelle: 'stackoverflow', ort: 'stackoverflow.com', id: `so:${i}`, g: i }));
  assert.deepEqual(verteile(so, 3).map((x) => x.g), [0, 1, 2, 3, 4], 'Stack Overflow wird nicht gedeckelt');
});

test('Wirkung: Discussions und GitLab – Ersatzgröße ohne Sterne, Stimmen zählen', async () => {
  const { wirkung, ERSATZ_WIRKUNG } = await import('../lib/score.mjs');
  assert.equal(ERSATZ_WIRKUNG, 30);
  assert.equal(wirkung({ quelle: 'gitlab', wirkungRoh: {} }), 30);
  assert.equal(wirkung({ quelle: 'github-discussions', wirkungRoh: { reaktionen: 2, stimmen: 1 } }), 42);
  assert.ok(wirkung({ quelle: 'gitlab', wirkungRoh: { sterne: 9999 } }) > 70);
  assert.equal(wirkung({ quelle: 'github-discussions', wirkungRoh: { sterne: 9999, archiviert: true } }), 0);
});

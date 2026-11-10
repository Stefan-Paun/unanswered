import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hebeAn, ladeSpeicher, speichereSpeicher, schreibeAtomar, duenneAus, vergesseAlteFunde, leererSpeicher, VERSION } from '../lib/verlauf-speicher.mjs';
import { ladeGesehen, nurNeue } from '../lib/store.mjs';

const ALT = new URL('./fixtures/gesehen-v1.json', import.meta.url).pathname;
const mitTemp = async (fn) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ungeloest-sp-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
};

test('Altes Format wird verlustfrei angehoben', async () => {
  await mitTemp(async (dir) => {
    const p = path.join(dir, 'gesehen.json');
    await copyFile(ALT, p);
    const s = await ladeSpeicher(p);
    assert.equal(s.version, VERSION);
    assert.deepEqual(s.scans, []);
    assert.deepEqual(Object.keys(s.funde).sort(), ['dc:discuss.python.org/109464', 'gh:acme/widget#12', 'so:80005138']);
    const f = s.funde['gh:acme/widget#12'];
    assert.equal(f.erstmals, '2026-10-20T08:00:00.000Z');
    assert.equal(f.gezeigt, '2026-10-20T08:00:00.000Z');
    assert.equal(f.quelle, 'github');
    assert.deepEqual(f.verlauf, []);
    // Die alte API sieht dieselben Daten, auch nach dem Speichern im neuen Format.
    await speichereSpeicher(p, s);
    const g = await ladeGesehen(p);
    assert.equal(g['so:80005138'], '2026-10-25T08:00:00.000Z');
    assert.deepEqual(nurNeue([{ id: 'so:80005138' }, { id: 'x' }], g).map((t) => t.id), ['x']);
  });
});

test('Neuere Version und kaputte Datei werden nicht überschrieben/verschluckt', async () => {
  assert.throws(() => hebeAn({ version: 99, funde: {} }), /Version 99/);
  assert.deepEqual(hebeAn(null), leererSpeicher());
  assert.deepEqual(hebeAn({}), leererSpeicher());
  await mitTemp(async (dir) => {
    const p = path.join(dir, 'g.json');
    await writeFile(p, '{kaputt');
    await assert.rejects(ladeSpeicher(p), /defekt/);
    await writeFile(p, JSON.stringify({ version: 99, funde: {} }));
    await assert.rejects(ladeSpeicher(p), /Version 99/);
    assert.deepEqual(await ladeSpeicher(path.join(dir, 'fehlt.json')), leererSpeicher());
  });
});

test('Ausdünnung: höchstens max Punkte, Anfang und Ende bleiben, sortiert', () => {
  const t0 = Date.parse('2026-10-01T00:00:00Z');
  const punkte = Array.from({ length: 50 }, (_, i) => ({ zeit: new Date(t0 + i * 3_600_000 * (i < 40 ? 1 : 24)).toISOString(), stimmen: i }));
  const d = duenneAus([...punkte].reverse(), 30);
  assert.equal(d.length, 30);
  assert.equal(d[0].stimmen, 0);
  assert.equal(d[d.length - 1].stimmen, 49);
  assert.deepEqual(d.map((p) => p.zeit), [...d.map((p) => p.zeit)].sort());
  assert.equal(duenneAus(punkte.slice(0, 5), 30).length, 5);
});

test('vergesseAlteFunde räumt auf, behält Frisches', () => {
  const s = { ...leererSpeicher(), funde: { alt: { zuletzt: '2026-01-01T00:00:00Z', gezeigt: null }, neu: { zuletzt: '2026-10-30T00:00:00Z' } } };
  assert.deepEqual(Object.keys(vergesseAlteFunde(s, 120, Date.parse('2026-11-01T00:00:00Z')).funde), ['neu']);
});

test('Schreiben ist atomar: Abbruch beim Umbenennen oder Schreiben lässt die alte Datei heil', async () => {
  await mitTemp(async (dir) => {
    const p = path.join(dir, 'tief', 'g.json');
    await schreibeAtomar(p, '{"alt":1}');
    const echt = await import('node:fs/promises');
    const bricht = { writeFile: echt.writeFile, rm: echt.rm, rename: async () => { throw new Error('Strom weg'); } };
    await assert.rejects(schreibeAtomar(p, '{"neu":2}', bricht), /Strom weg/);
    assert.equal(await readFile(p, 'utf8'), '{"alt":1}');
    assert.deepEqual(await readdir(path.dirname(p)), ['g.json'], 'keine temporäre Datei übrig');
    const halb = { writeFile: async (f) => { await echt.writeFile(f, '{"hal'); throw new Error('Platte voll'); }, rm: echt.rm, rename: echt.rename };
    await assert.rejects(schreibeAtomar(p, '{"neu":2}', halb), /Platte voll/);
    assert.equal(await readFile(p, 'utf8'), '{"alt":1}');
    assert.deepEqual(await readdir(path.dirname(p)), ['g.json']);
    await schreibeAtomar(p, '{"neu":2}');
    assert.equal(await readFile(p, 'utf8'), '{"neu":2}');
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ladeGesehen, speichereGesehen, nurNeue, merkeDir, vergesseAlte, auffrischen } from '../lib/store.mjs';

test('Store: laden, merken, speichern, nur Neues zeigen', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ungeloest-'));
  try {
    const pfad = path.join(dir, 'tief', 'gesehen.json');
    assert.deepEqual(await ladeGesehen(pfad), {});
    const g = merkeDir([{ id: 'a' }, { id: 'b' }], {}, new Date('2026-11-01T00:00:00Z'));
    await speichereGesehen(pfad, g);
    const geladen = await ladeGesehen(pfad);
    assert.deepEqual(Object.keys(geladen), ['a', 'b']);
    assert.deepEqual(nurNeue([{ id: 'a' }, { id: 'c' }], geladen).map((t) => t.id), ['c']);
    assert.match(await readFile(pfad, 'utf8'), /"a"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Store: defekte Datei meldet sich, vergesseAlte räumt auf', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ungeloest-'));
  try {
    const pfad = path.join(dir, 'g.json');
    await writeFile(pfad, '{kaputt');
    await assert.rejects(ladeGesehen(pfad), /defekt/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const jetzt = Date.parse('2026-11-01T00:00:00Z');
  const g = { alt: '2026-01-01T00:00:00Z', neu: '2026-10-30T00:00:00Z' };
  assert.deepEqual(Object.keys(vergesseAlte(g, 120, jetzt)), ['neu']);
  const frisch = auffrischen(g, [{ id: 'alt' }, { id: 'fremd' }], new Date(jetzt));
  assert.equal(frisch.alt, '2026-11-01T00:00:00.000Z');
  assert.ok(!('fremd' in frisch), 'auffrischen legt nichts Neues an');
  assert.deepEqual(Object.keys(vergesseAlte(frisch, 120, jetzt)).sort(), ['alt', 'neu']);
});

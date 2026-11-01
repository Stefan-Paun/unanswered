import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const BIN = new URL('../bin/ungeloest.mjs', import.meta.url).pathname;
const { finde } = await import('../bin/ungeloest.mjs');

test('CLI: --dry-run läuft ohne Netz, schreibt HTML + Markdown, aber keinen Zustand', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ungeloest-cli-'));
  try {
    const html = path.join(dir, 'b.html');
    const md = path.join(dir, 'b.md');
    const daten = path.join(dir, 'daten');
    const { stdout } = await exec(process.execPath, [BIN, 'scan', '--dry-run', '--alle', '--top', '5', '--html', html, '--md', md], { env: { ...process.env, UNGELOEST_DATEN: daten } });
    await assert.rejects(readFile(path.join(daten, 'gesehen.json')), /ENOENT/);
    await assert.rejects(exec(process.execPath, [BIN, 'list'], { env: { ...process.env, UNGELOEST_DATEN: daten } }), /Noch kein Scan/);
    assert.match(stdout, /Top 5/);
    assert.match(stdout, /gh:|so:|dc:/);
    const h = await readFile(html, 'utf8');
    assert.ok(h.includes('<title>Ungelöst') && !/<script/i.test(h));
    assert.match(await readFile(md, 'utf8'), /^# Ungelöst/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI: Hilfe, falsche Option, falscher Befehl', async () => {
  const { stdout } = await exec(process.execPath, [BIN, '--help']);
  assert.match(stdout, /dossier <id>/);
  await assert.rejects(exec(process.execPath, [BIN, '--quatsch']), /Unbekannte Option/);
  await assert.rejects(exec(process.execPath, [BIN, 'tanzen']), /Unbekannter Befehl/);
  await assert.rejects(exec(process.execPath, [BIN, '--top', 'x']), /ganze Zahl/);
  await assert.rejects(exec(process.execPath, [BIN, 'scan', '--quellen', '']), /mindestens eine Quelle/);
  await assert.rejects(exec(process.execPath, [BIN, 'show', 'a', 'b']), /Zu viele Argumente/);
  await assert.rejects(exec(process.execPath, [BIN, 'scan', '--quellen', 'gh,xx']), /Unbekannte Quelle xx/);
  await assert.rejects(exec(process.execPath, [BIN, 'list', 'x']), /nimmt kein weiteres Argument/);
  const mitBefehl = await exec(process.execPath, [BIN, 'scan', '--help']);
  assert.match(mitBefehl.stdout, /^ungeloest – findet/, 'scan --help zeigt Hilfe statt zu scannen');
});

test('finde: genau, Kurzform nur hinter Trenner, mehrdeutig meldet sich', () => {
  const daten = { treffer: [{ id: 'gh:x/y#12' }, { id: 'gh:x/y#112' }, { id: 'gh:z/y#12' }, { id: 'so:13743' }] };
  assert.equal(finde(daten, 'gh:x/y#112').id, 'gh:x/y#112');
  assert.equal(finde(daten, '13743').id, 'so:13743');
  assert.equal(finde(daten, 'y#112').id, 'gh:x/y#112');
  assert.throws(() => finde(daten, '#12'), /mehrdeutig/);
  assert.equal(finde({ treffer: [{ id: 'gh:x/y#12' }, { id: 'gh:x/y#112' }] }, '#12').id, 'gh:x/y#12');
  assert.throws(() => finde(daten, '12'), /mehrdeutig/);
  assert.throws(() => finde(daten, '3743'), /nicht im letzten Scan/);
  assert.throws(() => finde(daten, ''), /Bitte eine ID/);
});

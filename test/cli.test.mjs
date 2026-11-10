import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
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

test('CLI verlauf: liest nur den Speicher, Text und --json, ohne Scan', async () => {
  const { uebernimm } = await import('../lib/verlauf.mjs');
  const { leererSpeicher, speichereSpeicher } = await import('../lib/verlauf-speicher.mjs');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ungeloest-cli-'));
  try {
    const env = { ...process.env, UNGELOEST_DATEN: dir };
    const leer = await exec(process.execPath, [BIN, 'verlauf'], { env });
    assert.match(leer.stdout, /Noch kein Scan/);
    const gh = (n, o = {}) => ({ id: `gh:a/b#${n}`, quelle: 'github', titel: `Issue ${n}`, url: `https://github.com/a/b/issues/${n}`, ort: 'a/b', kommentare: 0, antworten: 0, wirkungRoh: { reaktionen: 0 }, gesamt: 50, ...o });
    let s = uebernimm(leererSpeicher(), [gh(1)], { quellen: ['github'], jetzt: new Date('2026-11-01T08:00:00Z') });
    s = uebernimm(s, [gh(1, { kommentare: 1 }), gh(2)], { quellen: ['github'], jetzt: new Date('2026-11-03T08:00:00Z') });
    const datei = path.join(dir, 'gesehen.json');
    await speichereSpeicher(datei, s);
    const vorher = await readFile(datei, 'utf8');
    const t = await exec(process.execPath, [BIN, 'verlauf'], { env });
    assert.match(t.stdout, /Neu seit dem letzten Scan \(1\)[\s\S]*Inzwischen gelöst \(1\)/);
    const j = JSON.parse((await exec(process.execPath, [BIN, 'verlauf', '--json'], { env })).stdout);
    assert.equal(j.neu[0].id, 'gh:a/b#2');
    assert.equal(j.geloest[0].id, 'gh:a/b#1');
    const j2 = JSON.parse((await exec(process.execPath, [BIN, '--json', 'verlauf'], { env })).stdout);
    assert.equal(j2.neu.length, 1);
    await exec(process.execPath, [BIN, 'verlauf', '--dry-run'], { env });
    assert.equal(await readFile(datei, 'utf8'), vorher, 'verlauf schreibt nichts');
    await assert.rejects(exec(process.execPath, [BIN, 'scan', '--json'], { env }), /braucht einen Wert/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI: scan --dry-run schreibt den Speicher nicht an, zeigt aber den Verlauf im Bericht', async () => {
  const { speichereGesehen } = await import('../lib/store.mjs');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ungeloest-cli-'));
  try {
    const datei = path.join(dir, 'gesehen.json');
    await speichereGesehen(datei, { 'gh:alt/alt#1': '2026-10-01T00:00:00.000Z' }); // altes Format
    const vorher = await readFile(datei, 'utf8');
    const html = path.join(dir, 'b.html');
    const { stdout } = await exec(process.execPath, [BIN, 'scan', '--dry-run', '--alle', '--html', html], { env: { ...process.env, UNGELOEST_DATEN: dir } });
    assert.equal(await readFile(datei, 'utf8'), vorher, 'Speicher unverändert');
    assert.deepEqual((await readdir(dir)).sort(), ['b.html', 'gesehen.json'], 'keine neuen Dateien, keine temporären');
    assert.match(stdout, /Erster Scan mit Verlauf/);
    assert.ok((await readFile(html, 'utf8')).includes('erste Scan mit Verlauf'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI: echter Scan nur mit Forum-Quelle ohne Foren (kein Netz) – Teil-Scan lässt GitHub-Funde in Ruhe', async () => {
  const { speichereGesehen } = await import('../lib/store.mjs');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ungeloest-cli-'));
  try {
    const datei = path.join(dir, 'gesehen.json');
    await speichereGesehen(datei, { 'gh:alt/alt#1': '2026-10-01T00:00:00.000Z' });
    const cfg = path.join(dir, 'cfg.json');
    await writeFile(cfg, JSON.stringify({ discourse: { foren: [] } }));
    await exec(process.execPath, [BIN, 'scan', '--quellen', 'dc', '--config', cfg], { env: { ...process.env, UNGELOEST_DATEN: dir } });
    const s = JSON.parse(await readFile(datei, 'utf8'));
    assert.equal(s.version, 2);
    assert.equal(s.scans.length, 1);
    assert.deepEqual(s.scans[0].quellen, ['discourse']);
    assert.equal(s.funde['gh:alt/alt#1'].fehlt, 0, 'GitHub wurde nicht gescannt, also nicht „verschwunden“');
    assert.equal(s.funde['gh:alt/alt#1'].gezeigt, '2026-10-01T00:00:00.000Z', 'altes Gesehen bleibt erhalten');
    assert.ok(!(await readdir(dir)).some((n) => n.endsWith('.tmp')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

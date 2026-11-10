import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
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

test('CLI: --dry-run zeigt geplante Abfragen und nimmt die neuen Quellen mit; --quelle wählt aus', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ungeloest-cli-'));
  try {
    const cfgPfad = path.join(dir, 'c.json');
    await writeFile(cfgPfad, JSON.stringify({ githubDiscussions: { repos: ['acme/widgets'] }, gitlab: { projekte: ['acme/gitlab-demo'], labels: ['bug'] } }));
    const env = { ...process.env, UNGELOEST_DATEN: path.join(dir, 'daten'), GITHUB_TOKEN: '', GITLAB_TOKEN: '' };
    const alle = await exec(process.execPath, [BIN, 'scan', '--dry-run', '--alle', '--top', '50', '--config', cfgPfad], { env });
    assert.match(alle.stdout, /gd:acme\/widgets#11/);
    assert.match(alle.stdout, /gl:acme\/gitlab-demo#1/);
    assert.match(alle.stderr, /dry-run: github-discussions: POST https:\/\/api\.github\.com\/graphql/);
    assert.match(alle.stderr, /repo:acme\/widgets is:unanswered/);
    assert.match(alle.stderr, /https:\/\/gitlab\.com\/api\/v4\/projects\/acme%2Fgitlab-demo\/issues\?/);
    const nur = await exec(process.execPath, [BIN, 'scan', '--dry-run', '--alle', '--top', '50', '--quelle', 'gl', '--config', cfgPfad], { env });
    assert.match(nur.stdout, /gl:/);
    assert.doesNotMatch(nur.stdout, /gd:|gh:|so:|dc:/);
    assert.doesNotMatch(nur.stderr, /github-discussions/);
    const leer = await exec(process.execPath, [BIN, 'scan', '--dry-run', '--quellen', 'gd,gl', '--config', path.join(dir, 'gibtsnicht.json')], { env });
    assert.match(leer.stderr, /nichts eingestellt/);
    await assert.rejects(exec(process.execPath, [BIN, 'scan', '--quellen', 'gx']), /Unbekannte Quelle gx/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

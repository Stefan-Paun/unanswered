import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { treffer } from '../lib/normalize.mjs';
import { bewerte } from '../lib/score.mjs';
import { ladeConfig } from '../lib/config.mjs';

const exec = promisify(execFile);
const BIN = new URL('../bin/ungeloest.mjs', import.meta.url).pathname;
const { digestBefehl, scanZeitAus } = await import('../bin/ungeloest.mjs');

const CFG = { sprachen: ['python', 'javascript'], alterTage: { min: 2, max: 60 } };
const JETZT = Date.now();
const vorTagen = (n) => new Date(JETZT - n * 86_400_000).toISOString();

function scanDaten(zeit) {
  const roh = [
    { id: 'gh:acme/widget#12', quelle: 'github', ort: 'acme/widget', titel: 'TypeError beim Start <b>fett</b>', sprache: 'python',
      text: 'Traceback (most recent call last)\n  File "a.py", line 3\nTypeError: x\nSteps to reproduce: start', wirkungRoh: { sterne: 25_000, reaktionen: 3 } },
    { id: 'gh:acme/widget#13', quelle: 'github', ort: 'acme/widget', titel: 'Zweites Issue im selben Repo', sprache: 'python',
      text: 'Traceback (most recent call last)\nValueError: y und noch etwas Text dazu, damit es nicht zu kurz ist ................', wirkungRoh: { sterne: 25_000 } },
    { id: 'so:80005138', quelle: 'stackoverflow', ort: 'stackoverflow.com', titel: 'Why does fetch hang?', sprache: 'javascript',
      text: '<pre>await fetch(url) // hängt für immer</pre> Error: timeout nach langer Zeit, niemand weiß warum, bitte helfen', wirkungRoh: { aufrufe: 900, punkte: 2 } },
    { id: 'dc:forum.example.org/7', quelle: 'discourse', ort: 'forum.example.org', titel: 'Frage ohne Code', sprache: 'python',
      text: 'Ich verstehe nicht, wie das gedacht ist. '.repeat(20), wirkungRoh: { gewicht: 60, aufrufe: 40 } },
    { id: 'gl:gruppe/projekt#7', quelle: 'gitlab', ort: 'gruppe/projekt', titel: 'Absturz beim Import', sprache: 'python',
      text: 'ImportError: kein Modul. '.repeat(10), wirkungRoh: { sterne: 300 } },
  ];
  const liste = roh.map((r) => bewerte(treffer({ ...r, url: `https://example.org/${encodeURIComponent(r.id)}`, erstellt: vorTagen(12) }, JETZT), CFG));
  return { meta: { when: zeit.slice(0, 16).replace('T', ' '), zeit, gesamt: liste.length, neu: liste.length, fehler: [] }, treffer: liste };
}

async function ordnerMit(zeit = vorTagen(0.01)) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ungeloest-digest-'));
  const daten = path.join(dir, 'daten');
  await mkdir(daten);
  if (zeit) await writeFile(path.join(daten, 'letzter-scan.json'), JSON.stringify(scanDaten(zeit)));
  // Vorspann für den Kindprozess: jeder Netzversuch (fetch) und jeder Unterprozess hinterlässt eine Marke und scheitert.
  const marke = path.join(dir, 'netz-benutzt');
  const vorspann = path.join(dir, 'kein-netz.mjs');
  await writeFile(vorspann, `import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const marke = ${JSON.stringify(marke)};
const sperre = (was) => (...a) => { fs.appendFileSync(marke, was + '\\n'); throw new TypeError('fetch failed (Test ohne Netz)'); };
globalThis.fetch = sperre('fetch');
for (const n of ['execFile', 'exec', 'spawn']) cp[n] = sperre(n);
syncBuiltinESMExports();
`);
  const lauf = (args, env = {}) => exec(process.execPath, ['--import', vorspann, BIN, ...args],
    { env: { ...process.env, UNGELOEST_DATEN: daten, NO_COLOR: '', GITHUB_TOKEN: '', ...env } });
  const netzBenutzt = () => access(marke).then(() => true, () => false);
  return { dir, daten, lauf, netzBenutzt };
}

test('digest: liest den letzten Scan ohne Netz, schreibt Markdown, HTML, JSON und die Merkliste', async () => {
  const { dir, daten, lauf, netzBenutzt } = await ordnerMit();
  try {
    const md = path.join(dir, 'd.md');
    const html = path.join(dir, 'd.html');
    const json = path.join(dir, 'd.json');
    const { stdout, stderr } = await lauf(['digest', '--md', md, '--html', html, '--json', json]);
    assert.equal(await netzBenutzt(), false, 'ohne --frisch gibt es keinen Netzversuch und keinen Unterprozess');
    assert.equal(stderr, '');
    assert.match(stdout, /^Ungelöst · Digest \d{4}-\d{2}-\d{2}\nScan vom /);
    assert.ok(!stdout.includes('\x1b['), 'keine Farbe ohne Terminal');
    assert.equal((stdout.match(/^\d\. /gm) || []).length, 3);
    assert.match(stdout, /1\. TypeError beim Start <b>fett<\/b>\n {3}GH acme\/widget · .* · Aufwand kurz\n {3}Warum: 12 Tage ohne Antwort, 3 Stimmen, klare Fehlermeldung im Text, Code oder Stacktrace dabei, Repo mit sehr vielen Nutzern \(25 Tsd\. Sterne\)/);
    assert.ok(!stdout.includes('gh:acme/widget#13 ·'), 'zweites Issue desselben Repos ist keine Chance');
    assert.match(stdout, /Außerdem neu:[\s\S]*gh:acme\/widget#13/);
    assert.ok(!/Achtung/.test(stdout));

    const m = await readFile(md, 'utf8');
    assert.match(m, /^# Ungelöst – Digest /);
    assert.match(m, /TypeError beim Start \\<b\\>fett\\<\/b\\>/);
    const h = await readFile(html, 'utf8');
    assert.ok(h.includes('TypeError beim Start &lt;b&gt;fett&lt;/b&gt;') && !/<script|<b>fett/i.test(h));
    const j = JSON.parse(await readFile(json, 'utf8'));
    assert.equal(j.chancen.length, 3);
    assert.equal(j.scan.veraltet, false);

    const merk = JSON.parse(await readFile(path.join(daten, 'digest.json'), 'utf8'));
    assert.equal(merk.version, 1);
    assert.deepEqual(merk.digests[0].eintraege.map((e) => e.id), j.chancen.map((c) => c.id));
    await assert.rejects(access(path.join(daten, 'gesehen.json')), 'der Digest fasst den Gesehen-Speicher nicht an');

    // Gleicher Stand, zweiter Aufruf: dieselbe Auswahl, Merkliste wächst nicht.
    const zweiter = await lauf(['digest', '--json']);
    assert.deepEqual(JSON.parse(zweiter.stdout).chancen, j.chancen);
    assert.equal(JSON.parse(await readFile(path.join(daten, 'digest.json'), 'utf8')).digests.length, 1);
    assert.equal(await netzBenutzt(), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('digest: neuer Scan zeigt nichts Gezeigtes erneut; --dry-run schreibt keine Merkliste', async () => {
  const { dir, daten, lauf } = await ordnerMit(vorTagen(0.5));
  try {
    const trocken = JSON.parse((await lauf(['digest', '--json', '--dry-run'])).stdout);
    await assert.rejects(access(path.join(daten, 'digest.json')));
    const erster = JSON.parse((await lauf(['--json', 'digest'])).stdout);
    assert.deepEqual(erster.chancen, trocken.chancen);
    await writeFile(path.join(daten, 'letzter-scan.json'), JSON.stringify(scanDaten(vorTagen(0.01))));
    const zweiter = JSON.parse((await lauf(['digest', '--json'])).stdout);
    const vorher = new Set(erster.chancen.map((c) => c.id));
    assert.ok(zweiter.chancen.length >= 1);
    for (const c of zweiter.chancen) assert.ok(!vorher.has(c.id), `${c.id} stand schon im letzten Digest`);
    assert.equal(zweiter.gesperrt, 3);
    assert.equal(JSON.parse(await readFile(path.join(daten, 'digest.json'), 'utf8')).digests.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('digest: veralteter Scan wird gekennzeichnet, fehlender Scan und kaputte Merkliste melden sich', async () => {
  const { dir, daten, lauf, netzBenutzt } = await ordnerMit(vorTagen(3));
  try {
    const { stdout } = await lauf(['digest']);
    assert.match(stdout, /\nAchtung: Der letzte Scan ist 3 Tage alt \(Stand \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\) – mit --frisch neu abfragen\./);
    assert.equal(JSON.parse((await lauf(['digest', '--json'])).stdout).scan.veraltet, true);
    await writeFile(path.join(daten, 'digest.json'), '{kaputt');
    await assert.rejects(lauf(['digest']), /Digest-Merkliste .* defekt/);
    await writeFile(path.join(daten, 'digest.json'), JSON.stringify({ version: 99, digests: [] }));
    await assert.rejects(lauf(['digest']), /Version 99/);
    assert.equal((await readFile(path.join(daten, 'digest.json'), 'utf8')), '{"version":99,"digests":[]}', 'neuere Merkliste bleibt unangetastet');
    await rm(path.join(daten, 'letzter-scan.json'));
    await assert.rejects(lauf(['digest']), /Noch kein Scan vorhanden/);
    assert.equal(await netzBenutzt(), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('digest: Farbe nie mit NO_COLOR, Optionen werden geprüft', async () => {
  const { dir, lauf } = await ordnerMit();
  try {
    assert.ok(!(await lauf(['digest', '--dry-run'], { NO_COLOR: '1', FORCE_COLOR: '1' })).stdout.includes('\x1b['));
    await assert.rejects(lauf(['digest', 'extra']), /nimmt kein weiteres Argument/);
    await assert.rejects(lauf(['digest', '--frisch', '--dry-run']), /schließen sich aus/);
    await assert.rejects(lauf(['scan', '--frisch']), /nur bei digest/);
    await assert.rejects(lauf(['list', '--json']), /--json braucht einen Wert/);
    assert.match((await lauf(['--help'])).stdout, /digest .*fragt das Netz nicht ab[\s\S]*--frisch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('digest --frisch: nur dann wird gescannt; scheitert das Netz, bleibt der alte Stand mit Hinweis und Exit 2', async () => {
  const { dir, daten, lauf, netzBenutzt } = await ordnerMit(vorTagen(2));
  try {
    const cfg = path.join(dir, 'cfg.json');
    await writeFile(cfg, JSON.stringify({ discourse: { foren: [{ host: 'forum.example.org', sprache: 'python', gewicht: 50 }] } }));
    const vorher = await readFile(path.join(daten, 'letzter-scan.json'), 'utf8');
    const fehl = await lauf(['digest', '--frisch', '--quellen', 'dc', '--config', cfg, '--json']).then(() => null, (e) => e);
    assert.ok(fehl, 'Exit-Code ist nicht 0');
    assert.equal(fehl.code, 2);
    assert.equal(await netzBenutzt(), true, 'mit --frisch wird das Netz versucht');
    const d = JSON.parse(fehl.stdout);
    assert.equal(d.chancen.length, 3, 'stdout bleibt reines JSON, die Scan-Meldungen stehen auf stderr');
    assert.match(d.hinweise[0], /frische Scan meldete Fehler/);
    assert.equal(d.scan.veraltet, true);
    assert.match(fehl.stderr, /Scan für den Digest: 0 gefunden, \d+ Fehler/);
    assert.equal(await readFile(path.join(daten, 'letzter-scan.json'), 'utf8'), vorher, 'der letzte Scan bleibt erhalten');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('digestBefehl: scanne wird nur mit --frisch gerufen, als Vorstufe ohne eigene Ausgabedateien', async () => {
  const { dir, daten } = await ordnerMit(vorTagen(2));
  try {
    const cfg = await ladeConfig(path.join(dir, 'gibt-es-nicht.json'));
    const rufe = [];
    const zeilen = [];
    const frisch = vorTagen(0);
    const scanne = async (o, c, extra) => {
      rufe.push({ o, extra });
      await writeFile(path.join(daten, 'letzter-scan.json'), JSON.stringify(scanDaten(frisch)));
      return 0;
    };
    const basis = { md: null, html: null, json: null, jsonFlag: true, dryRun: true, frisch: false, quellen: ['so'], top: 7 };
    const deps = { scanne, ordner: daten, aus: (s) => zeilen.push(s), jetzt: new Date(JETZT) };
    assert.equal(await digestBefehl(basis, cfg, deps), 0);
    assert.equal(rufe.length, 0);
    assert.equal(JSON.parse(zeilen[0]).scan.veraltet, true);

    const md = path.join(dir, 'x.md');
    assert.equal(await digestBefehl({ ...basis, frisch: true, dryRun: false, md }, cfg, deps), 0);
    assert.equal(rufe.length, 1);
    assert.deepEqual(rufe[0].extra, { fuerDigest: true });
    assert.deepEqual([rufe[0].o.md, rufe[0].o.html, rufe[0].o.json, rufe[0].o.top], [null, null, null, null]);
    assert.deepEqual(rufe[0].o.quellen, ['so'], '--quellen gilt für den frischen Scan');
    const d = JSON.parse(zeilen[1]);
    assert.equal(d.scan.veraltet, false);
    assert.equal(d.scan.zeit, frisch);
    assert.deepEqual(d.hinweise, []);
    assert.match(await readFile(md, 'utf8'), /^# Ungelöst – Digest /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('digest: „Außerdem neu“ nimmt nur, was der Speicher im letzten Scan erstmals sah; Interessen aus der Config', async () => {
  const zeit = vorTagen(0.01);
  const { dir, daten, lauf } = await ordnerMit(zeit);
  try {
    const frueher = vorTagen(1);
    const fundSeit = (erstmals) => ({ erstmals, zuletzt: zeit, gezeigt: null, quelle: 'github', titel: null, url: null, ort: null, zustand: 'offen', geloestAm: null, fehlt: 0, inTop: false, verlauf: [] });
    await writeFile(path.join(daten, 'gesehen.json'), JSON.stringify({ version: 2,
      scans: [{ zeit: frueher, quellen: ['github'], anzahl: 4 }, { zeit, quellen: ['github'], anzahl: 5 }],
      funde: { 'gh:acme/widget#13': fundSeit(frueher), 'gl:gruppe/projekt#7': fundSeit(zeit), 'gh:acme/widget#12': fundSeit(zeit) } }));
    const cfg = path.join(dir, 'cfg.json');
    await writeFile(cfg, JSON.stringify({ digest: { anzahl: 2, interessen: { schlagwoerter: ['import'] } } }));
    const d = JSON.parse((await lauf(['digest', '--json', '--dry-run', '--config', cfg])).stdout);
    assert.equal(d.chancen.length, 2);
    const gl = d.chancen.find((c) => c.id === 'gl:gruppe/projekt#7');
    if (gl) assert.match(gl.warum, /passt zu deinen Interessen \(import\)/);
    const neu = d.ausserdemNeu.map((t) => t.id);
    assert.ok(!neu.includes('gh:acme/widget#13'), 'schon länger bekannt, also nicht „neu“');
    for (const id of neu) assert.ok(['gl:gruppe/projekt#7', 'gh:acme/widget#12'].includes(id));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('scanZeitAus: neues Feld, altes Format, Unsinn', () => {
  assert.equal(scanZeitAus({ zeit: '2026-11-10T05:30:12.000Z', when: '2026-11-10 05:30' }), '2026-11-10T05:30:12.000Z');
  assert.equal(scanZeitAus({ when: '2026-11-10 05:30' }), '2026-11-10T05:30:00.000Z');
  assert.equal(scanZeitAus({ when: 'gestern' }), null);
  assert.equal(scanZeitAus({ zeit: 'quatsch' }), null);
  assert.equal(scanZeitAus(), null);
});

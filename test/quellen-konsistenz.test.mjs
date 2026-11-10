// Neue Quellen (gd, gl): Quellenprüfung, Speicher und Verlauf kennen alle Kürzel; GitLab-Sterne und minSterne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { QUELLEN } from '../lib/sources/index.mjs';
import { QUELLEN_NAMEN, quelleAusId, leererSpeicher } from '../lib/verlauf-speicher.mjs';
import { stimmenVon, uebernimm, auswerten } from '../lib/verlauf.mjs';
import { parseIssues, sucheGitlab } from '../lib/sources/gitlab.mjs';
import { toConsole } from '../lib/report/summary.mjs';
import { toMarkdown } from '../lib/report/markdown.mjs';
import { toHtml } from '../lib/report/html.mjs';
import { bewerte } from '../lib/score.mjs';

const exec = promisify(execFile);
const BIN = new URL('../bin/ungeloest.mjs', import.meta.url).pathname;
const fixture = async (n) => JSON.parse(await readFile(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const JETZT = Date.parse('2026-11-01T00:00:00Z');
const ok = (daten, h = {}) => ({ ok: true, status: 200, headers: new Map(Object.entries(h)), text: async () => JSON.stringify(daten) });
const opt = (extra = {}) => ({ jetzt: JETZT, schlaf: async () => {}, ...extra });

// ---- Kürzel
test('Speicher kennt dieselben Kürzel und Namen wie QUELLEN', () => {
  assert.deepEqual(Object.keys(QUELLEN_NAMEN).sort(), Object.keys(QUELLEN).sort());
  for (const [k, q] of Object.entries(QUELLEN)) assert.equal(quelleAusId(`${k}:x/y#1`), q.name, k);
  assert.equal(quelleAusId('xx:1'), null);
});

test('CLI: --quellen akzeptiert gd und gl, die Fehlermeldung nennt alle Kürzel aus QUELLEN', async () => {
  const env = { ...process.env, UNGELOEST_DATEN: '/nonexistent-ungeloest-test', GITHUB_TOKEN: '', GITLAB_TOKEN: '' };
  await assert.rejects(exec(process.execPath, [BIN, 'scan', '--quellen', 'gx'], { env }), (e) => /Unbekannte Quelle gx/.test(e.stderr) && /gh, so, dc, gd, gl/.test(e.stderr));
  await assert.rejects(exec(process.execPath, [BIN, 'scan', '--quellen', 'gd,gx'], { env }), /Unbekannte Quelle gx/);
  const { stdout } = await exec(process.execPath, [BIN, 'scan', '--dry-run', '--alle', '--quellen', 'gd,gl', '--top', '50'], { env });
  assert.match(stdout, /gl:/);
});

test('Verlauf: GitHub-Discussions- und GitLab-Funde bekommen ihre Quelle und können verschwinden', () => {
  const gl = { id: 'gl:acme/p#1', quelle: 'gitlab', titel: 'T', url: 'https://gitlab.com/acme/p/-/issues/1', ort: 'acme/p', kommentare: 0, wirkungRoh: { stimmen: 3 }, gesamt: 50 };
  const gd = { id: 'gd:acme/w#2', quelle: 'github-discussions', titel: 'D', url: 'https://github.com/acme/w/discussions/2', ort: 'acme/w', kommentare: 0, wirkungRoh: { reaktionen: 1, stimmen: 4 }, gesamt: 50 };
  let s = uebernimm(leererSpeicher(), [gl, gd], { quellen: ['gitlab', 'github-discussions'], jetzt: new Date('2026-11-01T08:00:00Z') });
  assert.equal(s.funde[gl.id].quelle, 'gitlab');
  assert.equal(s.funde[gd.id].quelle, 'github-discussions');
  assert.equal(s.funde[gl.id].verlauf[0].stimmen, 3);
  assert.equal(s.funde[gd.id].verlauf[0].stimmen, 4);
  s = uebernimm(s, [], { quellen: ['gitlab'], jetzt: new Date('2026-11-02T08:00:00Z') });
  assert.equal(s.funde[gl.id].fehlt, 1, 'gitlab wurde abgefragt und der Fund fehlt');
  assert.equal(s.funde[gd.id].fehlt, 0, 'discussions wurden nicht abgefragt');
  assert.ok(auswerten(s));
});

test('stimmenVon berücksichtigt reaktionen, stimmen und punkte', () => {
  assert.equal(stimmenVon({ wirkungRoh: { reaktionen: 3 } }), 3);
  assert.equal(stimmenVon({ wirkungRoh: { punkte: -2 } }), -2);
  assert.equal(stimmenVon({ wirkungRoh: { stimmen: 5 } }), 5, 'GitLab');
  assert.equal(stimmenVon({ wirkungRoh: { reaktionen: 0, stimmen: 5 } }), 5, 'Reaktionen 0 verdecken die Stimmen nicht');
  assert.equal(stimmenVon({ wirkungRoh: { reaktionen: 7, stimmen: 5 } }), 7);
  assert.equal(stimmenVon({ wirkungRoh: { aufrufe: 100 } }), 0);
  assert.equal(stimmenVon({}), 0);
});

// ---- GitLab: numerische Projekt-IDs und minSterne
const router = async () => {
  const [p1, p2, proj] = [await fixture('gitlab-issues.json'), await fixture('gitlab-issues-2.json'), await fixture('gitlab-projekt.json')];
  return async (url) => {
    if (!url.includes('/issues')) return ok(proj);
    return new URL(url).searchParams.get('page') === '1' ? ok(p1, { 'x-next-page': '2' }) : ok(p2, { 'x-next-page': '' });
  };
};
const cfgMit = (projekte, minSterne) => ({ alterTage: { min: 2, max: 60 }, gitlab: { projekte, labels: ['bug'], proSeite: 5, minSterne } });

test('GL: numerische Projekt-ID findet die Sterne (Issues tragen den Pfad)', async () => {
  const liste = await sucheGitlab(cfgMit(['77'], 0), opt({ fetchImpl: await router() }));
  const t = liste.find((x) => x.id === 'gl:acme/gitlab-demo#1');
  assert.equal(t.wirkungRoh.sterne, 340);
  assert.ok(!t.wirkungRoh.sterneUnbekannt);
});

test('GL: minSterne mit numerischer ID filtert nach den echten Sternen', async () => {
  const hoch = await sucheGitlab(cfgMit(['77'], 500), opt({ fetchImpl: await router() }));
  assert.equal(hoch.filter((t) => t.ort === 'acme/gitlab-demo').length, 0, '340 < 500');
  const niedrig = await sucheGitlab(cfgMit(['77'], 100), opt({ fetchImpl: await router() }));
  assert.ok(niedrig.some((t) => t.id === 'gl:acme/gitlab-demo#1'));
  const pfad = await sucheGitlab(cfgMit(['ACME/Gitlab-Demo'], 100), opt({ fetchImpl: await router() }));
  assert.ok(pfad.some((t) => t.id === 'gl:acme/gitlab-demo#1'), 'auch bei anderer Groß-/Kleinschreibung');
});

test('GL: reine Suche ohne Projektliste – Sterne unbekannt filtert nicht alles weg, wird gekennzeichnet', async () => {
  const json = await fixture('gitlab-issues.json');
  const r = parseIssues(json, { jetzt: JETZT, cfg: { gitlab: { minSterne: 50 } } });
  assert.deepEqual(r.treffer.map((t) => t.id), ['gl:acme/gitlab-demo#1']);
  const t = r.treffer[0];
  assert.equal(t.wirkungRoh.sterneUnbekannt, true);
  assert.equal(t.wirkungRoh.sterne, undefined);
  assert.ok(r.warnungen.some((w) => /ohne bekannte Sternezahl/.test(w)));
  // bekannte Sterne unter dem Mindestwert werden weiter gefiltert
  const info = new Map([['acme/gitlab-demo', { sterne: 3, forks: 0 }]]);
  assert.equal(parseIssues(json, { jetzt: JETZT, cfg: { gitlab: { minSterne: 50 } }, projektInfo: info }).treffer.length, 0);
  // ohne minSterne keine Kennzeichnung
  assert.ok(!parseIssues(json, { jetzt: JETZT, cfg: { gitlab: {} } }).treffer[0].wirkungRoh.sterneUnbekannt);
  assert.equal(bewerte(t, {}).wirkung >= 0, true);
});

test('GL: reine Suche mit Token und minSterne liefert Treffer statt einer leeren Liste', async () => {
  const router1 = await router();
  const liste = await sucheGitlab({ alterTage: { min: 2, max: 60 }, gitlab: { suche: 'crash', minSterne: 50, proSeite: 5 } }, opt({ token: 'gl-TESTTOKEN0123456789', fetchImpl: router1 }));
  assert.ok(liste.length > 0);
  assert.ok(liste.every((t) => t.wirkungRoh.sterneUnbekannt));
});

test('Berichte kennzeichnen „Sterne unbekannt“', async () => {
  const r = parseIssues(await fixture('gitlab-issues.json'), { jetzt: JETZT, cfg: { gitlab: { minSterne: 50 } } });
  const liste = r.treffer.map((t) => bewerte(t, {}));
  assert.match(toConsole(liste, {}, { farben: false }), /\(Sterne \?\)/);
  assert.match(toMarkdown(liste, {}), /\(Sterne \?\)/);
  assert.match(toHtml(liste, {}), /Sterne \?/);
});

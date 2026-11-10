import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDiskussionen, sucheDiskussionen, planeAnfragen, einstellungen } from '../lib/sources/github-discussions.mjs';
import { sammle } from '../lib/sources/index.mjs';
import { bewerte } from '../lib/score.mjs';
import { toHtml } from '../lib/report/html.mjs';

const fixture = async (n) => JSON.parse(await readFile(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const JETZT = Date.parse('2026-11-01T00:00:00Z');
const TOKEN = 'ghp_GEHEIMERTESTTOKEN0123';
const ok = (daten, h = {}) => ({ ok: true, status: 200, headers: new Map(Object.entries(h)), text: async () => JSON.stringify(daten) });
const fehl = (status, text = 'boom', h = {}) => ({ ok: false, status, headers: new Map(Object.entries(h)), text: async () => text });
const CFG = { alterTage: { min: 2, max: 60 }, githubDiscussions: { repos: ['acme/widgets', 'acme/tools'], proSeite: 5 } };
const opt = (extra = {}) => ({ token: TOKEN, jetzt: JETZT, schlaf: async () => {}, ...extra });

test('GD: Normalfall – nur beantwortbare, unbeantwortete, https; Felder gefüllt', async () => {
  const r = parseDiskussionen(await fixture('github-discussions.json'), { jetzt: JETZT, cfg: CFG });
  assert.deepEqual(r.treffer.map((t) => t.id), ['gd:acme/widgets#11', 'gd:acme/widgets#12']);
  assert.equal(r.weiter, true);
  assert.equal(r.cursor, 'CURSOR1');
  assert.equal(r.warnungen.length, 1, 'die Diskussion mit javascript:-Adresse zählt als unbrauchbar');
  const t = r.treffer[0];
  assert.equal(t.quelle, 'github-discussions');
  assert.equal(t.url, 'https://github.com/acme/widgets/discussions/11');
  assert.equal(t.ort, 'acme/widgets');
  assert.equal(t.kommentare, 1);
  assert.equal(t.wirkungRoh.reaktionen, 3);
  assert.equal(t.wirkungRoh.sterne, 1200);
  assert.deepEqual(t.labels, ['question']);
  assert.equal(t.sprache, 'typescript');
  assert.ok(t.erstellt.startsWith('2026-10-10') && t.codeVorhanden && t.fehlertext);
  const b = bewerte(t, { sprachen: ['typescript'], alterTage: { min: 2, max: 60 } });
  assert.ok(b.gesamt > 0 && b.wirkung > 30);
});

test('GD: Filter Mindest-Reaktionen und Alter', async () => {
  const daten = await fixture('github-discussions.json');
  const mit = parseDiskussionen(daten, { jetzt: JETZT, cfg: { ...CFG, githubDiscussions: { ...CFG.githubDiscussions, minReaktionen: 3 } } });
  assert.deepEqual(mit.treffer.map((t) => t.id), ['gd:acme/widgets#11']);
  const alt = parseDiskussionen(daten, { jetzt: Date.parse('2027-03-01T00:00:00Z'), cfg: CFG });
  assert.equal(alt.treffer.length, 0, 'älter als 60 Tage');
  const frisch = parseDiskussionen(daten, { jetzt: Date.parse('2026-10-10T12:00:00Z'), cfg: CFG });
  assert.equal(frisch.treffer.length, 0, 'jünger als 2 Tage');
});

test('GD: Suchanfrage – Repos gebündelt, Begriff bereinigt, nichts eingestellt = nichts abgefragt', () => {
  const q = planeAnfragen({ alterTage: { min: 2, max: 60 }, githubDiscussions: { repos: ['a/b', 'c/d', 'böse repo', 'x/y z'], suche: 'crash" repo:evil/x label:' } }, JETZT);
  assert.equal(q.length, 1);
  assert.equal(q[0], 'repo:a/b repo:c/d crash repo evil x label is:unanswered created:2026-09-02..2026-10-30');
  assert.equal(planeAnfragen({}, JETZT).length, 0);
  assert.equal(planeAnfragen({ githubDiscussions: { repos: Array.from({ length: 11 }, (_, i) => `a/r${i}`) } }, JETZT).length, 3);
  assert.equal(einstellungen({ githubDiscussions: { maxSeiten: 999, proSeite: 999 } }).maxSeiten, 10);
});

test('GD: mehrere Seiten werden über den Cursor geholt, Kennungen stabil, Anfrage nur an api.github.com', async () => {
  const [s1, s2] = [await fixture('github-discussions.json'), await fixture('github-discussions-2.json')];
  const aufrufe = [];
  const fetchImpl = async (url, o) => { aufrufe.push({ url, o, body: JSON.parse(o.body) }); return ok(aufrufe.length === 1 ? s1 : s2); };
  const fehler = [];
  const liste = await sucheDiskussionen(CFG, opt({ fetchImpl, fehler }));
  assert.equal(aufrufe.length, 2);
  assert.equal(aufrufe[0].url, 'https://api.github.com/graphql');
  assert.equal(aufrufe[0].o.method, 'POST');
  assert.equal(aufrufe[0].body.variables.after, null);
  assert.equal(aufrufe[1].body.variables.after, 'CURSOR1');
  assert.equal(aufrufe[0].o.headers.Authorization, `Bearer ${TOKEN}`);
  const ids = liste.map((t) => t.id);
  assert.deepEqual(ids, ['gd:acme/widgets#11', 'gd:acme/widgets#12', 'gd:acme/tools#21', 'gd:acme/tools#22']);
  assert.equal(new Set(ids).size, ids.length);
  // zweiter Lauf: dieselben Kennungen
  let n = 0;
  const wieder = await sucheDiskussionen(CFG, opt({ fetchImpl: async () => ok(n++ === 0 ? s1 : s2) }));
  assert.deepEqual(wieder.map((t) => t.id), ids);
  const t22 = liste.find((t) => t.id.endsWith('#22'));
  assert.equal(t22.wirkungRoh.stimmen, undefined);
  assert.equal(t22.wirkungRoh.sterne, undefined, 'fehlende Sterne bleiben fehlend → Ersatzgröße in der Bewertung');
  assert.equal(bewerte(t22, {}).wirkung, 42, 'Ersatzgröße 30 + 3 Reaktionen × 4');
  assert.ok(fehler.some((f) => /unbrauchbar/.test(f)), 'Warnung statt Abbruch');
});

test('GD: Seitenobergrenze wird eingehalten', async () => {
  const s1 = await fixture('github-discussions.json');
  let n = 0;
  await sucheDiskussionen({ ...CFG, githubDiscussions: { repos: ['acme/widgets'], maxSeiten: 2 } }, opt({ fetchImpl: async () => { n++; return ok(s1); } }));
  assert.equal(n, 2);
});

test('GD: Ratenlimit – kurze Wartezeit wird abgewartet, lange liefert Teilmenge', async () => {
  const [s1, s2] = [await fixture('github-discussions.json'), await fixture('github-discussions-2.json')];
  const schlaf = [];
  let n = 0;
  const kurz = await sucheDiskussionen(CFG, opt({ schlaf: async (ms) => schlaf.push(ms), fetchImpl: async () => {
    n++;
    if (n === 1) return fehl(403, 'limit', { 'retry-after': '2' });
    return ok(n === 2 ? s1 : s2);
  } }));
  assert.equal(kurz.length, 4);
  assert.deepEqual(schlaf, [2100]);

  n = 0;
  const fehler = [];
  const teil = await sucheDiskussionen(CFG, opt({ fetchImpl: async () => {
    n++;
    return n === 1 ? ok(s1, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(JETZT / 1000 + 3600) }) : ok(s2);
  }, uhr: () => JETZT, fehler }));
  assert.equal(n, 1, 'wegen langer Sperre keine zweite Anfrage');
  assert.deepEqual(teil.map((t) => t.id), ['gd:acme/widgets#11', 'gd:acme/widgets#12']);
  assert.ok(fehler.some((f) => /Ratenlimit/.test(f)));
});

test('GD: Fehlerantwort und unerwartete Form brechen nicht ab', async () => {
  const fehler = [];
  assert.deepEqual(await sucheDiskussionen(CFG, opt({ fehler, fetchImpl: async () => fehl(401, `Bad credentials ${TOKEN}`) })), []);
  assert.equal(fehler.length, 1, 'ein Fehler je Anfrage');
  const f2 = [];
  assert.deepEqual(await sucheDiskussionen(CFG, opt({ fehler: f2, fetchImpl: async () => ok({ data: null, errors: [{ message: 'Kaputt' }] }) })), []);
  assert.ok(f2.some((f) => /Kaputt/.test(f)));
  const f3 = [];
  assert.deepEqual(await sucheDiskussionen(CFG, opt({ fehler: f3, fetchImpl: async () => ok([1, 2]) })), []);
  assert.ok(f3.length > 0);
  const roh = parseDiskussionen({ data: { search: { nodes: [{ number: 1, title: 'x', url: 'https://github.com/a/b/discussions/1', createdAt: 'gestern', repository: { nameWithOwner: 'a/b' }, category: { isAnswerable: true } }] } } }, { jetzt: JETZT, cfg: {} });
  assert.equal(roh.treffer.length, 0);
  assert.equal(roh.weiter, false);
});

test('GD: ohne Token klare Meldung statt Absturz, keine Anfrage', async () => {
  const fehler = [];
  let n = 0;
  const liste = await sucheDiskussionen(CFG, { token: null, jetzt: JETZT, fehler, fetchImpl: async () => { n++; return ok({}); } });
  assert.deepEqual(liste, []);
  assert.equal(n, 0);
  assert.match(fehler[0], /kein GitHub-Token/);
  const leer = [];
  await sucheDiskussionen({}, { token: null, fehler: leer });
  assert.deepEqual(leer, [], 'nichts eingestellt: auch ohne Token keine Meldung');
});

test('GD: Token taucht in keiner Ausgabe auf', async () => {
  const logs = [];
  const fehler = [];
  const liste = await sucheDiskussionen(CFG, opt({ log: (s) => logs.push(s), fehler, fetchImpl: async (url, o) => (o.body.includes('after":null') && !logs.length ? fehl(500, `echo ${TOKEN}`) : fehl(401, `Bad ${TOKEN}`)) }));
  const alles = JSON.stringify([logs, fehler, liste, toHtml([], { fehler })]);
  assert.ok(!alles.includes(TOKEN) && !alles.includes('GEHEIMERTESTTOKEN'));
  assert.ok(fehler.length > 0);
});

test('GD: Fremdtext wird im HTML-Bericht maskiert', async () => {
  const liste = await sucheDiskussionen(CFG, opt({ fetchImpl: async (url, o) => ok(await fixture(JSON.parse(o.body).variables.after ? 'github-discussions-2.json' : 'github-discussions.json')) }));
  const bos = liste.find((t) => t.id.endsWith('#21'));
  assert.match(bos.titel, /<script>/, 'Titel bleibt Rohtext');
  const html = toHtml(liste.map((t) => bewerte(t, {})), {});
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!/href="(?!https:)/.test(html.replace(/href="#"/g, 'href="https:"')));
});

test('GD: sammle – Quelle gd läuft über die Registrierung, Token aus Umgebung', async () => {
  const s = await fixture('github-discussions.json');
  const { treffer, fehler } = await sammle(CFG, { quellen: ['gd'], jetzt: JETZT, env: { GITHUB_TOKEN: TOKEN }, fetchImpl: async () => ok({ ...s, data: { search: { ...s.data.search, pageInfo: { hasNextPage: false } } } }) });
  assert.equal(treffer.length, 2);
  assert.deepEqual(fehler.filter((f) => !/unbrauchbar/.test(f)), []);
});

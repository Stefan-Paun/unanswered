import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseIssues, parseProjekt, sucheGitlab, planeAnfragen, einstellungen, API } from '../lib/sources/gitlab.mjs';
import { sammle } from '../lib/sources/index.mjs';
import { bewerte } from '../lib/score.mjs';
import { toHtml } from '../lib/report/html.mjs';

const fixture = async (n) => JSON.parse(await readFile(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const JETZT = Date.parse('2026-11-01T00:00:00Z');
const TOKEN = 'gl-GEHEIMERTESTTOKEN0123';
const ok = (daten, h = {}) => ({ ok: true, status: 200, headers: new Map(Object.entries(h)), text: async () => JSON.stringify(daten) });
const fehl = (status, text = 'boom', h = {}) => ({ ok: false, status, headers: new Map(Object.entries(h)), text: async () => text });
const CFG = { alterTage: { min: 2, max: 60 }, gitlab: { projekte: ['acme/gitlab-demo'], labels: ['bug'], proSeite: 5 } };
const opt = (extra = {}) => ({ jetzt: JETZT, schlaf: async () => {}, ...extra });
// Router: Projekt-URL → Projekt, Issue-Seiten → Fixtures
const router = async (log = []) => {
  const [p1, p2, proj] = [await fixture('gitlab-issues.json'), await fixture('gitlab-issues-2.json'), await fixture('gitlab-projekt.json')];
  return async (url, o) => {
    log.push({ url, o });
    if (!url.includes('/issues')) return ok(proj);
    const seite = new URL(url).searchParams.get('page');
    return seite === '1' ? ok(p1, { 'x-next-page': '2' }) : ok(p2, { 'x-next-page': '' });
  };
};

test('GL: Normalfall – nur offene, unkommentierte, nicht zugewiesene, gitlab.com-Issues', async () => {
  const r = parseIssues(await fixture('gitlab-issues.json'), { jetzt: JETZT, cfg: CFG });
  assert.deepEqual(r.treffer.map((t) => t.id), ['gl:acme/gitlab-demo#1']);
  assert.equal(r.warnungen.length, 1, 'fremde Adresse, Text und Objekt ohne Felder');
  const t = r.treffer[0];
  assert.equal(t.quelle, 'gitlab');
  assert.equal(t.url, 'https://gitlab.com/acme/gitlab-demo/-/issues/1');
  assert.equal(t.ort, 'acme/gitlab-demo');
  assert.deepEqual(t.labels, ['bug', 'help wanted']);
  assert.equal(t.kommentare, 0);
  assert.equal(t.wirkungRoh.stimmen, 2);
  assert.ok(t.codeVorhanden && t.fehlertext);
  assert.equal(parseProjekt(await fixture('gitlab-projekt.json')).sterne, 340);
  assert.equal(parseProjekt(null), null);
});

test('GL: Anfrage – feste Basisadresse, Filter, Bereinigung, nichts eingestellt = nichts abgefragt', () => {
  const q = planeAnfragen({ alterTage: { min: 2, max: 60 }, gitlab: { projekte: ['g/s/p', 'ohne-slash', '../x/../y', 'a/b?x=1'], labels: ['bug', 'a,b'], suche: 'crash&x=1' } }, JETZT);
  assert.equal(q.length, 1);
  assert.ok(q[0].startsWith(`${API}/projects/g%2Fs%2Fp/issues?`));
  const u = new URL(q[0]);
  assert.equal(u.host, 'gitlab.com');
  assert.equal(u.searchParams.get('state'), 'opened');
  assert.equal(u.searchParams.get('labels'), 'bug');
  assert.equal(u.searchParams.get('search'), 'crash x 1');
  assert.equal(u.searchParams.get('created_before'), '2026-10-30T00:00:00.000Z');
  assert.equal(planeAnfragen({}, JETZT).length, 0);
  assert.ok(planeAnfragen({ gitlab: { suche: 'x' } }, JETZT)[0].startsWith(`${API}/issues?`));
  assert.equal(einstellungen({ gitlab: { baseUrl: 'https://evil.example', url: 'https://evil.example' } }).projekte.length, 0);
});

test('GL: mehrere Seiten über x-next-page, Kennungen stabil, Token nur an gitlab.com', async () => {
  const log = [];
  const fetchImpl = await router(log);
  const fehler = [];
  const liste = await sucheGitlab(CFG, opt({ token: TOKEN, fetchImpl, fehler }));
  const ids = liste.map((t) => t.id);
  assert.deepEqual(ids, ['gl:acme/gitlab-demo#1', 'gl:acme/gitlab-demo#21', 'gl:77#22'.replace('77', '88')]);
  assert.ok(log.every((a) => a.url.startsWith('https://gitlab.com/api/v4/')));
  assert.ok(log.every((a) => a.o.headers['PRIVATE-TOKEN'] === TOKEN));
  assert.ok(log.every((a) => !a.url.includes(TOKEN)));
  assert.equal(log.filter((a) => a.url.includes('/issues')).length, 2);
  const wieder = await sucheGitlab(CFG, opt({ token: TOKEN, fetchImpl: await router() }));
  assert.deepEqual(wieder.map((t) => t.id), ids);
  const t = liste[0];
  assert.equal(t.wirkungRoh.sterne, 340, 'Sterne aus dem Projekt');
  const ohneStimmen = liste.find((x) => x.id.endsWith('#21'));
  assert.equal(ohneStimmen.wirkungRoh.stimmen, 0, 'fehlende Stimmen = 0');
  const ohneSterne = liste.find((x) => x.id === 'gl:88#22');
  assert.equal(bewerte(ohneSterne, {}).wirkung, 38, 'Ersatzgröße 30 + 2 Stimmen × 4');
  assert.deepEqual(ohneSterne.labels, []);
});

test('GL: ohne Token nur öffentliche Daten (kein Header), Suche über alle Projekte braucht Token', async () => {
  const log = [];
  const liste = await sucheGitlab(CFG, opt({ fetchImpl: await router(log) }));
  assert.ok(liste.length > 0);
  assert.ok(log.every((a) => !('PRIVATE-TOKEN' in a.o.headers)));
  const fehler = [];
  let n = 0;
  const leer = await sucheGitlab({ gitlab: { suche: 'crash' } }, opt({ fehler, fetchImpl: async () => { n++; return ok([]); } }));
  assert.deepEqual(leer, []);
  assert.equal(n, 0);
  assert.match(fehler[0], /braucht einen Token/);
  const still = [];
  await sucheGitlab({}, opt({ fehler: still }));
  assert.deepEqual(still, []);
});

test('GL: Seitenobergrenze', async () => {
  let n = 0;
  const p1 = await fixture('gitlab-issues.json');
  await sucheGitlab({ ...CFG, gitlab: { ...CFG.gitlab, maxSeiten: 2 } }, opt({ fetchImpl: async (url) => { if (!url.includes('/issues')) return ok({ star_count: 1 }); n++; return ok(p1, { 'x-next-page': String(n + 1) }); } }));
  assert.equal(n, 2);
});

test('GL: Ratenlimit – kurz abwarten, lang → Teilmenge und Meldung', async () => {
  const schlaf = [];
  const base = await router();
  let n = 0;
  const kurz = await sucheGitlab(CFG, opt({ schlaf: async (ms) => schlaf.push(ms), fetchImpl: async (url, o) => (url.includes('page=2') && ++n === 1 ? fehl(429, 'Retry later', { 'retry-after': '4' }) : base(url, o)) }));
  assert.equal(kurz.length, 3);
  assert.deepEqual(schlaf, [4100]);

  const fehler = [];
  const teil = await sucheGitlab(CFG, opt({ fehler, fetchImpl: async (url, o) => (url.includes('page=2') ? fehl(429, 'x', { 'retry-after': '900' }) : base(url, o)) }));
  assert.deepEqual(teil.map((t) => t.id), ['gl:acme/gitlab-demo#1']);
  assert.ok(fehler.some((f) => /Ratenlimit/.test(f)));

  const vorab = [];
  await sucheGitlab(CFG, opt({ uhr: () => JETZT, fehler: vorab, fetchImpl: async (url, o) => { const r = await base(url, o); if (url.includes('page=1')) r.headers = new Map([['x-next-page', '2'], ['ratelimit-remaining', '0'], ['ratelimit-reset', String(JETZT / 1000 + 3000)]]); return r; } }));
  assert.ok(vorab.some((f) => /über der Grenze/.test(f)));
});

test('GL: Fehlerantwort, kaputtes JSON und unerwartete Form brechen den Scan nicht ab', async () => {
  const f1 = [];
  assert.deepEqual(await sucheGitlab(CFG, opt({ fehler: f1, fetchImpl: async () => fehl(404, 'Not found') })), []);
  assert.ok(f1.length >= 1 && f1.every((f) => /HTTP 404/.test(f)));
  const f2 = [];
  const kaputt = async () => ({ ok: true, status: 200, headers: new Map(), text: async () => '<html>oops' });
  assert.deepEqual(await sucheGitlab(CFG, opt({ fehler: f2, fetchImpl: kaputt })), []);
  assert.ok(f2.some((f) => /Keine JSON-Antwort/.test(f)));
  const f3 = [];
  assert.deepEqual(await sucheGitlab(CFG, opt({ fehler: f3, fetchImpl: async () => ok({ message: 'anders' }) })), []);
  assert.ok(f3.length > 0);
  assert.deepEqual(parseIssues(null).treffer, []);
  const f4 = [];
  let n = 0;
  const heilt = await sucheGitlab(CFG, opt({ fehler: f4, fetchImpl: async (url, o) => (++n === 2 ? fehl(503, 'kurz weg') : (await router())(url, o)) }));
  assert.ok(heilt.length > 0 && f4.every((f) => /unbrauchbar/.test(f)), 'vorübergehender Fehler wird wiederholt');
});

test('GL: Token taucht in keiner Ausgabe auf', async () => {
  const logs = [];
  const fehler = [];
  const liste = await sucheGitlab(CFG, opt({ token: TOKEN, log: (s) => logs.push(s), fehler, fetchImpl: async () => fehl(401, `{"message":"invalid ${TOKEN}"}`) }));
  const alles = JSON.stringify([logs, fehler, liste, toHtml([], { fehler })]);
  assert.ok(!alles.includes('GEHEIMERTESTTOKEN'));
  assert.ok(fehler.length > 0);
});

test('GL: Fremdtext wird im HTML-Bericht maskiert, Adressen nur https', async () => {
  const liste = await sucheGitlab(CFG, opt({ fetchImpl: await router() }));
  const bos = liste.find((t) => t.id.endsWith('#21'));
  assert.match(bos.titel, /<img/);
  const html = toHtml(liste.map((t) => bewerte(t, {})), {});
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!/href="http:/.test(html));
  const lang = parseIssues([{ ...(await fixture('gitlab-issues.json'))[0], title: 'x'.repeat(5000), description: 'y'.repeat(100000), labels: Array.from({ length: 50 }, (_, i) => 'l'.repeat(500) + i) }], { jetzt: JETZT, cfg: CFG }).treffer[0];
  assert.ok(lang.titel.length <= 300 && lang.text.length <= 8000 && lang.labels.length <= 10 && lang.labels.every((l) => l.length <= 50));
});

test('GL: sammle mit allen neuen Quellen läuft durch (Fixture-Modus, ohne Netz)', async () => {
  const [gd1, gd2] = [await fixture('github-discussions.json'), await fixture('github-discussions-2.json')];
  const gl = await router();
  const fetchImpl = async (url, o) => {
    if (url.startsWith('https://api.github.com/graphql')) return ok(JSON.parse(o.body).variables.after ? gd2 : gd1);
    if (url.startsWith('https://gitlab.com/')) return gl(url, o);
    throw new Error(`unerwartete Adresse ${url}`);
  };
  const cfg = { ...CFG, githubDiscussions: { repos: ['acme/widgets'], proSeite: 5 }, discourse: { foren: [] }, stackoverflow: { tags: [] }, sprachen: [] };
  const logs = [];
  const { treffer } = await sammle(cfg, { quellen: ['gd', 'gl'], jetzt: JETZT, env: { GITHUB_TOKEN: TOKEN }, fetchImpl, schlaf: async () => {}, log: (s) => logs.push(s) });
  assert.equal(treffer.filter((t) => t.quelle === 'github-discussions').length, 4);
  assert.equal(treffer.filter((t) => t.quelle === 'gitlab').length, 3);
  assert.ok(!logs.join('\n').includes(TOKEN));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseIssues, parseRepo, suchanfrage, repoAusUrl, sucheGithub, WARTE_SEK } from '../lib/sources/github.mjs';
import { parseFragen, sucheStackoverflow } from '../lib/sources/stackoverflow.mjs';
import { parseThemen, sucheDiscourse } from '../lib/sources/discourse.mjs';
import { sammle, QUELLEN } from '../lib/sources/index.mjs';
import { ohneQuery } from '../lib/http.mjs';

const fixture = async (n) => JSON.parse(await readFile(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const antwort = (daten, status = 200) => ({ ok: status < 400, status, headers: new Map(), text: async () => JSON.stringify(daten) });

test('GitHub: Suchanfrage, Repo-Name, Issues und Repo-Infos', async () => {
  const q = suchanfrage({ sprache: 'python', label: 'bug', minAlterTage: 2, maxAlterTage: 60, jetzt: Date.parse('2026-11-01T00:00:00Z') });
  assert.equal(q, 'is:issue is:open comments:0 no:assignee created:2026-09-02..2026-10-30 language:python label:"bug"');
  assert.equal(repoAusUrl('https://api.github.com/repos/a/b'), 'a/b');
  const liste = parseIssues(await fixture('github-search.json'), { sprache: 'javascript' });
  assert.equal(liste.length, 10);
  for (const t of liste) {
    assert.match(t.id, /^gh:[^/]+\/[^#]+#\d+$/);
    assert.equal(t.quelle, 'github');
    assert.equal(t.sprache, 'javascript');
    assert.ok(t.url.startsWith('https://github.com/'));
    assert.equal(t.kommentare, 0);
  }
  const r = parseRepo(await fixture('github-repo.json'));
  assert.equal(r.sterne, 4837);
  assert.equal(r.fork, false);
});

test('GitHub: Pull Requests fliegen raus, Reaktionen werden gezählt', () => {
  const liste = parseIssues({ items: [
    { number: 1, title: 'PR', html_url: 'u', state: 'open', pull_request: {}, repository_url: 'x/repos/a/b', created_at: '2026-10-01T00:00:00Z' },
    { number: 2, title: 'Bug', html_url: 'u', state: 'open', repository_url: 'x/repos/a/b', created_at: '2026-10-01T00:00:00Z', reactions: { total_count: 7 } },
  ] });
  assert.equal(liste.length, 1);
  assert.equal(liste[0].wirkungRoh.reaktionen, 7);
});

test('GitHub: bei 403 einmal warten und erneut versuchen', async () => {
  const such = await fixture('github-search.json');
  let n = 0;
  const fetchImpl = async (url) => {
    if (url.includes('/search/')) return ++n === 1 ? { ok: false, status: 403, headers: new Map([['retry-after', '0']]), text: async () => 'secondary rate limit' } : antwort(such);
    return antwort({ stargazers_count: 999 });
  };
  const cfg = { sprachen: ['javascript'], alterTage: { max: 60 }, github: { labels: ['bug'], minSterne: 1, proSprache: 10 } };
  const liste = await sucheGithub(cfg, { token: 'x', fetchImpl });
  assert.equal(n, 2);
  assert.ok(liste.length > 0);
});

test('GitHub: sucheGithub lädt Sterne nach und filtert kleine Repos', async () => {
  const such = await fixture('github-search.json');
  const repo = await fixture('github-repo.json');
  const aufrufe = [];
  const fetchImpl = async (url) => {
    aufrufe.push(url);
    if (url.includes('/search/issues')) return antwort(such);
    if (url.includes('/repos/Fei2411/DS-Bot')) return antwort(repo);
    return antwort({ stargazers_count: 3, fork: false }, 200);
  };
  const cfg = { sprachen: ['javascript'], alterTage: { max: 60 }, github: { labels: ['bug'], minSterne: 20, proSprache: 10, maxRepoAbfragen: 40 } };
  const liste = await sucheGithub(cfg, { token: 'x', fetchImpl });
  assert.equal(aufrufe.filter((u) => u.includes('/search/')).length, 1);
  assert.ok(liste.every((t) => t.wirkungRoh.sterne >= 20));
  assert.ok(liste.some((t) => t.ort === 'Fei2411/DS-Bot'));
  assert.ok(aufrufe.every((u) => !u.includes('token')), 'Token darf nie in der URL stehen');
});

test('Stack Overflow: Fragen parsen, HTML entfernen, Quota-Stopp', async () => {
  const liste = parseFragen(await fixture('stackoverflow-no-answers.json'));
  assert.equal(liste.length, 10);
  assert.ok(liste.every((t) => t.id.startsWith('so:') && t.antworten === 0 && !/<p>/.test(t.text)));
  assert.ok(liste.some((t) => t.wirkungRoh.aufrufe > 0));
  const logs = [];
  const fetchImpl = async () => antwort({ items: [], quota_remaining: 5, quota_max: 300 });
  const cfg = { stackoverflow: { tags: ['a', 'b', 'c'], minQuota: 20 }, alterTage: { max: 60 } };
  await sucheStackoverflow(cfg, { fetchImpl, key: null, log: (s) => logs.push(s) });
  assert.ok(logs.some((s) => /Quota fast leer/.test(s)));
  assert.equal(logs.filter((s) => /^stackoverflow [abc]:/.test(s)).length, 1);
});

test('Discourse: Themen ohne Antwort, URL-Aufbau, Forum-Fehler bricht andere nicht ab', async () => {
  const forum = { host: 'discuss.python.org', sprache: 'python', gewicht: 60 };
  const liste = parseThemen(await fixture('discourse-search.json'), forum);
  assert.ok(liste.length > 10);
  assert.ok(liste.every((t) => t.url.startsWith('https://discuss.python.org/t/') && t.sprache === 'python' && t.wirkungRoh.gewicht === 60));
  const daten = await fixture('discourse-search.json');
  const fetchImpl = async (url) => (url.includes('kaputt') ? antwort({ e: 1 }, 500) : antwort(daten));
  const cfg = { discourse: { foren: [{ host: 'kaputt.example', gewicht: 1 }, forum] } };
  const logs = [];
  const alle = await sucheDiscourse(cfg, { fetchImpl, log: (s) => logs.push(s) });
  assert.equal(alle.length, liste.length);
  assert.ok(logs.some((s) => /kaputt.example: Fehler/.test(s)));
});

test('sammle meldet unbekannte Quellen als Fehler statt zu werfen', async () => {
  const { treffer, fehler } = await sammle({ discourse: { foren: [] } }, { quellen: ['dc', 'xx'] });
  assert.deepEqual(treffer, []);
  assert.deepEqual(fehler, ['Unbekannte Quelle xx']);
  await assert.rejects(sammle({}, { quellen: [] }), /Keine Quelle/);
});

test('sammle: Quelle, die nur Fehler liefert, gilt als ausgefallen', async () => {
  const original = QUELLEN.dc.lauf;
  QUELLEN.dc.lauf = async (cfg, o) => {
    const kaputt = async () => ({ ok: false, status: 500, headers: new Map(), text: async () => 'boom' });
    return original(cfg, { ...o, fetchImpl: kaputt });
  };
  try {
    const { treffer, fehler, ausgefallen } = await sammle({ discourse: { foren: [{ host: 'a.example' }, { host: 'b.example' }] } }, { quellen: ['dc'] });
    assert.deepEqual(treffer, []);
    assert.equal(fehler.length, 2);
    assert.deepEqual(ausgefallen, ['discourse']);
  } finally {
    QUELLEN.dc.lauf = original;
  }
});

test('Stack-Apps-Key steht nie in Fehlermeldungen oder Logs', async () => {
  assert.equal(ohneQuery('https://api.stackexchange.com/2.3/q?key=GEHEIM&x=1'), 'https://api.stackexchange.com/2.3/q');
  const logs = [];
  const fehler = [];
  const fetchImpl = async () => ({ ok: false, status: 500, headers: new Map(), text: async () => 'boom' });
  await sucheStackoverflow({ stackoverflow: { tags: ['a'] }, alterTage: { max: 60 } }, { fetchImpl, key: 'GEHEIMKEY123', log: (s) => logs.push(s), fehler });
  assert.ok(![...logs, ...fehler].some((s) => s.includes('GEHEIMKEY123')));
  assert.equal(fehler.length, 1);
});

test('GitHub: Repo-Fehler außer 404 landen in fehler, 404 nicht', async () => {
  const such = await fixture('github-search.json');
  const fehler = [];
  const fetchImpl = async (url) => (url.includes('/search/') ? antwort(such) : antwort({ e: 1 }, 500));
  const cfg = { sprachen: ['javascript'], alterTage: {}, github: { labels: ['bug'], minSterne: 0, proSprache: 10 } };
  const liste = await sucheGithub(cfg, { token: 'x', fetchImpl, fehler });
  assert.equal(liste.length, 0);
  assert.ok(fehler.length > 0 && fehler.every((f) => /github repo .*HTTP 500/.test(f)));
  const f404 = [];
  const fetch404 = async (url) => (url.includes('/search/') ? antwort(such) : antwort({ message: 'Not Found' }, 404));
  await sucheGithub(cfg, { token: 'x', fetchImpl: fetch404, fehler: f404 });
  assert.deepEqual(f404, []);
});

test('GitHub: ohne Retry-After-Header (echte Headers) wird nicht 0 s gewartet', async () => {
  assert.deepEqual(WARTE_SEK, [5, 20, 60]);
  const logs = [];
  let n = 0;
  const fetchImpl = async (url) => {
    if (url.includes('/search/')) return ++n === 1 ? { ok: false, status: 403, headers: new Headers(), text: async () => 'limit' } : antwort({ items: [], total_count: 0 });
    return antwort({ stargazers_count: 1 });
  };
  const start = Date.now();
  await sucheGithub({ sprachen: ['python'], alterTage: {}, github: { labels: ['bug'], minSterne: 0 } }, { token: 'x', fetchImpl, log: (s) => logs.push(s) });
  assert.ok(logs.some((s) => /warte 5 s \(Versuch 1\/3\)/.test(s)), logs.join('|'));
  assert.ok(Date.now() - start >= 5000);
});

test('GitHub: Retry-After 0 wartet nicht 60 s', async () => {
  const start = Date.now();
  let n = 0;
  const fetchImpl = async (url) => {
    if (url.includes('/search/')) return ++n === 1 ? { ok: false, status: 403, headers: new Map([['retry-after', '0']]), text: async () => 'limit' } : antwort({ items: [], total_count: 0 });
    return antwort({ stargazers_count: 1 });
  };
  await sucheGithub({ sprachen: ['python'], alterTage: {}, github: { labels: ['bug'], minSterne: 0 } }, { token: 'x', fetchImpl });
  assert.ok(Date.now() - start < 15000, 'nur Takt (5 s) plus 1 s Mindestwartezeit, nicht 60 s');
});

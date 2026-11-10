import { test } from 'node:test';
import assert from 'node:assert/strict';
import { erstelleAbruf, wartezeitSek, verdecke } from '../lib/abruf.mjs';

const ok = (daten, h = {}) => ({ ok: true, status: 200, headers: new Map(Object.entries(h)), text: async () => JSON.stringify(daten) });
const fehl = (status, text = 'boom', h = {}) => ({ ok: false, status, headers: new Map(Object.entries(h)), text: async () => text });
const bau = (antworten, extra = {}) => {
  const schlaf = [];
  let n = 0;
  const fetchImpl = async (url, opt) => { const a = antworten[Math.min(n++, antworten.length - 1)]; return typeof a === 'function' ? a(url, opt) : a; };
  const abruf = erstelleAbruf({ name: 'test', fetchImpl, schlaf: async (ms) => schlaf.push(ms), ...extra });
  return { abruf, schlaf, aufrufe: () => n };
};

test('Abruf: 5xx wird wiederholt, 4xx nicht', async () => {
  const a = bau([fehl(503), ok({ a: 1 })]);
  assert.deepEqual((await a.abruf('https://x.example/a')).daten, { a: 1 });
  assert.equal(a.aufrufe(), 2);
  assert.deepEqual(a.schlaf, [1000]);
  const b = bau([fehl(404, 'weg'), ok({})]);
  await assert.rejects(b.abruf('https://x.example/a'), (e) => e.status === 404 && /HTTP 404/.test(e.message));
  assert.equal(b.aufrufe(), 1);
  const c = bau([fehl(500)]);
  await assert.rejects(c.abruf('https://x.example/a'), /HTTP 500/);
  assert.equal(c.aufrufe(), 3, 'ein Versuch plus zwei Wiederholungen');
});

test('Abruf: Zeitlimit zählt als vorübergehend', async () => {
  const haengt = (url, opt) => new Promise((_, rej) => opt.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const a = bau([haengt, ok({ ok: 1 })], { timeoutMs: 10 });
  assert.deepEqual((await a.abruf('https://x.example/a')).daten, { ok: 1 });
});

test('Abruf: Ratenlimit 429 mit Retry-After wartet, zu lange Wartezeit bricht sauber ab', async () => {
  const a = bau([fehl(429, 'slow', { 'retry-after': '3' }), ok({ x: 1 })]);
  await a.abruf('https://x.example/a');
  assert.deepEqual(a.schlaf, [3100]);
  const b = bau([fehl(429, 'slow', { 'retry-after': '500' }), ok({})]);
  await assert.rejects(b.abruf('https://x.example/a'), (e) => e.ratenlimit === true && /über der Grenze/.test(e.message));
  assert.equal(b.aufrufe(), 1);
});

test('Abruf: Restkontingent 0 bremst die nächste Anfrage vorab', async () => {
  const jetzt = 1_800_000_000_000;
  const a = bau([ok({}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(jetzt / 1000 + 5) }), ok({})], { uhr: () => jetzt });
  await a.abruf('https://x.example/1');
  assert.deepEqual(a.schlaf, []);
  await a.abruf('https://x.example/2');
  assert.deepEqual(a.schlaf, [5100]);
});

test('Abruf: Ratenlimit als GraphQL-Fehler im 200er und 403 mit leerem Kontingent', async () => {
  const a = bau([ok({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }, { 'retry-after': '1' }), ok({ data: 1 })]);
  assert.deepEqual((await a.abruf('https://x.example/g')).daten, { data: 1 });
  const b = bau([fehl(403, 'nope', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1' }), ok({})]);
  await b.abruf('https://x.example/g');
  assert.equal(b.aufrufe(), 2);
  const c = bau([fehl(403, 'forbidden')]);
  await assert.rejects(c.abruf('https://x.example/g'), (e) => e.status === 403 && !e.ratenlimit);
});

test('Abruf: Geheimnisse stehen nie in Fehlermeldungen', async () => {
  const a = bau([fehl(401, 'bad token ghp_GEHEIM123456')], { geheimnisse: ['ghp_GEHEIM123456'] });
  await assert.rejects(a.abruf('https://x.example/g?t=1'), (e) => !e.message.includes('GEHEIM') && /\*\*\*/.test(e.message));
  assert.equal(verdecke('a SECRET b', ['SECRET']), 'a *** b');
  assert.equal(wartezeitSek(new Map([['retry-after', '7']])), 7);
  assert.equal(wartezeitSek(new Map()), null);
});

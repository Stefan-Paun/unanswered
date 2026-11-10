import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHtml, esc } from '../lib/report/html.mjs';
import { toMarkdown } from '../lib/report/markdown.mjs';
import { toConsole } from '../lib/report/summary.mjs';
import { dossierText, dateiname, schreibeDossier } from '../lib/dossier.mjs';
import { sichereUrl } from '../lib/report/html.mjs';
import { treffer } from '../lib/normalize.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const t = { id: 'gh:a/b#1', quelle: 'github', titel: '<script>alert(1)</script> & TypeError', url: 'https://github.com/a/b/issues/1', ort: 'a/b', sprache: 'javascript',
  alterTage: 12.4, codeVorhanden: true, fehlertext: true, labels: ['bug'], tags: [], text: 'Body | mit Pipe', erstellt: '2026-10-20T00:00:00Z',
  loesbarkeit: 80, wirkung: 50, gesamt: 63, wirkungRoh: { sterne: 120, forks: 3 } };

test('HTML: kein Script, Titel escaped, Dracula-Hintergrund, Link vorhanden', () => {
  const h = toHtml([t], { when: '2026-11-01 10:00', gesamt: 1, neu: 1, fehler: ['so: kaputt <x>'] });
  assert.ok(!/<script/i.test(h));
  assert.ok(h.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; TypeError'));
  assert.ok(h.includes('#282a36'));
  assert.ok(h.includes('href="https://github.com/a/b/issues/1"'));
  assert.ok(h.includes('so: kaputt &lt;x&gt;'));
  assert.ok(toHtml([], {}).includes('Nichts Neues'));
  assert.equal(esc(`"'`), '&quot;&#39;');
  assert.ok(h.includes('Content-Security-Policy'));
  assert.equal(sichereUrl('javascript:alert(1)'), '#');
  assert.equal(sichereUrl('https://a.example/x'), 'https://a.example/x');
  assert.ok(toHtml([{ ...t, url: 'javascript:alert(1)' }], {}).includes('href="#"'));
});

test('Dossier wird nicht überschrieben, außer mit force', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ungeloest-dossier-'));
  try {
    const p1 = await schreibeDossier(t, dir);
    assert.ok(p1.startsWith(dir));
    await assert.rejects(schreibeDossier(t, dir), /existiert schon/);
    assert.equal(await schreibeDossier(t, dir, { force: true }), p1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Konsole und Dossier entfernen Steuerzeichen aus Fremdtext', () => {
  const fies = { ...t, titel: 'Bug \x1b]0;pwned\x07\x1b[2J hier', text: 'a\x1b[31mb' };
  const k = toConsole([fies], {}, { farben: false });
  const roh = treffer({ id: 'x', quelle: 'github', titel: 't', url: 'https://a.example/\x1b[2J', text: '', erstellt: '2026-10-01T00:00:00Z', labels: ['x\x1b[2Jy'], tags: ['a\x1b]0;b\x07c'], ort: 'o\x07' });
  assert.deepEqual([roh.url, roh.labels[0], roh.tags[0], roh.ort], ['https://a.example/', 'xy', 'ac', 'o']);
  assert.ok(!k.includes('\x1b') && !k.includes('\x07'));
  assert.ok(!dossierText(fies).includes('\x1b'));
});

test('Markdown und Konsole enthalten ID, URL und Werte', () => {
  const m = toMarkdown([t], { when: 'x' });
  assert.ok(m.includes('| 63 | 80 | 50 | GH | 12d |') && m.includes('`gh:a/b#1`'), 'ID bleibt kopierbar');
  assert.ok(toMarkdown([{ ...t, url: 'https://x.example/a%20b' }], {}).includes('(https://x.example/a%20b)'), 'keine Doppelkodierung');
  assert.ok(m.includes('\\<script\\>'), 'Titel ist im Markdown escaped');
  const boese = toMarkdown([{ ...t, titel: 'a](http://evil.example) [b', url: 'https://x.example/t/slug (1)/9' }], {});
  assert.ok(!boese.includes('](http://evil.example)'), 'kein eingeschleuster Link');
  assert.ok(boese.includes('https://x.example/t/slug%20%281%29/9'));
  const k = toConsole([t], { when: 'x', gesamt: 1, neu: 1 }, { farben: false });
  assert.ok(k.includes('63') && k.includes('https://github.com/a/b/issues/1'));
  assert.ok(toConsole([], {}, { farben: false }).includes('Nichts Neues'));
});

test('Dossier: Checkliste je Quelle, Stack-Overflow-Regel, Dateiname sicher', () => {
  const d = dossierText(t, new Date('2026-11-01T00:00:00Z'));
  assert.ok(d.startsWith('# <script>alert(1)</script> & TypeError'));
  assert.ok(d.includes('CONTRIBUTING.md') && d.includes('Stefan postet selbst'));
  const so = dossierText({ ...t, quelle: 'stackoverflow', id: 'so:1' });
  assert.ok(so.includes('verbietet KI-generierte Antworten'));
  assert.match(dateiname('gh:a/b#1'), /^gh-a-b-1-[0-9a-f]{6}\.md$/);
  assert.match(dateiname('../../etc/passwd'), /^etc-passwd-[0-9a-f]{6}\.md$/);
  assert.notEqual(dateiname('gh:a/b_c#1'), dateiname('gh:a/b-c#1'), 'verschiedene Repos, verschiedene Dateien');
  assert.ok(d.includes('Fremdtext aus dem Netz'));
  const crlf = dossierText({ ...t, text: 'zeile1\r\nzeile2' });
  assert.ok(crlf.includes('> zeile1\n> zeile2'), 'CRLF wird zu einfachen Zitatzeilen');
});

test('HTML: nur https-Adressen werden verlinkt', async () => {
  const { sichereUrl } = await import('../lib/report/html.mjs');
  assert.equal(sichereUrl('https://gitlab.com/a/b/-/issues/1'), 'https://gitlab.com/a/b/-/issues/1');
  for (const u of ['http://example.com/x', 'javascript:alert(1)', 'data:text/html,x', '//evil.example', '']) assert.equal(sichereUrl(u), '#');
});

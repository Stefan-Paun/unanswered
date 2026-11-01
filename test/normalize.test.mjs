import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hatCode, hatFehlertext, alterInTagen, erkenneSprache, treffer, ausgeschlossen, entferneHtml, kuerze, saeubere, alsIso } from '../lib/normalize.mjs';

test('hatCode erkennt Markdown-Blöcke, Stacktraces und HTML-pre', () => {
  assert.ok(hatCode('x\n```js\nconsole.log(1)\n```'));
  assert.ok(hatCode('Traceback (most recent call last):\n  File "a.py", line 3'));
  assert.ok(hatCode('    at foo (/app/index.js:10:5)'));
  assert.ok(hatCode('<pre><code>const a = 1;</code></pre>'));
  assert.ok(!hatCode('Mein Programm geht nicht, bitte helft mir.'));
});

test('hatFehlertext findet typische Fehlernamen', () => {
  assert.ok(hatFehlertext('TypeError: x is not a function'));
  assert.ok(hatFehlertext('ModuleNotFoundError beim Start'));
  assert.ok(hatFehlertext('Cannot read properties of undefined'));
  assert.ok(hatFehlertext('Error: boom'));
  assert.ok(hatFehlertext('the app crashes on start'));
  assert.ok(hatFehlertext('thread panics'));
  assert.ok(!hatFehlertext('Wie sortiere ich eine Liste?'));
});

test('alterInTagen versteht ISO, Sekunden und Millisekunden', () => {
  const jetzt = Date.parse('2026-11-01T12:00:00Z');
  assert.equal(Math.round(alterInTagen('2026-10-22T12:00:00Z', jetzt)), 10);
  assert.equal(Math.round(alterInTagen(Math.floor(jetzt / 1000) - 86_400 * 3, jetzt)), 3);
  assert.equal(alterInTagen('kein datum', jetzt), null);
});

test('erkenneSprache nimmt den ersten bekannten Kandidaten', () => {
  assert.equal(erkenneSprache(['flutter', 'node.js']), 'javascript');
  assert.equal(erkenneSprache(['python-3.x']), 'python');
  assert.equal(erkenneSprache(['cobol']), null);
});

test('treffer setzt abgeleitete Felder', () => {
  const t = treffer({ id: 'x:1', quelle: 'github', titel: ' TypeError beim Start ', url: 'u', text: '```\ncode()\n```', erstellt: '2026-10-20T00:00:00Z' }, Date.parse('2026-10-30T00:00:00Z'));
  assert.equal(t.titel, 'TypeError beim Start');
  assert.ok(t.codeVorhanden && t.fehlertext);
  assert.equal(Math.round(t.alterTage), 10);
});

test('saeubere entfernt Steuerzeichen und CRLF, alsIso normalisiert Epoch und ISO', () => {
  assert.equal(saeubere('a\x1b[2Jb\r\nc\td'), 'ab\nc\td');
  assert.equal(alsIso(1730000000), '2024-10-27T03:33:20.000Z');
  assert.equal(alsIso('2026-10-20T00:00:00Z'), '2026-10-20T00:00:00.000Z');
  assert.equal(alsIso('quatsch'), null);
  const so = treffer({ id: 'so:1', quelle: 'stackoverflow', titel: 'x', url: 'u', erstellt: 1730000000 });
  assert.equal(so.erstellt, '2024-10-27T03:33:20.000Z');
});

test('ausgeschlossen greift bei Titelmustern und Repos', () => {
  const a = { titelMuster: ['review request', '^pep\\b'], repos: ['foo/bar'] };
  assert.ok(ausgeschlossen({ titel: 'Review Request for PR 1', ort: 'x' }, a));
  assert.ok(ausgeschlossen({ titel: 'PEP 999: Dinge', ort: 'x' }, a));
  assert.ok(ausgeschlossen({ titel: 'Bug', ort: 'foo/bar' }, a));
  assert.ok(!ausgeschlossen({ titel: 'Bug', ort: 'x' }, a));
});

test('entferneHtml behält pre als Codeblock, kuerze schneidet', () => {
  const t = entferneHtml('<p>Hi &amp; <b>du</b></p><pre><code>a &lt; b</code></pre>');
  assert.match(t, /Hi & du/);
  assert.match(t, /```\na < b\n```/);
  assert.equal(kuerze('a'.repeat(50), 10).length, 10);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waehle, baueDigest, merke, leereMerkliste, hebeMerklisteAn, begruende, aufwand, interessenTreffer, konfig,
  scanStand, alterText, streuSchluessel, STANDARD } from '../lib/digest.mjs';

const JETZT = new Date('2026-11-10T06:00:00.000Z');
const SCAN = '2026-11-10T05:30:00.000Z';

// Ein bewerteter Treffer mit festen Zahlen; alles Weitere lässt sich überschreiben.
function fund(id, gesamt, mehr = {}) {
  const kuerzel = id.split(':')[0];
  const quelle = { gh: 'github', so: 'stackoverflow', dc: 'discourse', gd: 'github-discussions', gl: 'gitlab' }[kuerzel];
  const ort = quelle === 'stackoverflow' ? 'stackoverflow.com' : id.slice(kuerzel.length + 1).split(/[#/]\d+$/)[0];
  return { id, quelle, ort, titel: `Titel ${id}`, url: `https://example.org/${encodeURIComponent(id)}`, text: 'kurzer Text',
    sprache: 'python', tags: [], labels: [], antworten: 0, kommentare: 0, alterTage: 12, wirkungRoh: {},
    codeVorhanden: false, fehlertext: false, gesamt, loesbarkeit: gesamt, wirkung: gesamt, ...mehr };
}

const ids = (auswahl) => auswahl.chancen.map((c) => c.t.id);

test('waehle: die besten drei, höchstens einer je Repo, Stack Overflow zählt als ein Ort', () => {
  const liste = [
    fund('gh:acme/widget#1', 90), fund('gh:acme/widget#2', 88), fund('gh:acme/widget#3', 86),
    fund('so:1', 85), fund('so:2', 84),
    fund('dc:forum.example.org/7', 70), fund('gh:andere/sache#4', 60),
  ];
  const a = waehle(liste);
  assert.deepEqual(ids(a), ['gh:acme/widget#1', 'so:1', 'dc:forum.example.org/7']);
  assert.equal(new Set(a.chancen.map((c) => streuSchluessel(c.t))).size, 3);
  assert.deepEqual(a.ausserdemNeu.map((t) => t.id), ['gh:acme/widget#2', 'gh:acme/widget#3', 'so:2', 'gh:andere/sache#4']);
});

test('waehle: gleicher Stand ergibt dieselbe Auswahl, egal in welcher Reihenfolge die Treffer kommen', () => {
  const liste = [fund('gh:a/a#1', 70), fund('gh:b/b#1', 70), fund('gh:c/c#1', 70), fund('gh:d/d#1', 70), fund('so:9', 70), fund('gh:a/a#1', 70)];
  const erwartet = ids(waehle(liste));
  assert.deepEqual(erwartet, ['gh:a/a#1', 'gh:b/b#1', 'gh:c/c#1'], 'Gleichstand wird über die ID entschieden');
  for (let i = 0; i < 5; i++) {
    const gedreht = [...liste.slice(i), ...liste.slice(0, i)].reverse();
    assert.deepEqual(ids(waehle(gedreht)), erwartet);
  }
  const d1 = baueDigest(liste, { jetzt: JETZT, scanZeit: SCAN });
  const d2 = baueDigest([...liste].reverse(), { jetzt: JETZT, scanZeit: SCAN });
  assert.deepEqual(d1, d2);
});

test('waehle: weniger als drei Orte ergibt weniger Chancen, nie zwei aus einem Repo', () => {
  const a = waehle([fund('gh:acme/widget#1', 90), fund('gh:acme/widget#2', 88), fund('gh:ACME/widget#3', 80)]);
  assert.deepEqual(ids(a), ['gh:acme/widget#1']);
  assert.deepEqual(ids(waehle([])), []);
  assert.deepEqual(ids(waehle([{ id: 'gh:x/y#1' }, null, fund('gh:x/y#2', 50)])), ['gh:x/y#2'], 'unbewertete Einträge werden übergangen');
});

test('Wiederholungssperre: Gezeigtes kommt in den nächsten N Digests nicht wieder, danach schon', () => {
  const liste = [fund('gh:a/a#1', 90), fund('gh:b/b#1', 80), fund('gh:c/c#1', 70), fund('gh:d/d#1', 60), fund('gh:e/e#1', 50), fund('gh:f/f#1', 40)];
  const cfg = { digest: { sperreDigests: 2 } };
  let merkliste = leereMerkliste();
  const tag = (n) => `2026-11-0${n}T05:30:00.000Z`;
  const lauf = (n) => {
    const d = baueDigest(liste, { merkliste, cfg, scanZeit: tag(n), jetzt: new Date(tag(n)) });
    merkliste = merke(merkliste, d, { cfg });
    return d.chancen.map((c) => c.id);
  };
  assert.deepEqual(lauf(1), ['gh:a/a#1', 'gh:b/b#1', 'gh:c/c#1']);
  assert.deepEqual(lauf(2), ['gh:d/d#1', 'gh:e/e#1', 'gh:f/f#1']);
  assert.deepEqual(lauf(3), [], 'alles in den letzten zwei Digests gezeigt');
  // Der leere Digest zählt mit: Tag 1 ist jetzt aus dem Fenster (Tag 2, Tag 3) gefallen.
  assert.deepEqual(lauf(4), ['gh:a/a#1', 'gh:b/b#1', 'gh:c/c#1']);
});

test('Wiederholungssperre: deutliche Bewegung hebt sie auf und steht in der Begründung', () => {
  const vorher = [fund('gh:a/a#1', 80, { wirkungRoh: { reaktionen: 1 } }), fund('gh:b/b#1', 70), fund('gh:c/c#1', 60), fund('gh:d/d#1', 50), fund('gh:e/e#1', 45)];
  const d1 = baueDigest(vorher, { jetzt: JETZT, scanZeit: '2026-11-09T05:30:00.000Z' });
  const merkliste = merke(leereMerkliste(), d1);
  const nachher = [
    fund('gh:a/a#1', 81, { wirkungRoh: { reaktionen: 4 } }), // +3 Stimmen: bewegt
    fund('gh:b/b#1', 71, { kommentare: 2 }),                  // +2: zu wenig
    fund('gh:c/c#1', 70),                                     // +10 Bewertung: bewegt
    fund('gh:d/d#1', 50), fund('gh:e/e#1', 45),
  ];
  const d2 = baueDigest(nachher, { merkliste, jetzt: JETZT, scanZeit: SCAN });
  assert.deepEqual(d2.chancen.map((c) => c.id), ['gh:a/a#1', 'gh:c/c#1', 'gh:d/d#1']);
  assert.equal(d2.gesperrt, 1);
  assert.match(d2.chancen[0].warum, /^seit dem letzten Digest deutlich bewegt \(\+3 Stimmen\/Kommentare\)/);
  assert.match(d2.chancen[1].warum, /^seit dem letzten Digest deutlich höher bewertet \(\+10\)/);
  assert.equal(d2.chancen[0].wiederDabei, true);
  assert.equal(d2.chancen[2].wiederDabei, false);
});

test('Merkliste: zweiter Digest zum selben Scan ersetzt den ersten und zeigt dasselbe', () => {
  const liste = [fund('gh:a/a#1', 90), fund('gh:b/b#1', 80), fund('gh:c/c#1', 70), fund('gh:d/d#1', 60)];
  const d1 = baueDigest(liste, { jetzt: JETZT, scanZeit: SCAN });
  const m1 = merke(leereMerkliste(), d1);
  const d2 = baueDigest(liste, { merkliste: m1, jetzt: new Date(JETZT.getTime() + 60_000), scanZeit: SCAN });
  assert.deepEqual(d2.chancen, d1.chancen);
  assert.deepEqual(d2.ausserdemNeu, d1.ausserdemNeu);
  const m2 = merke(m1, d2);
  assert.equal(m2.digests.length, 1);
  assert.equal(m2.digests[0].scan, SCAN);
});

test('Merkliste: begrenzt, tolerant gegen Altes und Kaputtes, neuere Version wird nicht überschrieben', () => {
  let m = leereMerkliste();
  for (let i = 0; i < 40; i++) {
    const zeit = new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
    m = merke(m, baueDigest([fund(`gh:a/a#${i}`, 50)], { jetzt: new Date(zeit), scanZeit: zeit }));
  }
  assert.equal(m.digests.length, STANDARD.maxMerkliste);
  assert.equal(m.digests.at(-1).eintraege[0].id, 'gh:a/a#39');
  assert.equal(merke(m, baueDigest([], { jetzt: JETZT, scanZeit: SCAN }), { cfg: { digest: { maxMerkliste: 2 } } }).digests.length, 5,
    'die Merkliste ist nie kürzer als das Sperrfenster');
  assert.equal(merke(m, baueDigest([], { jetzt: JETZT, scanZeit: SCAN }), { cfg: { digest: { maxMerkliste: 2, sperreDigests: 1 } } }).digests.length, 2);

  assert.deepEqual(hebeMerklisteAn(null), leereMerkliste());
  assert.deepEqual(hebeMerklisteAn([1, 2]), leereMerkliste());
  assert.deepEqual(hebeMerklisteAn({ digests: 'quatsch' }), leereMerkliste());
  const alt = hebeMerklisteAn({ digests: [{ zeit: 'x', eintraege: [{ id: 'gh:a/a#1' }, { ohne: 'id' }, null] }, 'müll', { zeit: 'y' }], fremd: 1 });
  assert.deepEqual(alt, { version: 1, digests: [{ zeit: 'x', scan: null, eintraege: [{ id: 'gh:a/a#1', bewertung: 0, aktivitaet: 0 }] }] });
  assert.throws(() => hebeMerklisteAn({ version: 9, digests: [] }), /Version 9/);
});

test('Interessenliste: Schlagwörter und Sprachen heben einen Fund nach vorn, mit Deckel', () => {
  const liste = [
    fund('gh:a/a#1', 80, { sprache: 'java' }),
    fund('gh:b/b#1', 78, { sprache: 'java' }),
    fund('gh:c/c#1', 76, { sprache: 'java' }),
    fund('gh:d/d#1', 72, { sprache: 'rust', titel: 'Asyncio task hangs', tags: ['Tokio'] }),
    fund('gh:e/e#1', 66, { sprache: 'java', labels: ['area: asyncio'] }),
  ];
  assert.deepEqual(ids(waehle(liste)), ['gh:a/a#1', 'gh:b/b#1', 'gh:c/c#1']);
  const cfg = { digest: { interessen: { schlagwoerter: ['AsyncIO ', 'tokio', ''], sprachen: ['Rust'] } } };
  const a = waehle(liste, { cfg });
  assert.deepEqual(ids(a), ['gh:d/d#1', 'gh:a/a#1', 'gh:b/b#1']);
  assert.deepEqual(a.chancen[0].interessen, { sprache: 'rust', schlagwoerter: ['asyncio', 'tokio'], bonus: 20 });
  assert.equal(interessenTreffer(liste[4], konfig(cfg).interessen).bonus, 5);
  assert.equal(interessenTreffer(liste[0], konfig(cfg).interessen).bonus, 0);
  const d = baueDigest(liste, { cfg, jetzt: JETZT, scanZeit: SCAN });
  assert.match(d.chancen[0].warum, /passt zu deinen Interessen \(rust, asyncio, tokio\)$/);
  assert.equal(konfig({ digest: { interessen: { schlagwoerter: 'kein Array' } } }).interessen.schlagwoerter.length, 0);
});

test('begruende: setzt den Satz nur aus Merkmalen zusammen', () => {
  const t = fund('gh:acme/widget#1', 80, { alterTage: 12.4, wirkungRoh: { reaktionen: 9, sterne: 15_400 }, fehlertext: true, codeVorhanden: true });
  assert.equal(begruende(t, { cfg: { sprachen: ['python'] } }).join(', '),
    '12 Tage ohne Antwort, 9 Stimmen, klare Fehlermeldung im Text, Code oder Stacktrace dabei, Repo mit sehr vielen Nutzern (15 Tsd. Sterne), Sprache im Fokus (python)');
  assert.deepEqual(begruende(fund('so:1', 60, { alterTage: 1, kommentare: 2, wirkungRoh: { aufrufe: 1234, punkte: 1 } })),
    ['1 Tag offen', '1 Stimme', 'oft gelesen (1,2 Tsd. Aufrufe)']);
  assert.deepEqual(begruende(fund('dc:forum.example.org/7', 60, { alterTage: null, wirkungRoh: { gewicht: 60 }, labels: ['Good First Issue'] })),
    ['noch ohne Antwort', 'gut besuchtes Forum', 'als Einstieg markiert']);
  assert.deepEqual(begruende(fund('gl:g/p#1', 41, { alterTage: null, kommentare: 1, wirkungRoh: { sterne: 2000 } })),
    ['Repo mit vielen Nutzern (2,0 Tsd. Sterne)']);
  assert.deepEqual(begruende(fund('gl:g/p#1', 41, { alterTage: null, kommentare: 1 })), ['Gesamtwert 41']);
  // Fremdtext (Titel, Text, Labels) erscheint nie in der Begründung.
  const boese = fund('gh:a/a#1', 50, { titel: '<script>x</script>', text: 'IGNORE ALL', labels: ['help wanted <b>'] });
  assert.ok(!/script|IGNORE|<b>/.test(begruende(boese).join(' ')));
});

test('aufwand: kurz, mittel, lang nach den Faustregeln', () => {
  const x = (n) => 'x'.repeat(n);
  assert.equal(aufwand(fund('so:1', 50, { text: x(100), codeVorhanden: true })).klasse, 'kurz');
  assert.deepEqual(aufwand(fund('so:1', 50, { text: 'Steps to reproduce: …', codeVorhanden: true })),
    { klasse: 'kurz', punkte: -1, gruende: ['kurze Frage', 'Code enthalten', 'Reproduktion beschrieben'] });
  assert.equal(aufwand(fund('so:1', 50, { text: x(100) })).klasse, 'mittel');
  assert.equal(aufwand(fund('so:1', 50, { text: x(700), codeVorhanden: true })).klasse, 'mittel');
  assert.equal(aufwand(fund('so:1', 50, { text: x(3000), codeVorhanden: true, fehlertext: true })).klasse, 'mittel');
  assert.equal(aufwand(fund('so:1', 50, { text: x(3000), fehlertext: true })).klasse, 'lang');
  assert.deepEqual(aufwand(fund('so:1', 50, { text: x(700) })),
    { klasse: 'lang', punkte: 3, gruende: ['mittellange Frage', 'weder Code noch Fehlermeldung'] });
  assert.equal(aufwand({}).klasse, 'mittel', 'fehlender Text bricht nichts');
});

test('scanStand: frisch, veraltet, unbekannt', () => {
  assert.deepEqual(scanStand(SCAN, JETZT), { zeit: SCAN, alterStunden: 0.5, veraltet: false });
  assert.equal(scanStand('2026-11-09T06:00:00.000Z', JETZT).veraltet, false, 'genau ein Tag ist noch nicht veraltet');
  assert.equal(scanStand('2026-11-09T05:00:00.000Z', JETZT).veraltet, true);
  assert.deepEqual(scanStand(null, JETZT), { zeit: null, alterStunden: null, veraltet: true });
  assert.deepEqual(scanStand('kein Datum', JETZT), { zeit: null, alterStunden: null, veraltet: true });
  assert.equal(scanStand('2026-11-10T06:30:00.000Z', JETZT).alterStunden, 0, 'kleine Uhrabweichung zählt als frisch');
  assert.deepEqual(scanStand('2026-11-11T06:00:00.000Z', JETZT), { zeit: null, alterStunden: null, veraltet: true }, 'Scan aus der Zukunft gilt nicht als frisch');
  assert.equal(alterText(0.5), 'unter einer Stunde alt');
  assert.equal(alterText(1), '1 Stunde alt');
  assert.equal(alterText(30), '30 Stunden alt');
  assert.equal(alterText(72), '3 Tage alt');
  assert.equal(alterText(null), 'unbekannt alt');
});

test('baueDigest: Fremdtext ohne Steuerzeichen, Adressen nur https, außerdem neu begrenzt und gefiltert', () => {
  const liste = [
    fund('gh:a/a#1', 90, { titel: 'Kaputt\x1b[31m rot\x07\nzweite Zeile', url: 'javascript:alert(1)' }),
    fund('gh:b/b#1', 80, { url: 'http://unsicher.example.org/x' }),
    fund('gh:c/c#1', 70, { titel: 'T'.repeat(500) }),
    ...Array.from({ length: 8 }, (_, i) => fund(`gh:n/n#${i}`, 60 - i)),
  ];
  const neuIds = new Set(['gh:n/n#1', 'gh:n/n#3', 'gh:a/a#1']);
  const d = baueDigest(liste, { jetzt: JETZT, scanZeit: SCAN, neuIds, gesamt: 42, hinweise: ['Quelle\x1b[2J ausgefallen'] });
  assert.equal(d.chancen[0].titel, 'Kaputt rot zweite Zeile');
  assert.equal(d.chancen[0].url, null);
  assert.equal(d.chancen[1].url, null);
  assert.equal(d.chancen[2].titel.length, 200);
  assert.deepEqual(d.ausserdemNeu.map((t) => t.id), ['gh:n/n#1', 'gh:n/n#3']);
  assert.equal(d.scan.gesamt, 42);
  assert.deepEqual(d.hinweise, ['Quelle ausgefallen']);
  assert.match(d.datum, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!/[\x00-\x1f\x7f]/.test(JSON.stringify(d).replace(/\\n/g, '')));
  assert.equal(baueDigest(liste, { jetzt: JETZT, scanZeit: SCAN }).ausserdemNeu.length, 5, 'ohne Wissen über Neues: die nächsten fünf');
  assert.throws(() => baueDigest(liste, {}), /jetzt/);
});

test('waehle: doppelte IDs mit verschiedenen Werten – der beste zählt, egal in welcher Reihenfolge', () => {
  const liste = [fund('gh:a/a#1', 10), fund('gh:b/b#1', 50), fund('gh:a/a#1', 90)];
  assert.deepEqual(ids(waehle(liste)), ['gh:a/a#1', 'gh:b/b#1']);
  assert.deepEqual(ids(waehle([...liste].reverse())), ['gh:a/a#1', 'gh:b/b#1']);
  assert.equal(waehle(liste).chancen[0].t.gesamt, 90);
});

test('Begründung bei „wieder dabei“ nennt die Schwelle, die wirklich überschritten wurde', () => {
  const d1 = baueDigest([fund('gh:a/a#1', 60)], { jetzt: JETZT, scanZeit: '2026-11-09T05:30:00.000Z' });
  const d2 = baueDigest([fund('gh:a/a#1', 75, { kommentare: 1 })], { merkliste: merke(leereMerkliste(), d1), jetzt: JETZT, scanZeit: SCAN });
  assert.match(d2.chancen[0].warum, /^seit dem letzten Digest deutlich höher bewertet \(\+15\)/);
});

test('Kaputte gespeicherte Treffer brechen nichts und erzeugen keinen Unsinn', () => {
  const schief = fund('gh:a/a#1', 70, { labels: 'bug', tags: null, kommentare: '5', antworten: null, alterTage: 'alt', sprache: { x: 1 },
    titel: { y: 2 }, ort: 7, wirkungRoh: 'nix', text: null, url: ['https://example.org'] });
  const d = baueDigest([schief, 'text', 5, { id: '', gesamt: 1 }, { id: 'gh:b/b#1', gesamt: NaN }], { jetzt: JETZT, scanZeit: SCAN });
  assert.equal(d.chancen.length, 1);
  const c = d.chancen[0];
  assert.deepEqual([c.titel, c.ort, c.url, c.sprache, c.alterTage, c.aktivitaet], ['', '7', null, null, null, 0]);
  assert.ok(!/NaN|object Object|undefined/.test(JSON.stringify(d)));
  assert.equal(baueDigest(null, { jetzt: JETZT, scanZeit: SCAN }).chancen.length, 0);
});

test('Adressen und Titel: keine Steuerzeichen, kein Bidi, keine unsichtbaren Zeichen', () => {
  const liste = [
    fund('gh:a/a#1', 90, { url: 'https://example.org/\x1b]0;x\x07\x1b[2J', titel: 'Vor\u202Eher\u200B und nach' }),
    fund('gh:b/b#1', 80, { url: 'https://example.org/\u202Eabc' }),
    fund('gh:c/c#1', 70, { url: 'https://example.org/gut?a=1&b=2#x' }),
  ];
  const d = baueDigest(liste, { jetzt: JETZT, scanZeit: SCAN });
  assert.deepEqual(d.chancen.map((c) => c.url), [null, null, 'https://example.org/gut?a=1&b=2#x']);
  assert.equal(d.chancen[0].titel, 'Vorher und nach');
});

test('konfig: unsinnige Schwellen fallen auf den Standard zurück', () => {
  const k = konfig({ digest: { bewegtAktivitaet: 0, bewegtBewertung: -3, veraltetStunden: 'abc', anzahl: 0, interessen: { maxBonus: 'x', bonusSprache: 7 } } });
  assert.deepEqual([k.bewegtAktivitaet, k.bewegtBewertung, k.veraltetStunden, k.anzahl], [3, 10, 24, 3]);
  assert.deepEqual([k.interessen.maxBonus, k.interessen.bonusSprache], [20, 7]);
});

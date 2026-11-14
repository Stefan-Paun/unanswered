import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const ORDNER = new URL('../examples/launchd/', import.meta.url);
const PLIST = 'com.example.ungeloest.digest.plist';

// Kleiner plist-Leser für die Vorlage: prüft Wohlgeformtheit (Elemente sauber verschachtelt, dict = Schlüssel/Wert-Paare)
// und gibt den Inhalt als Objekt zurück. Kein allgemeiner XML-Parser.
function lesePlist(xml) {
  const kopf = /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<!DOCTYPE plist PUBLIC "-\/\/Apple\/\/DTD PLIST 1\.0\/\/EN" "http:\/\/www\.apple\.com\/DTDs\/PropertyList-1\.0\.dtd">\n/;
  assert.match(xml, kopf, 'XML-Kopf und DOCTYPE');
  const rest = xml.replace(kopf, '').replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!rest.includes('<!--') && !rest.includes('-->'), 'Kommentare sind geschlossen');
  const teile = rest.split(/(<[^>]*>)/).filter((t) => t.trim() !== '');
  let i = 0;
  const entschluessle = (s) => {
    assert.ok(!/&(?!(?:amp|lt|gt|quot|apos);)/.test(s) && !s.includes('<'), `unmaskiertes Zeichen in ${JSON.stringify(s)}`);
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  };
  const erwarte = (tag) => assert.equal(teile[i++], tag, `erwartet ${tag}`);
  const text = (name) => {
    let inhalt = '';
    if (!teile[i].startsWith('<')) inhalt = teile[i++];
    erwarte(`</${name}>`);
    return entschluessle(inhalt);
  };
  const wert = () => {
    const t = teile[i++];
    if (t === '<true/>') return true;
    if (t === '<false/>') return false;
    if (t === '<string>') return text('string');
    if (t === '<integer>') { const n = text('integer'); assert.match(n, /^-?\d+$/); return Number(n); }
    if (t === '<array>') { const a = []; while (teile[i] !== '</array>') a.push(wert()); i++; return a; }
    if (t === '<dict>') {
      const o = {};
      while (teile[i] !== '</dict>') {
        erwarte('<key>');
        const k = text('key');
        assert.ok(!(k in o), `Schlüssel ${k} doppelt`);
        o[k] = wert();
      }
      i++;
      return o;
    }
    assert.fail(`unerwartetes Element ${t}`);
  };
  erwarte('<plist version="1.0">');
  const wurzel = wert();
  erwarte('</plist>');
  assert.equal(i, teile.length, 'nichts hinter </plist>');
  return wurzel;
}

test('launchd-Vorlage: wohlgeformte plist, Start um 7:00, digest --frisch, Ausgabe in Dateien', async () => {
  const p = lesePlist(await readFile(new URL(PLIST, ORDNER), 'utf8'));
  assert.equal(`${p.Label}.plist`, PLIST, 'Label und Dateiname passen zusammen');
  assert.deepEqual(p.StartCalendarInterval, { Hour: 7, Minute: 0 });
  assert.deepEqual(p.ProgramArguments.slice(0, 4), ['PFAD_ZU_NODE', 'PFAD_ZU_UNGELOEST/bin/ungeloest.mjs', 'digest', '--frisch']);
  assert.equal(p.ProgramArguments[p.ProgramArguments.indexOf('--md') + 1], 'PFAD_ZU_AUSGABE/digest.md');
  assert.equal(p.StandardOutPath, 'PFAD_ZU_AUSGABE/digest.txt');
  assert.equal(p.StandardErrorPath, 'PFAD_ZU_AUSGABE/digest.log');
  assert.equal(p.RunAtLoad, false);
  assert.deepEqual(p.EnvironmentVariables, { NO_COLOR: '1' }, 'keine Geheimnisse in der Umgebung, keine Farbe in der Datei');
  assert.deepEqual(Object.keys(p).sort(), ['EnvironmentVariables', 'Label', 'ProgramArguments', 'RunAtLoad', 'StandardErrorPath', 'StandardOutPath', 'StartCalendarInterval', 'WorkingDirectory']);
});

test('launchd-Vorlage: nur Platzhalter, keine privaten Pfade, Namen oder Geheimnisse', async () => {
  const p = lesePlist(await readFile(new URL(PLIST, ORDNER), 'utf8'));
  const pfade = [...p.ProgramArguments.filter((a) => a.includes('/') || a.startsWith('PFAD')), p.WorkingDirectory, p.StandardOutPath, p.StandardErrorPath];
  for (const pfad of pfade) assert.match(pfad, /^PFAD_ZU_(?:NODE|UNGELOEST|AUSGABE)(?:\/[a-z.]+)*$/, pfad);
  const privat = /\/Users\/|\/home\/|\/var\/|\/opt\/|\/tmp\/|~\/|\$HOME|\$\{?USER|@[\w-]+\.\w|token|secret|passwor[dt]|gh[pousr]_/i;
  for (const datei of await readdir(ORDNER)) {
    const inhalt = await readFile(new URL(datei, ORDNER), 'utf8');
    // In der Anleitung dürfen ~/Library/LaunchAgents (Ziel beim Einschalten) und das Wort „Token“ vorkommen.
    const geprueft = datei.endsWith('.plist') ? inhalt : inhalt.replace(/~\/Library\/LaunchAgents\//g, '').replace(/\bToken\b|gh auth token/g, '');
    assert.ok(!privat.test(geprueft), `${datei}: ${privat.exec(geprueft)?.[0]}`);
  }
});

test('lesePlist erkennt kaputte Dateien', () => {
  const kopf = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n';
  assert.deepEqual(lesePlist(`${kopf}<plist version="1.0"><dict><key>A</key><string>x &amp; y</string></dict></plist>\n`), { A: 'x & y' });
  assert.throws(() => lesePlist(`${kopf}<plist version="1.0"><dict><key>A</key><string>x</dict></plist>`));
  assert.throws(() => lesePlist(`${kopf}<plist version="1.0"><dict><string>x</string></dict></plist>`));
  assert.throws(() => lesePlist(`${kopf}<plist version="1.0"><dict><key>A</key><string>x & y</string></dict></plist>`));
  assert.throws(() => lesePlist(`${kopf}<plist version="1.0"><dict></dict>`));
  assert.throws(() => lesePlist('<plist version="1.0"><dict></dict></plist>'));
});

// Ein Treffer-Format für alle Quellen.
const CODE_MUSTER = [
  /```[\s\S]{3,}```/,            // Markdown-Codeblock
  /(?:^|\n)(?: {4}|\t)\S.*\n(?: {4}|\t)\S/, // eingerückter Code über 2+ Zeilen
  /Traceback \(most recent call last\)/,
  /\bat [\w$.<>]+ \([^)]*:\d+:\d+\)/,       // JS-Stacktrace-Zeile
  /File "[^"]+", line \d+/,                 // Python-Stacktrace-Zeile
  /<pre>[\s\S]{10,}<\/pre>/i,               // HTML-Codeblock (Stack Overflow body)
];

const FEHLER_MUSTER = /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|ValueError|KeyError|AttributeError|ImportError|ModuleNotFoundError|IndexError|NameError|Traceback|Exception|Error:|ENOENT|EADDRINUSE|ECONNREFUSED|undefined is not|is not a function|cannot read propert(?:y|ies)|segfault|panic\w*|crash\w*|stürzt|Fehler)/i;

// Steuerzeichen (ESC-Sequenzen, Terminal-Titel, Bell) aus Fremdtext entfernen; Zeilenumbrüche und Tabs bleiben.
export function saeubere(text = '') {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')      // OSC: Terminal-Titel, Links
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')               // CSI: Farben, Cursor, Bildschirm löschen
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

export function alsIso(wert) {
  const t = typeof wert === 'number' ? wert * (wert < 1e12 ? 1000 : 1) : Date.parse(wert);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export const MS_TAG = 86_400_000;

export function hatCode(text = '') {
  return CODE_MUSTER.some((m) => m.test(text));
}

export function hatFehlertext(text = '') {
  return FEHLER_MUSTER.test(text);
}

export function alterInTagen(iso, jetzt = Date.now()) {
  const t = typeof iso === 'number' ? iso * (iso < 1e12 ? 1000 : 1) : Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (jetzt - t) / MS_TAG);
}

const SPRACHEN_ALIAS = {
  js: 'javascript', javascript: 'javascript', node: 'javascript', 'node.js': 'javascript', nodejs: 'javascript',
  ts: 'typescript', typescript: 'typescript',
  py: 'python', python: 'python', 'python-3.x': 'python', python3: 'python',
  rust: 'rust', go: 'go', java: 'java', 'c#': 'csharp', csharp: 'csharp', cpp: 'cpp', 'c++': 'cpp', c: 'c',
  ruby: 'ruby', php: 'php', swift: 'swift', kotlin: 'kotlin',
};

export function erkenneSprache(kandidaten = []) {
  for (const k of kandidaten) {
    const s = SPRACHEN_ALIAS[String(k || '').toLowerCase()];
    if (s) return s;
  }
  return null;
}

export function kuerze(text = '', max = 400) {
  const t = saeubere(text).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export function entferneHtml(html = '') {
  return String(html)
    .replace(/<pre[^>]*>[\s\S]*?<\/pre>/gi, (m) => '\n```\n' + m.replace(/<[^>]+>/g, '') + '\n```\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/**
 * Baut einen normalisierten Treffer. Pflicht: id, quelle, titel, url, erstellt.
 */
export function treffer({ id, quelle, titel, url, text = '', erstellt, sprache = null, tags = [], labels = [],
  antworten = 0, kommentare = 0, wirkungRoh = {}, ort = '' }, jetzt = Date.now()) {
  titel = saeubere(titel).replace(/\s+/g, ' ').trim();
  text = saeubere(text);
  const eine = (s) => saeubere(s).replace(/\s+/g, ' ').trim();
  const voll = `${titel}\n${text}`;
  return {
    id, quelle, titel, url: eine(url), text, erstellt: alsIso(erstellt),
    alterTage: alterInTagen(erstellt, jetzt),
    sprache, tags: tags.map(eine), labels: labels.map(eine), antworten, kommentare, wirkungRoh, ort: eine(ort),
    codeVorhanden: hatCode(text),
    fehlertext: hatFehlertext(voll),
  };
}

export function ausgeschlossen(t, ausschluss = {}) {
  const muster = (ausschluss.titelMuster || []).map((m) => new RegExp(m, 'i'));
  if (muster.some((m) => m.test(t.titel))) return true;
  if ((ausschluss.repos || []).includes(t.ort)) return true;
  return false;
}

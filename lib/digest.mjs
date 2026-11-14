// Morgen-Digest: die drei lohnendsten Funde des letzten Scans, mit Begründung und Aufwandsklasse.
// Reine Funktionen: keine Uhr (jetzt kommt als Parameter), kein Netz, keine Dateien, keine KI.
import { saeubere } from './normalize.mjs';
import { stimmenVon, kommentareVon } from './verlauf.mjs';

export const MS_STUNDE = 3_600_000;
export const VERSION = 1;

export const STANDARD = {
  anzahl: 3,            // so viele Chancen zeigt der Digest
  sperreDigests: 5,     // was in den letzten N Digests stand, kommt nicht wieder …
  bewegtBewertung: 10,  // … außer die Bewertung stieg seither um so viele Punkte
  bewegtAktivitaet: 3,  // … oder Stimmen + Kommentare stiegen um so viele
  ausserdemNeu: 5,      // Titel unter „außerdem neu“
  maxMerkliste: 30,     // so viele Digests bleiben in der Merkliste
  veraltetStunden: 24,  // ab hier gilt der letzte Scan als veraltet
  interessen: { schlagwoerter: [], sprachen: [], bonusSprache: 10, bonusSchlagwort: 5, maxBonus: 20 },
};

export function konfig(cfg = {}) {
  const d = cfg.digest || {};
  const k = { ...STANDARD, ...d, interessen: { ...STANDARD.interessen, ...(d.interessen || {}) } };
  const ganz = (v, ersatz, min = 0) => (Number.isInteger(v) && v >= min ? v : ersatz);
  k.anzahl = ganz(k.anzahl, STANDARD.anzahl, 1);
  k.sperreDigests = ganz(k.sperreDigests, STANDARD.sperreDigests);
  k.ausserdemNeu = ganz(k.ausserdemNeu, STANDARD.ausserdemNeu);
  k.maxMerkliste = Math.max(ganz(k.maxMerkliste, STANDARD.maxMerkliste, 1), k.sperreDigests);
  // Schwellen müssen positive Zahlen sein, sonst gilt der Standard (0 würde die Sperre aushebeln).
  const positiv = (v, ersatz) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : ersatz);
  for (const n of ['bewegtBewertung', 'bewegtAktivitaet', 'veraltetStunden']) k[n] = positiv(k[n], STANDARD[n]);
  for (const n of ['bonusSprache', 'bonusSchlagwort', 'maxBonus']) k.interessen[n] = positiv(k.interessen[n], STANDARD.interessen[n]);
  const liste = (v) => (Array.isArray(v) ? v.map((s) => String(s).trim().toLowerCase()).filter(Boolean) : []);
  k.interessen.schlagwoerter = liste(k.interessen.schlagwoerter);
  k.interessen.sprachen = liste(k.interessen.sprachen);
  return k;
}

// ---------- Merkliste ----------
// { version: 1, digests: [{ zeit, scan, eintraege: [{ id, bewertung, aktivitaet }] }] }, älteste zuerst.

export const leereMerkliste = () => ({ version: VERSION, digests: [] });

/** Liest jede bekannte Form tolerant; fehlende oder kaputte Teile werden leer. Neuere Version → Fehler statt Datenverlust. */
export function hebeMerklisteAn(roh) {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return leereMerkliste();
  if (typeof roh.version === 'number' && roh.version > VERSION) {
    throw new Error(`Digest-Merkliste hat Version ${roh.version}, dieses Programm kennt nur ${VERSION}`);
  }
  const digests = (Array.isArray(roh.digests) ? roh.digests : [])
    .filter((d) => d && typeof d === 'object' && Array.isArray(d.eintraege))
    .map((d) => ({
      zeit: typeof d.zeit === 'string' ? d.zeit : null,
      scan: typeof d.scan === 'string' ? d.scan : null,
      eintraege: d.eintraege
        .filter((e) => e && typeof e.id === 'string')
        .map((e) => ({ id: e.id, bewertung: Number(e.bewertung) || 0, aktivitaet: Number(e.aktivitaet) || 0 })),
    }));
  return { version: VERSION, digests };
}

export const aktivitaetVon = (t) => stimmenVon(t) + kommentareVon(t);

/**
 * Trägt einen Digest ein (gibt eine neue Merkliste zurück). Ein zweiter Digest zum selben Scan
 * ersetzt den ersten, damit „gleicher Stand → gleiche Auswahl“ auch über mehrere Aufrufe gilt.
 */
export function merke(merkliste, digest, { cfg } = {}) {
  const k = konfig(cfg);
  const scan = digest.scan?.zeit || null;
  const eintrag = {
    zeit: digest.erstellt,
    scan,
    eintraege: digest.chancen.map((c) => ({ id: c.id, bewertung: c.gesamt, aktivitaet: c.aktivitaet })),
  };
  const rest = merkliste.digests.filter((d) => !(scan && d.scan === scan));
  return { version: VERSION, digests: [...rest, eintrag].slice(-k.maxMerkliste) };
}

// ---------- Auswahl ----------

// Streuung: höchstens ein Fund je Repo/Forum. Stack Overflow hat keine Repos und zählt als ein Ort.
export const streuSchluessel = (t) => `${t.quelle}|${String(t.ort || '').toLowerCase()}`;

const kleinListe = (v) => (Array.isArray(v) ? v.map((s) => String(s).toLowerCase()) : []);

/** Welche Einträge der Interessenliste treffen diesen Fund? Schlagwörter in Titel, Tags, Labels und Ort. */
export function interessenTreffer(t, interessen = STANDARD.interessen) {
  const sprache = t.sprache && interessen.sprachen.includes(String(t.sprache).toLowerCase()) ? String(t.sprache).toLowerCase() : null;
  const heu = [t.titel, t.ort, ...kleinListe(t.tags), ...kleinListe(t.labels)].join('\n').toLowerCase();
  const schlagwoerter = interessen.schlagwoerter.filter((s) => heu.includes(s));
  const bonus = Math.min(interessen.maxBonus, (sprache ? interessen.bonusSprache : 0) + schlagwoerter.length * interessen.bonusSchlagwort);
  return { sprache, schlagwoerter, bonus };
}

/** Stand eines Fundes im jüngsten der letzten N Digests (ohne den Digest zum selben Scan), sonst null. */
function zuletztGezeigt(id, digests) {
  for (let i = digests.length - 1; i >= 0; i--) {
    const e = digests[i].eintraege.find((x) => x.id === id);
    if (e) return e;
  }
  return null;
}

const zahl = (v, ersatz = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : ersatz);
const text = (v) => (typeof v === 'string' ? v : v == null || typeof v === 'object' ? '' : String(v));
const texte = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/** Bringt einen gespeicherten Treffer in feste Typen; die Datei könnte von Hand verändert oder alt sein. */
export function richte(t) {
  return {
    ...t,
    titel: text(t.titel), url: text(t.url), quelle: text(t.quelle), ort: text(t.ort), text: text(t.text),
    sprache: typeof t.sprache === 'string' && t.sprache ? t.sprache : null,
    tags: texte(t.tags), labels: texte(t.labels),
    antworten: zahl(t.antworten), kommentare: zahl(t.kommentare),
    alterTage: typeof t.alterTage === 'number' && Number.isFinite(t.alterTage) ? t.alterTage : null,
    wirkungRoh: t.wirkungRoh && typeof t.wirkungRoh === 'object' && !Array.isArray(t.wirkungRoh) ? t.wirkungRoh : {},
    codeVorhanden: t.codeVorhanden === true, fehlertext: t.fehlertext === true,
    wirkung: zahl(t.wirkung),
  };
}

function vergleiche(a, b) {
  return b.rang - a.rang || b.t.gesamt - a.t.gesamt || b.t.wirkung - a.t.wirkung
    || (a.t.id < b.t.id ? -1 : a.t.id > b.t.id ? 1 : 0);
}

/**
 * Wählt die Chancen des Tages. Gleiche Eingabe ergibt dieselbe Auswahl, unabhängig von der Reihenfolge der Treffer.
 * @param treffer bewertete Treffer des letzten Scans
 * @param merkliste frühere Digests (siehe oben)
 * @param scanZeit ISO-Zeit des Scans; ein früherer Digest zum selben Scan sperrt nichts
 * @param neuIds Set der IDs, die im letzten Scan erstmals auftauchten (null = unbekannt)
 */
export function waehle(treffer, { merkliste = leereMerkliste(), cfg, scanZeit = null, neuIds = null } = {}) {
  const k = konfig(cfg);
  const frueher = merkliste.digests.filter((d) => !(scanZeit && d.scan === scanZeit)).slice(-k.sperreDigests);
  const gueltig = (Array.isArray(treffer) ? treffer : [])
    .filter((t) => t && typeof t === 'object' && typeof t.id === 'string' && t.id && typeof t.gesamt === 'number' && Number.isFinite(t.gesamt))
    .map(richte);
  // Erst sortieren, dann je ID den ersten (besten) behalten: so entscheidet nie die Reihenfolge der Eingabe.
  const schonDa = new Set();
  const kandidaten = gueltig.map((t) => {
    const interessen = interessenTreffer(t, k.interessen);
    return { t, interessen, rang: t.gesamt + interessen.bonus };
  }).sort(vergleiche).filter(({ t }) => !schonDa.has(t.id) && schonDa.add(t.id));

  const orte = new Set();
  const chancen = [];
  const gesperrt = [];
  for (const kand of kandidaten) {
    if (chancen.length >= k.anzahl) break;
    const { t } = kand;
    const alt = zuletztGezeigt(t.id, frueher);
    let bewegt = null;
    if (alt) {
      const dBewertung = t.gesamt - alt.bewertung;
      const dAktivitaet = aktivitaetVon(t) - alt.aktivitaet;
      if (dBewertung >= k.bewegtBewertung || dAktivitaet >= k.bewegtAktivitaet) bewegt = { bewertung: dBewertung, aktivitaet: dAktivitaet, wegenAktivitaet: dAktivitaet >= k.bewegtAktivitaet };
      else { gesperrt.push(t.id); continue; }
    }
    const ort = streuSchluessel(t);
    if (orte.has(ort)) continue;
    orte.add(ort);
    chancen.push({ ...kand, bewegt });
  }

  const gewaehlt = new Set(chancen.map((c) => c.t.id));
  const jeGezeigt = new Set(merkliste.digests.filter((d) => !(scanZeit && d.scan === scanZeit)).flatMap((d) => d.eintraege.map((e) => e.id)));
  const ausserdemNeu = kandidaten
    .filter(({ t }) => !gewaehlt.has(t.id) && !jeGezeigt.has(t.id) && (!neuIds || neuIds.has(t.id)))
    .slice(0, k.ausserdemNeu)
    .map(({ t }) => t);
  return { chancen, ausserdemNeu, gesperrt };
}

// ---------- Begründung und Aufwand ----------

const mz = (n, eins, viele) => `${n} ${n === 1 ? eins : viele}`;
const tausender = (n) => (n >= 10_000 ? `${Math.round(n / 1000)} Tsd.` : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')} Tsd.` : String(n));

/**
 * Ein Satz „warum diese“, nur aus Merkmalen des Fundes zusammengesetzt (kein Fremdtext, keine KI).
 * Rückgabe: Liste der Gründe; der Satz ist `gruende.join(', ')`.
 */
export function begruende(t, { cfg = {}, interessen = null, bewegt = null } = {}) {
  const g = [];
  const r = t.wirkungRoh || {};
  if (bewegt) {
    g.push(bewegt.wegenAktivitaet ?? bewegt.aktivitaet > 0
      ? `seit dem letzten Digest deutlich bewegt (+${bewegt.aktivitaet} Stimmen/Kommentare)`
      : `seit dem letzten Digest deutlich höher bewertet (+${bewegt.bewertung})`);
  }
  if (t.alterTage != null) {
    const tage = Math.round(t.alterTage);
    g.push(kommentareVon(t) === 0 ? `${mz(tage, 'Tag', 'Tage')} ohne Antwort` : `${mz(tage, 'Tag', 'Tage')} offen`);
  } else if (kommentareVon(t) === 0) g.push('noch ohne Antwort');
  const stimmen = stimmenVon(t);
  if (stimmen > 0) g.push(mz(stimmen, 'Stimme', 'Stimmen'));
  if (t.fehlertext) g.push('klare Fehlermeldung im Text');
  if (t.codeVorhanden) g.push('Code oder Stacktrace dabei');
  const sterne = zahl(r.sterne, -1);
  if (['github', 'github-discussions', 'gitlab'].includes(t.quelle) && sterne >= 1000) {
    g.push(`Repo mit ${sterne >= 10_000 ? 'sehr vielen' : 'vielen'} Nutzern (${tausender(sterne)} Sterne)`);
  }
  if (t.quelle === 'stackoverflow' && zahl(r.aufrufe) >= 500) g.push(`oft gelesen (${tausender(r.aufrufe)} Aufrufe)`);
  if (t.quelle === 'discourse' && zahl(r.gewicht) >= 50) g.push('gut besuchtes Forum');
  if ((t.labels || []).some((l) => /good first issue|help wanted|beginner|easy/i.test(l))) g.push('als Einstieg markiert');
  const i = interessen || interessenTreffer(t, konfig(cfg).interessen);
  const passt = [i.sprache, ...i.schlagwoerter].filter(Boolean);
  if (passt.length) g.push(`passt zu deinen Interessen (${passt.join(', ')})`);
  else if (t.sprache && (cfg.sprachen || []).includes(t.sprache)) g.push(`Sprache im Fokus (${t.sprache})`);
  if (!g.length) g.push(`Gesamtwert ${t.gesamt}`);
  return g;
}

const REPRO = /\b(?:steps to reproduce|to reproduce|reproduc\w*|repro\b|minimal (?:example|reproduc\w*)|mcve|expected (?:behaviou?r|result|output)|actual (?:behaviou?r|result|output)|schritte zum|nachstellen|erwartet\w*)/i;

/**
 * Grobe Aufwandsklasse aus Faustregeln (Punkte, Start bei 1):
 *   Länge der Frage: unter 600 Zeichen +0, unter 2500 +1, sonst +2
 *   Code oder Stacktrace enthalten: −1 (man sieht, worum es geht)
 *   Reproduktion beschrieben (Schritte, erwartet/tatsächlich, Minimalbeispiel): −1
 *   weder Code noch Fehlermeldung: +1 (erst herausfinden, was gemeint ist)
 * Summe ≤ 0 → kurz, 1–2 → mittel, ab 3 → lang.
 */
export function aufwand(t) {
  const laenge = (t.text || '').length;
  const gruende = [];
  let p = 1;
  if (laenge >= 2500) { p += 2; gruende.push('lange Frage'); }
  else if (laenge >= 600) { p += 1; gruende.push('mittellange Frage'); }
  else gruende.push('kurze Frage');
  if (t.codeVorhanden) { p -= 1; gruende.push('Code enthalten'); }
  if (REPRO.test(t.text || '')) { p -= 1; gruende.push('Reproduktion beschrieben'); }
  if (!t.codeVorhanden && !t.fehlertext) { p += 1; gruende.push('weder Code noch Fehlermeldung'); }
  return { klasse: p <= 0 ? 'kurz' : p <= 2 ? 'mittel' : 'lang', punkte: p, gruende };
}

// ---------- Digest ----------

// Unsichtbares, das Text optisch verdrehen kann: Richtungswechsel (Bidi) und Zeichen ohne Breite.
const UNSICHTBAR = /[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
// Nur https, und nur druckbare Zeichen: keine Steuerzeichen, kein Bidi, keine Leerzeichen oder Anführungszeichen.
const httpsUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>\\`\x00-\x20\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]+$/i.test(u) ? u : null);
const eineZeile = (s, max = 200) => {
  const t = saeubere(s ?? '').replace(UNSICHTBAR, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};
const zwei = (n) => String(n).padStart(2, '0');
export const datumLokal = (d) => `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;

/** Wie alt ist der Scan? `scanZeit` ist ISO oder null (unbekannt). */
export function scanStand(scanZeit, jetzt, veraltetStunden = STANDARD.veraltetStunden) {
  const ms = scanZeit ? Date.parse(scanZeit) : NaN;
  // Unlesbar oder deutlich in der Zukunft (verstellte Uhr, veränderte Datei): Alter unbekannt, also nicht als frisch ausgeben.
  if (!Number.isFinite(ms) || ms > jetzt.getTime() + MS_STUNDE) return { zeit: null, alterStunden: null, veraltet: true };
  const alterStunden = Math.max(0, (jetzt.getTime() - ms) / MS_STUNDE);
  return { zeit: new Date(ms).toISOString(), alterStunden: Math.round(alterStunden * 10) / 10, veraltet: alterStunden > veraltetStunden };
}

export function alterText(stunden) {
  if (stunden == null) return 'unbekannt alt';
  if (stunden < 1) return 'unter einer Stunde alt';
  if (stunden < 48) return `${mz(Math.round(stunden), 'Stunde', 'Stunden')} alt`;
  return `${Math.round(stunden / 24)} Tage alt`;
}

function kurzform(t) {
  return { id: eineZeile(t.id), titel: eineZeile(t.titel), url: httpsUrl(t.url), quelle: eineZeile(t.quelle, 40), ort: eineZeile(t.ort, 120) };
}

/**
 * Baut den fertigen Digest als schlichtes Objekt (zugleich die JSON-Ausgabe). Fremdtext ist darin
 * schon von Steuerzeichen befreit und gekürzt, Adressen sind `https:` oder null.
 */
export function baueDigest(treffer, { merkliste = leereMerkliste(), cfg = {}, scanZeit = null, neuIds = null, jetzt, gesamt = null, hinweise = [] } = {}) {
  if (!(jetzt instanceof Date)) throw new Error('baueDigest braucht jetzt (Date)');
  const k = konfig(cfg);
  const stand = scanStand(scanZeit, jetzt, k.veraltetStunden);
  const { chancen, ausserdemNeu, gesperrt } = waehle(treffer, { merkliste, cfg, scanZeit: stand.zeit, neuIds });
  const anzahl = Array.isArray(treffer) ? treffer.length : 0;
  return {
    datum: datumLokal(jetzt),
    erstellt: jetzt.toISOString(),
    scan: { ...stand, gesamt: gesamt ?? anzahl },
    chancen: chancen.map(({ t, interessen, bewegt }) => {
      const gruende = begruende(t, { cfg, interessen, bewegt });
      return {
        ...kurzform(t),
        sprache: t.sprache ? eineZeile(t.sprache, 40) : null,
        gesamt: t.gesamt, loesbarkeit: zahl(t.loesbarkeit, null), wirkung: zahl(t.wirkung, null),
        alterTage: t.alterTage == null ? null : Math.round(t.alterTage),
        aktivitaet: aktivitaetVon(t),
        warum: gruende.join(', '),
        gruende,
        aufwand: aufwand(t),
        wiederDabei: !!bewegt,
      };
    }),
    ausserdemNeu: ausserdemNeu.map(kurzform),
    gesperrt: gesperrt.length,
    hinweise: hinweise.map((h) => eineZeile(h, 300)),
  };
}

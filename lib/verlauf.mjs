// Verlauf über Scans: reine Funktionen, ohne Uhr (jetzt kommt als Parameter), Netz und Dateien.
import { duenneAus, neuerFund, MAX_PUNKTE } from './verlauf-speicher.mjs';

export const MS_TAG = 86_400_000;

export const STANDARD = {
  steigtProTag: 1,      // Zuwachs (Stimmen + Kommentare) je Tag, ab dem ein Fund „wird wichtiger“ heißt
  minAbstandTage: 0.5,  // so weit müssen zwei Messpunkte auseinanderliegen, sonst ist die Rate Rauschen
  langeScans: 5,        // „liegt lange“: so viele Scans in Folge unverändert offen …
  langeBewertung: 60,   // … und mindestens so hoch bewertet
  topAnzahl: 10,        // „Top“ für die Trefferliste
  maxPunkte: MAX_PUNKTE,
};

export const konfig = (cfg = {}) => ({ ...STANDARD, ...(cfg.verlauf || cfg) });

const GELOEST = new Set(['beantwortet', 'geschlossen']);
export const istGeloest = (z) => GELOEST.has(z);

// Sicher gelöst nur, wenn die Quelle es hergibt: ausdrücklicher Zustand oder inzwischen Antworten/Kommentare.
export function zustandVon(t) {
  if (istGeloest(t.zustand)) return t.zustand;
  if ((t.antworten || 0) > 0 || (t.kommentare || 0) > 0) return 'beantwortet';
  return 'offen';
}

// Stimmen eines Treffers: GitHub/Discussions-Reaktionen und GitLab-/Discussions-Stimmen (das Größere, sie überlappen sich),
// sonst die Punkte (Stack Overflow). Fehlt alles, 0.
export function stimmenVon(t) {
  const r = t.wirkungRoh || {};
  const zahl = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const gezaehlt = [zahl(r.reaktionen), zahl(r.stimmen)].filter((v) => v != null);
  if (gezaehlt.length) return Math.max(...gezaehlt);
  return zahl(r.punkte) ?? 0;
}
export const kommentareVon = (t) => (t.kommentare || 0) + (t.antworten || 0);

/**
 * Schreibt einen Scan in den Speicher (gibt einen neuen zurück).
 * @param treffer alle bewerteten Treffer dieses Scans (nicht nur die angezeigten)
 * @param quellen Namen der Quellen, die in diesem Scan wirklich geantwortet haben (leer/ausgefallen zählen nicht)
 * @param topIds IDs der aktuellen Top-Treffer (für die Trefferliste)
 */
export function uebernimm(speicher, treffer, { quellen = [], topIds = [], jetzt = new Date(), cfg } = {}) {
  const k = konfig(cfg);
  const iso = jetzt.toISOString();
  const funde = { ...speicher.funde };
  const gesehenJetzt = new Set();
  const top = new Set(topIds);
  for (const t of treffer) {
    gesehenJetzt.add(t.id);
    const alt = funde[t.id];
    const f = alt ? { ...alt } : neuerFund(t.id, iso);
    const z = zustandVon(t);
    f.zuletzt = iso;
    f.fehlt = 0;
    f.quelle = t.quelle || f.quelle;
    f.titel = t.titel ?? f.titel;
    f.url = t.url ?? f.url;
    f.ort = t.ort ?? f.ort;
    if (top.has(t.id)) f.inTop = true;
    if (istGeloest(z) && !istGeloest(f.zustand)) f.geloestAm = iso;
    if (!istGeloest(z) && istGeloest(f.zustand)) f.geloestAm = null; // wieder offen (z. B. Issue neu eröffnet)
    f.zustand = z;
    f.verlauf = duenneAus([...f.verlauf, { zeit: iso, kommentare: kommentareVon(t), stimmen: stimmenVon(t), zustand: z, bewertung: t.gesamt ?? null }], k.maxPunkte);
    funde[t.id] = f;
  }
  // Nur Funde derjenigen Quellen, die in diesem Scan antworteten, können „fehlen“.
  const abgefragt = new Set(quellen);
  for (const [id, f] of Object.entries(funde)) {
    if (gesehenJetzt.has(id) || !f.quelle || !abgefragt.has(f.quelle) || istGeloest(f.zustand)) continue;
    funde[id] = { ...f, fehlt: (f.fehlt || 0) + 1 };
  }
  const scans = [...speicher.scans, { zeit: iso, quellen: [...abgefragt], anzahl: treffer.length }];
  return { ...speicher, funde, scans };
}

const tage = (a, b) => (Date.parse(b) - Date.parse(a)) / MS_TAG;
const letzterPunkt = (f) => f.verlauf[f.verlauf.length - 1];

/** Zuwachs je Tag gegenüber dem jüngsten Messpunkt, der mindestens minAbstandTage zurückliegt. */
export function zuwachsProTag(f, minAbstandTage = STANDARD.minAbstandTage) {
  const v = f.verlauf;
  if (v.length < 2) return null;
  const jetzt = v[v.length - 1];
  for (let i = v.length - 2; i >= 0; i--) {
    const d = tage(v[i].zeit, jetzt.zeit);
    if (d >= minAbstandTage) {
      const zuwachs = (jetzt.stimmen + jetzt.kommentare) - (v[i].stimmen + v[i].kommentare);
      return { proTag: zuwachs / d, zuwachs, tage: d };
    }
  }
  return null;
}

export function unveraendertSeit(f) {
  const v = f.verlauf;
  let n = 0;
  for (let i = v.length - 1; i >= 0; i--) {
    const p = v[i];
    if (p.zustand !== 'offen' || p.stimmen !== letzterPunkt(f).stimmen || p.kommentare !== letzterPunkt(f).kommentare) break;
    n++;
  }
  return n;
}

/**
 * Vergleicht den jüngsten Scan im Speicher mit dem davor.
 * Rückgabe: { erster, vergleichMit, letzter, neu, geloest, verschwunden, steigt, liegtLange, trefferliste }
 */
export function auswerten(speicher, { cfg } = {}) {
  const k = konfig(cfg);
  const scans = speicher.scans;
  const letzter = scans[scans.length - 1] || null;
  const vorher = scans.length > 1 ? scans[scans.length - 2] : null;
  const funde = Object.entries(speicher.funde).map(([id, f]) => ({ id, ...f }));
  const leer = { erster: !vorher, vergleichMit: vorher?.zeit || null, letzter: letzter?.zeit || null, neu: [], geloest: [], verschwunden: [], steigt: [], liegtLange: [] };
  const trefferliste = trefferlisteVon(funde, k);
  if (!letzter) return { ...leer, trefferliste };
  const imLetzten = funde.filter((f) => f.zuletzt === letzter.zeit);
  const out = { ...leer, trefferliste };
  if (vorher) {
    out.neu = imLetzten.filter((f) => f.erstmals === letzter.zeit && !istGeloest(f.zustand));
    // Gelöst: Zustand wurde im letzten Scan als gelöst erkannt (sicher, weil die Quelle es hergibt).
    out.geloest = funde.filter((f) => f.geloestAm === letzter.zeit);
    // Nicht mehr gefunden: könnte an Filtern oder Ratenlimit liegen, zählt nicht als gelöst.
    out.verschwunden = funde.filter((f) => f.fehlt === 1 && !istGeloest(f.zustand) && f.quelle && letzter.quellen.includes(f.quelle));
  }
  for (const f of imLetzten) {
    if (istGeloest(f.zustand)) continue;
    if (vorher) {
      const z = zuwachsProTag(f, k.minAbstandTage);
      if (z && z.zuwachs > 0 && z.proTag >= k.steigtProTag) out.steigt.push({ ...f, ...z });
      const p = letzterPunkt(f);
      if (unveraendertSeit(f) >= k.langeScans && (p.bewertung ?? 0) >= k.langeBewertung) out.liegtLange.push({ ...f, scansOffen: unveraendertSeit(f) });
    }
  }
  out.steigt.sort((a, b) => b.proTag - a.proTag);
  out.liegtLange.sort((a, b) => b.scansOffen - a.scansOffen);
  return out;
}

/** Wie viele Funde, die einmal in den Top waren, wurden von anderen gelöst – und nach wie vielen Tagen im Mittel? */
export function trefferlisteVon(funde, k = STANDARD) {
  const top = funde.filter((f) => f.inTop);
  const geloest = top.filter((f) => istGeloest(f.zustand) && f.geloestAm);
  const dauern = geloest.map((f) => Math.max(0, tage(f.erstmals, f.geloestAm)));
  const mittel = dauern.length ? dauern.reduce((a, b) => a + b, 0) / dauern.length : null;
  return { topGesamt: top.length, geloest: geloest.length, mittelTage: mittel };
}

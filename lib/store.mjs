import { readFile } from 'node:fs/promises';
import { hebeAn, schreibeAtomar } from './verlauf-speicher.mjs';

// Gesehen-Karte { "<id>": "<ISO zuletzt gezeigt>" } – damit jeder Scan nur Neues zeigt.
// Liest das alte Format und den Speicher v2 (siehe verlauf-speicher.mjs).
export async function ladeGesehen(pfad) {
  try {
    return gesehenAus(hebeAn(JSON.parse(await readFile(pfad, 'utf8'))));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`Store ${pfad} defekt: ${e.message}`);
  }
}

export const gesehenAus = (speicher) =>
  Object.fromEntries(Object.entries(speicher.funde).filter(([, f]) => f.gezeigt).map(([id, f]) => [id, f.gezeigt]));

export const speichereGesehen = (pfad, gesehen) => schreibeAtomar(pfad, JSON.stringify(gesehen, null, 1));

export function nurNeue(treffer, gesehen) {
  return treffer.filter((t) => !(t.id in gesehen));
}

export function merkeDir(treffer, gesehen, jetzt = new Date()) {
  const iso = jetzt.toISOString();
  const out = { ...gesehen };
  for (const t of treffer) if (!(t.id in out)) out[t.id] = iso;
  return out;
}

// Treffer, die im aktuellen Scan wieder auftauchen, bekommen einen frischen Zeitstempel,
// sonst fallen sie nach maxTage aus dem Speicher und erscheinen erneut als „neu“.
export function auffrischen(gesehen, treffer, jetzt = new Date()) {
  const iso = jetzt.toISOString();
  const out = { ...gesehen };
  for (const t of treffer) if (t.id in out) out[t.id] = iso;
  return out;
}

// Alte Einträge vergessen, sonst wächst die Datei ewig.
export function vergesseAlte(gesehen, maxTage = 120, jetzt = Date.now()) {
  const grenze = jetzt - maxTage * 86_400_000;
  return Object.fromEntries(Object.entries(gesehen).filter(([, iso]) => Date.parse(iso) >= grenze));
}

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

// data/gesehen.json: { "<id>": "<ISO erstmals gesehen>" } – damit jeder Scan nur Neues zeigt.
export async function ladeGesehen(pfad) {
  try {
    const d = JSON.parse(await readFile(pfad, 'utf8'));
    return d && typeof d === 'object' ? d : {};
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`Store ${pfad} defekt: ${e.message}`);
  }
}

export async function speichereGesehen(pfad, gesehen) {
  await mkdir(path.dirname(pfad), { recursive: true });
  const tmp = `${pfad}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(gesehen, null, 1));
  await rename(tmp, pfad);
}

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

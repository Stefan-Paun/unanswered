import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

// Speicher v2 (data/gesehen.json):
// { version: 2, scans: [{ zeit, quellen: ["github", …], anzahl }],
//   funde: { "<id>": { erstmals, zuletzt, gezeigt, quelle, titel, url, ort, zustand, geloestAm, fehlt, inTop,
//                      verlauf: [{ zeit, kommentare, stimmen, zustand, bewertung }] } } }
// Altes Format (Version 1): { "<id>": "<ISO zuletzt gesehen>" } – wird beim Laden verlustfrei angehoben.
export const VERSION = 2;
export const MAX_PUNKTE = 30;
export const MAX_SCANS = 200;

export const leererSpeicher = () => ({ version: VERSION, scans: [], funde: {} });

// Kürzel in der ID → Quellenname (wie QUELLEN[kuerzel].name in lib/sources/index.mjs; ein Test prüft den Gleichklang).
export const QUELLEN_NAMEN = { gh: 'github', so: 'stackoverflow', dc: 'discourse', gd: 'github-discussions', gl: 'gitlab' };
export const quelleAusId = (id) => QUELLEN_NAMEN[String(id).split(':')[0]] || null;

export function neuerFund(id, iso) {
  return { erstmals: iso, zuletzt: iso, gezeigt: null, quelle: quelleAusId(id), titel: null, url: null, ort: null,
    zustand: 'offen', geloestAm: null, fehlt: 0, inTop: false, verlauf: [] };
}

// Hebt jedes bekannte Format auf die aktuelle Version. Unbekannte neuere Version → Fehler statt Datenverlust.
export function hebeAn(roh) {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return leererSpeicher();
  if (roh.version === VERSION && roh.funde && typeof roh.funde === 'object') {
    return { ...roh, scans: Array.isArray(roh.scans) ? roh.scans : [], funde: roh.funde };
  }
  if (roh.version != null && typeof roh.version === 'number' && roh.version > VERSION) {
    throw new Error(`Speicher hat Version ${roh.version}, dieses Programm kennt nur ${VERSION}`);
  }
  const s = leererSpeicher();
  for (const [id, iso] of Object.entries(roh)) {
    if (typeof iso !== 'string') continue;
    s.funde[id] = { ...neuerFund(id, iso), gezeigt: iso };
  }
  return s;
}

export async function ladeSpeicher(pfad) {
  try {
    return hebeAn(JSON.parse(await readFile(pfad, 'utf8')));
  } catch (e) {
    if (e.code === 'ENOENT') return leererSpeicher();
    throw new Error(`Store ${pfad} defekt: ${e.message}`);
  }
}

// Atomar: erst in eine temporäre Datei im selben Ordner, dann umbenennen. Bricht etwas ab,
// bleibt die alte Datei unberührt und die temporäre wird entfernt.
export async function schreibeAtomar(pfad, text, fs = { writeFile, rename, rm }) {
  await mkdir(path.dirname(pfad), { recursive: true });
  const tmp = `${pfad}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tmp, text);
    await fs.rename(tmp, pfad);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

export const speichereSpeicher = (pfad, speicher, fs) => schreibeAtomar(pfad, JSON.stringify(speicher, null, 1), fs);

// Höchstens `max` Punkte: erster und letzter bleiben, sonst fliegt der Punkt weg, dessen Nachbarn am
// dichtesten beieinanderliegen (die Form der Kurve bleibt erhalten, ältere Dichte wird dünner).
export function duenneAus(verlauf, max = MAX_PUNKTE) {
  const v = [...verlauf].sort((a, b) => Date.parse(a.zeit) - Date.parse(b.zeit));
  while (v.length > Math.max(2, max)) {
    let bester = 1;
    let abstand = Infinity;
    for (let i = 1; i < v.length - 1; i++) {
      const d = Date.parse(v[i + 1].zeit) - Date.parse(v[i - 1].zeit);
      if (d < abstand) { abstand = d; bester = i; }
    }
    v.splice(bester, 1);
  }
  return v;
}

// Funde, die lange nirgends mehr auftauchten, fallen heraus, sonst wächst die Datei ewig.
export function vergesseAlteFunde(speicher, maxTage = 120, jetzt = Date.now()) {
  const grenze = jetzt - maxTage * 86_400_000;
  const funde = Object.fromEntries(Object.entries(speicher.funde)
    .filter(([, f]) => Date.parse(f.zuletzt) >= grenze || (f.gezeigt && Date.parse(f.gezeigt) >= grenze)));
  return { ...speicher, funde, scans: speicher.scans.slice(-MAX_SCANS) };
}

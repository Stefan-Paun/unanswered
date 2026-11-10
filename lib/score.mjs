// Zwei Zahlen 0–100: Lösbarkeit (kann ich das realistisch lösen?) und Wirkung (hilft es vielen?).
const klemm = (n) => Math.max(0, Math.min(100, Math.round(n)));

export function loesbarkeit(t, cfg = {}) {
  const fokus = cfg.sprachen || [];
  const { min = 2, max = 60 } = cfg.alterTage || {};
  let p = 30;
  if (t.codeVorhanden) p += 25;
  if (t.fehlertext) p += 15;
  if (t.sprache && fokus.includes(t.sprache)) p += 15;
  else if (t.sprache) p -= 5;
  if (t.alterTage != null) {
    if (t.alterTage < min) p -= 10;        // zu frisch: da antwortet oft noch jemand
    else if (t.alterTage > max) p -= 15;   // zu alt: Fragesteller längst weg
    else p += 10;
  }
  const labels = (t.labels || []).map((l) => l.toLowerCase());
  if (labels.some((l) => /good first issue|help wanted|beginner|easy/.test(l))) p += 15;
  if (labels.some((l) => /wontfix|duplicate|invalid|needs info|needs reproduction/.test(l))) p -= 25;
  if (typeof t.wirkungRoh?.punkte === 'number' && t.wirkungRoh.punkte < 0) p -= 15;
  const laenge = (t.text || '').length;
  if (laenge < 80) p -= 15;
  else if (laenge > 6000) p -= 5;
  return klemm(p);
}

export const ERSATZ_WIRKUNG = 30;

export function wirkung(t) {
  const r = t.wirkungRoh || {};
  if (r.fork || r.archiviert) return 0;
  let p;
  switch (t.quelle) {
    case 'github': {
      p = (Math.log10((r.sterne || 0) + 1) / 5) * 100;            // 100 000 Sterne → 100
      p += Math.min(10, Math.log10((r.forks || 0) + 1) * 3);
      p += Math.min(20, (r.reaktionen || 0) * 4);                   // andere sind auch betroffen
      break;
    }
    case 'github-discussions':
    case 'gitlab': {
      // Sterne wie bei GitHub; fehlen sie (GitLab-Suche ohne Projektliste, anonyme Felder), gilt die Ersatzgröße 30.
      // Reaktionen/Stimmen (GitLab: Daumen hoch) zählen wie bei GitHub-Issues, höchstens +20.
      p = typeof r.sterne === 'number' ? (Math.log10(r.sterne + 1) / 5) * 100 : ERSATZ_WIRKUNG;
      p += Math.min(10, Math.log10((r.forks || 0) + 1) * 3);
      p += Math.min(20, ((r.reaktionen || 0) + (r.stimmen || 0)) * 4);
      break;
    }
    case 'stackoverflow': {
      p = (Math.log10((r.aufrufe || 0) + 1) / 4) * 100;           // 10 000 Aufrufe → 100
      p += (r.punkte || 0) * 5;
      break;
    }
    case 'discourse': {
      p = r.gewicht ?? 50;
      p += Math.min(20, Math.log10((r.aufrufe || 0) + 1) * 7);
      break;
    }
    default:
      p = 30;
  }
  return Math.max(5, klemm(p));
}

export function bewerte(t, cfg) {
  const l = loesbarkeit(t, cfg);
  const w = wirkung(t);
  return { ...t, loesbarkeit: l, wirkung: w, gesamt: Math.round(Math.sqrt(l * w)) };
}

export function sortiere(liste) {
  return [...liste].sort((a, b) => b.gesamt - a.gesamt || b.wirkung - a.wirkung || a.titel.localeCompare(b.titel));
}

// Höchstens n Treffer pro Ort (Repo/Forum), damit ein großes Repo nicht die ganze Liste füllt.
// Stack Overflow ist ein Ort für alles und wird deshalb nicht gedeckelt.
export const ortSchluessel = (t) => (t.quelle === 'stackoverflow' ? t.id : t.ort);

export function verteile(liste, maxProOrt = 3, schluessel = ortSchluessel) {
  const zaehler = new Map();
  const vorne = [];
  const hinten = [];
  for (const t of liste) {
    const k = schluessel(t);
    const n = zaehler.get(k) || 0;
    zaehler.set(k, n + 1);
    (n < maxProOrt ? vorne : hinten).push(t);
  }
  return [...vorne, ...hinten];
}

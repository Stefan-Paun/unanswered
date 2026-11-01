import { kuerze } from '../normalize.mjs';

const F = { lila: '\x1b[38;2;189;147;249m', gruen: '\x1b[38;2;80;250;123m', gelb: '\x1b[38;2;241;250;140m',
  rot: '\x1b[38;2;255;85;85m', cyan: '\x1b[38;2;139;233;253m', grau: '\x1b[38;2;98;114;164m', fett: '\x1b[1m', aus: '\x1b[0m' };
const farbe = (n) => (n >= 70 ? F.gruen : n >= 45 ? F.gelb : F.rot);
export const QUELLE_KURZ = { github: 'GH', stackoverflow: 'SO', discourse: 'DC' };

export function toConsole(liste, meta = {}, { farben = process.stdout.isTTY } = {}) {
  const c = (code, s) => (farben ? code + s + F.aus : s);
  const zeilen = [];
  zeilen.push(c(F.fett, `Ungelöst · ${meta.when || ''} · ${meta.gesamt ?? liste.length} gefunden, ${meta.neu ?? liste.length} neu, Top ${liste.length}`));
  if (meta.fehler?.length) zeilen.push(c(F.rot, 'Fehler: ' + meta.fehler.join(' | ')));
  zeilen.push(c(F.grau, '  Ges  Lös  Wirk  Q   Alter  Titel'));
  for (const t of liste) {
    const alter = t.alterTage == null ? '  ?' : String(Math.round(t.alterTage)).padStart(3) + 'd';
    zeilen.push(
      `  ${c(farbe(t.gesamt), String(t.gesamt).padStart(3))}  ${String(t.loesbarkeit).padStart(3)}  ${String(t.wirkung).padStart(4)}  ` +
      `${c(F.cyan, QUELLE_KURZ[t.quelle] || '??')}  ${alter}  ${kuerze(t.titel, 70)}`,
    );
    zeilen.push(c(F.grau, `                            ${t.id} · ${t.url}`));
  }
  if (!liste.length) zeilen.push(c(F.grau, '  Nichts Neues. Mit --alle siehst du auch schon Gezeigtes.'));
  return zeilen.join('\n');
}

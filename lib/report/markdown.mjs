import { kuerze } from '../normalize.mjs';
import { QUELLE_KURZ } from './summary.mjs';

const mdText = (s) => String(s).replace(/[\\`*_\[\]()<>|#]/g, (c) => '\\' + c);
const mdUrl = (u) => String(u).replace(/[\s()<>]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
const mdCode = (s) => String(s).replace(/`/g, '');

export function toMarkdown(liste, meta = {}) {
  const z = [`# Ungelöst – ${meta.when || ''}`, '', `${meta.gesamt ?? liste.length} gefunden, ${meta.neu ?? liste.length} neu, Top ${liste.length}.`, ''];
  if (meta.fehler?.length) z.push(`> Fehler: ${meta.fehler.join(' | ')}`, '');
  z.push('| Ges | Lös | Wirk | Q | Alter | Problem |', '|---:|---:|---:|---|---:|---|');
  for (const t of liste) {
    const alter = t.alterTage == null ? '?' : `${Math.round(t.alterTage)}d`;
    z.push(`| ${t.gesamt} | ${t.loesbarkeit} | ${t.wirkung} | ${QUELLE_KURZ[t.quelle] || '??'} | ${alter} | [${mdText(kuerze(t.titel, 90))}](${mdUrl(t.url)}) \`${mdCode(t.id)}\`${t.wirkungRoh?.sterneUnbekannt ? ' (Sterne ?)' : ''} |`);
  }
  return z.join('\n') + '\n';
}

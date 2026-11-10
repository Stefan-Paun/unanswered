import { sucheGithub, githubToken } from './github.mjs';
import { sucheStackoverflow } from './stackoverflow.mjs';
import { sucheDiscourse } from './discourse.mjs';
import { sucheDiskussionen } from './github-discussions.mjs';

export const QUELLEN = {
  gh: { name: 'github', lauf: async (cfg, o) => sucheGithub(cfg, { ...o, token: await githubToken(o.env) }) },
  so: { name: 'stackoverflow', lauf: sucheStackoverflow },
  dc: { name: 'discourse', lauf: sucheDiscourse },
  gd: { name: 'github-discussions', lauf: async (cfg, o) => sucheDiskussionen(cfg, { ...o, token: await githubToken(o.env) }) },
};

/**
 * Alle Quellen nacheinander. Rückgabe: treffer, fehler (jede fehlgeschlagene Anfrage),
 * ausgefallen (Quellen, die Fehler hatten und keinen einzigen Treffer lieferten).
 */
export async function sammle(cfg, { quellen = Object.keys(QUELLEN), log = () => {}, jetzt = Date.now(), env = process.env, fetchImpl, schlaf } = {}) {
  const alle = [];
  const fehler = [];
  const ausgefallen = [];
  if (!quellen.length) throw new Error('Keine Quelle angegeben (gh, so, dc, gd, gl)');
  for (const k of quellen) {
    const q = QUELLEN[k];
    if (!q) { fehler.push(`Unbekannte Quelle ${k}`); continue; }
    const eigene = [];
    let neu = [];
    try {
      neu = await q.lauf(cfg, { log, jetzt, fehler: eigene, env, fetchImpl, schlaf });
    } catch (e) {
      eigene.push(`${q.name}: abgebrochen – ${e.message}`);
      log(`${q.name}: abgebrochen – ${e.message}`);
    }
    if (eigene.length && !neu.length) ausgefallen.push(q.name);
    fehler.push(...eigene);
    alle.push(...neu);
  }
  return { treffer: alle, fehler, ausgefallen };
}

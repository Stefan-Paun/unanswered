import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const STANDARD = {
  sprachen: ['javascript', 'typescript', 'python'],
  alterTage: { min: 2, max: 60 },
  top: 20,
  maxProOrt: 3,
  github: { labels: ["bug"], minSterne: 20, proSprache: 30, maxRepoAbfragen: 40 },
  stackoverflow: { tags: ['javascript', 'python'], proTag: 30, minQuota: 20 },
  discourse: { foren: [] },
  ausschluss: { titelMuster: [], repos: [] },
};

export async function ladeConfig(pfad = path.join(WURZEL, 'ungeloest.config.json')) {
  let eigene = {};
  try {
    eigene = JSON.parse(await readFile(pfad, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`Config ${pfad} nicht lesbar: ${e.message}`);
  }
  const cfg = verschmelze(STANDARD, eigene);
  for (const m of cfg.ausschluss?.titelMuster || []) {
    try { new RegExp(m, 'i'); } catch (e) { throw new Error(`Ungültiges Titelmuster ${JSON.stringify(m)} in der Config: ${e.message}`); }
  }
  return cfg;
}

export function verschmelze(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof a[k] === 'object' && !Array.isArray(a[k])
      ? verschmelze(a[k], v)
      : v;
  }
  return out;
}

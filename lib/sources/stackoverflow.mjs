import { holeJson, schlafe } from '../http.mjs';
import { treffer, erkenneSprache, entferneHtml } from '../normalize.mjs';

const API = 'https://api.stackexchange.com/2.3';

export function parseFragen(json, { jetzt = Date.now() } = {}) {
  return (json?.items || [])
    .filter((f) => !f.is_answered && (f.answer_count || 0) === 0)
    .map((f) => treffer({
      id: `so:${f.question_id}`,
      quelle: 'stackoverflow',
      titel: entferneHtml(f.title),
      url: f.link,
      text: entferneHtml(f.body || ''),
      erstellt: f.creation_date,
      sprache: erkenneSprache(f.tags || []),
      tags: f.tags || [],
      antworten: f.answer_count || 0,
      ort: 'stackoverflow.com',
      wirkungRoh: { aufrufe: f.view_count || 0, punkte: f.score || 0 },
    }, jetzt));
}

/**
 * Unbeantwortete Fragen je Tag. Ohne Key 300 Anfragen/Tag – wir lesen quota_remaining aus jeder
 * Antwort und hören bei minQuota auf. `backoff` (Sekunden) wird eingehalten.
 */
export async function sucheStackoverflow(cfg, { key = process.env.STACKAPPS_KEY, fetchImpl = fetch, jetzt = Date.now(), log = () => {}, fehler = [] } = {}) {
  const so = cfg.stackoverflow || {};
  const ab = Math.floor((jetzt - (cfg.alterTage?.max || 60) * 86_400_000) / 1000);
  const alle = [];
  let quota = null;
  for (const tag of so.tags || []) {
    if (quota != null && quota < (so.minQuota ?? 20)) {
      log(`stackoverflow: Quota fast leer (${quota}), stoppe`);
      break;
    }
    const p = new URLSearchParams({
      order: 'desc', sort: 'creation', tagged: tag, site: 'stackoverflow',
      pagesize: String(so.proTag || 30), filter: 'withbody', fromdate: String(ab),
    });
    if (key) p.set('key', key);
    try {
      const { daten } = await holeJson(`${API}/questions/no-answers?${p}`, { fetchImpl });
      quota = daten.quota_remaining ?? quota;
      const neu = parseFragen(daten, { jetzt });
      log(`stackoverflow ${tag}: ${neu.length} Fragen (Quota ${quota}/${daten.quota_max ?? '?'})`);
      alle.push(...neu);
      if (daten.backoff) await schlafe(daten.backoff * 1000 + 200);
    } catch (e) {
      log(`stackoverflow ${tag}: Fehler – ${e.message}`);
      fehler.push(`stackoverflow ${tag}: ${e.message}`);
      if (e.status === 400 || e.status === 429 || e.status === 502) break;
    }
  }
  // dieselbe Frage kann unter mehreren Tags kommen
  const gesehen = new Set();
  return alle.filter((t) => !gesehen.has(t.id) && gesehen.add(t.id));
}

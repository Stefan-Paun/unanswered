import { holeJson } from '../http.mjs';
import { treffer, erkenneSprache, entferneHtml } from '../normalize.mjs';

export function parseThemen(json, forum, { jetzt = Date.now() } = {}) {
  const blurbs = new Map((json?.posts || []).map((p) => [p.topic_id, p.blurb || '']));
  return (json?.topics || [])
    .filter((t) => (t.posts_count || 1) <= 1 && !t.closed && !t.archived && !t.pinned && t.visible !== false && !t.has_accepted_answer)
    .map((t) => treffer({
      id: `dc:${forum.host}/${t.id}`,
      quelle: 'discourse',
      titel: t.title,
      url: `https://${forum.host}/t/${t.slug}/${t.id}`,
      text: entferneHtml(blurbs.get(t.id) || ''),
      erstellt: t.created_at,
      sprache: erkenneSprache([forum.sprache, ...(t.tags || [])]),
      tags: t.tags || [],
      ort: forum.host,
      wirkungRoh: { gewicht: forum.gewicht ?? 50, aufrufe: t.views || 0 },
    }, jetzt));
}

/** Themen ohne Antwort je Forum. Ein Forum, das nicht antwortet, bricht die anderen nicht ab. */
export async function sucheDiscourse(cfg, { fetchImpl = fetch, jetzt = Date.now(), log = () => {}, fehler = [] } = {}) {
  const alle = [];
  for (const forum of cfg.discourse?.foren || []) {
    const q = encodeURIComponent('status:noreplies order:latest');
    try {
      const { daten } = await holeJson(`https://${forum.host}/search.json?q=${q}`, { fetchImpl });
      const neu = parseThemen(daten, forum, { jetzt });
      log(`discourse ${forum.host}: ${neu.length} Themen ohne Antwort`);
      alle.push(...neu);
    } catch (e) {
      log(`discourse ${forum.host}: Fehler – ${e.message}`);
      fehler.push(`discourse ${forum.host}: ${e.message}`);
    }
  }
  return alle;
}

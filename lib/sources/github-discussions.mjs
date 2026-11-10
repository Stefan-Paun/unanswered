import { erstelleAbruf } from '../abruf.mjs';
import { treffer, erkenneSprache, MS_TAG } from '../normalize.mjs';
import { begrenze, httpsUrl, zahl, labelListe, sauberBegriff, REPO_MUSTER, MAX_TITEL, MAX_TEXT } from './gemeinsam.mjs';

export const GRAPHQL = 'https://api.github.com/graphql';
const REPOS_PRO_ANFRAGE = 5;

export const ABFRAGE = `query($q:String!,$n:Int!,$after:String){
 search(query:$q,type:DISCUSSION,first:$n,after:$after){
  pageInfo{hasNextPage endCursor}
  nodes{... on Discussion{
   number title url createdAt body closed locked isAnswered answer{id} upvoteCount
   category{name isAnswerable}
   comments{totalCount} reactions{totalCount}
   labels(first:10){nodes{name}}
   repository{nameWithOwner isArchived isFork stargazerCount forkCount primaryLanguage{name}}
  }}
 }
}`;

export function einstellungen(cfg = {}) {
  const d = cfg.githubDiscussions || {};
  return {
    repos: (Array.isArray(d.repos) ? d.repos : []).filter((r) => typeof r === 'string' && REPO_MUSTER.test(r)),
    suche: sauberBegriff(d.suche),
    minReaktionen: zahl(d.minReaktionen) ?? 0,
    minSterne: zahl(d.minSterne) ?? 0,
    maxSeiten: Math.max(1, Math.min(10, Math.trunc(zahl(d.maxSeiten) ?? 3))),
    proSeite: Math.max(1, Math.min(100, Math.trunc(zahl(d.proSeite) ?? 50))),
  };
}

/** Suchanfragen (Text) für die Einstellungen; leer, wenn weder Repos noch Suchbegriff gesetzt sind. */
export function planeAnfragen(cfg, jetzt = Date.now()) {
  const e = einstellungen(cfg);
  if (!e.repos.length && !e.suche) return [];
  const tag = (d) => new Date(jetzt - d * MS_TAG).toISOString().slice(0, 10);
  const { min = 2, max = 60 } = cfg.alterTage || {};
  const rest = [e.suche, 'is:unanswered', `created:${tag(max)}..${tag(min)}`].filter(Boolean).join(' ');
  if (!e.repos.length) return [rest];
  const out = [];
  for (let i = 0; i < e.repos.length; i += REPOS_PRO_ANFRAGE) {
    out.push(`${e.repos.slice(i, i + REPOS_PRO_ANFRAGE).map((r) => `repo:${r}`).join(' ')} ${rest}`);
  }
  return out;
}

/**
 * Reine Funktion: GraphQL-Antwort → { treffer, warnungen, weiter, cursor }.
 * Kaputte oder unerwartete Knoten werden übersprungen und als Warnung gezählt.
 */
export function parseDiskussionen(json, { jetzt = Date.now(), cfg = {} } = {}) {
  const e = einstellungen(cfg);
  const { min = 2, max = 60 } = cfg.alterTage || {};
  const such = json?.data?.search;
  const warnungen = [];
  if (!such || !Array.isArray(such.nodes)) {
    const msg = Array.isArray(json?.errors) && json.errors[0]?.message ? begrenze(json.errors[0].message, 150, { einzeilig: true }) : 'unerwartete Antwortform';
    return { treffer: [], warnungen: [`GraphQL ohne Ergebnisliste (${msg})`], weiter: false, cursor: null };
  }
  let kaputt = 0;
  const out = [];
  for (const d of such.nodes) {
    if (!d || typeof d !== 'object' || !Object.keys(d).length) continue; // andere Treffertypen der Suche
    const repo = d.repository?.nameWithOwner;
    const url = httpsUrl(d.url);
    if (!Number.isInteger(d.number) || typeof d.title !== 'string' || !url || typeof repo !== 'string' || !REPO_MUSTER.test(repo)) { kaputt++; continue; }
    if (d.category?.isAnswerable !== true || d.answer || d.isAnswered || d.closed || d.locked) continue;
    if (d.repository.isArchived || d.repository.isFork) continue;
    const reaktionen = zahl(d.reactions?.totalCount) ?? 0;
    const stimmen = zahl(d.upvoteCount);
    if (reaktionen + (stimmen ?? 0) < e.minReaktionen) continue;
    const sterne = zahl(d.repository.stargazerCount);
    if (e.minSterne && (sterne ?? 0) < e.minSterne) continue;
    const alter = (jetzt - Date.parse(d.createdAt)) / MS_TAG;
    if (!Number.isFinite(alter)) { kaputt++; continue; }
    if (alter < min || alter > max) continue;
    out.push(treffer({
      id: `gd:${repo}#${d.number}`,
      quelle: 'github-discussions',
      titel: begrenze(d.title, MAX_TITEL, { einzeilig: true }),
      url,
      text: begrenze(d.body, MAX_TEXT),
      erstellt: d.createdAt,
      sprache: erkenneSprache([d.repository.primaryLanguage?.name]),
      labels: labelListe((d.labels?.nodes || []).map((l) => l?.name)),
      kommentare: zahl(d.comments?.totalCount) ?? 0,
      ort: repo,
      wirkungRoh: {
        reaktionen, ...(stimmen != null ? { stimmen } : {}),
        ...(sterne != null ? { sterne } : {}), forks: zahl(d.repository.forkCount) ?? 0,
      },
    }, jetzt));
  }
  if (kaputt) warnungen.push(`${kaputt} unbrauchbare Diskussion(en) übersprungen`);
  const seite = such.pageInfo;
  const weiter = seite?.hasNextPage === true && typeof seite.endCursor === 'string' && seite.endCursor.length > 0;
  return { treffer: out, warnungen, weiter, cursor: weiter ? seite.endCursor : null };
}

/** Diskussionen ohne gewählte Antwort. Ohne Token: klare Meldung statt Absturz. */
export async function sucheDiskussionen(cfg, { token, fetchImpl = fetch, jetzt = Date.now(), log = () => {}, fehler = [], schlaf, uhr } = {}) {
  const anfragen = planeAnfragen(cfg, jetzt);
  if (!anfragen.length) { log('github-discussions: nichts eingestellt (githubDiscussions.repos oder .suche) – übersprungen'); return []; }
  if (!token) {
    fehler.push('github-discussions: kein GitHub-Token (GITHUB_TOKEN setzen oder `gh auth login`) – die GraphQL-Schnittstelle verlangt einen Token, Quelle übersprungen');
    return [];
  }
  const e = einstellungen(cfg);
  const abruf = erstelleAbruf({
    name: 'github-discussions', fetchImpl, geheimnisse: [token], log, schlaf, uhr,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const alle = new Map();
  for (const q of anfragen) {
    let cursor = null;
    for (let seite = 1; seite <= e.maxSeiten; seite++) {
      let res;
      try {
        res = await abruf(GRAPHQL, { method: 'POST', body: JSON.stringify({ query: ABFRAGE, variables: { q, n: e.proSeite, after: cursor } }) });
      } catch (err) {
        log(`github-discussions: Fehler – ${err.message}`);
        fehler.push(err.message);
        if (err.ratenlimit) return [...alle.values()]; // Teilmenge liefern
        break;
      }
      const r = parseDiskussionen(res.daten, { jetzt, cfg });
      for (const w of r.warnungen) { log(`github-discussions: ${w}`); fehler.push(`github-discussions: ${w}`); }
      for (const t of r.treffer) alle.set(t.id, t);
      log(`github-discussions Seite ${seite}: ${r.treffer.length} Diskussionen`);
      if (!r.weiter) break;
      cursor = r.cursor;
    }
  }
  return [...alle.values()];
}

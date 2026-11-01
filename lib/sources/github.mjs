import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { holeJson, mitAbstand, schlafe } from '../http.mjs';
import { treffer, erkenneSprache } from '../normalize.mjs';

const API = 'https://api.github.com';
export const WARTE_SEK = [5, 20, 60];
const exec = promisify(execFile);

// Token aus gh (Keychain), sonst Umgebung, sonst anonym (10 Suchen/min statt 30).
export async function githubToken(env = process.env) {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  try {
    const { stdout } = await exec('gh', ['auth', 'token'], { timeout: 5000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export function suchanfrage({ sprache, label, minAlterTage = 2, maxAlterTage = 60, jetzt = Date.now() }) {
  const tag = (d) => new Date(jetzt - d * 86_400_000).toISOString().slice(0, 10);
  // Zeitfenster statt nur Untergrenze: brandneue Issues bekommen oft noch von selbst eine Antwort.
  const teile = ['is:issue', 'is:open', 'comments:0', 'no:assignee', `created:${tag(maxAlterTage)}..${tag(minAlterTage)}`, `language:${sprache}`];
  if (label) teile.push(`label:"${label}"`);
  return teile.join(' ');
}

export function repoAusUrl(repositoryUrl = '') {
  const m = /repos\/([^/]+\/[^/]+)$/.exec(repositoryUrl);
  return m ? m[1] : '';
}

// Reine Funktion: GitHub-Suchantwort → Treffer (ohne Sterne, die kommen später dazu).
export function parseIssues(json, { sprache = null, jetzt = Date.now() } = {}) {
  return (json?.items || [])
    .filter((i) => !i.pull_request && i.state === 'open')
    .map((i) => {
      const repo = repoAusUrl(i.repository_url);
      return treffer({
        id: `gh:${repo}#${i.number}`,
        quelle: 'github',
        titel: i.title,
        url: i.html_url,
        text: i.body || '',
        erstellt: i.created_at,
        sprache: erkenneSprache([sprache]),
        labels: (i.labels || []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean),
        kommentare: i.comments || 0,
        ort: repo,
        wirkungRoh: { reaktionen: i.reactions?.total_count || 0 },
      }, jetzt);
    });
}

export function parseRepo(json) {
  return {
    sterne: json?.stargazers_count || 0,
    forks: json?.forks_count || 0,
    fork: Boolean(json?.fork),
    archiviert: Boolean(json?.archived),
    beschreibung: json?.description || '',
  };
}

/**
 * Sucht offene, unkommentierte Issues je Sprache, lädt für die beteiligten Repos die Sterne nach
 * und wirft Repos unter minSterne weg. Hält 30 Suchen/min (2,1 s Abstand) ein.
 */
export async function sucheGithub(cfg, { token, fetchImpl = fetch, jetzt = Date.now(), log = () => {}, fehler = [] } = {}) {
  const gh = cfg.github || {};
  const headers = { 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const takt = mitAbstand(token ? 3000 : 6500);
  const alle = [];
  const labels = gh.labels?.length ? gh.labels : [null];
  // Sekundäres Rate-Limit (403/429) auf der Suche ist kurzlebig: gemessen 403 ohne Retry-After,
  // dieselbe Anfrage 5 s später 200. Darum kurze, wachsende Pausen (Retry-After hat Vorrang).
  const holeMitGeduld = async (url) => {
    for (let versuch = 0; ; versuch++) {
      try {
        return await takt(() => holeJson(url, { headers, fetchImpl }));
      } catch (e) {
        if ((e.status !== 403 && e.status !== 429) || versuch >= WARTE_SEK.length) throw e;
        const roh = e.headers?.get?.('retry-after');
        const kopf = roh == null || roh === '' ? NaN : Number(roh);
        const sek = Math.min(120, Math.max(1, Number.isFinite(kopf) ? kopf : WARTE_SEK[versuch]));
        log(`github: Rate-Limit, warte ${sek} s (Versuch ${versuch + 1}/${WARTE_SEK.length})`);
        await schlafe(sek * 1000);
      }
    }
  };
  suche: for (const sprache of cfg.sprachen || []) {
    for (const label of labels) {
      const q = suchanfrage({ sprache, label, minAlterTage: cfg.alterTage?.min, maxAlterTage: cfg.alterTage?.max, jetzt });
      // Nach Reaktionen sortiert: ein unkommentiertes Issue mit 👍 von anderen trifft offenbar mehrere.
      const url = `${API}/search/issues?q=${encodeURIComponent(q)}&sort=reactions&order=desc&per_page=${gh.proSprache || 30}`;
      try {
        const { daten } = await holeMitGeduld(url);
        const neu = parseIssues(daten, { sprache, jetzt });
        log(`github ${sprache}${label ? ' ' + label : ''}: ${neu.length} von ${daten.total_count} Issues`);
        alle.push(...neu);
      } catch (e) {
        log(`github ${sprache}: Fehler – ${e.message}`);
        fehler.push(`github ${sprache}: ${e.message}`);
        if (e.status === 403 || e.status === 429) break suche; // zweites Mal gesperrt: ganz aufhören
      }
    }
  }
  // Sterne je Repo nachladen (einmal pro Repo, begrenzt; Repos mit den meisten Reaktionen zuerst)
  const reaktionen = new Map();
  for (const t of alle) reaktionen.set(t.ort, Math.max(reaktionen.get(t.ort) || 0, t.wirkungRoh.reaktionen || 0));
  const repos = [...reaktionen.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r).slice(0, gh.maxRepoAbfragen || 40);
  const info = new Map();
  for (const repo of repos) {
    try {
      const { daten } = await holeJson(`${API}/repos/${repo}`, { headers, fetchImpl });
      info.set(repo, parseRepo(daten));
    } catch (e) {
      log(`github repo ${repo}: ${e.message}`);
      if (e.status === 404) continue; // Repo weg oder privat geworden: Issues dazu fallen einfach raus
      fehler.push(`github repo ${repo}: ${e.message}`);
      if (e.status === 403 || e.status === 429) { fehler.push('github repos: Rate-Limit, Rest übersprungen'); break; }
    }
  }
  const min = gh.minSterne ?? 0;
  return alle
    .filter((t) => info.has(t.ort))
    .map((t) => ({ ...t, wirkungRoh: { ...t.wirkungRoh, ...info.get(t.ort) } }))
    .filter((t) => !t.wirkungRoh.fork && !t.wirkungRoh.archiviert && t.wirkungRoh.sterne >= min);
}

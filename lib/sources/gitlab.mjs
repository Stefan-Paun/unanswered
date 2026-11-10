import { erstelleAbruf, kopf } from '../abruf.mjs';
import { treffer, MS_TAG } from '../normalize.mjs';
import { begrenze, httpsUrl, zahl, labelListe, sauberBegriff, MAX_TITEL, MAX_TEXT } from './gemeinsam.mjs';

// Fest gitlab.com: keine einstellbare Adresse, damit ein Token nie an einen fremden Host geht.
export const API = 'https://gitlab.com/api/v4';
export const WEB = 'https://gitlab.com/';
const PROJEKT_MUSTER = /^(?:\d{1,12}|[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)$/;
const LABEL_MUSTER = /^[^\s,&?#=][^,&?#=\n\r]{0,49}$/;

export function gitlabToken(env = process.env) {
  return env.GITLAB_TOKEN || null;
}

const echterPfad = (p) => p.split('/').every((s) => !/^\.+$/.test(s));

export function einstellungen(cfg = {}) {
  const g = cfg.gitlab || {};
  const liste = (x) => (Array.isArray(x) ? x : []).filter((s) => typeof s === 'string');
  return {
    projekte: liste(g.projekte).filter((p) => PROJEKT_MUSTER.test(p) && echterPfad(p)),
    suche: sauberBegriff(g.suche),
    labels: liste(g.labels).filter((l) => LABEL_MUSTER.test(l)).slice(0, 5),
    minSterne: zahl(g.minSterne) ?? 0,
    maxSeiten: Math.max(1, Math.min(10, Math.trunc(zahl(g.maxSeiten) ?? 3))),
    proSeite: Math.max(1, Math.min(100, Math.trunc(zahl(g.proSeite) ?? 50))),
  };
}

/** Geplante Issue-Abfragen (URLs ohne Seitenzahl). Leer, wenn weder Projekte noch Suchbegriff gesetzt sind. */
export function planeAnfragen(cfg, jetzt = Date.now()) {
  const e = einstellungen(cfg);
  if (!e.projekte.length && !e.suche) return [];
  const { min = 2, max = 60 } = cfg.alterTage || {};
  const ziele = e.projekte.length ? e.projekte.map((p) => `${API}/projects/${encodeURIComponent(p)}/issues`) : [`${API}/issues`];
  const labels = e.labels.length ? e.labels : [null];
  const out = [];
  for (const basis of ziele) {
    for (const label of labels) {
      const p = new URLSearchParams({ state: 'opened', scope: 'all', assignee_id: 'None', order_by: 'created_at', sort: 'desc', per_page: String(e.proSeite),
        created_after: new Date(jetzt - max * MS_TAG).toISOString(), created_before: new Date(jetzt - min * MS_TAG).toISOString() });
      if (e.suche) p.set('search', e.suche);
      if (label) p.set('labels', label);
      out.push(`${basis}?${p}`);
    }
  }
  return out;
}

/**
 * Reine Funktion: GitLab-Issueliste → { treffer, warnungen }.
 * `projektInfo` (Map Projektpfad → { sterne, forks, fork, archiviert }) ist optional; ohne Sterne gilt in der Bewertung die Ersatzgröße.
 */
export function parseIssues(json, { jetzt = Date.now(), cfg = {}, projektInfo = new Map() } = {}) {
  const { min = 2, max = 60 } = cfg.alterTage || {};
  if (!Array.isArray(json)) return { treffer: [], warnungen: ['GitLab-Antwort ist keine Liste'] };
  let kaputt = 0;
  const out = [];
  for (const i of json) {
    if (!i || typeof i !== 'object') { kaputt++; continue; }
    const url = httpsUrl(i.web_url);
    const ref = typeof i.references?.full === 'string' ? i.references.full : null;
    const pfad = ref ? ref.replace(/#\d+$/, '') : null;
    if (!Number.isInteger(i.iid) || typeof i.title !== 'string' || !url || !url.startsWith(WEB) || typeof i.user_notes_count !== 'number') { kaputt++; continue; }
    if (i.state !== 'opened' || i.confidential === true || i.user_notes_count !== 0) continue;
    if (Array.isArray(i.assignees) && i.assignees.length) continue;
    const alter = (jetzt - Date.parse(i.created_at)) / MS_TAG;
    if (!Number.isFinite(alter)) { kaputt++; continue; }
    if (alter < min || alter > max) continue;
    const ort = pfad || (Number.isInteger(i.project_id) ? String(i.project_id) : 'gitlab');
    const info = projektInfo.get(ort) || {};
    if (info.fork || info.archiviert) continue;
    if (cfg.gitlab?.minSterne && (info.sterne ?? 0) < cfg.gitlab.minSterne) continue;
    out.push(treffer({
      id: `gl:${ref || `${i.project_id}#${i.iid}`}`,
      quelle: 'gitlab',
      titel: begrenze(i.title, MAX_TITEL, { einzeilig: true }),
      url,
      text: begrenze(i.description, MAX_TEXT),
      erstellt: i.created_at,
      labels: labelListe((Array.isArray(i.labels) ? i.labels : []).map((l) => (typeof l === 'string' ? l : l?.name))),
      kommentare: 0,
      ort,
      wirkungRoh: { stimmen: zahl(i.upvotes) ?? 0, ...(info.sterne != null ? { sterne: info.sterne, forks: info.forks ?? 0 } : {}) },
    }, jetzt));
  }
  return { treffer: out, warnungen: kaputt ? [`${kaputt} unbrauchbare Issue(s) übersprungen`] : [] };
}

export function parseProjekt(json) {
  if (!json || typeof json !== 'object') return null;
  return { sterne: zahl(json.star_count), forks: zahl(json.forks_count) ?? 0, fork: Boolean(json.forked_from_project), archiviert: Boolean(json.archived) };
}

/** Offene Issues ohne Kommentare von anderen. Ohne Token nur öffentliche Daten (nur mit Projektliste). */
export async function sucheGitlab(cfg, { token = null, fetchImpl = fetch, jetzt = Date.now(), log = () => {}, fehler = [], schlaf, uhr } = {}) {
  const anfragen = planeAnfragen(cfg, jetzt);
  if (!anfragen.length) { log('gitlab: nichts eingestellt (gitlab.projekte oder .suche) – übersprungen'); return []; }
  const e = einstellungen(cfg);
  if (!e.projekte.length && !token) {
    fehler.push('gitlab: Suche über alle Projekte braucht einen Token (GITLAB_TOKEN) – ohne Token nur mit gitlab.projekte; Quelle übersprungen');
    return [];
  }
  const abruf = erstelleAbruf({ name: 'gitlab', fetchImpl, geheimnisse: [token], log, schlaf, uhr, headers: token ? { 'PRIVATE-TOKEN': token } : {} });
  const warn = (msg) => { log(`gitlab: ${msg}`); fehler.push(`gitlab: ${msg}`); };

  // Projekt-Infos (Sterne) einmal je Projekt; ein Fehler dort ist nur eine Warnung.
  const projektInfo = new Map();
  for (const p of e.projekte) {
    try {
      const { daten } = await abruf(`${API}/projects/${encodeURIComponent(p)}`);
      const info = parseProjekt(daten);
      if (info) projektInfo.set(p, info); else warn(`Projekt ${p}: unerwartete Antwort`);
    } catch (err) {
      warn(err.message.replace(/^gitlab: /, ''));
      if (err.ratenlimit) return [];
    }
  }

  const alle = new Map();
  for (const basis of anfragen) {
    for (let seite = 1; seite <= e.maxSeiten; seite++) {
      let res;
      try {
        res = await abruf(`${basis}&page=${seite}`);
      } catch (err) {
        warn(err.message.replace(/^gitlab: /, ''));
        if (err.ratenlimit) return [...alle.values()]; // Teilmenge
        break;
      }
      // Die Info-Tabelle ist nach Projektpfad geschlüsselt, Treffer tragen den Pfad aus references.full.
      const r = parseIssues(res.daten, { jetzt, cfg, projektInfo });
      for (const w of r.warnungen) warn(w);
      for (const t of r.treffer) alle.set(t.id, t);
      log(`gitlab Seite ${seite}: ${r.treffer.length} Issues`);
      const naechste = kopf(res.headers, 'x-next-page');
      const roh = Array.isArray(res.daten) ? res.daten.length : 0;
      if (!naechste || !/^\d+$/.test(naechste) || roh === 0) break;
    }
  }
  return [...alle.values()];
}

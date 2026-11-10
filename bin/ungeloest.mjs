#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ladeConfig, WURZEL } from '../lib/config.mjs';
import { sammle } from '../lib/sources/index.mjs';
import { parseIssues, parseRepo } from '../lib/sources/github.mjs';
import { parseFragen } from '../lib/sources/stackoverflow.mjs';
import { parseThemen } from '../lib/sources/discourse.mjs';
import { parseDiskussionen, planeAnfragen as planeGd, GRAPHQL } from '../lib/sources/github-discussions.mjs';
import { parseIssues as parseGitlab, planeAnfragen as planeGl } from '../lib/sources/gitlab.mjs';
import { ausgeschlossen } from '../lib/normalize.mjs';
import { bewerte, sortiere, verteile } from '../lib/score.mjs';
import { nurNeue, gesehenAus } from '../lib/store.mjs';
import { ladeSpeicher, speichereSpeicher, vergesseAlteFunde } from '../lib/verlauf-speicher.mjs';
import { uebernimm, auswerten } from '../lib/verlauf.mjs';
import { verlaufText } from '../lib/report/verlauf.mjs';
import { QUELLEN } from '../lib/sources/index.mjs';
import { toConsole } from '../lib/report/summary.mjs';
import { toHtml } from '../lib/report/html.mjs';
import { toMarkdown } from '../lib/report/markdown.mjs';
import { schreibeDossier, dossierText } from '../lib/dossier.mjs';

const HILFE = `ungeloest – findet offene Fehler und Fragen, auf die noch niemand geantwortet hat

Befehle:
  scan                 GitHub-Issues, GitHub Discussions, GitLab-Issues, Stack Overflow und Discourse-Foren absuchen (Standard)
  show <id>            einen Treffer aus dem letzten Scan anzeigen
  dossier <id>         Steckbrief dossiers/<id>.md schreiben (Problem, Links, Checkliste; --force überschreibt)
  list                 alle Treffer des letzten Scans auflisten
  verlauf [--json]     Veränderungen seit dem vorletzten Scan aus dem Speicher (neu, wird wichtiger, gelöst); schreibt nichts

Optionen für scan:
  --quellen gh,so,dc,gd,gl  nur diese Quellen (Standard: alle; gd = GitHub Discussions, gl = GitLab; --quelle ist dasselbe)
  --top <n>            so viele Treffer zeigen (Standard: aus Config, 20)
  --alle               auch schon gezeigte Treffer anzeigen
  --html <pfad>        HTML-Bericht schreiben (Dracula, ohne Script)
  --md <pfad>          Markdown-Liste schreiben
  --json <pfad>        alle bewerteten Treffer als JSON schreiben (bei verlauf: Schalter ohne Pfad, JSON auf stdout)
  --dry-run            keine Netzanfragen, Fixtures aus test/fixtures nutzen, zeigt die geplanten Abfragen; schreibt keinen Zustand
  --config <pfad>      andere Config-Datei
  --force              bei dossier: vorhandene Datei überschreiben
  -h, --help           diese Hilfe

Zustand liegt in data/ (letzter Scan, Gesehen-Speicher); UNGELOEST_DATEN überschreibt den Ordner.

Ablauf: scan → Liste lesen → dossier <id> → in Ruhe reproduzieren und lösen → selbst posten.
`;

function parseArgs(argv) {
  const o = { befehl: 'scan', quellen: null, top: null, alle: false, html: null, md: null, json: null, dryRun: false, config: null, id: null, force: false, jsonFlag: false };
  const rest = [];
  let hilfe = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`Option ${a} braucht einen Wert`); return argv[++i]; };
    if (a === '-h' || a === '--help') hilfe = true;
    else if (a === '--quellen' || a === '--quelle') o.quellen = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--top') o.top = Number(next());
    else if (a === '--alle') o.alle = true;
    else if (a === '--html') o.html = next();
    else if (a === '--md') o.md = next();
    else if (a === '--json') {
      // Bei `verlauf` ist --json ein Schalter ohne Pfad.
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-') || (argv[i + 1] === 'verlauf' && !rest.length)) o.jsonFlag = true;
      else o.json = next();
    }
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--force') o.force = true;
    else if (a === '--config') o.config = next();
    else if (a.startsWith('-')) throw new Error(`Unbekannte Option ${a}`);
    else rest.push(a);
  }
  if (hilfe) return { ...o, befehl: 'help' };
  if (rest.length) {
    if (!['scan', 'show', 'dossier', 'list', 'verlauf'].includes(rest[0])) throw new Error(`Unbekannter Befehl ${rest[0]}`);
    if (rest.length > 2) throw new Error(`Zu viele Argumente: ${rest.slice(2).join(' ')}`);
    o.befehl = rest[0];
    o.id = rest[1] || null;
  }
  if (o.quellen && !o.quellen.length) throw new Error(`--quellen braucht mindestens eine Quelle (${Object.keys(QUELLEN).join(', ')})`);
  const kuerzel = Object.keys(QUELLEN); // eine Liste für alle Quellen: neue Kürzel müssen hier nie nachgetragen werden
  const fremd = (o.quellen || []).filter((q) => !kuerzel.includes(q));
  if (fremd.length) throw new Error(`Unbekannte Quelle ${fremd.join(', ')} (erlaubt: ${kuerzel.join(', ')})`);
  if (o.jsonFlag && o.befehl !== 'verlauf') throw new Error('Option --json braucht einen Wert');
  if (['scan', 'list', 'verlauf'].includes(o.befehl) && o.id) throw new Error(`${o.befehl} nimmt kein weiteres Argument (${o.id})`);
  if (o.top != null && !(Number.isInteger(o.top) && o.top > 0)) throw new Error('--top braucht eine ganze Zahl > 0');
  return o;
}

const DATEN = process.env.UNGELOEST_DATEN ? path.resolve(process.env.UNGELOEST_DATEN) : path.join(WURZEL, 'data');
const LETZTER = path.join(DATEN, 'letzter-scan.json');
const GESEHEN = path.join(DATEN, 'gesehen.json');
const DOSSIERS = path.join(WURZEL, 'dossiers');

// Was ein echter Scan abfragen würde (nur Adressen und Suchtexte, nie Token).
export function geplanteAbfragen(cfg, quellen, jetzt = Date.now()) {
  const z = [];
  const dran = (k) => !quellen || quellen.includes(k);
  if (dran('gh')) z.push(`github: Suche je Sprache (${(cfg.sprachen || []).join(', ') || '–'}) über die REST-Suche`);
  if (dran('so')) z.push(`stackoverflow: Fragen ohne Antwort je Tag (${(cfg.stackoverflow?.tags || []).join(', ') || '–'})`);
  if (dran('dc')) z.push(`discourse: ${(cfg.discourse?.foren || []).map((f) => f.host).join(', ') || 'keine Foren eingestellt'}`);
  if (dran('gd')) {
    const q = planeGd(cfg, jetzt);
    z.push(q.length ? `github-discussions: POST ${GRAPHQL}, ${q.length} Suche(n), je bis zu ${cfg.githubDiscussions?.maxSeiten ?? 3} Seite(n):` : 'github-discussions: nichts eingestellt (githubDiscussions.repos oder .suche) – keine Abfrage');
    z.push(...q.map((s) => `    ${s}`));
  }
  if (dran('gl')) {
    const q = planeGl(cfg, jetzt);
    z.push(q.length ? `gitlab: ${q.length} Abfrage(n) bei gitlab.com, je bis zu ${cfg.gitlab?.maxSeiten ?? 3} Seite(n):` : 'gitlab: nichts eingestellt (gitlab.projekte oder .suche) – keine Abfrage');
    z.push(...q.map((s) => `    ${s}`));
  }
  return z;
}

async function fixturesSammeln(cfg, quellen) {
  const lies = async (n) => JSON.parse(await readFile(path.join(WURZEL, 'test/fixtures', n), 'utf8'));
  const repo = parseRepo(await lies('github-repo.json'));
  const gh = parseIssues(await lies('github-search.json'), { sprache: 'javascript' }).map((t) => ({ ...t, wirkungRoh: repo }));
  const so = parseFragen(await lies('stackoverflow-no-answers.json'));
  const dc = parseThemen(await lies('discourse-search.json'), cfg.discourse.foren[0] || { host: 'discuss.python.org', sprache: 'python', gewicht: 60 });
  // Alterfenster weit offen: die Fixtures tragen feste Daten.
  const offen = { ...cfg, alterTage: { min: 0, max: 1e6 }, githubDiscussions: {}, gitlab: {} };
  const gd = parseDiskussionen(await lies('github-discussions.json'), { cfg: offen }).treffer;
  const gl = parseGitlab(await lies('gitlab-issues.json'), { cfg: offen }).treffer;
  const alle = { gh, so, dc, gd, gl };
  const treffer = Object.entries(alle).filter(([k]) => !quellen || quellen.includes(k)).flatMap(([, v]) => v);
  return { treffer, fehler: [], ausgefallen: [] };
}

async function scan(o, cfg) {
  const log = (s) => process.stderr.write(`  · ${s}\n`);
  if (o.dryRun) for (const z of geplanteAbfragen(cfg, o.quellen)) log(`dry-run: ${z}`);
  const { treffer, fehler, ausgefallen } = o.dryRun ? await fixturesSammeln(cfg, o.quellen) : await sammle(cfg, { quellen: o.quellen || undefined, log });
  const bewertet = sortiere(treffer.filter((t) => !ausgeschlossen(t, cfg.ausschluss)).map((t) => bewerte(t, cfg)));
  const speicher = await ladeSpeicher(GESEHEN);
  const gesehen = gesehenAus(speicher);
  const neu = verteile(o.alle ? bewertet : nurNeue(bewertet, gesehen), cfg.maxProOrt ?? 3);
  const top = neu.slice(0, o.top || cfg.top || 20);
  if (ausgefallen.length) fehler.unshift(`Quelle(n) komplett ausgefallen: ${ausgefallen.join(', ')} – letzter Scan bleibt erhalten`);
  const meta = { when: new Date().toISOString().slice(0, 16).replace('T', ' '), gesamt: bewertet.length, neu: neu.length, fehler };

  // Verlauf: Scan in den Speicher übernehmen (im Speicher, geschrieben wird erst unten) und mit dem vorigen vergleichen.
  // Nur Quellen, die vollständig geantwortet haben, können Funde „verlieren“.
  const alleNamen = o.dryRun || !o.quellen ? Object.values(QUELLEN).map((q) => q.name) : o.quellen.map((k) => QUELLEN[k].name);
  const quellenOk = alleNamen.filter((n) => !ausgefallen.includes(n) && !fehler.some((f) => f.startsWith(n)));
  const jetzt = new Date();
  const topIds = verteile(bewertet, cfg.maxProOrt ?? 3).slice(0, 10).map((t) => t.id);
  let neuerSpeicher = uebernimm(speicher, bewertet, { quellen: quellenOk, topIds, jetzt, cfg });
  const verlauf = auswerten(neuerSpeicher, { cfg });

  // Erst zeigen, dann merken: was nie ausgegeben wurde, gilt nicht als gesehen.
  if (o.html) await writeFile(o.html, toHtml(top, meta, verlauf));
  if (o.md) await writeFile(o.md, toMarkdown(top, meta));
  if (o.json) await writeFile(o.json, JSON.stringify({ meta, treffer: bewertet }, null, 1));
  console.log(toConsole(top, meta));
  console.log('\n' + verlaufText(verlauf));
  if (o.html) console.log(`HTML: ${path.resolve(o.html)}`);

  // Ein Trockenlauf schreibt keinen Zustand; bei einer komplett ausgefallenen Quelle bleibt der letzte Scan stehen.
  if (!o.dryRun && !ausgefallen.length) {
    await mkdir(DATEN, { recursive: true });
    await writeFile(LETZTER, JSON.stringify({ meta, treffer: bewertet }, null, 1));
    // gezeigt = was ausgegeben wurde; wieder aufgetauchte, schon gezeigte Funde bekommen einen frischen Zeitstempel.
    const iso = jetzt.toISOString();
    const gezeigt = new Set(top.map((t) => t.id));
    const funde = { ...neuerSpeicher.funde };
    for (const t of bewertet) if (funde[t.id] && (gezeigt.has(t.id) || funde[t.id].gezeigt)) funde[t.id] = { ...funde[t.id], gezeigt: iso };
    neuerSpeicher = vergesseAlteFunde({ ...neuerSpeicher, funde }, 120, jetzt.getTime());
    await speichereSpeicher(GESEHEN, neuerSpeicher);
  }
  return fehler.length ? 2 : 0;
}

async function letzter() {
  try {
    return JSON.parse(await readFile(LETZTER, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('Noch kein Scan vorhanden – zuerst `ungeloest scan`.');
    throw e;
  }
}

export function finde(daten, id) {
  if (!id) throw new Error('Bitte eine ID angeben, z. B. gh:owner/repo#12 oder so:80013743');
  const genau = daten.treffer.find((x) => x.id === id);
  if (genau) return genau;
  // Kurzform nur an einer Trennstelle: "12" oder "#12" trifft gh:a/b#12, aber nicht gh:a/b#112
  const kurz = daten.treffer.filter((x) => x.id.endsWith(id) && (/^[#:/]/.test(id) || /[#:/]/.test(x.id.charAt(x.id.length - id.length - 1))));
  if (kurz.length === 1) return kurz[0];
  if (kurz.length > 1) throw new Error(`ID ${id} ist mehrdeutig: ${kurz.map((x) => x.id).join(', ')}`);
  throw new Error(`ID ${id} nicht im letzten Scan. Mit \`list\` alle sehen.`);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.befehl === 'help') { process.stdout.write(HILFE); return 0; }
  const cfg = await ladeConfig(o.config || undefined);
  if (o.befehl === 'scan') return scan(o, cfg);
  if (o.befehl === 'verlauf') {
    const a = auswerten(await ladeSpeicher(GESEHEN), { cfg });
    console.log(o.jsonFlag ? JSON.stringify(a, null, 1) : verlaufText(a));
    return 0;
  }
  const daten = await letzter();
  if (o.befehl === 'list') {
    console.log(toConsole(daten.treffer, { ...daten.meta, neu: daten.treffer.length }));
    return 0;
  }
  const t = finde(daten, o.id);
  if (o.befehl === 'show') { process.stdout.write(dossierText(t)); return 0; }
  const pfad = await schreibeDossier(t, DOSSIERS, { force: o.force });
  console.log(`Dossier geschrieben: ${pfad}`);
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error(`ungeloest: ${e.message}`);
    process.exit(1);
  });
}

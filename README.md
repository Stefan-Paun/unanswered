# ungeloest

**Findet offene Fehler und Fragen, auf die noch niemand geantwortet hat – und sortiert sie danach, ob du sie lösen kannst und ob es jemandem hilft.**

Jeden Tag bleiben tausende Bug-Reports und Fragen unbeantwortet: GitHub-Issues ohne einen einzigen Kommentar, Stack-Overflow-Fragen ohne Antwort, Forenthemen, die ins Leere laufen. `ungeloest` sammelt sie ein, bewertet sie und schreibt dir pro Problem einen Steckbrief. Lösen und posten tust du selbst.

> Das Werkzeug sendet nichts. Keine automatischen Antworten, keine Massen-PRs. Stack Overflow verbietet KI-generierte Antworten – der Steckbrief erinnert dich daran.

## Schnellstart

```sh
git clone https://github.com/Stefan-Paun/unanswered && cd ungeloest
node bin/ungeloest.mjs scan --html bericht.html     # echter Scan (braucht Node 20+)
node bin/ungeloest.mjs dossier so:80005138           # Steckbrief zu einem Treffer
node bin/ungeloest.mjs digest                        # die drei besten Chancen aus dem letzten Scan, ohne Netz
node bin/ungeloest.mjs scan --dry-run --alle         # ohne Netz, mit Beispieldaten; zeigt auch, was abgefragt würde
```

Keine Abhängigkeiten. GitHub-Token kommt automatisch aus `gh auth token` oder `GITHUB_TOKEN` (ohne Token geht es langsamer). Optional `GITLAB_TOKEN` für GitLab. Optional `STACKAPPS_KEY` für 10 000 statt 300 Stack-Overflow-Anfragen pro Tag.

## Quellen

| Quelle | Was gesucht wird | Zugang |
|---|---|---|
| GitHub | offene Issues, 0 Kommentare, niemand zugewiesen, Label `bug`, Sprache aus Config, Repo ≥ 20 Sterne | REST-Suche, 30 Anfragen/min werden eingehalten |
| Stack Overflow | Fragen ohne Antwort je Tag | Stack Exchange API, Quota wird aus jeder Antwort gelesen |
| Discourse-Foren | Themen ohne Antwort (`status:noreplies`) | `search.json` jedes Forums aus der Config |
| GitHub Discussions (`gd`) | Diskussionen in beantwortbaren Kategorien (Q&A) ohne gewählte Antwort, offen, nicht gesperrt; Filter: Repo-Liste, Suchbegriff, Alter, Mindest-Reaktionen | GraphQL (`api.github.com/graphql`), braucht einen Token (derselbe wie bei GitHub; ohne Token klare Meldung), Cursor-Seiten bis `maxSeiten` |
| GitLab (`gl`) | offene Issues auf gitlab.com ohne Kommentare von anderen (`user_notes_count` 0), nicht zugewiesen, nicht vertraulich; Filter: Projekt-Liste, Suchbegriff, Labels | REST `gitlab.com/api/v4`, Adresse fest (kein Token an fremde Hosts, keine selbst gehosteten Instanzen); Token optional über `GITLAB_TOKEN`, ohne nur öffentliche Daten; Seiten über `x-next-page` |

Beide neuen Quellen fragen **nichts ab**, solange in der Config weder Repos/Projekte noch ein Suchbegriff stehen:

```json
{ "githubDiscussions": { "repos": ["owner/repo"], "suche": "", "minReaktionen": 0, "minSterne": 0, "maxSeiten": 3, "proSeite": 50 },
  "gitlab": { "projekte": ["gruppe/projekt"], "suche": "", "labels": ["bug"], "minSterne": 0, "maxSeiten": 3, "proSeite": 50 } }
```

Beide beachten die Ratenlimit-Kopfzeilen: kurze Sperren (bis 60 s) werden abgewartet, längere beenden die Quelle sauber und liefern die bis dahin geladene Teilmenge samt Hinweis. Je Anfrage gilt ein Zeitlimit (20 s); wiederholt wird nur bei 5xx, Netzfehler und Zeitlimit. Kaputte oder unerwartete Antworten werden als Warnung gemeldet und übersprungen. Suche über alle GitLab-Projekte (ohne `projekte`) geht nur mit Token. Mehrere GitLab-Labels sind ODER-verknüpft (eine Abfrage je Label). Fremdtexte werden gekürzt (Titel 300, Text 8000 Zeichen), im HTML-Bericht maskiert und nur mit `https:` verlinkt.

Ersatzgrößen in der Bewertung: GitHub-Diskussionen nutzen Sterne und Forks des Repos aus derselben Antwort; Reaktionen und Stimmen (`upvoteCount`) zählen wie bei GitHub-Issues (höchstens +20). GitLab-Issues tragen keine Sterne; sie werden einmal je Projekt in `projekte` nachgeladen. Fehlen Sterne, gilt eine Basiswirkung von 30; fehlende Stimmen zählen 0.

Reddit ist bewusst nicht dabei: Das Subreddit-RSS trägt keine Kommentarzahl, und das RSS je Beitrag antwortet ohne Login sofort mit 429. Dafür bräuchte es eine OAuth-App.

## Bewertung

Zwei Zahlen 0–100, Gesamt = √(Lösbarkeit × Wirkung).

- **Lösbarkeit:** Codeblock oder Stacktrace dabei, Fehlertext im Titel (`TypeError`, `Traceback` …), Sprache in deinem Fokus, Alter 2–60 Tage (frischer antwortet noch jemand, älter ist der Fragesteller weg), Labels wie `good first issue` (+) oder `wontfix` (−), sehr kurze Texte (−).
- **Wirkung:** GitHub-Sterne (logarithmisch, 100 000 → 100) plus Reaktionen, Stack-Overflow-Aufrufe und Punkte, Forum-Gewicht aus der Config. Forks und archivierte Repos zählen 0.

Pro Repo oder Forum stehen höchstens drei Treffer vorne (`maxProOrt`), damit ein großes Projekt nicht die ganze Liste füllt. Was schon einmal gezeigt wurde, landet in `data/gesehen.json` und erscheint beim nächsten Scan nicht mehr (`--alle` zeigt alles, Einträge älter als 120 Tage werden vergessen).

## Verlauf über Scans

Das Radar erinnert sich: `data/gesehen.json` (Speicher v2) hält je Fund bis zu 30 Messpunkte (Zeit, Kommentare, Stimmen/Reaktionen, Zustand, Bewertung; ältere werden ausgedünnt) und die Liste der Scans. Das alte Format (`{id: Zeitstempel}`) wird beim Laden verlustfrei angehoben, geschrieben wird atomar (temporäre Datei, dann umbenennen).

| Kategorie | Bedeutung |
|---|---|
| neu | zum ersten Mal gesehen |
| inzwischen gelöst | war offen, die Quelle meldet jetzt Antworten/Kommentare oder „geschlossen“ – nur das zählt als gelöst |
| nicht mehr gefunden | taucht im Scan nicht mehr auf; **unsicher** (Filter, Ratenlimit), zählt nicht als gelöst |
| wird wichtiger | Zuwachs an Stimmen + Kommentaren ≥ 1 je Tag, Messpunkte mindestens 12 Stunden auseinander |
| liegt lange | seit 5 Scans unverändert offen und Bewertung ≥ 60 |

Dazu eine Trefferliste: wie viele Funde, die einmal in den Top 10 waren, andere gelöst haben und nach wie vielen Tagen im Mittel. Im HTML-Bericht stehen die Abschnitte über der Tabelle, je Fund mit Verlaufslinie (statisches SVG) und Abzeichen; beim allerersten Scan steht stattdessen ein Hinweis. Ein Scan mit `--quellen` oder mit ausgefallener Quelle wertet Funde der nicht (vollständig) gescannten Quellen nie als verschwunden. Schwellen lassen sich in der Config unter `verlauf` ändern (`steigtProTag`, `minAbstandTage`, `langeScans`, `langeBewertung`, `maxPunkte`).

Grenze: Die Suchen liefern nur noch Offenes. „Sicher gelöst“ entsteht daher nur, wenn ein Fund mit Antworten, Kommentaren oder Zustand `geschlossen` wieder auftaucht; ein aktives Nachfragen je Fund gibt es nicht.

## Morgen-Digest

`ungeloest digest` zeigt statt der ganzen Liste die **drei lohnendsten Funde** des letzten gespeicherten Scans, je mit einem Satz „warum diese“ und einer Aufwandsklasse. Der Befehl fragt das Netz nicht ab; nur `--frisch` macht vorher einen Scan. Ist der letzte Scan älter als ein Tag, steht das als „Achtung“ in jeder Ausgabe.

```sh
node bin/ungeloest.mjs digest                                   # Text im Terminal (Farbe nur am Terminal und ohne NO_COLOR)
node bin/ungeloest.mjs digest --md digest.md --html digest.html # zusätzlich Markdown und eine HTML-Karte (hell/dunkel, ohne Script)
node bin/ungeloest.mjs digest --json                            # JSON auf stdout; --json pfad schreibt in eine Datei
node bin/ungeloest.mjs digest --frisch                          # erst scannen, dann Digest (Scan-Meldungen auf stderr)
```

**Auswahl.** Rang = Gesamtwert plus Bonus aus der Interessenliste; bei Gleichstand entscheiden Gesamtwert, Wirkung und zuletzt die ID, sodass derselbe Stand immer dieselbe Auswahl ergibt. Dazu zwei Regeln:

- *Streuung:* höchstens ein Fund je Repo oder Forum; Stack Overflow zählt als ein Ort. Gibt es weniger als drei Orte, zeigt der Digest weniger als drei Chancen.
- *Wiederholungssperre:* Was in den letzten 5 Digests stand, kommt nicht wieder, außer es hat sich deutlich bewegt (Bewertung +10 oder Stimmen + Kommentare +3); dann steht „wieder dabei“ daneben. Ein zweiter Aufruf zum selben Scan zeigt dasselbe wie der erste.

Unter „Außerdem neu“ stehen bis zu fünf weitere Titel, die im letzten Scan zum ersten Mal auftauchten und noch in keinem Digest standen.

**Warum diese.** Der Satz entsteht ohne KI aus Merkmalen des Fundes: Alter („12 Tage ohne Antwort“), Stimmen, erkannte Fehlermeldung, Code oder Stacktrace, Reichweite (ab 1 000 Sternen, ab 500 Aufrufen bei Stack Overflow, Forum mit Gewicht ≥ 50), Einstiegs-Label, Treffer in der Interessenliste oder Sprache im Fokus. Text aus der Frage selbst kommt darin nie vor.

**Aufwand** (grobe Faustregel, Start bei 1 Punkt):

| Merkmal | Punkte |
|---|---:|
| Frage unter 600 Zeichen / unter 2 500 / länger | +0 / +1 / +2 |
| Code oder Stacktrace enthalten | −1 |
| Reproduktion beschrieben (Schritte, erwartet/tatsächlich, Minimalbeispiel) | −1 |
| weder Code noch Fehlermeldung | +1 |

Summe ≤ 0 → **kurz**, 1–2 → **mittel**, ab 3 → **lang**.

**Interessenliste und Schwellen** in der Config unter `digest`:

```json
"digest": {
  "anzahl": 3,
  "sperreDigests": 5,
  "interessen": { "schlagwoerter": ["asyncio", "vite"], "sprachen": ["python"] }
}
```

Eine passende Sprache gibt +10, jedes Schlagwort in Titel, Tags, Labels oder Ort +5, zusammen höchstens +20. Weitere Schalter: `bewegtBewertung`, `bewegtAktivitaet`, `ausserdemNeu`, `maxMerkliste`, `veraltetStunden`.

Die Merkliste der gezeigten Funde liegt in `data/digest.json` (höchstens 30 Digests); `--dry-run` schreibt sie nicht fort. Fremde Titel sind in jedem Format maskiert, verlinkt wird nur `https:`. Der Digest sendet nichts und benachrichtigt niemanden.

## Befehle

```
scan [--quellen gh,so,dc,gd,gl] [--top n] [--alle] [--html p] [--md p] [--json p] [--dry-run]
verlauf [--json]  Veränderungen aus dem Speicher (kein Scan, schreibt nichts)
digest [--frisch] [--md p] [--html p] [--json [p]] [--dry-run]   die drei besten Chancen des letzten Scans
list              alle Treffer des letzten Scans
show <id>         Steckbrief in der Konsole
dossier <id>      Steckbrief nach dossiers/<id>.md schreiben
```

IDs sehen so aus: `gh:owner/repo#123`, `gd:owner/repo#45` (Discussion), `gl:gruppe/projekt#7`, `so:80005138`, `dc:discuss.python.org/109464`. `show`/`dossier` verstehen auch Kurzformen hinter einem Trenner (`#123`, `80005138`) und melden Mehrdeutigkeit. Ein vorhandenes Dossier wird nur mit `--force` überschrieben. Fällt eine Quelle komplett aus, bleibt der letzte Scan erhalten und der Exit-Code ist 2. `UNGELOEST_DATEN` verlegt den Zustandsordner.

## Config

`ungeloest.config.json`: Sprachen, Alter, GitHub-Labels und Mindest-Sterne, Stack-Overflow-Tags, Foren mit Gewicht, `githubDiscussions` und `gitlab` (siehe Quellen), Ausschluss-Muster für Titel (Ankündigungen, PEPs, Review-Requests) und Repos, `digest` (siehe Morgen-Digest).

## Ablauf, der funktioniert

1. `scan --html bericht.html` am Morgen, Liste überfliegen.
2. `dossier <id>` für ein, zwei Treffer.
3. In einer eigenen Sitzung reproduzieren, Ursache finden, Fix testen.
4. Antwort oder PR **selbst** schreiben und posten, Checkliste im Dossier abhaken.

## Jeden Morgen automatisch

`examples/launchd/` enthält eine Vorlage für macOS: eine Beispiel-plist mit Platzhaltern statt echter Pfade, die um 7:00 `digest --frisch` startet und Text, Markdown und HTML in einen Ordner schreibt, dazu eine kurze Anleitung zum Ein- und Ausschalten. `ungeloest` lädt und kopiert die Datei nie selbst.

Älter und auf die ganze Liste statt den Digest ausgelegt: `tools/at.stefanpaun.ungeloest.plist` ist ein launchd-Job, der um 07:10 `tools/morgen.sh` startet (HTML + Markdown nach `data/`, Benachrichtigung, wenn `terminal-notifier` installiert ist). Einschalten musst du selbst, die Schritte stehen in der Datei. `tools/routine-nachtschicht.md` skizziert die Cloud-Variante für später.

## Entwickeln

```sh
node --test test/*.test.mjs      # 137 Tests, laufen ohne Netz (Fixtures in test/fixtures)
```

Module: `lib/sources/{github,stackoverflow,discourse,github-discussions,gitlab}.mjs` (je eine reine `parse*`-Funktion plus `suche*` mit injizierbarem `fetch`), `lib/abruf.mjs` (gemeinsamer Abruf mit Zeitlimit, Wiederholung, Ratenlimit, Token-Schwärzung), `lib/normalize.mjs`, `lib/score.mjs`, `lib/store.mjs`, `lib/verlauf-speicher.mjs` (Speicher v2), `lib/verlauf.mjs` (Auswertung), `lib/report/{summary,html,markdown,verlauf,digest}.mjs`, `lib/dossier.mjs`, `lib/digest.mjs` (Auswahl, Begründung, Aufwand, Merkliste; rein).

MIT

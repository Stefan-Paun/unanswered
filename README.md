# ungeloest

**Findet offene Fehler und Fragen, auf die noch niemand geantwortet hat – und sortiert sie danach, ob du sie lösen kannst und ob es jemandem hilft.**

Jeden Tag bleiben tausende Bug-Reports und Fragen unbeantwortet: GitHub-Issues ohne einen einzigen Kommentar, Stack-Overflow-Fragen ohne Antwort, Forenthemen, die ins Leere laufen. `ungeloest` sammelt sie ein, bewertet sie und schreibt dir pro Problem einen Steckbrief. Lösen und posten tust du selbst.

> Das Werkzeug sendet nichts. Keine automatischen Antworten, keine Massen-PRs. Stack Overflow verbietet KI-generierte Antworten – der Steckbrief erinnert dich daran.

## Schnellstart

```sh
git clone https://github.com/Stefan-Paun/ungeloest && cd ungeloest
node bin/ungeloest.mjs scan --html bericht.html     # echter Scan (braucht Node 20+)
node bin/ungeloest.mjs dossier so:80005138           # Steckbrief zu einem Treffer
node bin/ungeloest.mjs scan --dry-run --alle         # ohne Netz, mit Beispieldaten
```

Keine Abhängigkeiten. GitHub-Token kommt automatisch aus `gh auth token` oder `GITHUB_TOKEN` (ohne Token geht es langsamer). Optional `STACKAPPS_KEY` für 10 000 statt 300 Stack-Overflow-Anfragen pro Tag.

## Quellen

| Quelle | Was gesucht wird | Zugang |
|---|---|---|
| GitHub | offene Issues, 0 Kommentare, niemand zugewiesen, Label `bug`, Sprache aus Config, Repo ≥ 20 Sterne | REST-Suche, 30 Anfragen/min werden eingehalten |
| Stack Overflow | Fragen ohne Antwort je Tag | Stack Exchange API, Quota wird aus jeder Antwort gelesen |
| Discourse-Foren | Themen ohne Antwort (`status:noreplies`) | `search.json` jedes Forums aus der Config |

## Bewertung

Zwei Zahlen 0–100, Gesamt = √(Lösbarkeit × Wirkung).

- **Lösbarkeit:** Codeblock oder Stacktrace dabei, Fehlertext im Titel (`TypeError`, `Traceback` …), Sprache in deinem Fokus, Alter 2–60 Tage (frischer antwortet noch jemand, älter ist der Fragesteller weg), Labels wie `good first issue` (+) oder `wontfix` (−), sehr kurze Texte (−).
- **Wirkung:** GitHub-Sterne (logarithmisch, 100 000 → 100) plus Reaktionen, Stack-Overflow-Aufrufe und Punkte, Forum-Gewicht aus der Config. Forks und archivierte Repos zählen 0.

Pro Repo oder Forum stehen höchstens drei Treffer vorne (`maxProOrt`), damit ein großes Projekt nicht die ganze Liste füllt. Was schon einmal gezeigt wurde, landet in `data/gesehen.json` und erscheint beim nächsten Scan nicht mehr (`--alle` zeigt alles, Einträge älter als 120 Tage werden vergessen).

## Befehle

```
scan [--quellen gh,so,dc] [--top n] [--alle] [--html p] [--md p] [--json p] [--dry-run]
list              alle Treffer des letzten Scans
show <id>         Steckbrief in der Konsole
dossier <id>      Steckbrief nach dossiers/<id>.md schreiben
```

IDs sehen so aus: `gh:owner/repo#123`, `so:80005138`, `dc:discuss.python.org/109464`. `show`/`dossier` verstehen auch Kurzformen hinter einem Trenner (`#123`, `80005138`) und melden Mehrdeutigkeit. Ein vorhandenes Dossier wird nur mit `--force` überschrieben. Fällt eine Quelle komplett aus, bleibt der letzte Scan erhalten und der Exit-Code ist 2. `UNGELOEST_DATEN` verlegt den Zustandsordner.

## Config

`ungeloest.config.json`: Sprachen, Alter, GitHub-Labels und Mindest-Sterne, Stack-Overflow-Tags, Foren mit Gewicht, Ausschluss-Muster für Titel (Ankündigungen, PEPs, Review-Requests) und Repos.

## Ablauf, der funktioniert

1. `scan --html bericht.html` am Morgen, Liste überfliegen.
2. `dossier <id>` für ein, zwei Treffer.
3. In einer eigenen Sitzung reproduzieren, Ursache finden, Fix testen.
4. Antwort oder PR **selbst** schreiben und posten, Checkliste im Dossier abhaken.

## Entwickeln

```sh
node --test test/*.test.mjs      # 35 Tests, laufen ohne Netz (Fixtures in test/fixtures)
```

Module: `lib/sources/{github,stackoverflow,discourse}.mjs` (je eine reine `parse*`-Funktion plus `suche*` mit injizierbarem `fetch`), `lib/normalize.mjs`, `lib/score.mjs`, `lib/store.mjs`, `lib/report/{summary,html,markdown}.mjs`, `lib/dossier.mjs`.

MIT

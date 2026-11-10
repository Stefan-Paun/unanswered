# Plan: GitHub Discussions und GitLab-Issues als Quellen

## Ziel
Zwei weitere Quellen für das Radar: `github-discussions` (Kürzel `gd`; Q&A-Diskussionen ohne gewählte Antwort, GraphQL) und `gitlab` (Kürzel `gl`; offene Issues ohne Kommentare anderer, REST von gitlab.com). Nur lesen, nichts senden. Ohne Einstellungen fragen beide nichts ab.

## Etappen
1. **Abruf-Kern** (`lib/abruf.mjs`, `lib/http.mjs`): einsetzbare Abruf-Funktion mit Zeitlimit, Wiederholung nur bei vorübergehenden Fehlern (5xx, Netz, Zeitlimit), Ratenlimit-Kopfzeilen (warten bis zu einer Grenze, sonst sauber abbrechen), Token-Schwärzung in jeder Fehlermeldung. Tests: `test/abruf.test.mjs`.
2. **github-discussions** (`lib/sources/github-discussions.mjs`, Fixture `test/fixtures/github-discussions.json`): Suchanfrage planen, seitenweise laden, Antwort prüfen, Fund-Format. Bewertung in `lib/score.mjs`.
3. **gitlab** (`lib/sources/gitlab.mjs`, Fixture `test/fixtures/gitlab-issues.json`): Basisadresse fest gitlab.com, Projektliste, Suchbegriff, Labels, Seiten über `x-next-page`.
4. **Einbindung**: `QUELLEN` (`gd`, `gl`), Config-Standardwerte, CLI (`--quellen`, `--dry-run` zeigt Abfragen), Bericht (Kürzel, Farbe, nur `https:` verlinkt), Dossier-Checkliste.
5. **Doku**: README-Quellentabelle, Testzahl, Plan auf Endstand.

## Stand
Alle fünf Etappen erledigt; `npm test` grün (66 Tests). Nicht gegen die echten Schnittstellen geprüft (nur Fixtures): Form der GraphQL-Suche (`is:unanswered`, `created:`) und `x-next-page`/`user_notes_count` sind nach Dokumentation gebaut.

## Tests
Alles mit Fixtures und Attrappen für `fetch`/Schlafen, keine echten Anfragen. Pro Quelle: Normalfall, mehrere Seiten, Ratenlimit, Fehlerantwort, unerwartete Felder, fehlender Token, stabile Kennungen, Token nie in Ausgaben, Maskierung im Bericht.

## Bewusst nicht dabei
Posten/Kommentieren, selbst gehostetes GitLab (Basisadresse bleibt fest), neue Abhängigkeiten, Sortier-Qualifier der Discussions-Suche (nicht ohne echte Anfrage prüfbar).

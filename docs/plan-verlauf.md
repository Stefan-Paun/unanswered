# Plan: Verlauf über Scans

## Ziel
Das Radar erinnert sich an frühere Scans und zeigt Veränderung: **neu**, **inzwischen gelöst**,
**wird wichtiger**, **liegt lange**, dazu eine Trefferliste „wie schnell lösen andere die Top-Funde“.

## Etappen
1. **Speicher v2** (`lib/store.mjs`, `lib/verlauf-speicher.mjs`): Schema-Version, je Fund ein
   begrenzter Verlauf (≤ 30 Messpunkte, Ausdünnung), Liste der Scans, Anheben des alten Formats
   (`{id: iso}`), atomares Schreiben (temporäre Datei, dann umbenennen). Tests mit altem Fixture.
2. **Auswertung** (`lib/verlauf.mjs`, rein, ohne Uhr/Netz/DOM): `uebernimm` (Scan → Speicher),
   `auswerten` (neu, beantwortet/geschlossen, nicht mehr gefunden, wird wichtiger, liegt lange,
   Trefferliste). Teil-Scans werten fremde Quellen nie als „verschwunden“.
3. **Bericht** (`lib/report/verlauf.mjs`, `lib/report/html.mjs`): Abschnitte, Verlaufslinie als
   statisches SVG, Abzeichen, Kopfzeile mit Vergleichszeitpunkt, Hinweis beim ersten Scan.
4. **CLI** (`bin/ungeloest.mjs`): `scan` führt den Verlauf mit; `verlauf [--json]` liest nur den
   Speicher; `--dry-run` schreibt nichts.
5. **Doku** (README, dieser Plan).

## Tests
`test/verlauf-speicher.test.mjs`, `test/verlauf.test.mjs`, `test/verlauf-bericht.test.mjs`,
Ergänzungen in `test/cli.test.mjs`. Speicherordner immer im Temp, keine Netzanfragen.

## Bewusst nicht dabei
Benachrichtigungen, aktive Nachfrage bei den Quellen („ist das noch offen?“), neue Abhängigkeiten.
Die Suchen liefern nur noch Offenes; „sicher gelöst“ entsteht, wenn ein Fund mit Zustand
`beantwortet`/`geschlossen` oder mit Antworten/Kommentaren wieder auftaucht.

## Stand
Alle fünf Etappen sind umgesetzt. Offen/bewusst weggelassen: Markdown-Bericht ohne Verlauf-Abschnitte,
kein aktives Nachfragen bei den Quellen. Die Echtlauf-Pfade der Quellen sind nur über Fixtures und
einen netzlosen Scan (`--quellen dc` ohne Foren) getestet.

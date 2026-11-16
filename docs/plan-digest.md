# Plan: Morgen-Digest

## Ziel
`ungeloest digest` zeigt statt des ganzen Berichts die drei lohnendsten offenen Fragen des Tages,
je mit einem Satz „warum diese“ und einer Aufwandsklasse. Ohne Netz, ohne KI, ohne Abhängigkeiten.

## Etappen
1. **Auswahl** (`lib/digest.mjs`, rein, ohne Uhr/Netz/Dateien): Rang = Gesamtwert + Bonus aus der
   Interessenliste, Streuung (höchstens einer je Repo/Forum, Stack Overflow zählt als ein Ort),
   Wiederholungssperre über die letzten N Digests (außer bei deutlicher Bewegung), Begründung und
   Aufwandsklasse aus festen Faustregeln, Merkliste (begrenzt, versioniert).
2. **Ausgaben** (`lib/report/digest.mjs`): Terminal, Markdown, HTML-Karte (hell/dunkel, ohne externe
   Verweise), JSON. Fremdtext überall maskiert, Adressen nur `https:`.
3. **CLI** (`bin/ungeloest.mjs`): Befehl `digest` liest den letzten gespeicherten Scan, `--frisch`
   scannt vorher, veralteter Scan wird gekennzeichnet, Merkliste in `data/digest.json`.
4. **Vorlage** (`examples/launchd/`): Beispiel-plist mit Platzhaltern und Anleitung; nichts wird
   installiert. README-Abschnitt.

## Tests
Fixtures und Temp-Ordner, kein Netz: Auswahl und Streuung, gleiche Eingabe → gleiche Auswahl,
Wiederholungssperre, Interessenliste, Begründungstexte, Aufwandsklassen, jedes Ausgabeformat
(wohlgeformt, maskiert), kein Netzzugriff ohne `--frisch`, veralteter Scan, plist wohlgeformt.

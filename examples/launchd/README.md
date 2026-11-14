# Digest jeden Morgen (macOS, launchd)

`com.example.ungeloest.digest.plist` ist eine **Vorlage**. Sie startet um 7:00 `ungeloest digest --frisch`
und schreibt den Digest als Text, Markdown und HTML in einen Ordner deiner Wahl. `ungeloest` selbst
installiert nichts: Die Datei liegt nur im Repo, kopieren und laden musst du sie selbst.

## Einrichten

1. Vorlage an einen Arbeitsort kopieren und dort die drei Platzhalter durch absolute Pfade ersetzen:

   | Platzhalter | Bedeutung | so findest du ihn |
   |---|---|---|
   | `PFAD_ZU_NODE` | das Node-Programm (Version 20 oder neuer) | `command -v node` |
   | `PFAD_ZU_UNGELOEST` | der Ordner dieses Repos | `pwd` im Repo |
   | `PFAD_ZU_AUSGABE` | ein vorhandener Ordner für `digest.txt`, `digest.md`, `digest.html`, `digest.log` | selbst anlegen |

   launchd ersetzt weder die Tilde noch Umgebungsvariablen, deshalb müssen es ausgeschriebene Pfade sein. Wer mag, ändert
   auch `Label` und den Dateinamen (beide gleich halten).

2. Prüfen, dass die Datei gültig ist und kein Platzhalter übrig blieb:

   ```sh
   plutil -lint com.example.ungeloest.digest.plist
   grep -n PFAD_ZU_ com.example.ungeloest.digest.plist    # darf nichts ausgeben
   ```

3. Einschalten:

   ```sh
   cp com.example.ungeloest.digest.plist ~/Library/LaunchAgents/
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.ungeloest.digest.plist
   ```

   Sofort einmal probelaufen lassen: `launchctl kickstart gui/$(id -u)/com.example.ungeloest.digest`

## Ausschalten

```sh
launchctl bootout gui/$(id -u)/com.example.ungeloest.digest
rm ~/Library/LaunchAgents/com.example.ungeloest.digest.plist
```

## Gut zu wissen

- War der Rechner um 7:00 im Ruhezustand, holt launchd den Lauf beim Aufwachen nach.
- `--frisch` macht vor dem Digest einen Scan (Netzanfragen an die eingestellten Quellen). Ohne `--frisch`
  liest der Digest nur den letzten gespeicherten Scan und sagt dazu, wenn der älter als ein Tag ist.
- launchd startet mit einer kargen Umgebung. Ein GitHub-Token findet `ungeloest` über `gh auth token`
  nur, wenn `gh` im `PATH` des Jobs liegt; ohne Token läuft der Scan trotzdem, nur langsamer.
  **Kein Token in die plist schreiben.**
- Exit-Code 2 heißt: Der Scan hatte Fehler, der Digest zeigt den letzten vollständig gespeicherten Stand.
  Einzelheiten stehen in `digest.log`.
- Der Job sendet nichts und benachrichtigt niemanden; er schreibt nur die vier Dateien und den Zustand in `data/`.

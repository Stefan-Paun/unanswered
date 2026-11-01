# Entwurf: Cloud-Routine „Ungelöst-Morgenliste“ (noch NICHT angelegt)

Idee: Eine Routine wie die anderen Nachtschichten läuft täglich um 06:30 (Europe/Vienna) auf dem Repo
Stefan-Paun/ungeloest (sobald es öffentlich ist), führt `node bin/ungeloest.mjs scan --md morgen.md` aus
und schickt die Top 10 als PushNotification. Sie postet nichts, öffnet keinen PR, ändert nichts im Repo.

Prompt-Entwurf:

> Du bist die Morgenliste für Stefan. Repo ist geklont. Führe `node bin/ungeloest.mjs scan --md morgen.md --top 10`
> aus (GitHub-Token aus der Umgebung, falls vorhanden; sonst läuft es langsamer). Lies morgen.md und schicke per
> PushNotification eine Kurzfassung: Anzahl gefunden, die drei besten Treffer mit Gesamtwert, Quelle und Link.
> Poste nichts, kommentiere nichts, erstelle keinen PR, pushe nichts. Wenn eine Quelle ausfällt, sag es in der Nachricht.

Warum noch nicht: Das Repo ist privat/lokal, Routinen brauchen ein öffentliches oder verbundenes Repo, und Stefan
hat Routinen bisher einzeln freigegeben. Bis dahin: launchd-Job in `tools/at.stefanpaun.ungeloest.plist` (lokal, ohne Cloud).

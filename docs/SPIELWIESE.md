# Was eine Testumgebung braucht

Bisher läuft der Prototyp auf einem privaten Raspberry Pi. Das war für den
Anfang richtig — es hat nichts gekostet und niemanden aufgehalten. Es ist aber
auch der Grund, warum sieben von sieben Punkten in [`STATUS.md`](STATUS.md)
offen sind: Ohne Zugang zu Testsystemen des Hauses lässt sich nicht prüfen, ob
das Portal an echten Schnittstellen funktioniert.

Dieses Dokument beschreibt, was eine Spielwiese enthalten müsste. Es ist zum
Weitergeben gedacht.

## Der Kern der Bitte

Eine abgeschottete Testumgebung mit **Testdaten**, nicht mit Echtdaten. Kein
Zugriff auf Produktivsysteme, keine echten Mitarbeiterkonten. Damit bleibt die
datenschutzrechtliche Bewertung einfach, und die aufsichtsrechtlichen Fragen
aus [`PROZESSE.md`](PROZESSE.md) stellen sich erst bei einer Einführung — nicht
schon beim Ausprobieren.

## Was gebraucht wird

**1. Ein Linux-Host.** Eine VM genügt: 2 vCPU, 4 GB RAM, 20 GB Platte, Docker
und Docker Compose. Ausgehend HTTPS zu `api.anthropic.com`. **Eingehend aus dem
Internet erreichbar muss sie nicht sein** — Zugriff nur aus dem internen Netz.

**2. Ein Entra-Testmandant** oder eine App-Registrierung in einem bestehenden
Testmandanten, plus **mindestens zwei Testbenutzer**. Zwei, weil das
Vier-Augen-Prinzip sonst nicht vorführbar ist: Wer eine Aktion anfordert, darf
sie nicht selbst freigeben. Das ist die Kontrolle, die eine Prüfung sehen will,
und sie läuft bisher nur im automatisierten Test. Anleitung:
[`ENTRA_SETUP.md`](ENTRA_SETUP.md).

**3. Eine Graph-App mit `AuditLog.Read.All`** (Anwendungsberechtigung, mit
Administrator-Zustimmung). Ausschliesslich lesend — damit prüft das Portal vor
einem Passwort-Fall, ob die Person die Selbstbedienung schon eingerichtet hat.
Für das Zurücksetzen selbst ist bewusst **kein** Graph-Recht vorgesehen.

**4. Zwei bis drei Wegwerf-Konten im Test-AD**, an denen Zurücksetzen und
Entsperren geübt werden. Keine echten Mitarbeiterkonten, kein Domänen-Admin für
das Portal — der Dienstaccount braucht genau diese beiden Rechte auf genau
dieser Test-OU.

**5. Ein Jira-Testprojekt und ein Confluence-Bereich.** Dazu ein technisches
Konto mit einem API-Token; ein Token für beide Produkte, aber die Rechte hängen
je Produkt: in Jira „Vorgänge erstellen" im Testprojekt, in Confluence
Leserechte auf den Bereich. Ein paar echte Anleitungen im Bereich wären
wertvoll — daran zeigt sich, ob die Antworten wirklich taugen.

**6. Ein Windows-Testclient.** Eine VM reicht. Das ist der einzige Weg, die
PowerShell-Varianten der Aktionen zu prüfen: Getestet ist bisher nur Linux,
weil der Prüfstand ein Raspberry Pi ist. Von den elf Aktionen sind damit die
Windows-Pfade sämtlich unerprobt.

**7. Optional: ein baramundi Test- oder Staging-Server** mit einem
bConnect-Konto. Ohne ihn bleibt offen, wie die Zustände einer JobInstance am
echten Server heissen.

**8. Ein Anthropic-API-Schlüssel des Hauses.** Bisher läuft alles auf einem
privaten Schlüssel. Ein Gespräch kostet rund 0,9 ct; die Testkosten sind
zweistellig im Monat, nicht dreistellig.

## Was ausdrücklich nicht gebraucht wird

- Kein Zugriff auf Produktivsysteme
- Kein Domänen-Administrator für das Portal oder den Geräte-Agenten
- Keine echten Personen- oder Abrechnungsdaten
- Keine Erreichbarkeit aus dem Internet
- Keine Hochverfügbarkeit, keine Backups, kein Monitoring

## Was danach beantwortet ist

Mit dieser Umgebung lassen sich die offenen Punkte aus [`STATUS.md`](STATUS.md)
schliessen: Die Anmeldung wird scharf, die Vier-Augen-Freigabe läuft im Portal
statt nur im Test, die Windows-Aktionen sind erprobt, und Confluence, Jira und
bConnect antworten mit echten Feldnamen statt mit denen der Attrappen.

Erst danach ist die Frage „taugt das für den 1st-Level-Support?" überhaupt
beantwortbar. Heute lässt sich nur sagen: Der Weg funktioniert, solange alle
Gegenstellen nachgebaut sind.

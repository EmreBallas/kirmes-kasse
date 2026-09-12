# Projektdokumente

Die Dateien in diesem Ordner sind die Arbeitsdokumente der WintiKirmes 2026 des Vereins KIBW
Winterthur: Roadmap, Entscheide und Recherchen aus der Entwicklung der Kasse. Sie
beschreiben, wie dieser eine Anlass gerechnet, eingerichtet und betrieben wurde. Sie sind
Beispiele und Begründungen, keine Vorschriften: Preise, Termine, Hardware, Händler und
Produktnamen sind auf diesen Verein zugeschnitten. Verbindlich für den Code ist allein
`../kasse/KONTRAKT.md`.

| Datei | Inhalt |
|---|---|
| [roadmap-v1.md](roadmap-v1.md) | Roadmap der ersten Etappe mit Funktionsumfang (Abschnitt 2), Abschlussformeln (Abschnitt 4) und den Fachregeln (Abschnitt 5). |
| [entscheidungen.md](entscheidungen.md) | Entscheidungsprotokoll: nummerierte Entscheide mit Datum und Quelle, inklusive der noch offenen Annahmen. |
| [drucker-setup.md](drucker-setup.md) | Einrichtung des Epson TM-T20II unter Windows: Warteschlange mit Treiber "Generic / Text Only", RAW-Druck über den Spooler, Codepage PC857, Kassenschublade am DK-Port. |
| [technik-tag1.md](technik-tag1.md) | Technische Entscheide zum Fundament: Electron 44 mit `node:sqlite`, Alternativen und die geprüften Versionsstände. |
| [einkaufsliste.md](einkaufsliste.md) | Beschaffung für den Anlass: Kassenschublade, Bonrollen und Zubehör mit Händlern, Preisen und Lieferzeiten von 2026. |
| [recherche-drucker.md](recherche-drucker.md) | Ausführliche Recherche zum Druckweg: warum RAW über den Windows-Spooler und warum keine Epson-Treiberpakete installiert werden. |
| [produkte-seed.json](produkte-seed.json) | Die Produktliste des Anlasses (Namen, Preise in Rappen, Gruppe `coupon` oder `kasse`) als Vorlage für den Erststart. |

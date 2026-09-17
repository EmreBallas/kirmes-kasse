-- Vereins-Kasse: Migration 005
-- Helfer zahlen ihr Essen (Auftraggeber, 17.9.2026): Ein Helfer-Beleg traegt den Helfernamen.
-- «Gleich zahlen» = echte Zahlart (bar_chf/bar_eur/twint) mit helfer_name; «spaeter zahlen» = zahlart helfer
-- mit vollem (ggf. rabattiertem) total_rappen als offene Schuld, kein Geld in der Lade.
-- Bestehende Belege behalten helfer_name NULL (alte Helfer-Belege haben total_rappen 0, also keine Schuld).
ALTER TABLE verkauf ADD COLUMN helfer_name TEXT;
CREATE INDEX IF NOT EXISTS idx_verkauf_helfer_name ON verkauf(helfer_name);

-- Stammdaten: gespeicherte Helfernamen zur Auswahl beim naechsten Mal, eindeutig ohne Gross-/Kleinschreibung.
CREATE TABLE IF NOT EXISTS helfer (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  erstellt_am TEXT NOT NULL
);

-- Zahlung eines Helfers auf seine offene Schuld (Teilzahlungen erlaubt). betrag: Rappen bei bar_chf/twint,
-- Cent bei bar_eur; betrag_chf_rappen: CHF-Gegenwert (EUR auf 5 Rappen abgerundet). bar_chf/bar_eur liegen in
-- der Lade (Schublade oeffnet, kein Bon) und erhoehen Soll CHF bzw. Soll EUR; twint ist kein Bargeld.
-- Nichts wird geloescht: Storno setzt storniert_am (mit_pin = 1, wenn der Storno eine PIN brauchte).
CREATE TABLE IF NOT EXISTS helfer_zahlung (
  id TEXT PRIMARY KEY,
  kassentag_id TEXT NOT NULL REFERENCES kassentag(id),
  helfer_name TEXT NOT NULL,
  zeit TEXT NOT NULL,
  typ TEXT NOT NULL CHECK(typ IN ('bar_chf','bar_eur','twint')),
  betrag INTEGER NOT NULL CHECK(betrag > 0),
  kurs_x10000 INTEGER,
  betrag_chf_rappen INTEGER NOT NULL,
  storniert_am TEXT,
  mit_pin INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_helfer_zahlung_kassentag ON helfer_zahlung(kassentag_id);
CREATE INDEX IF NOT EXISTS idx_helfer_zahlung_helfer_name ON helfer_zahlung(helfer_name);

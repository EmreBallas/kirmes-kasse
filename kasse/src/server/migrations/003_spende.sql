-- Kasse WintiKirmes 2026: Migration 003
-- Separat erfasste Spenden (nachträglich, ohne Bon): "Rückgeld als Spende" zu einem bereits
-- abgeschlossenen Bar-Beleg (verkauf_id gesetzt) oder freie Spende ohne Kauf (verkauf_id NULL).
-- betrag: Rappen bei bar_chf/twint, Cent bei bar_eur; betrag_chf_rappen: CHF-Gegenwert (EUR auf 5 Rappen abgerundet).
-- Nichts wird gelöscht: Storno setzt storniert_am (mit_pin = 1, wenn der Storno eine PIN brauchte).
CREATE TABLE IF NOT EXISTS spende (
  id TEXT PRIMARY KEY,
  kassentag_id TEXT NOT NULL REFERENCES kassentag(id),
  verkauf_id TEXT REFERENCES verkauf(id),
  zeit TEXT NOT NULL,
  typ TEXT NOT NULL CHECK(typ IN ('bar_chf','bar_eur','twint')),
  betrag INTEGER NOT NULL CHECK(betrag > 0),
  kurs_x10000 INTEGER,
  betrag_chf_rappen INTEGER NOT NULL,
  storniert_am TEXT,
  mit_pin INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_spende_kassentag ON spende(kassentag_id);
CREATE INDEX IF NOT EXISTS idx_spende_verkauf ON spende(verkauf_id);

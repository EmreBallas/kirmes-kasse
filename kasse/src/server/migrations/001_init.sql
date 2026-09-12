-- Kasse WintiKirmes 2026: Grundschema (Migration 001)
-- Alle Beträge als ganze Rappen (CHF) bzw. Cent (EUR). Zeitstempel ISO-8601 lokal. IDs als UUID-Text.

CREATE TABLE IF NOT EXISTS produkt (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) <= 24),
  preis_rappen INTEGER,
  gruppe TEXT NOT NULL CHECK(gruppe IN ('coupon','kasse')),
  aktiv INTEGER NOT NULL DEFAULT 1,
  ausverkauft INTEGER NOT NULL DEFAULT 0,
  reihenfolge INTEGER NOT NULL DEFAULT 0,
  erstellt_am TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kassentag (
  id TEXT PRIMARY KEY,
  datum TEXT NOT NULL,
  kasse_praefix TEXT NOT NULL,
  kassier TEXT NOT NULL,
  startgeld_chf_rappen INTEGER NOT NULL,
  startgeld_eur_cent INTEGER NOT NULL DEFAULT 0,
  geoeffnet_am TEXT NOT NULL,
  abgeschlossen_am TEXT,
  ist_chf_rappen INTEGER,
  ist_eur_cent INTEGER,
  differenz_chf_rappen INTEGER,
  differenz_eur_cent INTEGER,
  bemerkung TEXT
);

CREATE TABLE IF NOT EXISTS verkauf (
  id TEXT PRIMARY KEY,
  kassentag_id TEXT NOT NULL REFERENCES kassentag(id),
  belegnr TEXT NOT NULL UNIQUE,
  zeit TEXT NOT NULL,
  zahlart TEXT NOT NULL CHECK(zahlart IN ('bar_chf','bar_eur','twint','helfer')),
  total_rappen INTEGER NOT NULL,
  storniert_am TEXT,
  storno_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_verkauf_kassentag ON verkauf(kassentag_id);
CREATE INDEX IF NOT EXISTS idx_verkauf_zeit ON verkauf(zeit);

CREATE TABLE IF NOT EXISTS position (
  id TEXT PRIMARY KEY,
  verkauf_id TEXT NOT NULL REFERENCES verkauf(id),
  produkt_id TEXT NOT NULL REFERENCES produkt(id),
  name_snapshot TEXT NOT NULL,
  preis_snapshot_rappen INTEGER NOT NULL,
  anzahl INTEGER NOT NULL CHECK(anzahl > 0),
  gruppe_snapshot TEXT NOT NULL CHECK(gruppe_snapshot IN ('coupon','kasse'))
);
CREATE INDEX IF NOT EXISTS idx_position_verkauf ON position(verkauf_id);

CREATE TABLE IF NOT EXISTS zahlung (
  verkauf_id TEXT PRIMARY KEY REFERENCES verkauf(id),
  waehrung TEXT NOT NULL CHECK(waehrung IN ('CHF','EUR')),
  kurs_x10000 INTEGER,
  gegeben INTEGER NOT NULL,
  gegeben_chf_rappen INTEGER NOT NULL,
  rueckgeld_chf_rappen INTEGER NOT NULL,
  spende_chf_rappen INTEGER NOT NULL DEFAULT 0,
  spende_typ TEXT CHECK(spende_typ IN ('bar_chf','bar_eur','twint'))
);

CREATE TABLE IF NOT EXISTS storno (
  id TEXT PRIMARY KEY,
  verkauf_id TEXT NOT NULL UNIQUE REFERENCES verkauf(id),
  kassentag_id TEXT NOT NULL REFERENCES kassentag(id),
  zeit TEXT NOT NULL,
  grund TEXT NOT NULL CHECK(grund IN ('tippfehler','ausverkauft','abgesprungen')),
  auszahlung_chf_rappen INTEGER NOT NULL,
  mit_pin INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_storno_kassentag ON storno(kassentag_id);

CREATE TABLE IF NOT EXISTS druckauftrag (
  id TEXT PRIMARY KEY,
  verkauf_id TEXT REFERENCES verkauf(id),
  kassentag_id TEXT REFERENCES kassentag(id),
  typ TEXT NOT NULL CHECK(typ IN ('beleg','nachdruck_alles','nachdruck_coupons','nachdruck_bon','abschluss','test','schublade')),
  bytes_pfad TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued','sent','done','failed')),
  spooler_job_id INTEGER,
  fehler TEXT,
  erstellt_am TEXT NOT NULL,
  erledigt_am TEXT
);
CREATE INDEX IF NOT EXISTS idx_druckauftrag_status ON druckauftrag(status);

CREATE TABLE IF NOT EXISTS einstellung (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS warenkorb_entwurf (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  json TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);

-- Vereins-Kasse: Migration 004
-- Beleg-Rabatt (angereiste Mitglieder anderer Vereine): Der Rabatt gilt fuer den GANZEN Beleg,
-- nie fuer einzelne Positionen. position.preis_snapshot_rappen bleibt darum der VOLLE Preis.
-- verkauf.total_rappen ist der bereits rabattierte, kassierte Betrag (Zahlung, Rueckgeld,
-- Storno-Auszahlung und die Soll-Formeln des Abschlusses rechnen unveraendert damit).
-- rabatt_prozent: gewaehrter Satz (0 = kein Rabatt, auch bei zahlart helfer).
-- rabatt_rappen: Abzug = Zwischensumme (volle Preise) - total_rappen.
-- Bestehende Belege bekommen ueber DEFAULT 0 den bisherigen Zustand "kein Rabatt".
ALTER TABLE verkauf ADD COLUMN rabatt_prozent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE verkauf ADD COLUMN rabatt_rappen INTEGER NOT NULL DEFAULT 0;

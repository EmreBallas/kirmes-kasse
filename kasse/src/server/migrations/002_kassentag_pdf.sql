-- Vereins-Kasse: Migration 002
-- Pfad der Abschluss-PDF je Kassentag (absoluter Pfad, gesetzt vom Main nach dem Schreiben; NULL = keine PDF).
ALTER TABLE kassentag ADD COLUMN pdf_pfad TEXT;

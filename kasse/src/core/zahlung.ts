/**
 * Zahlungsberechnung nach Fachregeln 1 bis 8 (roadmap-v1.md Abschnitt 5).
 * Reine Funktion: keine Seiteneffekte, alle Beträge ganze Rappen/Cent.
 * Ein Beleg-Rabatt braucht hier nichts: `totalRappen` ist bereits der rabattierte, zu kassierende Betrag
 * (der Server rechnet ihn mit `rabattBetrag` aus), darum stimmen Deckung, Rückgeld und Spende unverändert.
 * Zahlart `helfer` («später zahlen»): keine Zahlung, das Total ist die entstehende Helfer-Schuld.
 */
import { chfZuEurCentAufgerundet, eurZuChfRappen, pruefeGanzzahl, pruefeKurs } from './geld'
import type { ZahlungsEingabe, ZahlungsErgebnis, ZahlungsWarnung } from './types'

/** Schwelle für die Bestätigung "Rückgeld/Überzahlung über 200" (Fachregel 3), in Rappen. */
export const SCHWELLE_RUECKGELD_RAPPEN = 20_000

function pruefeEingabe(e: ZahlungsEingabe): void {
  pruefeGanzzahl(e.totalRappen, 'Total in Rappen')
  pruefeGanzzahl(e.gegeben, 'Gegebener Betrag')
  if (e.totalRappen < 0) {
    throw new Error(`Total darf nicht negativ sein, erhalten: ${String(e.totalRappen)}`)
  }
  if (e.gegeben < 0) {
    throw new Error(`Gegebener Betrag darf nicht negativ sein, erhalten: ${String(e.gegeben)}`)
  }
}

/**
 * Bar-Zahlung (CHF oder EUR): Rückgeld = Gegenwert − Total, nie negativ (Regel 1);
 * nicht gedeckt blockiert (Regel 2); "stimmt so" macht das Rückgeld zur Bar-Spende (Regel 7);
 * Überzahlung über 200 CHF verlangt Bestätigung (Regel 3) – auch wenn sie als Spende behalten wird.
 */
function berechneBar(e: ZahlungsEingabe, gegebenChfRappen: number): Pick<
  ZahlungsErgebnis,
  'gedeckt' | 'warnungen' | 'rueckgeldChfRappen' | 'spendeChfRappen' | 'spendeTyp'
> {
  const spendeTyp = e.zahlart === 'bar_eur' ? 'bar_eur' : 'bar_chf'
  const gedeckt = gegebenChfRappen >= e.totalRappen
  const warnungen: ZahlungsWarnung[] = []
  if (!gedeckt) {
    warnungen.push('nicht_gedeckt')
    return { gedeckt, warnungen, rueckgeldChfRappen: 0, spendeChfRappen: 0, spendeTyp: null }
  }
  const ueberzahlung = gegebenChfRappen - e.totalRappen
  if (ueberzahlung > SCHWELLE_RUECKGELD_RAPPEN) warnungen.push('rueckgeld_ueber_200')
  if (e.spendeBehalten && ueberzahlung > 0) {
    return { gedeckt, warnungen, rueckgeldChfRappen: 0, spendeChfRappen: ueberzahlung, spendeTyp }
  }
  return { gedeckt, warnungen, rueckgeldChfRappen: ueberzahlung, spendeChfRappen: 0, spendeTyp: null }
}

export function berechneZahlung(e: ZahlungsEingabe): ZahlungsErgebnis {
  switch (e.zahlart) {
    case 'helfer':
      // Helfer «später zahlen»: keine Zahlung an der Kasse (gegeben 0, Rückgeld 0, Spende 0), immer gedeckt.
      // e.totalRappen ist der geschuldete Betrag (ggf. rabattiert) und wird nur durchgereicht: der Server
      // speichert ihn als verkauf.totalRappen, daraus entsteht die offene Helfer-Schuld. Kein Geld in der Lade.
      pruefeGanzzahl(e.totalRappen, 'Total in Rappen')
      if (e.totalRappen < 0) {
        throw new Error(`Total darf nicht negativ sein, erhalten: ${String(e.totalRappen)}`)
      }
      return {
        gedeckt: true,
        warnungen: [],
        waehrung: 'CHF',
        kursX10000: null,
        gegeben: 0,
        gegebenChfRappen: 0,
        rueckgeldChfRappen: 0,
        spendeChfRappen: 0,
        spendeTyp: null,
        totalEurCent: null
      }

    case 'bar_chf': {
      pruefeEingabe(e)
      const bar = berechneBar(e, e.gegeben)
      return {
        ...bar,
        waehrung: 'CHF',
        kursX10000: null,
        gegeben: e.gegeben,
        gegebenChfRappen: e.gegeben,
        totalEurCent: null
      }
    }

    case 'bar_eur': {
      pruefeEingabe(e)
      pruefeKurs(e.kursX10000)
      // Regel 4: Gegenwert auf 5 Rappen abgerundet, Total in EUR auf 10 Cent aufgerundet.
      const gegebenChfRappen = eurZuChfRappen(e.gegeben, e.kursX10000)
      const bar = berechneBar(e, gegebenChfRappen)
      return {
        ...bar,
        waehrung: 'EUR',
        kursX10000: e.kursX10000,
        gegeben: e.gegeben,
        gegebenChfRappen,
        totalEurCent: chfZuEurCentAufgerundet(e.totalRappen, e.kursX10000)
      }
    }

    case 'twint': {
      pruefeEingabe(e)
      // Regel 6: Überzahlung = Twint-Spende, nie Rückgeld; Regel 3 gilt für die Überzahlung.
      const gedeckt = e.gegeben >= e.totalRappen
      const warnungen: ZahlungsWarnung[] = []
      const spendeChfRappen = gedeckt ? e.gegeben - e.totalRappen : 0
      if (!gedeckt) warnungen.push('nicht_gedeckt')
      if (spendeChfRappen > SCHWELLE_RUECKGELD_RAPPEN) warnungen.push('spende_ueber_200')
      return {
        gedeckt,
        warnungen,
        waehrung: 'CHF',
        kursX10000: null,
        gegeben: e.gegeben,
        gegebenChfRappen: e.gegeben,
        rueckgeldChfRappen: 0,
        spendeChfRappen,
        spendeTyp: spendeChfRappen > 0 ? 'twint' : null,
        totalEurCent: null
      }
    }
  }
}

import { describe, expect, it } from 'vitest'
import type { Produkt } from './types'
import { anzahlArtikel, entfernen, hinzufuegen, leererWarenkorb, mengeAendern, sofortAusgeben, summeMitRabatt, total } from './warenkorb'

function produkt(id: string, name: string, preisRappen: number | null, gruppe: Produkt['gruppe'] = 'coupon'): Produkt {
  return { id, name, preisRappen, gruppe, aktiv: true, ausverkauft: false, reihenfolge: 0, erstelltAm: '2026-09-12T10:00:00' }
}

const burger = produkt('p1', 'Winti Burger', 1100)
const dose = produkt('p2', 'Getränk Dose', 250, 'kasse')
const duerum = produkt('p3', 'Dürüm', null)

describe('warenkorb', () => {
  it('leerer Warenkorb hat Total 0', () => {
    const w = leererWarenkorb()
    expect(w.zeilen).toEqual([])
    expect(total(w)).toBe(0)
    expect(anzahlArtikel(w)).toBe(0)
  })

  it('hinzufuegen legt eine Zeile an, erneutes Antippen erhöht die Menge', () => {
    let w = hinzufuegen(leererWarenkorb(), burger)
    expect(w.zeilen).toEqual([{ produktId: 'p1', name: 'Winti Burger', preisRappen: 1100, gruppe: 'coupon', anzahl: 1 }])
    w = hinzufuegen(w, burger)
    expect(w.zeilen).toHaveLength(1)
    expect(w.zeilen[0]?.anzahl).toBe(2)
    w = hinzufuegen(w, dose, 3)
    expect(w.zeilen).toHaveLength(2)
    expect(total(w)).toBe(2 * 1100 + 3 * 250)
    expect(anzahlArtikel(w)).toBe(5)
  })

  it('hinzufuegen verändert den alten Warenkorb nicht', () => {
    const w0 = leererWarenkorb()
    const w1 = hinzufuegen(w0, burger)
    expect(w0.zeilen).toHaveLength(0)
    expect(w1.zeilen).toHaveLength(1)
  })

  it('Produkt ohne Preis kann nicht hinzugefügt werden', () => {
    expect(() => hinzufuegen(leererWarenkorb(), duerum)).toThrow(/keinen Preis/)
    expect(() => hinzufuegen(leererWarenkorb(), burger, 0)).toThrow()
  })

  it('mengeAendern erhöht, senkt und entfernt bei 0', () => {
    let w = hinzufuegen(hinzufuegen(leererWarenkorb(), burger), dose)
    w = mengeAendern(w, 'p1', 2)
    expect(w.zeilen[0]?.anzahl).toBe(3)
    w = mengeAendern(w, 'p1', -1)
    expect(w.zeilen[0]?.anzahl).toBe(2)
    w = mengeAendern(w, 'p1', -2)
    expect(w.zeilen.map((z) => z.produktId)).toEqual(['p2'])
    w = mengeAendern(w, 'p2', -5)
    expect(w.zeilen).toHaveLength(0)
  })

  it('mengeAendern für unbekanntes Produkt ändert nichts', () => {
    const w = hinzufuegen(leererWarenkorb(), burger)
    expect(mengeAendern(w, 'gibt-es-nicht', 1)).toEqual(w)
  })

  it('entfernen löscht die Zeile', () => {
    const w = hinzufuegen(hinzufuegen(leererWarenkorb(), burger), dose)
    expect(entfernen(w, 'p1').zeilen.map((z) => z.produktId)).toEqual(['p2'])
    expect(entfernen(w, 'p9').zeilen).toHaveLength(2)
  })

  it('total rechnet mit Ganzzahlen, keine Rundung auf Positionen', () => {
    const w = hinzufuegen(hinzufuegen(leererWarenkorb(), burger), dose, 2)
    expect(total(w)).toBe(1600)
  })

  it('sofortAusgeben liefert nur Gruppe kasse', () => {
    const w = hinzufuegen(hinzufuegen(leererWarenkorb(), burger), dose, 2)
    expect(sofortAusgeben(w.zeilen)).toEqual([{ name: 'Getränk Dose', anzahl: 2 }])
  })
})

describe('summeMitRabatt', () => {
  const burger = produkt('burger', 'Winti Burger', 1100)
  const dose = produkt('dose', 'Getränk Dose', 250, 'kasse')

  it('50 Prozent auf den ganzen Warenkorb (Positionen behalten volle Preise)', () => {
    const w = hinzufuegen(hinzufuegen(leererWarenkorb(), burger), dose, 2) // 16.00
    expect(summeMitRabatt(w, 50)).toEqual({ zwischensummeRappen: 1600, rabattProzent: 50, rabattRappen: 800, totalRappen: 800 })
    expect(w.zeilen.map((z) => z.preisRappen)).toEqual([1100, 250])
  })

  it('ohne Rabatt bleibt das Total die Zwischensumme', () => {
    const w = hinzufuegen(leererWarenkorb(), burger)
    expect(summeMitRabatt(w, 0)).toEqual({ zwischensummeRappen: 1100, rabattProzent: 0, rabattRappen: 0, totalRappen: 1100 })
  })

  it('leerer Warenkorb: alles 0, auch mit Satz', () => {
    expect(summeMitRabatt(leererWarenkorb(), 50)).toEqual({ zwischensummeRappen: 0, rabattProzent: 0, rabattRappen: 0, totalRappen: 0 })
  })
})

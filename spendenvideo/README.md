# Spendenvideo „Kur'an Öğretme Hizmeti“ – Çad / Abeşe (Entwurf 1)

Hochformat 9:16 (1080×1920), 30 fps, ca. 93 Sekunden. Für WhatsApp, Instagram Reels/Story, TikTok.
Hauptfassung: Türkisch. Deutsche Fassung liegt zusätzlich bei.

## Dateien

| Datei | Zweck |
|---|---|
| `spendenvideo_tr_9x16.mp4` | Türkische Fassung, Master-Qualität |
| `spendenvideo_tr_9x16_whatsapp.mp4` | Türkische Fassung, kleiner (WhatsApp-Versand) |
| `spendenvideo_de_9x16.mp4` | Deutsche Fassung, Master-Qualität |
| `spendenvideo_de_9x16_whatsapp.mp4` | Deutsche Fassung, kleiner |
| `script_final.json` | Alle eingeblendeten Texte (TR/DE) – hier Wortlaut ändern |
| `details.json` | Zeilen der Spendenkarte (Ort, Hoca, Kontakt, Bağış hesabı) |
| `storyboard.json` | Briefing: Fakten, Verbote, Slots |
| `tools/build.py`, `tools/preview.py` | Renderer (ffmpeg + Python/PIL) und Kontrollbögen |

## Schon eingebaut (Stand WhatsApp-Chat mit Cihat Hoca)

- Ort: Çad, Abeşe (Titel, Untertitel)
- Foto von Cihat Göçer Hoca mit Talebe als eigenes Bild vor der Spendenkarte
- Spendenkarte: Hicaz Eğitim Kültür ve Dostluk Derneği, IBAN TR02 0001 0007 1784 3659 0450 01
  (Prüfziffer geprüft), Açıklama/Verwendungszweck 2004, Online-Link odeme.sunrisehelp.org/2004,
  Kontakt +90 534 234 84 67 (Cihat Göçer)

## Bitte bestätigen

1. Online-Link …/2004: vom Auftraggeber bestätigt.
2. Die Nummer +90 534 234 84 67 ist als türkische Mobilnummer formatiert.
3. Für Spender in Deutschland: Überweisung auf ein türkisches Konto ist keine SEPA-Zahlung
   (Gebühren, Dauer). Der Online-Link ist dafür wahrscheinlich der einfachere Weg; „Elden tahsilat“
   (Bargeld in der Gemeinde) war laut Hoca ohnehin Priorität 1.
4. Optional: Logo (PNG transparent), Nasheed/İlahi als Tonbett statt der Rezitation

## Bewusst so gelöst

- Keine Zahlen (Kinder, Kosten), weil keine vorliegen.
- Keine Musik. Tonkonzept (nach Prüfrunde, adab-konform):
  Clip 1 läuft voll, solange der Junge im Bild ist, danach einmal leiser weiter, bis er von selbst
  endet (keine Schleife, kein Schnitt mitten in der Rezitation). Clip 2 läuft synchron im Bild.
  Ab dem Hadith läuft Clip 1 ein zweites Mal komplett und ungeschnitten leise mit und endet von
  selbst auf der Spendenkarte; Abspann nur mit leisem Raumton. Falls der Hoca gar keine Rezitation
  im Hintergrund möchte: in `tools/build.py` `second_pass=False` setzen und neu rendern.
- Texte: drei Autorenvarianten, drei Gutachten (Wirkung, Richtigkeit/Religion, Sprache TR+DE), dann Synthese.
- Prüfrunde am gerenderten Video (Layout, Sprache, Timing, Bild, Zielgruppe) eingearbeitet:
  türkische Großbuchstaben (İ), Textpositionen außerhalb der App-Leisten, längere Lesezeiten,
  Hadith-Lesbarkeit, Bildausschnitte, Tonbett ohne überlappende Stimmen.
  Hadith: Buhârî 5027 („Sizin en hayırlınız, Kur'an'ı öğrenen ve öğretendir.“).

## Ablauf (Sekunden ≈)

| Zeit | Bild | Text (TR) |
|---|---|---|
| 0–9 | Clip: Junge rezitiert von der Holztafel (O-Ton) | Besmele + „Elindeki tahta levhadan Kur’an okuyor…“ |
| 8–17 | Schwenk über den Hof mit der Klasse | „Çad’da Çocuklara Kur’an Eğitimi“ |
| 16–23 | Zwei Jungen mit Tafeln | „Defter yerine tahta levha…“ |
| 22–30 | Reihe der Jungen, kleiner Junge | „Her gün geliyorlar…“ |
| 30–37 | Junge mit weißer Kappe und Tafel | „Hocalarına maaş veren yok…“ |
| 36–43 | Kleiner Junge auf der Matte | „Bu dersler yalnızca … bağışlarıyla ayakta kalıyor.“ |
| 42–51 | Clip: kleiner Junge rezitiert (O-Ton) | „Bağışınızla bu çocuklar öğrenmeye devam edebilir.“ |
| 50–60 | Junge in Rot mit Tafel | Hadith arabisch + Übersetzung (Buhârî 5027) |
| 59–67 | Lachende Jungen | „Sadaka-i cariye … sevabınız inşallah sürer.“ |
| 66–73 | Cihat Hoca mit Talebe | „Hocamız Cihat Göçer, Abeşe’de bir talebesiyle.“ |
| 72–85 | Spendenkarte | „Siz de bu hayra ortak olun“ + Konto/IBAN/Proje kodu/Link/Kontakt |
| 84–93 | Lächelnder Junge | „Allah razı olsun“ |

## Neu rendern (nach Änderungen an Texten oder Daten)

```
python3 tools/build.py base            # nur nötig, wenn Bilder/Dauern geändert wurden
python3 tools/build.py final --lang tr # Overlays + Ton + Export (Master + WhatsApp)
python3 tools/build.py final --lang de
```
Quellmedien (Fotos/Clips) liegen nicht im Repo (Privatsphäre der Kinder), sondern im Projektordner `src/`.

# Spendenvideo „Kur'an Öğretme Hizmeti“ – Çad / Abeşe (Entwurf 1)

Hochformat 9:16 (1080×1920), 30 fps, ca. 81 Sekunden. Für WhatsApp, Instagram Reels/Story, TikTok.
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

- Ort: Çad, Abeşe (Titel, Untertitel, Spendenkarte)
- Verantwortlicher: Cihat Göçer
- Kontakt: +90 534 234 84 67 (als türkische Mobilnummer interpretiert – bitte bestätigen)

## Noch offen

1. **Zahlungsweg** (IBAN / PayPal / Western Union …) – aktuell Platzhalter „[Ödeme bilgileri eklenecek]“
2. Name des Vereins / der Kuruluş, falls es einen gibt (sonst bleibt die Zeile weg)
3. Foto von Cihat Hoca mit den Talebe (kommt nach dem Gebet) – kann als eigenes Bild vor der Spendenkarte eingebaut werden
4. Optional: Logo (PNG transparent), Nasheed/İlahi als Tonbett statt der Rezitation

## Bewusst so gelöst

- Keine Zahlen (Kinder, Kosten), weil keine vorliegen.
- Keine Musik: Tonspur ist ausschließlich die Rezitation der Kinder aus den beiden Clips.
  Clip 1 läuft nach dem Schnitt leiser als Klangteppich weiter, Clip 2 ist synchron im Bild.
- Texte: drei Autorenvarianten, drei Gutachten (Wirkung, Richtigkeit/Religion, Sprache TR+DE), dann Synthese.
  Hadith: Buhârî 5027 („Sizin en hayırlınız, Kur'an'ı öğrenen ve öğretendir.“).

## Ablauf (Sekunden ≈)

| Zeit | Bild | Text (TR) |
|---|---|---|
| 0–9 | Clip: Junge rezitiert von der Holztafel (O-Ton) | Besmele + „Elindeki tahta levhadan Kur'an okuyor…“ |
| 8–15 | Schwenk über den Hof mit der Klasse | „Çad'da Çocuklara Kur'an Eğitimi“ |
| 14–21 | Zwei Jungen mit Tafeln | „Defter yerine tahta levha…“ |
| 21–29 | Reihe der Jungen, kleiner Junge | „Her gün geliyorlar…“ |
| 29–36 | Junge mit weißer Kappe | „Hocalarına maaş veren yok…“ |
| 35–42 | Kleiner Junge auf der Matte | „Bu dersler yalnızca … bağışlarıyla ayakta kalıyor.“ |
| 41–50 | Clip: kleiner Junge rezitiert (O-Ton) | „Bağışınızla bu çocuk öğrenmeye devam edebilir.“ |
| 49–57 | Junge in Rot mit Tafel | Hadith arabisch + Übersetzung |
| 57–65 | Lachende Jungen | „Sadaka-i cariye…“ |
| 64–75 | Spendenkarte | „Siz de bu hayra ortak olun“ + Ort/Hoca/Kontakt/Bağış |
| 74–81 | Lächelnder Junge | „Allah razı olsun“ |

## Neu rendern (nach Änderungen an Texten oder Daten)

```
python3 tools/build.py base            # nur nötig, wenn Bilder/Dauern geändert wurden
python3 tools/build.py final --lang tr # Overlays + Ton + Export (Master + WhatsApp)
python3 tools/build.py final --lang de
```
Quellmedien (Fotos/Clips) liegen nicht im Repo (Privatsphäre der Kinder), sondern im Projektordner `src/`.

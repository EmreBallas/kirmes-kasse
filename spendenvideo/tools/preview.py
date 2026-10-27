#!/usr/bin/env python3
"""preview.py <lang> <aspect> [final.mp4]
Without a video: composites each overlay PNG on a representative frame of its segment file -> out/preview_<lang>_<aspect>.jpg
With a video: extracts frames at the middle of every text window of the final cut -> out/frames_<lang>_<aspect>/ + sheet."""
import sys, os, json, subprocess, glob
sys.path.insert(0, os.path.dirname(__file__))
import build
from PIL import Image, ImageDraw, ImageFont

lang, aspect = sys.argv[1], sys.argv[2]
video = sys.argv[3] if len(sys.argv) > 3 else None
W, H = build.ASPECTS[aspect]
OUT = build.OUT
tl = json.load(open(os.path.join(OUT, f"timeline_{aspect}.json"))) if os.path.exists(os.path.join(OUT, f"timeline_{aspect}.json")) else None

def grab(path, t):
    tmp = "/tmp/_grab.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", path, "-frames:v", "1", tmp], check=True)
    return Image.open(tmp).convert("RGB")

tiles = []
if video:
    segs = {x["id"]: x for x in tl["segments"]}
    fdir = os.path.join(OUT, f"frames_{lang}_{aspect}"); os.makedirs(fdir, exist_ok=True)
    for seg in build.SEGMENTS:
        st = segs[seg["id"]]
        times = [st["start"] + build.T_X + 0.3]  # just after the transition (no text yet, picture check)
        for slot in seg["slots"]:
            key, appear, span = (tuple(slot) + (1,))[:3]
            S0, E0 = build.slot_window(build.SEGMENTS.index(seg), appear, span)
            times.append(S0 + 1.0); times.append((S0 + E0) / 2)
        for t in times:
            if t < tl["total"]:
                fr = grab(video, t); fr.save(os.path.join(fdir, f"{seg['id']}_{t:06.2f}.jpg"), quality=88)
                tiles.append((f"{seg['id']} @{t:.1f}s", fr))
else:
    ovl = build.make_overlays(lang, aspect)
    for seg in build.SEGMENTS:
        segfile = os.path.join(build.SEG, f"{seg['id']}_{aspect}.mp4")
        for slot in seg["slots"]:
            key, appear = slot[0], slot[1]
            if os.path.exists(segfile) and os.path.getsize(segfile) > 1000:
                fr = grab(segfile, min(appear + 1.5, seg["dur"] - 0.2))
            else:
                fr = Image.new("RGB", (W, H), (90, 80, 60))
            path, x, y = ovl[key]
            o = Image.open(path).convert("RGBA")
            fr = fr.convert("RGBA"); fr.alpha_composite(o, (x, y))
            tiles.append((f"{seg['id']} / {key}", fr.convert("RGB")))
# sheet
tw = 360; th = int(tw * H / W)
cols = 5 if len(tiles) > 8 else len(tiles)
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * (th + 28)), (30, 30, 30))
d = ImageDraw.Draw(sheet); f = ImageFont.truetype("/usr/share/fonts/opentype/inter/Inter-Medium.otf", 16)
for i, (lab, im) in enumerate(tiles):
    x, y = (i % cols) * tw, (i // cols) * (th + 28)
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + 28)); d.text((x + 6, y + 5), lab, font=f, fill=(230, 230, 230))
name = f"preview_{lang}_{aspect}.jpg" if not video else f"frames_{lang}_{aspect}.jpg"
sheet.save(os.path.join(OUT, name), quality=85); print(os.path.join(OUT, name))

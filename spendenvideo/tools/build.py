#!/usr/bin/env python3
"""Spendenvideo renderer.

  build.py base  [--aspect 9x16]              -> segments + xfade -> out/base_<aspect>.mp4 + timeline json
  build.py final --lang de|tr [--aspect 9x16] -> text overlays + audio -> out/spendenvideo_<lang>_<aspect>.mp4
  build.py overlays --lang de [--aspect 9x16] -> only render overlay PNGs (for preview)
"""
import json, math, os, subprocess, sys, argparse, shutil, glob
from concurrent.futures import ProcessPoolExecutor
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC, OVL, SEG, OUT, FONTS = [os.path.join(ROOT, d) for d in ("src", "overlays", "segments", "out", "fonts")]
for d in (OVL, SEG, OUT):
    os.makedirs(d, exist_ok=True)

FPS = 30
T_X = 0.8            # crossfade duration between segments
END_FADE = 1.2       # fade to black at the very end
ASPECTS = {"9x16": (1080, 1920), "16x9": (1920, 1080), "1x1": (1080, 1080)}

# ----------------------------------------------------------------------------- fonts
def font_path(*candidates):
    for c in candidates:
        p = c if os.path.isabs(c) else os.path.join(FONTS, c)
        if os.path.exists(p):
            return p
    raise FileNotFoundError(candidates)

F_SERIF_B = font_path("Playfair-700.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf")
F_SERIF_SB = font_path("Playfair-600.ttf", "Playfair-700.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf")
F_SERIF_I = font_path("Playfair-400i.ttf", "Playfair-600i.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf")
F_SANS_M = font_path("/usr/share/fonts/opentype/inter/Inter-Medium.otf")
F_SANS_SB = font_path("/usr/share/fonts/opentype/inter/Inter-SemiBold.otf")
F_SANS_B = font_path("/usr/share/fonts/opentype/inter/Inter-Bold.otf")
F_ARABIC = font_path("Amiri-400.ttf", "Scheherazade-400.ttf", "/usr/share/fonts/truetype/freefont/FreeSerif.ttf")

# ----------------------------------------------------------------------------- colours
C_TEXT = (255, 249, 238, 255)
C_GOLD = (233, 196, 125, 255)
C_MUTED = (236, 226, 208, 230)
C_GREEN = (15, 61, 46)
C_GREEN_D = (7, 30, 22)

# ----------------------------------------------------------------------------- storyboard (picture)
# fx,fy = focus point (fraction of source image) the crop is centred on; z = zoom relative to the
# "cover" framing (1.0 = the largest crop that fills the frame). Motion eases from start to end.
SEGMENTS = [
    dict(id="s01", kind="clip", src="vB_boy_tablet_reciting.mov", ss=0.0, dur=9.0,
         slots=[("bismillah", 0.8), ("s01_hook", 2.4)]),
    dict(id="s02", kind="photo", src="p14_courtyard_class.jpg", dur=8.5,
         start=dict(fx=0.30, fy=0.50, z=1.0), end=dict(fx=0.74, fy=0.50, z=1.0),
         slots=[("title", 1.0)]),
    dict(id="s03", kind="photo", src="p09_two_tablets.jpg", dur=7.0,
         start=dict(fx=0.36, fy=0.55, z=1.0), end=dict(fx=0.64, fy=0.55, z=1.04),
         slots=[("s03_tablets", 0.9)]),
    dict(id="s04a", kind="photo", src="p04_row_of_boys.jpg", dur=5.0,
         start=dict(fx=0.30, fy=0.45, z=1.0), end=dict(fx=0.58, fy=0.45, z=1.0),
         slots=[("s04_children", 0.9, 2)]),
    dict(id="s04b", kind="photo", src="p01_boy_hand_mouth.jpg", dur=4.0,
         start=dict(fx=0.60, fy=0.52, z=1.0), end=dict(fx=0.62, fy=0.50, z=1.10), slots=[]),
    dict(id="s05", kind="photo", src="p10_boy_white_cap_tablet.jpg", dur=7.0,
         start=dict(fx=0.42, fy=0.42, z=1.0), end=dict(fx=0.40, fy=0.40, z=1.10),
         slots=[("s05_teachers", 0.9)]),
    dict(id="s06", kind="photo", src="p12_small_boy_mat.jpg", dur=7.0, enhance=True,
         start=dict(fx=0.50, fy=0.52, z=1.22), end=dict(fx=0.50, fy=0.55, z=1.0),
         slots=[("s06_donations", 0.9)]),
    dict(id="s07", kind="clip", src="vA_small_boy_reciting.mov", ss=0.6, dur=8.5, eq="eq=saturation=1.12:contrast=1.09",
         slots=[("s07_clipA", 2.0)]),
    dict(id="s08", kind="photo", src="p07_boy_red_tablet.jpg", dur=10.0,
         start=dict(fx=0.52, fy=0.48, z=1.0), end=dict(fx=0.50, fy=0.46, z=1.08),
         slots=[("hadith", 0.9)]),
    dict(id="s09a", kind="photo", src="p03_two_boys_smiling.jpg", dur=5.0,
         start=dict(fx=0.42, fy=0.45, z=1.06), end=dict(fx=0.44, fy=0.45, z=1.0),
         slots=[("s09_sadaqa", 0.9, 2)]),
    dict(id="s09b", kind="photo", src="p05_two_boys_smiling_b.jpg", dur=4.0,
         start=dict(fx=0.40, fy=0.45, z=1.0), end=dict(fx=0.42, fy=0.44, z=1.08), slots=[]),
    dict(id="s09c", kind="photo", src="p15_hoca_with_boy.jpg", dur=6.5, enhance=True,
         start=dict(fx=0.60, fy=0.50, z=1.07), end=dict(fx=0.60, fy=0.50, z=1.0),
         slots=[("s09c_hoca", 0.9)]),
    dict(id="s10", kind="card", src="p08_boy_blue_tablet.jpg", dur=12.5,
         start=dict(fx=0.5, fy=0.5, z=1.0), end=dict(fx=0.5, fy=0.5, z=1.05),
         slots=[("cta", 0.7)]),
    dict(id="s11", kind="photo", src="p11_boy_brown_cap.jpg", dur=9.0,
         start=dict(fx=0.40, fy=0.42, z=1.0), end=dict(fx=0.40, fy=0.42, z=1.06),
         slots=[("end", 0.9)]),
]

def slot_window(k, appear, span=1):
    """(S0, E0) in final-cut seconds for a text attached to segment k that persists over `span` segments."""
    tl, total = timeline()
    S0 = tl[k]["start"] + max(appear, T_X)
    last = k + span - 1
    if last >= len(SEGMENTS) - 1:
        E0 = tl[-1]["end"] - (END_FADE + 0.3)
    else:
        E0 = tl[last]["end"] - (T_X + 0.25)
    return S0, E0

def timeline():
    """Absolute start times of each segment in the final cut (xfade overlaps subtracted)."""
    t, out = 0.0, []
    for k, s in enumerate(SEGMENTS):
        out.append(dict(id=s["id"], start=round(t, 3), dur=s["dur"], end=round(t + s["dur"], 3)))
        t += s["dur"] - T_X
    total = t + T_X
    return out, round(total, 3)

# ----------------------------------------------------------------------------- picture engine
def ease(p):
    return p * p * (3 - 2 * p)

def cover_crop(sw, sh, W, H, fx, fy, z):
    """Crop box (float) of the source for focus (fx,fy) and zoom z, filling WxH."""
    scale = max(W / sw, H / sh) * z          # source px -> output px
    cw, ch = W / scale, H / scale            # crop size in source px
    cx, cy = fx * sw, fy * sh
    x0 = min(max(cx - cw / 2, 0), sw - cw)
    y0 = min(max(cy - ch / 2, 0), sh - ch)
    return (x0, y0, x0 + cw, y0 + ch)

def prep_image(path, kind, W, H, enhance=False):
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    if enhance:  # hazy / backlit source: restore contrast and a little colour
        from PIL import ImageEnhance
        im = ImageOps.autocontrast(im, cutoff=0.5)
        im = ImageEnhance.Color(im).enhance(1.10)
        im = ImageEnhance.Contrast(im).enhance(1.03)
    if kind == "card":
        im = im.filter(ImageFilter.GaussianBlur(28))
        tint = Image.new("RGB", im.size, C_GREEN)
        im = Image.blend(im, tint, 0.72)
        im = ImageOps.autocontrast(im, cutoff=1)
        im = Image.eval(im, lambda v: int(v * 0.62))
    # keep the source roughly 1.0-1.4x the output so LANCZOS always has enough pixels
    sw, sh = im.size
    s = max(W / sw, H / sh) * 1.3
    if s < 1:
        im = im.resize((round(sw * s), round(sh * s)), Image.LANCZOS)
    return im

def render_photo_segment(seg, W, H, out_path):
    im = prep_image(os.path.join(SRC, seg["src"]), seg["kind"], W, H, enhance=seg.get("enhance", False))
    sw, sh = im.size
    n = round(seg["dur"] * FPS)
    a, b = seg["start"], seg["end"]
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
           "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p",
           "-r", str(FPS), "-g", "60", out_path]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(n):
        e = ease(i / max(n - 1, 1))
        fx = a["fx"] + (b["fx"] - a["fx"]) * e
        fy = a["fy"] + (b["fy"] - a["fy"]) * e
        z = a["z"] + (b["z"] - a["z"]) * e
        box = cover_crop(sw, sh, W, H, fx, fy, z)
        frame = im.resize((W, H), Image.LANCZOS, box=box)
        p.stdin.write(frame.tobytes())
    p.stdin.close()
    if p.wait() != 0:
        raise RuntimeError("ffmpeg failed for " + seg["id"])

def render_clip_segment(seg, W, H, out_path):
    src = os.path.join(SRC, seg["src"])
    # portrait phone clip; for a landscape canvas: blurred fill behind the sharp clip
    sharp = ("hqdn3d=1.5:1.5:4:4,scale=%d:-2:flags=lanczos,crop=%d:min(ih\\,%d),"
             "unsharp=5:5:0.45:5:5:0.0," + seg.get("eq", "eq=saturation=1.04:contrast=1.02"))
    if W < H:
        vf = (sharp % (W, W, H)) + f",pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,fps={FPS},setsar=1,format=yuv420p"
    else:
        vf = (f"split[a][b];[a]scale={W}:{H}:flags=bicubic,gblur=sigma=40,eq=brightness=-0.15[bg];"
              f"[b]hqdn3d=1.5:1.5:4:4,scale=-2:{H}:flags=lanczos,unsharp=5:5:0.45[fg];"
              f"[bg][fg]overlay=(W-w)/2:0,fps={FPS},setsar=1,format=yuv420p")
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", str(seg["ss"]), "-t", str(seg["dur"]), "-i", src,
           "-filter_complex" if W >= H else "-vf", vf, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "16",
           "-pix_fmt", "yuv420p", "-r", str(FPS), "-g", "60", "-t", str(seg["dur"]), out_path]
    subprocess.run(cmd, check=True)
    # pad/trim to the exact length (clip may be a few frames short)
    fix = os.path.join(SEG, "fix_" + os.path.basename(out_path))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", out_path, "-vf", f"tpad=stop_mode=clone:stop_duration=1,trim=duration={seg['dur']},setpts=PTS-STARTPTS",
                    "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", str(FPS), fix], check=True)
    shutil.move(fix, out_path)

def render_segment(args):
    seg, W, H, aspect = args
    out_path = os.path.join(SEG, f"{seg['id']}_{aspect}.mp4")
    if seg["kind"] == "clip":
        render_clip_segment(seg, W, H, out_path)
    else:
        render_photo_segment(seg, W, H, out_path)
    return out_path

def build_base(aspect, only=None):
    W, H = ASPECTS[aspect]
    todo = [s for s in SEGMENTS if (only is None or s["id"] in only)]
    jobs = [(s, W, H, aspect) for s in todo]
    with ProcessPoolExecutor(max_workers=max(1, os.cpu_count() - 1)) as ex:
        list(ex.map(render_segment, jobs))
    paths = [os.path.join(SEG, f"{s['id']}_{aspect}.mp4") for s in SEGMENTS]
    # xfade chain
    inputs, filt = [], []
    for i, p in enumerate(paths):
        inputs += ["-i", p]
        filt.append(f"[{i}:v]fps={FPS},settb=AVTB,format=yuv420p[v{i}]")
    prev, acc = "v0", 0.0
    for i in range(1, len(paths)):
        acc += SEGMENTS[i - 1]["dur"]
        offset = acc - i * T_X
        out = f"x{i}" if i < len(paths) - 1 else "vx"
        filt.append(f"[{prev}][v{i}]xfade=transition=fade:duration={T_X}:offset={offset:.3f}[{out}]")
        prev = out
    tl, total = timeline()
    filt.append(f"[vx]fade=t=out:st={total - END_FADE:.3f}:d={END_FADE}[vout]")
    base = os.path.join(OUT, f"base_{aspect}.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(filt), "-map", "[vout]",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", str(FPS), base], check=True)
    json.dump(dict(aspect=aspect, total=total, segments=tl), open(os.path.join(OUT, f"timeline_{aspect}.json"), "w"), indent=1)
    print("base:", base, "total", total)

# ----------------------------------------------------------------------------- text engine
def load_script(lang):
    sb = json.load(open(os.path.join(ROOT, "storyboard.json")))
    fixed = {s["id"]: s.get(lang) for s in sb["slots"] if s.get("fixed")}
    final = json.load(open(os.path.join(ROOT, "script_final.json")))
    txt = {s["id"]: s[lang] for s in final["slots"]}
    txt.update(fixed)
    details = json.load(open(os.path.join(ROOT, "details.json")))
    return txt, details.get(lang, details)

def upper_lang(text, lang):
    """str.upper() turns Turkish i into I; map i->İ and ı->I first for Turkish."""
    if lang == "tr":
        text = text.replace("i", "İ").replace("ı", "I")
    return text.upper()

def wrap_fit(draw, text, fpath, size, max_w, min_size, **kw):
    """Shrink font until every explicit line fits; if still too wide, word-wrap."""
    lines = text.split("\n")
    while size > min_size:
        f = ImageFont.truetype(fpath, size)
        if all(draw.textlength(l, font=f, **kw) <= max_w for l in lines):
            return f, lines
        size -= 2
    f = ImageFont.truetype(fpath, size)
    out = []
    for l in lines:
        cur = ""
        for w in l.split(" "):
            cand = (cur + " " + w).strip()
            if draw.textlength(cand, font=f, **kw) <= max_w or not cur:
                cur = cand
            else:
                out.append(cur); cur = w
        out.append(cur)
    return f, out

class Canvas:
    def __init__(self, W, H):
        self.W, self.H = W, H
        self.im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def scrim(self, y0, y1, alpha=0.62, top=False):
        """vertical black gradient from y0 (transparent) to y1 (alpha); top=True inverts."""
        g = Image.new("L", (1, self.H), 0)
        px = g.load()
        for y in range(self.H):
            if y0 <= y <= y1:
                p = (y - y0) / max(y1 - y0, 1)
                p = 1 - p if top else p
                px[0, y] = int(255 * alpha * ease(p))
            elif (y > y1 and not top) or (y < y0 and top):
                px[0, y] = int(255 * alpha)
        layer = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 255))
        layer.putalpha(g.resize((self.W, self.H)))
        self.im.alpha_composite(layer)

    def text_block(self, lines_spec, x, y, align="left", max_w=None, shadow=True):
        """lines_spec: list of dict(text, font, size, color, spacing(after, px), tracking, rtl, min_size).
        Returns bottom y. For align=center x is the centre."""
        max_w = max_w or (self.W - 2 * 72)
        layer = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        cy = y
        for sp in lines_spec:
            kw = {}
            if sp.get("rtl"):
                kw = dict(direction="rtl", language="ar")
            f, lines = wrap_fit(d, sp["text"], sp["font"], sp["size"], max_w, sp.get("min_size", int(sp["size"] * 0.7)), **kw)
            asc, desc = f.getmetrics()
            lh = int((asc + desc) * sp.get("lh", 1.08))
            for ln in lines:
                tracking = sp.get("tracking", 0)
                if tracking:
                    tw = sum(d.textlength(ch, font=f) for ch in ln) + tracking * (len(ln) - 1)
                else:
                    tw = d.textlength(ln, font=f, **kw)
                if align == "center":
                    tx = x - tw / 2
                elif align == "right":
                    tx = x - tw
                else:
                    tx = x
                if tracking:
                    cx = tx
                    for ch in ln:
                        d.text((cx, cy), ch, font=f, fill=sp["color"])
                        cx += d.textlength(ch, font=f) + tracking
                else:
                    d.text((tx, cy), ln, font=f, fill=sp["color"], **kw)
                cy += lh
            cy += sp.get("after", 0)
        if shadow:
            sh = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))
            a = layer.split()[3].filter(ImageFilter.GaussianBlur(7))
            sh.putalpha(a.point(lambda v: int(v * 0.7)))
            self.im.alpha_composite(sh, (0, 4))
        self.im.alpha_composite(layer)
        return cy

    def rule(self, x0, x1, y, color=C_GOLD, w=4):
        self.d.rectangle([x0, y, x1, y + w], fill=color)

    def save(self, path):
        """Crop to content bbox (+margin) and save; returns (path, x, y)."""
        bbox = self.im.getbbox()
        if not bbox:
            raise ValueError("empty overlay")
        m = 24
        x0, y0 = max(bbox[0] - m, 0), max(bbox[1] - m, 0)
        x1, y1 = min(bbox[2] + m, self.W), min(bbox[3] + m, self.H)
        # keep even dimensions / even origin for yuv420 safety
        x0 -= x0 % 2; y0 -= y0 % 2
        x1 += x1 % 2; y1 += y1 % 2
        self.im.crop((x0, y0, min(x1, self.W), min(y1, self.H))).save(path)
        return path, x0, y0

def S(W):
    """scale factor relative to the 1080-wide design"""
    return W / 1080.0

def make_overlays(lang, aspect):
    W, H = ASPECTS[aspect]
    s = S(W)
    txt, details = load_script(lang)
    out = {}
    marg = int(72 * s)
    lower_bottom = int(H - (300 if H > W else 120) * s)   # bottom edge of lower-third text blocks
    maxw = W - 2 * marg

    def medium_block(key, text, extra=None):
        c = Canvas(W, H)
        # measure first with a throwaway canvas to find block height
        tmp = Canvas(W, H)
        spec = [dict(text=text, font=F_SERIF_SB, size=int(62 * s), color=C_TEXT, lh=1.14)]
        if extra:
            spec += extra
        bottom = tmp.text_block(spec, marg, 0, max_w=maxw, shadow=False)
        y = lower_bottom - bottom
        c.scrim(int(y - 260 * s), H, alpha=0.58)
        c.rule(marg, marg + int(64 * s), y - int(28 * s), w=int(5 * s))
        c.text_block(spec, marg, y, max_w=maxw)
        out[key] = c.save(os.path.join(OVL, f"{lang}_{aspect}_{key}.png"))

    # --- bismillah (top centre, s01)
    c = Canvas(W, H)
    c.scrim(0, int(520 * s), alpha=0.5, top=True)
    c.text_block([dict(text="بِسْمِ اللّٰهِ الرَّحْمٰنِ الرَّحِيمِ", font=F_ARABIC, size=int(74 * s), color=C_GOLD, rtl=True, lh=1.6)], W // 2, int(262 * s), align="center", max_w=maxw)
    out["bismillah"] = c.save(os.path.join(OVL, f"{lang}_{aspect}_bismillah.png"))

    for key in ("s01_hook", "s03_tablets", "s04_children", "s05_teachers", "s06_donations", "s07_clipA", "s09_sadaqa", "s09c_hoca"):
        medium_block(key, txt[key])

    # --- title block (s02): kicker + title + sub, centred
    c = Canvas(W, H)
    spec = [dict(text=txt["s02_kicker"], font=F_SANS_SB, size=int(33 * s), color=C_GOLD, tracking=int(8 * s), after=int(26 * s)),
            dict(text=txt["s02_title"], font=F_SERIF_B, size=int(96 * s), color=C_TEXT, lh=1.06, after=int(30 * s)),
            dict(text=txt["s02_sub"], font=F_SANS_M, size=int(38 * s), color=C_MUTED)]
    tmp = Canvas(W, H); bottom = tmp.text_block(spec, W // 2, 0, align="center", max_w=maxw, shadow=False)
    y = int(H * (0.72 if H > W else 0.50)) - bottom // 2
    if H > W:
        y = min(y, lower_bottom - bottom)
    c.scrim(int(y - 320 * s), int(y + bottom + 320 * s), alpha=0.0)  # no-op placeholder keeps API symmetric
    full = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    full.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, 92)))
    c.im.alpha_composite(full)
    c.text_block(spec, W // 2, y, align="center", max_w=maxw)
    out["title"] = c.save(os.path.join(OVL, f"{lang}_{aspect}_title.png"))

    # --- hadith block (s08): arabic + translation + source, centred lower
    c = Canvas(W, H)
    spec = [dict(text=txt["s08_hadith_ar"], font=F_ARABIC, size=int(78 * s), color=C_GOLD, rtl=True, lh=1.5, after=int(22 * s)),
            dict(text=txt["s08_hadith"], font=F_SERIF_I, size=int(58 * s), color=C_TEXT, lh=1.16, after=int(22 * s)),
            dict(text=txt["s08_source"], font=F_SANS_M, size=int(34 * s), color=C_MUTED)]
    tmp = Canvas(W, H); bottom = tmp.text_block(spec, W // 2, 0, align="center", max_w=maxw, shadow=False)
    y = lower_bottom - bottom
    c.scrim(int(y - 320 * s), H, alpha=0.66)
    c.text_block(spec, W // 2, y, align="center", max_w=maxw)
    out["hadith"] = c.save(os.path.join(OVL, f"{lang}_{aspect}_hadith.png"))

    # --- CTA card (s10)
    c = Canvas(W, H)
    if "rows" in details:
        pairs = [(r[0], r[1]) for r in details["rows"]]
    else:
        labels = [l.strip() for l in txt["s10_labels"].split("|")]
        while len(labels) < 4:
            labels.append("")
        pairs = list(zip(labels, [details["org"], details["iban"], details["purpose"], details["contact"]]))
    head = [dict(text=txt["s10_heading"], font=F_SERIF_B, size=int(88 * s), color=C_TEXT, lh=1.05, after=int(18 * s))]
    tmp = Canvas(W, H); hb = tmp.text_block(head, W // 2, 0, align="center", max_w=maxw, shadow=False)
    rows = []
    for lab, val in pairs:
        rows.append(dict(text=upper_lang(lab, lang), font=F_SANS_SB, size=int(25 * s), color=C_GOLD, tracking=int(4 * s), after=int(5 * s)))
        rows.append(dict(text=val, font=F_SANS_SB if val.startswith("[") is False else F_SANS_M, size=int(41 * s),
                         color=C_TEXT if not val.startswith("[") else C_MUTED, lh=1.12, after=int(24 * s)))
    tmp = Canvas(W, H); rb = tmp.text_block(rows, marg + int(40 * s), 0, max_w=maxw - int(80 * s), shadow=False)
    line = [dict(text=txt["s10_line"], font=F_SERIF_I, size=int(42 * s), color=C_MUTED)]
    tmp = Canvas(W, H); lb = tmp.text_block(line, W // 2, 0, align="center", max_w=maxw, shadow=False)
    pad = int(44 * s)
    total_h = hb + int(26 * s) + rb + pad + int(30 * s) + lb
    y = int(H * 0.5 - total_h / 2)
    c.text_block(head, W // 2, y, align="center", max_w=maxw)
    yy = y + hb
    c.rule(W // 2 - int(50 * s), W // 2 + int(50 * s), yy - int(4 * s), w=int(4 * s))
    yy += int(26 * s)
    # panel
    panel = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pdraw = ImageDraw.Draw(panel)
    pdraw.rounded_rectangle([marg, yy, W - marg, yy + rb + pad - int(30 * s) + pad], radius=int(28 * s), fill=(0, 0, 0, 110), outline=(233, 196, 125, 120), width=2)
    c.im.alpha_composite(panel)
    c.text_block(rows, marg + int(40 * s), yy + pad, max_w=maxw - int(80 * s), shadow=False)
    yy = yy + rb + pad - int(30 * s) + pad + int(30 * s)
    c.text_block(line, W // 2, yy, align="center", max_w=maxw)
    out["cta"] = c.save(os.path.join(OVL, f"{lang}_{aspect}_cta.png"))

    # --- end block (s11)
    c = Canvas(W, H)
    spec = [dict(text=txt["s11_end"], font=F_SERIF_B, size=int(92 * s), color=C_TEXT, lh=1.06, after=int(26 * s)),
            dict(text=txt["s11_sub"], font=F_SANS_M, size=int(38 * s), color=C_MUTED, lh=1.25)]
    tmp = Canvas(W, H); bottom = tmp.text_block(spec, W // 2, 0, align="center", max_w=maxw, shadow=False)
    y = lower_bottom - bottom
    c.scrim(int(y - 300 * s), H, alpha=0.62)
    c.text_block(spec, W // 2, y, align="center", max_w=maxw)
    out["end"] = c.save(os.path.join(OVL, f"{lang}_{aspect}_end.png"))
    return out

# ----------------------------------------------------------------------------- audio engine
import numpy as np

def decode(path, af=None, ss=None, t=None):
    cmd = ["ffmpeg", "-v", "error"]
    if ss is not None:
        cmd += ["-ss", str(ss)]
    if t is not None:
        cmd += ["-t", str(t)]
    cmd += ["-i", path, "-vn"]
    if af:
        cmd += ["-af", af]
    cmd += ["-f", "f32le", "-ac", "2", "-ar", "48000", "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()

def rms_norm(a, target_db=-20.0):
    r = np.sqrt(np.mean(a ** 2)) + 1e-9
    return a * (10 ** (target_db / 20) / r)

def env_ramp(n, t0, t1, v0, v1, sr=48000):
    """gain envelope array of length n: v0 before t0, linear to v1 at t1, v1 after."""
    t = np.arange(n) / sr
    return np.clip((t - t0) / max(t1 - t0, 1e-6), 0, 1) * (v1 - v0) + v0

def build_audio(aspect, out_wav):
    """Audio timeline built from the two clips' own recitation:
    clip B plays at full level while on screen (s01) and then continues as a softer, filtered bed
    (J-cut) that loops until the end; clip A plays in sync with s07 while the bed ducks."""
    sr = 48000
    tl = json.load(open(os.path.join(OUT, f"timeline_{aspect}.json")))
    total = tl["total"]
    segs = {s["id"]: s for s in tl["segments"]}
    n = int((total + 0.2) * sr)
    mix = np.zeros((n, 2), np.float32)
    BED = 0.27
    segB = next(x for x in SEGMENTS if x["src"].startswith("vB"))
    segA = next(x for x in SEGMENTS if x["src"].startswith("vA"))
    vB = os.path.join(SRC, segB["src"]); vA = os.path.join(SRC, segA["src"])
    b_clean = rms_norm(decode(vB), -20)
    b_bed = rms_norm(decode(vB, af="highpass=f=100,lowpass=f=7000"), -20)
    a_clean = rms_norm(decode(vA, ss=segA["ss"], t=segA["dur"] + T_X), -20)
    lb = len(b_clean)

    def place(arr, t0, gain):
        i0 = int(t0 * sr)
        seg = arr[: n - i0]
        g = gain if np.isscalar(gain) else gain[: len(seg), None]
        mix[i0:i0 + len(seg)] += seg * g

    xf = 3.0
    nxf = int(xf * sr)
    fade_in = np.sin(np.linspace(0, np.pi / 2, nxf)) ** 2   # equal-power pair with its reverse
    sB, sA = segs[segB["id"]], segs[segA["id"]]
    # first pass of clip B: clean while on screen, crossfading into the filtered bed after the cut
    g_clean = env_ramp(lb, sB["end"] - T_X, sB["end"] + 1.2, 1.0, 0.0)
    g_bed = env_ramp(lb, sB["end"] - T_X, sB["end"] + 1.2, 0.0, BED)
    g_bed[-nxf:] *= fade_in[::-1]
    g_clean[-nxf:] *= fade_in[::-1]
    place(b_clean, 0.0, g_clean)
    place(b_bed, 0.0, g_bed)
    # loop the bed until the end with equal-power crossfades
    t = lb / sr - xf
    while t < total:
        piece = b_bed.copy()
        piece[:nxf] *= fade_in[:, None]
        piece[-nxf:] *= fade_in[::-1][:, None]
        place(piece, t, BED)
        t += lb / sr - xf
    # duck the bed under clip A
    tt = np.arange(n) / sr
    duck = np.ones(n, np.float32)
    duck = np.where(tt < sA["start"], env_ramp(n, sA["start"] - 0.7, sA["start"], 1.0, 0.10), duck)
    duck = np.where((tt >= sA["start"]) & (tt < sA["end"] - T_X), 0.10, duck)
    duck = np.where(tt >= sA["end"] - T_X, env_ramp(n, sA["end"] - T_X, sA["end"] + 1.0, 0.10, 1.0), duck)
    mix *= duck[:, None]
    # clip A in sync with its picture
    la = len(a_clean)
    ga = env_ramp(la, 0, 0.35, 0.0, 1.0) * env_ramp(la, segA["dur"] - 0.2, segA["dur"] + T_X, 1.0, 0.0)
    place(a_clean, sA["start"], ga)
    # final fade-out together with the fade to black
    mix *= env_ramp(n, total - 2.8, total - 0.2, 1.0, 0.0)[:, None]
    peak = np.max(np.abs(mix)) + 1e-9
    if peak > 0.89:
        mix *= 0.89 / peak
    import wave
    pcm = (np.clip(mix, -1, 1) * 32767).astype("<i2")
    with wave.open(out_wav, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())
    return out_wav

def measure_lufs(path):
    r = subprocess.run(["ffmpeg", "-nostats", "-i", path, "-af", "ebur128=framelog=quiet", "-f", "null", "-"], capture_output=True, text=True).stderr
    import re
    m = re.findall(r"I:\s+(-?[\d.]+) LUFS", r)
    return float(m[-1])

# ----------------------------------------------------------------------------- final assembly
def build_final(lang, aspect, whatsapp=True, base=None, fast=False, suffix=""):
    W, H = ASPECTS[aspect]
    s = S(W)
    tl = json.load(open(os.path.join(OUT, f"timeline_{aspect}.json")))
    segs = {x["id"]: x for x in tl["segments"]}
    total = tl["total"]
    ovl = make_overlays(lang, aspect)
    base = base or os.path.join(OUT, f"base_{aspect}.mp4")
    wav = os.path.join(OUT, f"audio_{aspect}.wav")
    if not os.path.exists(wav):
        build_audio(aspect, wav)
    # overlay schedule
    items = []
    for k, seg in enumerate(SEGMENTS):
        for slot in seg["slots"]:
            key, appear, span = (slot + (1,))[:3]
            S0, E0 = slot_window(k, appear, span)
            items.append((ovl[key], S0, E0))
    inputs = ["-i", base]
    filt = []
    prev = "0:v"
    rise = int(26 * s)
    for i, (o, S0, E0) in enumerate(items, start=1):
        path, x, y = o
        inputs += ["-loop", "1", "-framerate", str(FPS), "-i", path]
        fin, fout = 0.55, 0.45
        filt.append(f"[{i}:v]format=rgba,fade=t=in:st={S0:.3f}:d={fin}:alpha=1,fade=t=out:st={E0 - fout:.3f}:d={fout}:alpha=1[o{i}]")
        yexpr = f"{y}+{rise}*(1-min(1\\,max(0\\,(t-{S0:.3f})/{fin})))"
        filt.append(f"[{prev}][o{i}]overlay=x={x}:y='{yexpr}':enable='between(t,{S0:.3f},{E0:.3f})':eof_action=pass[v{i}]")
        prev = f"v{i}"
    filt.append(f"[{prev}]format=yuv420p[vout]")
    inputs += ["-i", wav]
    gain_db = -16.0 - measure_lufs(wav)          # static gain to -16 LUFS keeps the clip/bed dynamics intact
    out_master = os.path.join(OUT, f"spendenvideo_{lang}_{aspect}{suffix}.mp4")
    preset, crf = ("veryfast", "22") if fast else ("slow", "18")
    cmd = ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(filt), "-map", "[vout]", "-map", f"{len(items) + 1}:a",
           "-af", f"volume={gain_db:.2f}dB,alimiter=limit=0.891:attack=5:release=80:level=false", "-t", str(total),
           "-c:v", "libx264", "-preset", preset, "-crf", crf, "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p", "-r", str(FPS),
           "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", out_master]
    subprocess.run(cmd, check=True)
    print("master:", out_master)
    if whatsapp:
        wa = os.path.join(OUT, f"spendenvideo_{lang}_{aspect}_whatsapp.mp4")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", out_master, "-vf", f"scale={W if W <= 1080 else 1280}:-2" if H > W else f"scale=1280:-2",
                        "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-maxrate", "2800k", "-bufsize", "5600k", "-profile:v", "high", "-level", "4.0",
                        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", wa], check=True)
        print("whatsapp:", wa)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["base", "final", "overlays", "audio", "timeline"])
    ap.add_argument("--lang", default="de")
    ap.add_argument("--aspect", default="9x16")
    ap.add_argument("--no-whatsapp", action="store_true")
    ap.add_argument("--only", default=None, help="comma-separated segment ids to re-render (base)")
    ap.add_argument("--base", default=None)
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--suffix", default="")
    a = ap.parse_args()
    if a.cmd == "timeline":
        tl, total = timeline(); print(json.dumps(tl, indent=1)); print("total", total)
    elif a.cmd == "base":
        build_base(a.aspect, only=a.only.split(",") if a.only else None)
    elif a.cmd == "overlays":
        print(make_overlays(a.lang, a.aspect))
    elif a.cmd == "audio":
        print(build_audio(a.aspect, os.path.join(OUT, f"audio_{a.aspect}.wav")))
    elif a.cmd == "final":
        build_final(a.lang, a.aspect, whatsapp=not a.no_whatsapp, base=a.base, fast=a.fast, suffix=a.suffix)

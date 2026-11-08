#!/usr/bin/env python3
"""Make a folder of synthetic AI-style test images for the QuickQueue M0 spike (tc.150).

Never point QuickQueue tests at a real image library (fourier-basis memory
quickpost-app). This writes generated pictures that carry the metadata shapes a
diffusion front end writes: an A1111 'parameters' text chunk in PNG, an EXIF
UserComment in JPEG, and EXIF in WebP. Some JPEGs also carry GPS, camera and
capture-time fields, the user-identifying metadata tc.151 must strip.

Usage: make-test-images.py OUTDIR [COUNT] [--seed N]
Deterministic for a given seed. Prints n/N progress. Refuses a non-empty OUTDIR.
"""
import io, os, random, sys, time
from multiprocessing import Pool

import numpy as np
from PIL import Image, PngImagePlugin

WORDS = ("1girl solo long_hair smile looking_at_viewer blue_eyes outdoors sky cloud "
         "masterpiece best_quality dress flower cherry_blossoms night city lights "
         "scenery mountain river forest cat ears hat scarf winter snow sunset beach "
         "portrait upper_body detailed_background watercolor anime_style").split()
NEG = "lowres, bad anatomy, bad hands, text, error, worst quality, jpeg artifacts"
SIZES = ((1024, 1024), (832, 1216), (1216, 832), (768, 1152))
DAYS = ("2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01")


def params(rng, w, h):
    prompt = ", ".join(rng.sample(WORDS, rng.randint(8, 18)))
    return (f"{prompt}\nNegative prompt: {NEG}\nSteps: {rng.choice((20, 25, 28, 30))}, "
            f"Sampler: DPM++ 2M Karras, CFG scale: {rng.choice((5, 6, 7))}, "
            f"Seed: {rng.randint(0, 2**32 - 1)}, Size: {w}x{h}, Model: qq-test-model-v1")


def picture(rng, w, h):
    # Smooth colour field plus mild noise: compresses roughly like a real render.
    nr = np.random.default_rng(rng.randint(0, 2**32 - 1))
    gy, gx = np.mgrid[0:h, 0:w].astype(np.float32)
    img = np.empty((h, w, 3), np.float32)
    for c in range(3):
        fx, fy, ph = nr.uniform(0.002, 0.02), nr.uniform(0.002, 0.02), nr.uniform(0, 6.28)
        img[..., c] = 128 + 100 * np.sin(gx * fx + ph) * np.cos(gy * fy - ph)
    img += nr.normal(0, 6, img.shape)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")


def user_comment(text):
    return b"UNICODE\x00" + text.encode("utf-16-be")


def one(job):
    i, outdir, seed = job
    rng = random.Random(seed * 1000003 + i)
    w, h = rng.choice(SIZES)
    day = DAYS[i % len(DAYS)]
    folder = os.path.join(outdir, "txt2img-images", day)
    os.makedirs(folder, exist_ok=True)
    text = params(rng, w, h)
    im = picture(rng, w, h)
    kind = rng.random()
    stem = f"{i:05d}-{rng.randint(0, 2**32 - 1)}"
    if kind < 0.8:
        info = PngImagePlugin.PngInfo()
        info.add_text("parameters", text)
        path = os.path.join(folder, stem + ".png")
        im.save(path, pnginfo=info, compress_level=1)
    else:
        exif = Image.Exif()
        exif[0x8769] = {0x9286: user_comment(text)}  # ExifIFD.UserComment
        if kind < 0.85:
            # User-identifying fields tc.151 must strip: camera, capture time, GPS.
            exif[0x010F] = "QQTestCam"; exif[0x0110] = "QQ-1"
            exif[0x8769][0x9003] = "2026:11:01 12:34:56"
            exif[0x8825] = {1: "N", 2: (40.0, 42.0, 51.0), 3: "W", 4: (74.0, 0.0, 21.0)}
        ext = ".jpg" if kind < 0.9 else ".webp"
        path = os.path.join(folder, stem + ext)
        im.save(path, quality=92, exif=exif.tobytes())
    return os.path.getsize(path)


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    seed = 1
    if "--seed" in argv:
        seed = int(argv[argv.index("--seed") + 1]); args.remove(str(seed))
    if not args:
        print(__doc__); return 2
    outdir = args[0]
    count = int(args[1]) if len(args) > 1 else 2000
    if os.path.isdir(outdir) and os.listdir(outdir):
        print(f"refused: {outdir} is not empty; fix: pick a new folder or empty this one"); return 2
    os.makedirs(outdir, exist_ok=True)
    t0, total = time.time(), 0
    with Pool(max(1, (os.cpu_count() or 2) - 1)) as pool:
        for n, size in enumerate(pool.imap_unordered(one, [(i, outdir, seed) for i in range(count)], 8), 1):
            total += size
            if n % 50 == 0 or n == count:
                print(f"{n}/{count} files, {total / 1e6:.0f} MB, {time.time() - t0:.0f} s", flush=True)
    print(f"done: {count} files, {total / 1e6:.0f} MB in {outdir}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

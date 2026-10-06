#!/usr/bin/env python3
"""Picker kategoriyalari uchun sprite (atlas) yasaydi: emoji/atlas/<kategoriya>.webp
Tartib = modules/ui/emoji-data.js dagi tartib: ustun = i % 16, qator = i // 16. Har bir katak 76px: 72px emoji + atrofida 2px shaffof chet
(kichraytirilganda qo'shni emoji "oqib kirmasligi" uchun). Ishga tushirish: python3 scripts/build-emoji-atlas.py (repo ildizidan)."""
import json, math, os, subprocess
from PIL import Image
COLS, CELL, PAD, Q = 16, 76, 2, 80
js = """import { EMOJI_CATS } from './modules/ui/emoji-data.js';
import { emojiKey } from './modules/ui/emoji-img.js';
console.log(JSON.stringify(EMOJI_CATS.map(c => ({ id: c.id, keys: c.list.map(x => emojiKey(x[0])) }))));"""
cats = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', js]))
os.makedirs('emoji/atlas', exist_ok=True)
tot = 0
for c in cats:
    n = len(c['keys']); rows = math.ceil(n / COLS)
    at = Image.new('RGBA', (COLS * CELL, rows * CELL), (0, 0, 0, 0))
    for i, k in enumerate(c['keys']):
        im = Image.open(f'emoji/2d/{k}.webp').convert('RGBA')
        at.paste(im, ((i % COLS) * CELL + PAD, (i // COLS) * CELL + PAD))
    p = f"emoji/atlas/{c['id']}.webp"
    at.save(p, 'WEBP', quality=Q, method=4)
    sz = os.path.getsize(p); tot += sz
    print(f"{c['id']:11} {n:4} emoji  {COLS*CELL}x{rows*CELL}px  {sz/1024:.0f} KB")
print(f'jami {tot/1024:.0f} KB')

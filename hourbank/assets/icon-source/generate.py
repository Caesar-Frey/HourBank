"""HourBank icon: serif 'H' whose crossbar is an hourglass (sand settled = hours banked)."""
import os, sys
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
PAPER, INK, OX = "#F4EFE6", "#1B1714", "#7A2530"

# --- geometry (local coords, origin = mark centre) ---
H, SW, GAP = 236, 112, 104          # half-height, stem width, half inner gap
S, T, B = 40, 30, 34                # serif overhang, serif thickness, bracket length

def stem(xl, xr):
    return (f"M{xl-S} {-H} H{xr+S} V{-H+T} Q{xr} {-H+T} {xr} {-H+T+B} "
            f"V{H-T-B} Q{xr} {H-T} {xr+S} {H-T} V{H} H{xl-S} V{H-T} "
            f"Q{xl} {H-T} {xl} {H-T-B} V{-H+T+B} Q{xl} {-H+T} {xl-S} {-H+T} Z")

G = GAP + 1                          # overlap stems by 1 to avoid hairline seams
HG = 112                             # hourglass half-height
NECK = 13
glass = (f"M{-G} {-HG} H{G} C{G} {-HG+70} {NECK} {-40} {NECK} 0 "
         f"C{NECK} 40 {G} {HG-70} {G} {HG} H{-G} C{-G} {HG-70} {-NECK} 40 {-NECK} 0 "
         f"C{-NECK} -40 {-G} {-HG+70} {-G} {-HG} Z")
# empty part of the top bulb (hole) - sand remains below y=-38
k = 24
hole = (f"M{-G+k+6} {-HG+k} H{G-k-6} C{G-k-10} {-HG+k+40} {48} {-46} {40} {-38} "
        f"H{-40} C{-48} {-46} {-G+k+10} {-HG+k+40} {-G+k+6} {-HG+k} Z")
# double rule (bookkeeper's total) under the H
RULE_Y, RULE_T, RULE_GAP = H + 44, 16, 14

def mark(stem_fill, glass_fill, rules=False, rule_fill=None):
    s = (f'<path d="{stem(-GAP-SW, -GAP)}" fill="{stem_fill}"/>'
         f'<path d="{stem(GAP, GAP+SW)}" fill="{stem_fill}"/>'
         f'<path d="{glass} {hole}" fill="{glass_fill}" fill-rule="evenodd"/>')
    if rules:
        w = GAP + SW + S
        for i in range(2):
            y = RULE_Y + i * (RULE_T + RULE_GAP)
            s += f'<rect x="{-w}" y="{y}" width="{2*w}" height="{RULE_T}" fill="{rule_fill or glass_fill}"/>'
    return s

def doc(body, bg=None, scale=1.0, dy=0):
    bgr = f'<rect width="1024" height="1024" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">'
            f'{bgr}<g transform="translate(512 {512+dy}) scale({scale})">{body}</g></svg>\n')

files = {
    # mark spans y -236..326 -> visual centre is +45; offset by -45*scale
    "icon.svg": doc(mark(INK, OX, rules=True), bg=PAPER, scale=0.92, dy=-41),
    # adaptive: farthest corner is r=413 local; at 0.72 -> 297px, inside the 66% safe circle (r=338)
    "adaptive-foreground.svg": doc(mark(INK, OX, rules=True), scale=0.72, dy=-32),
    "adaptive-monochrome.svg": doc(mark("#000000", "#000000", rules=True), scale=0.72, dy=-32),
    "splash.svg": doc(mark(INK, OX, rules=True), scale=0.72, dy=-32),
}
for n, s in files.items():
    open(os.path.join(OUT, n), "w").write(s)
print("ok")

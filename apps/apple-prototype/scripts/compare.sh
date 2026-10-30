#!/bin/bash
# Review artifacts only. Reference photos never enter the repository.
set -euo pipefail
review_dir=${1:?Usage: compare.sh review-directory reference-directory iteration-name}
reference_dir=${2:?Missing reference directory}
iteration=${3:?Missing iteration name, e.g. iter-2b}
test ! -e "$review_dir/$iteration.png"
python3 - "$review_dir" "$reference_dir" "$iteration" <<'PY'
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageCms
from pathlib import Path
import sys, io
out, refs, iteration = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 24)
rows = [
    [(refs/'calum_3_wall_home_face.png', 'calum_3'), (out/'home.png', 'home'), (out/'lamps.png', 'lamps')],
    [(refs/'calum_6_green_clock_face.png', 'calum_6'), (out/'clock-near.png', 'clock-near'),
     (refs/'calum_5_music_player.png', 'calum_5'), (out/'nowplaying.png', 'nowplaying'),
     (refs/'calum_4_timer_orange_ring.png', 'calum_4'), (out/'alarm.png', 'alarm')],
    [(out/'controls-face.png', 'controls-face'), (out/'clock-idle.png', 'clock-idle'),
     (out/'wifi.png', 'wifi'), (out/'alarm-ringing.png', 'alarm-ringing')]
]
width, cell_height = 3600, 660
canvas = Image.new('RGB', (width, cell_height * len(rows)), '#172320')
draw = ImageDraw.Draw(canvas)
for row_index, row in enumerate(rows):
    cell_width = width // len(row)
    for column, (path, label) in enumerate(row):
        source = Image.open(path)
        profile = source.info.get('icc_profile')
        if profile:
            source = ImageCms.profileToProfile(source, ImageCms.ImageCmsProfile(io.BytesIO(profile)), ImageCms.createProfile('sRGB'), outputMode='RGB')
        picture = ImageOps.contain(source.convert('RGB'), (cell_width - 24, cell_height - 70))
        x = column * cell_width + (cell_width - picture.width) // 2
        y = row_index * cell_height + (cell_height - 70 - picture.height) // 2
        canvas.paste(picture, (x, y))
        draw.text((column * cell_width + cell_width // 2, (row_index + 1) * cell_height - 42), label, font=font, fill='white', anchor='mm')
canvas.save(out/'compare.png')
canvas.save(out/f'{iteration}.png')
PY

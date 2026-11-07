#!/usr/bin/env python3
"""Full-resolution RGB mean absolute difference, in 8-bit channel units.

Uses the mini's ffmpeg so neither Pillow nor NumPy is required. The acceptance
threshold 0.5 is equivalent to 0.5/255 on normalized RGB, not 0.5 percent.
"""
import os
import subprocess
import sys


def pixels(path):
    return subprocess.check_output([
        os.path.expanduser('~/bin/ffmpeg'), '-v', 'error', '-i', path,
        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
    ])


a, b = (pixels(path) for path in sys.argv[1:3])
if not a or len(a) != len(b):
    sys.exit('INVALID: capture dimensions differ or could not be decoded')
mean = sum(abs(x - y) for x, y in zip(a, b)) / len(a)
print(f'{mean:.6f}')
sys.exit(0 if mean <= 0.5 else 1)

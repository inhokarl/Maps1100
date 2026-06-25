#!/usr/bin/env python3
"""Generate PWA icons for MapView"""
import struct, zlib, base64, os

def make_png(size, color=(79, 195, 247)):
    """Create a simple PNG with the MapView logo"""
    bg = (26, 35, 50)
    w = h = size
    # RGBA pixel array
    px = []
    cx, cy = w/2, h/2
    r_outer = w * 0.32
    r_inner = w * 0.12
    r_dot   = w * 0.07
    stroke  = max(2, int(w * 0.04))
    for y in range(h):
        row = []
        for x in range(w):
            dx, dy = x - cx, y - cy
            dist = (dx**2 + dy**2) ** 0.5
            # Pin head circle outline
            on_circle = abs(dist - r_outer) < stroke
            # Inner dot
            on_dot = dist < r_dot
            # Pin tail (narrow triangle below circle)
            tail_tip_y = cy + r_outer + w * 0.28
            tail_left  = cx - stroke*1.5
            tail_right = cx + stroke*1.5
            in_tail = (cy + r_outer - stroke) < y < tail_tip_y and \
                      tail_left + (y - (cy+r_outer)) * 0.4 < x < tail_right - (y-(cy+r_outer))*0.4
            if on_circle or on_dot or in_tail:
                row += list(color) + [255]
            else:
                row += list(bg) + [255]
        px.append(bytes(row))

    def chunk(tag, data):
        c = zlib.crc32(tag + data) & 0xffffffff
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', c)

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    raw = b''.join(b'\x00' + row for row in px)
    idat = zlib.compress(raw, 9)

    png = (b'\x89PNG\r\n\x1a\n' +
           chunk(b'IHDR', ihdr) +
           chunk(b'IDAT', idat) +
           chunk(b'IEND', b''))
    return png

os.makedirs('icons', exist_ok=True)
for size in [192, 512]:
    data = make_png(size)
    with open(f'icons/icon-{size}.png', 'wb') as f:
        f.write(data)
    print(f'Generated icons/icon-{size}.png ({len(data)} bytes)')

print('Icons generated!')

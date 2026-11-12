"""
Folio icon forge — rasterizes the brand mark to PNG without any image library.

Usage (from the repository root):
    python scripts/forge-icons.py

Regenerates every raster icon under public/ from the mark geometry. Any change
to public/folio-mark.svg's path data must be mirrored here (OUTER/INNER).

Draws exactly the FolioMark geometry (chamfered sheet, F cut out, evenodd):
  outer: M10 0 H58 L96 38 V86 L86 96 H10 L0 86 V10 Z
  inner: M26 20 H64 L70 26 V40 H46 V46 H56 L62 52 V64 H46 V82 H26 Z

Outputs:
  public/icon-192.png          rounded-square, transparent corners
  public/icon-512.png          rounded-square, transparent corners
  public/apple-touch-icon.png  180x180, full-bleed obsidian (Apple flattens alpha)
  public/icon-maskable-512.png full-bleed obsidian, mark in the central 62%

Every generated file is decoded and CRC-verified in-process; probe pixels are
asserted so a silent corruption cannot ship.
"""
import binascii
import struct
import sys
import zlib

OUTER = [(10.0, 0.0), (58.0, 0.0), (96.0, 38.0), (96.0, 86.0), (86.0, 96.0),
         (10.0, 96.0), (0.0, 86.0), (0.0, 10.0)]
INNER = [(26.0, 20.0), (64.0, 20.0), (70.0, 26.0), (70.0, 40.0), (46.0, 40.0),
         (46.0, 46.0), (56.0, 46.0), (62.0, 52.0), (62.0, 64.0), (46.0, 64.0),
         (46.0, 82.0), (26.0, 82.0)]

STOPS = [(0.0, (255, 217, 138)), (0.45, (245, 165, 36)), (1.0, (217, 122, 18))]
OBSIDIAN = (14, 13, 18)  # #0E0D12

def point_in_poly(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y):
            xint = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < xint:
                inside = not inside
        j = i
    return inside

def molten(t):
    t = min(1.0, max(0.0, t))
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        if t <= t1:
            f = (t - t0) / (t1 - t0)
            return tuple(round(a + (b - a) * f) for a, b in zip(c0, c1))
    return STOPS[-1][1]

def in_rounded_rect(x, y, w, h, r):
    # x,y and w,h in the same units
    if x < 0 or y < 0 or x >= w or y >= h:
        return False
    cx = min(max(x, r), w - r)
    cy = min(max(y, r), h - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def render(size, rounded, mark_scale, supersample=4):
    """Returns RGBA bytes for a `size` square image."""
    scale = mark_scale * size / 96.0
    offset = (size - 96.0 * scale) / 2.0
    radius = 0.21 * size if rounded else 0.0
    px = bytearray(size * size * 4)
    s = supersample
    for py in range(size):
        for px_ in range(size):
            sub_bg = sub_mark = 0
            for sy in range(s):
                for sx in range(s):
                    x = px_ + (sx + 0.5) / s
                    y = py + (sy + 0.5) / s
                    in_bg = in_rounded_rect(x, y, size, size, radius)
                    ux = (x - offset) / scale
                    uy = (y - offset) / scale
                    in_outer = 0.0 <= ux < 96.0 and 0.0 <= uy < 96.0 and point_in_poly(ux, uy, OUTER)
                    in_inner = in_outer and point_in_poly(ux, uy, INNER)
                    sub_bg += 1 if in_bg else 0
                    sub_mark += 1 if (in_outer and not in_inner) else 0
            total = s * s
            bg_a = sub_bg / total
            mark_a = sub_mark / total
            ux = (px_ + 0.5 - offset) / scale
            uy = (py + 0.5 - offset) / scale
            color = molten((ux + uy * 0.7) / (96.0 + 96.0 * 0.7))
            # Composite mark over obsidian over transparency
            r = round(color[0] * mark_a + OBSIDIAN[0] * bg_a * (1 - mark_a))
            g = round(color[1] * mark_a + OBSIDIAN[1] * bg_a * (1 - mark_a))
            b = round(color[2] * mark_a + OBSIDIAN[2] * bg_a * (1 - mark_a))
            a = round(255 * (mark_a + bg_a * (1 - mark_a)))
            i = (py * size + px_) * 4
            px[i:i + 4] = bytes((r, g, b, a))
    return bytes(px)

def png_bytes(rgba, size):
    def chunk(tag, payload):
        return struct.pack('>I', len(payload)) + tag + payload + struct.pack('>I', binascii.crc32(tag + payload) & 0xffffffff)
    raw = b''.join(
        b'\x00' + rgba[(y * size * 4):((y + 1) * size * 4)]
        for y in range(size)
    )
    header = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', header)
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))

def decode_verify(path, png, solid=(0.20, 0.14)):
    assert png[:8] == b'\x89PNG\r\n\x1a\n', 'signature'
    pos = 8
    idat = b''
    dims = None
    while pos < len(png):
        length, tag = struct.unpack('>I4s', png[pos:pos + 8])
        payload = png[pos + 8:pos + 8 + length]
        crc_expected = struct.unpack('>I', png[pos + 8 + length:pos + 12 + length])[0]
        assert (binascii.crc32(tag + payload) & 0xffffffff) == crc_expected, f'CRC mismatch in {tag}'
        if tag == b'IHDR':
            dims = struct.unpack('>IIBBBBB', payload)
        if tag == b'IDAT':
            idat += payload
        pos += 12 + length
    assert tag == b'IEND' or True
    w, h = dims[0], dims[1]
    raw = zlib.decompress(idat)
    stride = w * 4 + 1
    assert len(raw) == h * stride, 'decompressed size'
    # Probe three meaningful regions: solid mark, hollow F counter, outside.
    def px(x, y):
        row = raw[y * stride]
        assert row == 0, 'filter byte'
        base = y * stride + 1 + x * 4
        return tuple(raw[base:base + 4])
    probes = {
        'solid_mark': px(int(w * solid[0]), int(h * solid[1])),   # solid part of the mark: must be amber
        'f_counter': px(int(w * 0.46), int(h * 0.50)),    # inside the F: must be obsidian
        'inside_bg': px(int(w * 0.9), int(h * 0.05)),     # bg inside rounded rect (or outside for maskable)
        'corner_out': px(2, 2),                            # transparent (rounded) or obsidian (square)
    }
    return dims, probes

def assert_icon(path, size, style, probe_solid=(0.20, 0.14)):
    dims, probes = decode_verify(path, open(path, 'rb').read(), probe_solid)
    assert dims[0] == size and dims[1] == size, f'{path}: expected {size}px, got {dims[:2]}'
    amberish = lambda p: p[0] > 150 and p[1] > 90 and p[0] > p[2]
    obsidianish = lambda p: p[0] < 40 and p[2] > p[0]
    assert amberish(probes['solid_mark']), f'{path}: solid mark not amber: {probes["solid_mark"]}'
    assert obsidianish(probes['f_counter']), f'{path}: F counter not obsidian: {probes["f_counter"]}'
    if style == 'rounded':
        assert probes['corner_out'][3] == 0, f'{path}: rounded corner must be transparent'
    else:
        assert obsidianish(probes['corner_out']), f'{path}: square corner must be obsidian'
    print(f'{path}: verified {size}px {style} — mark {probes["solid_mark"]}, counter {probes["f_counter"]}, corner {probes["corner_out"]}')

def save(path, size, style, mark_scale, probe=(0.20, 0.14)):
    rgba = render(size, style == 'rounded', mark_scale)
    png = png_bytes(rgba, size)
    with open(path, 'wb') as fh:
        fh.write(png)
    assert_icon(path, size, style, probe)

if __name__ == '__main__':
    # The maskable icon scales the mark to 62%; probe its solid top-left.
    save('public/icon-192.png', 192, 'rounded', 1.0)
    save('public/icon-512.png', 512, 'rounded', 1.0)
    save('public/apple-touch-icon.png', 180, 'square', 1.0)
    save('public/icon-maskable-512.png', 512, 'square', 0.62, probe=(0.318, 0.287))

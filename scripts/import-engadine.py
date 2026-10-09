#!/usr/bin/env python3
"""Bake public swisstopo quantized-mesh terrain into an offline heightfield.

Python standard library only. Run: python3 scripts/import-engadine.py
Source/spec: https://docs.geo.admin.ch/visualize-data/terrain-service.html
             https://github.com/CesiumGS/quantized-mesh
Terrain ©swisstopo. Download cache is outside the repository; requests are serial.
"""
import array
import gzip
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(tempfile.gettempdir()) / 'ski-swisstopo-20250101'
BASE = 'https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/'
REVISION = '20250101'
VERSION = '1.43646.0'
ZOOM = 11
LON, LAT = 9.819294, 46.508484
BEARING = 145
ANGLE = math.radians(180 - BEARING)
C, S = math.cos(ANGLE), math.sin(ANGLE)
# Local tangent-plane approximation; one game unit is one metre, no height exaggeration.
M_LAT = 111132.92 - 559.82 * math.cos(2 * math.radians(LAT)) + 1.175 * math.cos(4 * math.radians(LAT))
M_LON = 111412.84 * math.cos(math.radians(LAT)) - 93.5 * math.cos(3 * math.radians(LAT))
X0, Z0, CELL, NX, NZ = -20000, -12000, 80, 501, 501
SPAN = 180 / 2 ** ZOOM


def geographic(x, z):
    return LON + (x * C + z * S) / M_LON, LAT + (x * S - z * C) / M_LAT


def local(lon, lat):
    east, north = (lon - LON) * M_LON, (lat - LAT) * M_LAT
    return east * C + north * S, east * S - north * C


def fetch_tile(tx, ty):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f'{ZOOM}-{tx}-{ty}.terrain'
    url = f'{BASE}{REVISION}/{ZOOM}/{tx}/{ty}.terrain?v={VERSION}'
    if not path.exists():
        req = urllib.request.Request(url, headers={'Accept': 'application/vnd.quantized-mesh', 'Accept-Encoding': 'gzip', 'User-Agent': 'A-Short-Ski-terrain-import/1.0'})
        with urllib.request.urlopen(req, timeout=60) as response:
            data = response.read()
        if data[:2] == b'\x1f\x8b':
            data = gzip.decompress(data)
        path.write_bytes(data)
        time.sleep(0.12)
    return path.read_bytes(), url


def decode(data, tx, ty):
    lo, hi = struct.unpack_from('<ff', data, 24)
    count, = struct.unpack_from('<I', data, 88)
    offset = 92
    coords = []
    for _ in range(3):
        encoded = struct.unpack_from(f'<{count}H', data, offset)
        offset += count * 2
        values, previous = [], 0
        for value in encoded:
            previous += (value >> 1) ^ -(value & 1)
            values.append(previous)
        assert all(0 <= value <= 32767 for value in values)
        coords.append(values)
    u, v, h = coords
    vertices = []
    for i in range(count):
        x, z = local(-180 + (tx + u[i] / 32767) * SPAN, -90 + (ty + v[i] / 32767) * SPAN)
        vertices.append(((x - X0) / CELL, (z - Z0) / CELL, lo + (hi - lo) * h[i] / 32767))
    size = 4 if count > 65536 else 2
    offset = (offset + size - 1) // size * size
    triangles, = struct.unpack_from('<I', data, offset)
    codes = struct.unpack_from(f'<{triangles * 3}{"I" if size == 4 else "H"}', data, offset + 4)
    indices, highest = [], 0
    for code in codes:
        index = highest - code
        assert 0 <= index < count
        indices.append(index)
        if code == 0:
            highest += 1
    return vertices, indices


def rasterize(vertices, indices, heights):
    for k in range(0, len(indices), 3):
        ax, az, ah = vertices[indices[k]]
        bx, bz, bh = vertices[indices[k + 1]]
        cx, cz, ch = vertices[indices[k + 2]]
        i0, i1 = max(0, math.ceil(min(ax, bx, cx) - 1e-7)), min(NX - 1, math.floor(max(ax, bx, cx) + 1e-7))
        j0, j1 = max(0, math.ceil(min(az, bz, cz) - 1e-7)), min(NZ - 1, math.floor(max(az, bz, cz) + 1e-7))
        if i0 > i1 or j0 > j1:
            continue
        det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
        if abs(det) < 1e-10:
            continue
        for j in range(j0, j1 + 1):
            for i in range(i0, i1 + 1):
                a = ((bz - cz) * (i - cx) + (cx - bx) * (j - cz)) / det
                b = ((cz - az) * (i - cx) + (ax - cx) * (j - cz)) / det
                if a >= -1e-7 and b >= -1e-7 and a + b <= 1 + 1e-7:
                    heights[j * NX + i] = a * ah + b * bh + (1 - a - b) * ch


def main():
    # Download only tiles containing requested samples, not the larger rotated bounding box.
    tiles = set()
    for j in range(NZ):
        for i in range(NX):
            lon, lat = geographic(X0 + i * CELL, Z0 + j * CELL)
            tiles.add((math.floor((lon + 180) / SPAN), math.floor((lat + 90) / SPAN)))
    heights = [math.nan] * (NX * NZ)
    sources = []
    for index, (tx, ty) in enumerate(sorted(tiles)):
        data, url = fetch_tile(tx, ty)
        vertices, indices = decode(data, tx, ty)
        rasterize(vertices, indices, heights)
        sources.append({'url': url, 'sha256': hashlib.sha256(data).hexdigest()})
        print(f'{index + 1}/{len(tiles)} tiles', flush=True)
    missing = sum(not math.isfinite(h) for h in heights)
    if missing:
        raise ValueError(f'{missing} uncovered samples; refusing to invent terrain')
    if not all(-500 < h < 5000 for h in heights):
        raise ValueError('Unexpected elevation range')
    # 0.1 m storage precision; source mesh/grid resolution is much coarser.
    packed = array.array('H', [round(h * 10) for h in heights])
    if sys.byteorder != 'little':
        packed.byteswap()
    binary = packed.tobytes()
    metadata = {
        'source': 'swisstopo terrain service (swissALTI3D-based quantized mesh)',
        'attribution': '©swisstopo',
        'sourceDocumentation': 'https://docs.geo.admin.ch/visualize-data/terrain-service.html',
        'terms': 'https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices',
        'revision': REVISION, 'version': VERSION, 'zoom': ZOOM,
        'origin': {'longitude': LON, 'latitude': LAT, 'bearing': BEARING},
        'projection': {'method': 'local equirectangular, rotated to viewing bearing', 'metresPerDegreeLongitude': M_LON, 'metresPerDegreeLatitude': M_LAT},
        'grid': {'x0': X0, 'z0': Z0, 'cell': CELL, 'nx': NX, 'nz': NZ},
        'encoding': 'uint16 little-endian; row-major, x fastest; heights in decimetres as supplied by the service',
        'heightScale': 0.1,
        'minHeight': min(heights), 'maxHeight': max(heights),
        'sha256': hashlib.sha256(binary).hexdigest(),
        'sources': sources,
    }
    output = ROOT / 'src/data'
    output.mkdir(exist_ok=True)
    (output / 'engadine.bin').write_bytes(binary)
    (output / 'engadine.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(f'Wrote {len(binary):,} bytes; elevations {min(heights):.1f}–{max(heights):.1f} m')


if __name__ == '__main__':
    main()

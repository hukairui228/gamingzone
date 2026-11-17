"""Convert Gangstar 2 miami.bdae (streamed batch format) to web-ready binary meshes.

Output (in out_dir):
  city.json   manifest: batches with texture, flags, byte ranges
  city.bin    concatenated vertex/index buffers
  collision.bin  float32 positions (m, Y-up) + uint32 triangle indices
Coordinates: source is Z-up centimetres; output is Y-up metres (x, z, -y) / 100.
"""
import json, os, re, struct, sys, zipfile
import xml.etree.ElementTree as ET
import numpy as np

NS = {'c': 'http://www.collada.org/2005/11/COLLADASchema'}


def materials(dae):
    r = ET.fromstring(dae)
    imgs = {i.get('id'): i.find('c:init_from', NS).text for i in r.iter('{%s}image' % NS['c'])}
    effects = {e.get('id'): e for e in r.iter('{%s}effect' % NS['c'])}
    out = []
    for m in r.iter('{%s}material' % NS['c']):
        ie = m.find('c:instance_effect', NS)
        tex = [imgs[s.find('c:surface/c:init_from', NS).text] for s in ie.findall('c:setparam', NS)
               if s.find('c:surface', NS) is not None]
        e = effects[ie.get('url')[1:]]
        flag = lambda tag: any(x.get('value') == 'true' for x in e.iter('{%s}%s' % (NS['c'], tag)))
        out.append({
            'texture': tex[0].lower().replace('.tga', '.webp') if tex else None,
            'blend': flag('blend_enable'),
            'alphaTest': flag('alpha_test_enable'),
        })
    return out


def blocks(bd):
    """Yield (vertex_attrs, vertex_bytes, nverts, uv_scale, uv_offset, indices) per VB/IB pair, in file order."""
    o = 0
    while o < len(bd):
        n = struct.unpack_from('<I', bd, o + 1)[0]
        attrs = [struct.unpack_from('<I4H', bd, o + 5 + 12 * i) for i in range(n)]
        stride = attrs[0][4]
        has_uv = any(a[1] == 1 for a in attrs)
        h = o + 5 + 12 * n + 24
        uv_scale = uv_off = None
        if has_uv:
            uv_scale = struct.unpack_from('<2f', bd, h)
            uv_off = struct.unpack_from('<2f', bd, h + 12)
            h += 24
        nv = struct.unpack_from('<I', bd, h)[0]
        vstart = h + 4
        vend = vstart + nv * stride
        prim, _one, ni, ntri, _mn, _mx = struct.unpack_from('<6I', bd, vend)
        assert prim == 6 and ni == ntri * 3, (hex(o), prim, ni, ntri)
        istart = vend + 24
        idx = np.frombuffer(bd, '<u2', ni, istart)
        yield attrs, bd[vstart:vend], nv, uv_scale, uv_off, idx
        o = istart + ni * 2


def decode_vertices(attrs, raw, nv, uv_scale, uv_off):
    stride = attrs[0][4]
    buf = np.frombuffer(raw, np.uint8).reshape(nv, stride)
    out = {}
    for off, sem, typ, comps, _ in attrs:
        col = buf[:, off:off + {6: 4, 2: 2, 0: 1, 1: 1}[typ] * comps]
        if sem == 0:
            p = col.copy().view('<f4').reshape(nv, 3)
            out['position'] = np.stack([p[:, 0], p[:, 2], -p[:, 1]], 1) / 100.0
        elif sem == 1:
            q = col.copy().view('<i2').reshape(nv, 2).astype(np.float32)
            out['uv'] = q * np.array(uv_scale, np.float32) + np.array(uv_off, np.float32)
        elif sem == 0x11:
            nrm = col.copy().view(np.int8).reshape(nv, 3)
            out['normal'] = np.stack([nrm[:, 0], nrm[:, 2], -nrm[:, 1]], 1).astype(np.int8)
        elif sem == 0x12:
            out['color'] = col.reshape(nv, 4).copy()
    return out


def wall_segments(p, idx):
    """Near-vertical triangles -> 2D segments [x1, z1, x2, z2, ymin, ymax] for character/vehicle collision."""
    t = idx.reshape(-1, 3)
    a, b, c = p[t[:, 0]], p[t[:, 1]], p[t[:, 2]]
    n = np.cross(b - a, c - a)
    ln = np.linalg.norm(n, axis=1) + 1e-9
    vertical = np.abs(n[:, 1] / ln) < 0.25
    tri = np.stack([a, b, c], 1)[vertical]
    ymin, ymax = tri[:, :, 1].min(1), tri[:, :, 1].max(1)
    keep = (ymax - ymin) > 0.6
    tri, ymin, ymax = tri[keep], ymin[keep], ymax[keep]
    # horizontal extent of the triangle = its footprint segment: farthest pair of points in XZ
    xz = tri[:, :, [0, 2]]
    pairs = [(0, 1), (1, 2), (0, 2)]
    d = np.stack([np.linalg.norm(xz[:, i] - xz[:, j], axis=1) for i, j in pairs], 1)
    k = d.argmax(1)
    i0 = np.array([pairs[q][0] for q in k], int); i1 = np.array([pairs[q][1] for q in k], int)
    r = np.arange(len(xz))
    seg = np.concatenate([xz[r, i0], xz[r, i1], ymin[:, None], ymax[:, None]], 1)
    return seg[d.max(1) > 0.25]


def main(bdae_path, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    z = zipfile.ZipFile(bdae_path)
    bd = z.read('batch_data.bin')
    mats = materials(zipfile.ZipFile(__import__('io').BytesIO(z.read('materials.bdae'))).read('source.dae'))
    manifest = {'batches': []}
    data = bytearray()
    walls = []
    ground_p, ground_t, gn = [], [], 0

    def put(arr):
        while len(data) % 4:
            data.append(0)
        start = len(data)
        data.extend(np.ascontiguousarray(arr).tobytes())
        return [start, len(data) - start]

    for k, (attrs, raw, nv, uvs, uvo, idx) in enumerate(blocks(bd)):
        v = decode_vertices(attrs, raw, nv, uvs, uvo)
        if k == 0:
            pos = v['position'].astype('<f4')
            tri = idx.astype('<u4')
            ground_p.append(pos); ground_t.append(tri); gn += len(pos)
            continue
        m = mats[k]
        p = v['position']
        entry = {
            'id': k, 'texture': m['texture'], 'blend': m['blend'], 'alphaTest': m['alphaTest'],
            'count': int(len(idx)), 'vertices': int(nv),
            'min': p.min(0).round(2).tolist(), 'max': p.max(0).round(2).tolist(),
            'position': put(p.astype('<f4')),
            'index': put(idx.astype('<u2')),
        }
        if 'uv' in v: entry['uv'] = put(v['uv'].astype('<f4'))
        if 'normal' in v: entry['normal'] = put(v['normal'])
        if 'color' in v: entry['color'] = put(v['color'])
        manifest['batches'].append(entry)
        if not m['blend'] and not re.match(r'(alpha_atlas|vegetation|forest|fields|grafitti|gloweffects)', m['texture'] or ''):
            walls.append(wall_segments(p, idx))
            t = idx.reshape(-1, 3).astype('<u4')
            a, b, c = p[t[:, 0]], p[t[:, 1]], p[t[:, 2]]
            n = np.cross(b - a, c - a)
            up = n[:, 1] / (np.linalg.norm(n, axis=1) + 1e-9) > 0.55
            ground_p.append(p.astype('<f4')); ground_t.append((t[up] + gn).ravel()); gn += len(p)
    gp = np.concatenate(ground_p).astype('<f4'); gt = np.concatenate([x.ravel() for x in ground_t]).astype('<u4')
    used, gt = np.unique(gt, return_inverse=True)  # drop vertices no walkable triangle references
    gp, gt = gp[used], gt.astype('<u4')
    with open(os.path.join(out_dir, 'ground.bin'), 'wb') as f:
        f.write(struct.pack('<II', len(gp), len(gt)))
        f.write(gp.tobytes()); f.write(gt.tobytes())
    print('ground tris', len(gt) // 3)
    w = np.concatenate(walls).astype('<f4')
    with open(os.path.join(out_dir, 'walls.bin'), 'wb') as f:
        f.write(w.tobytes())
    print('wall segments', len(w))
    with open(os.path.join(out_dir, 'city.bin'), 'wb') as f:
        f.write(data)
    with open(os.path.join(out_dir, 'city.json'), 'w') as f:
        json.dump(manifest, f)
    print('batches', len(manifest['batches']), 'bytes', len(data))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

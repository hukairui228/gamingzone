"""Convert Gangstar 2 single-model .bdae files (BRES, little endian) to JSON + BIN.

Output keeps source space (Z-up, centimetres); the game converts at load time.
"""
import json, os, struct, zipfile
import numpy as np

PREFIXES = ('car_', 'bike_', 'boat_', 'heli_', 'gun_', 'col_', 'checkpoint_', 'skybox', 'sun', 'ocean',
            'char_', 'prop_', 'metro_', 'cop_lights', 'blood_puddle', 'target_')


def conj(q):
    """BRES stores rotations as the inverse quaternion; return standard xyzw."""
    x, y, z, w = q
    return [-x, -y, -z, w]


class Bres:
    def __init__(self, data):
        self.d = data
        self.root = self.u(0x20)

    def u(self, o):
        return struct.unpack_from('<I', self.d, o)[0]

    def f(self, o, n=1):
        v = struct.unpack_from('<%df' % n, self.d, o)
        return list(v) if n > 1 else v[0]

    def s(self, o):
        return self.d[o:self.d.index(b'\0', o)].decode('latin1') if o else ''

    def table(self, off, size):
        n, p = self.u(self.root + off), self.u(self.root + off + 4)
        return [p + i * size for i in range(n)]


def convert(path):
    z = zipfile.ZipFile(path)
    name = next(n for n in z.namelist() if n.endswith('.bdae'))
    b = Bres(z.read(name))
    images = [b.s(b.u(e + 8)) for e in b.table(0x4c, 20)]

    materials, mat_index = [], {}
    for e in b.table(0x5c, 0x24):
        tex = None
        n, p = b.u(e + 0x10), b.u(e + 0x14)
        for j in range(n):
            pe = p + j * 0x18
            if b.u(pe + 8) == 0xb and b.s(b.u(pe)) == 'diffuse-sampler':
                idx = b.u(b.u(b.u(pe + 0x14)))
                if idx < len(images):
                    tex = images[idx].lower().replace('.tga', '.webp')
        mat_index[b.s(b.u(e))] = len(materials)
        materials.append({'name': b.s(b.u(e)), 'texture': tex})

    data = bytearray()

    def put(arr):
        while len(data) % 4:
            data.append(0)
        start = len(data)
        data.extend(np.ascontiguousarray(arr).tobytes())
        return [start, len(data) - start]

    meshes, mesh_index = [], {}
    for e in b.table(0x64, 16):
        gid, m = b.s(b.u(e)), b.u(e + 12)
        nv, desc, nsub, subs = b.u(m + 4), b.u(m + 8), b.u(m + 12), b.u(m + 16)
        stride, na = b.u(desc), b.u(desc + 4)
        cols = [[b.u(b.u(desc + 8 + k * 8) + j * 4) for j in range(na)] for k in range(3)]
        raw = np.frombuffer(b.d, np.uint8, nv * stride, b.u(desc + 0x24)).reshape(nv, stride)
        mesh = {'name': gid}
        floats3 = 0
        for off, typ, comps in zip(*cols):
            if typ == 6 and comps == 3:
                key = 'position' if floats3 == 0 else 'normal'
                floats3 += 1
                mesh[key] = put(raw[:, off:off + 12].copy().view('<f4'))
            elif typ == 6 and comps == 2 and 'uv' not in mesh:
                mesh['uv'] = put(raw[:, off:off + 8].copy().view('<f4'))
            elif typ == 1 and comps == 4 and 'color' not in mesh:
                mesh['color'] = put(raw[:, off:off + 4].copy())
        prims = []
        for k in range(nsub):
            sb = subs + k * 0x28
            sym, ni, ip = b.s(b.u(sb + 4)), b.u(sb + 0x20), b.u(sb + 0x24)
            idx = np.frombuffer(b.d, '<u2', ni, ip)
            prims.append({'material': mat_index.get(sym, -1), 'symbol': sym, 'index': put(idx)})
        mesh['prims'] = prims
        mesh['bbox'] = b.f(m + 0x14, 6)
        mesh_index[gid] = len(meshes)
        meshes.append(mesh)

    nodes = []

    def walk(o, parent):
        i = len(nodes)
        node = {'name': b.s(b.u(o + 4)) or b.s(b.u(o)), 'parent': parent, 'sid': b.s(b.u(o + 8)),
                't': b.f(o + 0xc, 3), 'q': conj(b.f(o + 0x18, 4)), 's': b.f(o + 0x28, 3), 'meshes': []}
        nodes.append(node)
        for j in range(b.u(o + 0x40)):
            ip = b.u(o + 0x44) + j * 8
            url = b.s(b.u(b.u(ip + 4) + 4)).lstrip('#')
            gid = url if url in mesh_index else url.split('-mesh')[0] + '-mesh'
            if gid in mesh_index:
                node['meshes'].append(mesh_index[gid])
        for j in range(b.u(o + 0x38)):
            walk(b.u(o + 0x3c) + j * 0x50, i)

    for vs in b.table(0x8c, 0x10)[:1]:
        for j in range(b.u(vs + 8)):
            walk(b.u(vs + 0xc) + j * 0x50, -1)

    # skin controllers: entry = (type 0=skin/1=morph, name, data)
    skins = []
    by_sid = {n['sid']: i for i, n in enumerate(nodes) if n['sid']}
    by_name = {n['name']: i for i, n in enumerate(nodes)}
    for e in b.table(0x6c, 12):
        if b.u(e) != 0:
            continue
        sk = b.u(e + 8)
        url = b.s(b.u(sk + 0x70)).lstrip('#')
        gid = url if url in mesh_index else url.split('-mesh')[0] + '-mesh'
        if gid not in mesh_index:
            continue
        mi = mesh_index[gid]
        mesh = meshes[mi]
        nj = b.u(sk + 0x74)
        names = [b.s(b.u(b.u(sk + 0x78) + 4 * j)) for j in range(nj)]
        joints = [by_sid.get(n, by_name.get(n, -1)) for n in names]
        nv = mesh['position'][1] // 12
        max_inf = b.u(sk + 0x90)
        stride = 4 + 4 * max_inf
        if b.u(sk + 0x7c) * 4 != nv * stride or -1 in joints:
            continue
        raw = np.frombuffer(b.d, np.uint8, nv * stride, b.u(sk + 0x80)).reshape(nv, stride)
        jidx = raw[:, :4].copy()
        w = np.zeros((nv, 4), '<f4')
        w[:, :max_inf] = raw[:, 4:].copy().view('<f4')
        jidx[w == 0] = 0
        mesh['joints'] = put(jidx)
        mesh['weights'] = put(w)
        mesh['skin'] = len(skins)
        skins.append({'mesh': mi, 'joints': joints, 'jointNames': names,
                      'inverseBind': put(np.frombuffer(b.d, '<f4', 16 * nj, b.u(sk + 4))),
                      'bindShape': b.f(sk + 0x10, 16)})

    meta = {'materials': materials, 'meshes': meshes, 'nodes': nodes}
    if skins:
        meta['skins'] = skins
        meta['skin'] = skins[0]
    return meta, bytes(data)


def convert_all(paths, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    ok = []
    for p in paths:
        base = os.path.basename(p)[:-5]
        try:
            meta, data = convert(p)
        except Exception as e:
            print('model skipped', base, repr(e))
            continue
        with open(os.path.join(out_dir, base + '.bin'), 'wb') as f:
            f.write(data)
        with open(os.path.join(out_dir, base + '.json'), 'w') as f:
            json.dump(meta, f)
        ok.append(base)
    with open(os.path.join(out_dir, 'index.json'), 'w') as f:
        json.dump(ok, f)
    print('models', len(ok), '/', len(paths))

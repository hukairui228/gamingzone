"""Convert Gangstar 2 anim_ingame.bdae (raw BRES) to clips.json + clips.bin.

Layout (reversed): one global 30 fps timeline; root+0x24/+0x28 lists 24 bone channels
(0x20 bytes each: name, sampler, channel, default); root+0x34/+0x38 lists clips
(name, start_ms, start_ms) in timeline order. Key data at header[0x28] is a sequence of
time chunks: 48 x (offset, count) rows, u32 size, then per channel: u16 frame times,
pad to 4, float32 values (quat xyzw or vec3 in cm).

Output tracks per clip: {bone: {t:[o,n], q:[o,n]} or {t, p}}, times in seconds from clip start.
"""
import json, os, struct, sys
import numpy as np

FPS = 30.0


def convert(path, out_dir):
    d = open(path, 'rb').read()
    u = lambda o: struct.unpack_from('<I', d, o)[0]
    s = lambda o: d[o:d.index(b'\0', o)].decode('latin1') if o else ''
    root = u(0x20)

    chans = []
    for i in range(u(root + 0x24)):
        e = u(root + 0x28) + i * 0x20
        name = s(u(e))
        smp = u(e + 8)
        comps = u(smp + 0x14)
        bone, _, prop = name.rpartition('-node-')
        chans.append({'bone': bone, 'prop': prop, 'comps': comps})

    nclip = u(root + 0x34)
    clips = [(s(u(u(root + 0x38) + 12 * i)), u(u(root + 0x38) + 12 * i + 4)) for i in range(nclip)]

    times = [[] for _ in chans]
    vals = [[] for _ in chans]
    p, nch = u(0x28), len(chans)
    while p + nch * 16 + 4 <= len(d):
        counts = [struct.unpack_from('<2I', d, p + 8 * k)[1] for k in range(2 * nch)][::2]
        q = p + nch * 16 + 4
        for k, c in enumerate(chans):
            n = counts[k]
            times[k].append(np.frombuffer(d, '<u2', n, q).astype(np.int32))
            q = (q + 2 * n + 3) & ~3
            v = np.frombuffer(d, '<f4', n * c['comps'], q).reshape(n, c['comps'])
            if c['prop'] == 'rotation' and c['comps'] == 4:
                v = v * np.array([-1, -1, -1, 1], '<f4')  # stored as inverse rotation
            vals[k].append(v)
            q += 4 * n * c['comps']
        p = q
        if times[0][-1].size and times[0][-1][-1] >= round(clips[-1][1] * FPS / 1000) - 1:
            break

    tracks = []
    for k in range(nch):
        t = np.concatenate(times[k])
        v = np.concatenate(vals[k])
        t, idx = np.unique(t, return_index=True)
        tracks.append((t, v[idx]))

    def sample(t, v, f, quat):
        i = np.searchsorted(t, f, side='right') - 1
        if i < 0:
            return v[0]
        if i >= len(t) - 1:
            return v[-1]
        a = (f - t[i]) / (t[i + 1] - t[i])
        x, y = v[i], v[i + 1]
        if quat and np.dot(x, y) < 0:
            y = -y
        r = x * (1 - a) + y * a
        return r / np.linalg.norm(r) if quat else r

    data = bytearray()

    def put(arr):
        start = len(data)
        data.extend(np.ascontiguousarray(arr, '<f4').tobytes())
        return [start, len(data) - start]

    out = {}
    for ci in range(nclip - 1):
        name, ms = clips[ci]
        f0 = round(ms * FPS / 1000)
        f1 = max(f0, round(clips[ci + 1][1] * FPS / 1000) - 1)
        clip = {'duration': (f1 - f0) / FPS, 'tracks': {}}
        for k, c in enumerate(chans):
            if c['prop'] not in ('rotation', 'translation') or c['comps'] not in (3, 4):
                continue
            t, v = tracks[k]
            quat = c['prop'] == 'rotation'
            sel = (t > f0) & (t < f1)
            ft = np.concatenate([[f0], t[sel], [f1]]) if f1 > f0 else np.array([f0])
            fv = np.stack([sample(t, v, f, quat) for f in ft])
            tr = clip['tracks'].setdefault(c['bone'], {})
            tr['t'] = put((ft - f0) / FPS) if 't' not in tr else tr['t']
            if quat:
                tr['tq'] = put((ft - f0) / FPS)
                tr['q'] = put(fv)
            else:
                tr['tp'] = put((ft - f0) / FPS)
                tr['p'] = put(fv)
        for tr in clip['tracks'].values():
            tr.pop('t', None)
        out[name] = clip

    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, 'clips.bin'), 'wb') as f:
        f.write(data)
    with open(os.path.join(out_dir, 'clips.json'), 'w') as f:
        json.dump(out, f)
    print('clips', len(out), 'bytes', len(data))


if __name__ == '__main__':
    convert(sys.argv[1], sys.argv[2])

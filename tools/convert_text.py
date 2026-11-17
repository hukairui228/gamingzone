"""Decode Gangstar 2 localisation tables (.chinese/.english): u16 count, then u16 length + UTF-8 per string."""
import json, os, struct


def decode(data):
    n = struct.unpack_from('<H', data, 0)[0]
    o, out = 2, []
    for _ in range(n):
        L = struct.unpack_from('<H', data, o)[0]
        out.append(data[o + 2:o + 2 + L].decode('utf-8', 'replace'))
        o += 2 + L
    return out


def convert_all(files, read, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for name in files:
        base, lang = name.rsplit('.', 1)
        with open(os.path.join(out_dir, f'{base}.{lang}.json'), 'w', encoding='utf-8') as f:
            json.dump(decode(read(name)), f, ensure_ascii=False)

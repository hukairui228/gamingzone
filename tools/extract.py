"""Extract game assets from your own Gangstar: Miami Vindication IPA into public/assets.

Usage: python3 tools/extract.py path/to/gangstar.ipa
Requires: pip install numpy pillow texture2ddecoder
"""
import io, os, sys, zipfile

sys.path.insert(0, os.path.dirname(__file__))
import pvr2png, convert_city, convert_model, build_roads, convert_anim, convert_text

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'assets')


def main(ipa):
    z = zipfile.ZipFile(ipa)
    pack = {os.path.basename(n): n for n in z.namelist() if '/_packMac/' in n and not n.endswith('/')}
    tmp = os.path.join(OUT, '_raw')
    os.makedirs(tmp, exist_ok=True)

    def raw(name):
        p = os.path.join(tmp, name)
        if not os.path.exists(p):
            with open(p, 'wb') as f:
                f.write(z.read(pack[name]))
        return p

    tex_out = os.path.join(OUT, 'tex')
    os.makedirs(tex_out, exist_ok=True)
    for name in sorted(pack):
        if name.lower().endswith(('.tga', '.bmp')) and not name.endswith('_lo.tga'):
            dst = os.path.join(tex_out, name[:-4].lower() + '.webp')
            if not os.path.exists(dst):
                try:
                    pvr2png.decode(raw(name)).save(dst, quality=92, method=4)
                except Exception as e:
                    print('texture skipped', name, e)
    print('textures done')

    convert_city.main(raw('miami.bdae'), os.path.join(OUT, 'city'))
    build_roads.main(os.path.join(tex_out, 'minimap_map.webp'), os.path.join(OUT, 'city', 'roads.json'))

    models = [n for n in pack if n.endswith('.bdae') and n.startswith(convert_model.PREFIXES)
              and not n.endswith('_lo.bdae')]
    convert_model.convert_all([raw(n) for n in sorted(models)], os.path.join(OUT, 'models'))
    convert_anim.convert(raw('anim_ingame.bdae'), os.path.join(OUT, 'anim'))
    convert_text.convert_all([n for n in pack if n.endswith(('.chinese', '.english'))],
                             lambda n: z.read(pack[n]), os.path.join(OUT, 'text'))
    convert_audio([n for n in sorted(pack) if n.endswith('.wav')], raw, os.path.join(OUT, 'audio'))
    print('done ->', OUT)


def convert_audio(names, raw, out_dir):
    """IMA-ADPCM wav -> AAC (.m4a), which every browser decodes."""
    import subprocess
    from concurrent.futures import ThreadPoolExecutor
    os.makedirs(out_dir, exist_ok=True)

    def one(name):
        dst = os.path.join(out_dir, name[:-4].lower() + '.m4a')
        if os.path.exists(dst):
            return
        rate = '128k' if name.startswith('m_') else '64k'
        r = subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', raw(name), '-c:a', 'aac', '-b:a', rate, dst])
        if r.returncode:
            print('audio skipped', name)

    for n in names:
        raw(n)
    with ThreadPoolExecutor(os.cpu_count() or 4) as ex:
        list(ex.map(one, names))
    print('audio', len(names))


if __name__ == '__main__':
    main(sys.argv[1])

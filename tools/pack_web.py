"""Build a self-contained web deployment in deploy/: one HTML page (JS + CSS inlined) plus asset packs.

Hosts that limit file count/size (e.g. a private claude.ai page: <=511 files, <=15 MB each, <=256 MB total)
can serve it as-is. Run after `NO_PUBLIC=1 npx vite build`:  python3 tools/pack_web.py [--no-hd] [--full-audio]
"""
import json, os, re, shutil, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'public', 'assets')
OUT = os.path.join(ROOT, 'deploy')
RAW = os.path.join(ROOT, '.extract_cache')
PACK_MAX = 14 * 1024 * 1024
MIME = {'.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.bin': 'application/octet-stream',
        '.m4a': 'audio/mp4', '.ttf': 'font/ttf'}


def group_of(rel):
    if rel.startswith('audio/cin_'):
        return 'voice_' + rel.split('_')[1].lower()  # one group per chapter
    if rel.startswith('audio/'):
        return 'sfx'
    if rel.startswith('tex_hd/'):
        return 'texhd'
    if rel.startswith('tex/'):
        return 'tex'
    if rel.startswith('city/'):
        return 'city'
    return 'core'


def encode_audio(tmp):
    """Smaller audio for the web: speech/sfx mono 40k, music stereo 80k (kept as separate streamable files)."""
    os.makedirs(tmp, exist_ok=True)
    jobs = []
    wavs = {x.lower(): os.path.join(RAW, x) for x in os.listdir(RAW) if x.lower().endswith('.wav')} if os.path.isdir(RAW) else {}
    for f in sorted(os.listdir(os.path.join(SRC, 'audio'))):
        src = wavs.get(f[:-4] + '.wav', os.path.join(SRC, 'audio', f))
        music = f.startswith('m_')
        # music stays streamable as separate files; .mp4 is the widely served name for the same AAC container
        dst = os.path.join(OUT, 'assets', 'audio', f[:-4] + '.mp4') if music else os.path.join(tmp, f)
        jobs.append((src, dst, music))

    full = '--full-audio' in sys.argv

    def run(job):
        src, dst, music = job
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if full:  # keep the extraction-quality AAC files untouched
            shutil.copyfile(os.path.join(SRC, 'audio', os.path.basename(dst)[:-4] + '.m4a'), dst)
            return
        if os.path.exists(dst):
            return
        args = ['-b:a', '80k'] if music else ['-ac', '1', '-b:a', '40k']
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-c:a', 'aac', *args, dst], check=True)

    with ThreadPoolExecutor(os.cpu_count() or 4) as ex:
        list(ex.map(run, jobs))


def main():
    no_hd = '--no-hd' in sys.argv
    dist = os.path.join(ROOT, 'dist')
    if os.path.exists(OUT):
        keep = os.path.join(OUT, 'assets', 'audio')
        for x in os.listdir(OUT):
            if x != 'assets':
                shutil.rmtree(os.path.join(OUT, x), ignore_errors=True) if os.path.isdir(os.path.join(OUT, x)) else os.remove(os.path.join(OUT, x))
        for x in os.listdir(os.path.join(OUT, 'assets')):
            if x.startswith('pack_') or x == 'packs.json':
                os.remove(os.path.join(OUT, 'assets', x))
        del keep
    tmp = os.path.join(ROOT, '.extract_cache', 'web_audio_full' if '--full-audio' in sys.argv else 'web_audio')
    encode_audio(tmp)

    files = []
    for d, _, fs in os.walk(SRC):
        for f in fs:
            rel = os.path.relpath(os.path.join(d, f), SRC).replace(os.sep, '/')
            if rel.startswith('audio/m_') or (no_hd and rel.startswith('tex_hd/')):
                continue
            path = os.path.join(tmp, f) if rel.startswith('audio/') else os.path.join(d, f)
            files.append((group_of(rel), rel, path))
    files.sort()
    index, packs = {}, []
    cur, cur_group, cur_size, fh = None, None, 0, None
    for g, rel, path in files:
        data = open(path, 'rb').read()
        parts, off = [], 0
        while off < len(data) or not parts:
            if fh is None or g != cur_group or cur_size >= PACK_MAX:
                if fh:
                    fh.close()
                cur = f'pack_{len(packs):02d}_{g}.wasm'  # served as an opaque byte blob
                packs.append(cur)
                fh = open(os.path.join(OUT, 'assets', cur), 'wb')
                cur_group, cur_size = g, 0
            n = min(len(data) - off, PACK_MAX - cur_size)
            fh.write(data[off:off + n])
            parts.append([cur, cur_size, n])
            cur_size += n
            off += n
            if not data:
                break
        index[rel] = {'p': parts, 't': MIME.get(os.path.splitext(rel)[1], 'application/octet-stream')}
    fh.close()
    for f in os.listdir(os.path.join(SRC, 'audio')):
        if f.startswith('m_'):
            index['audio/' + f] = {'url': 'audio/' + f[:-4] + '.mp4'}
    json.dump({'files': index, 'packs': packs}, open(os.path.join(OUT, 'assets', 'packs.json'), 'w'))

    # page: inline the built CSS and JS into the HTML body
    html = open(os.path.join(dist, 'index.html'), encoding='utf-8').read()
    css = ''.join(open(os.path.join(dist, m), encoding='utf-8').read() for m in re.findall(r'href="\./(assets/[^"]+\.css)"', html))
    js = ''.join(open(os.path.join(dist, m), encoding='utf-8').read() for m in re.findall(r'src="\./(assets/[^"]+\.js)"', html))
    body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
    body = re.sub(r'<script[^>]*src="[^"]+"[^>]*></script>', '', body)
    page = (f'<meta charset="utf-8">\n<title>孤胆车神 重制版</title>\n<meta name="apple-mobile-web-app-capable" content="yes">\n'
            f'<style>{css}</style>\n{body}\n<script type="module">{js.replace("</script", "<\\/script")}</script>\n')
    open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(page)

    total = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
    count = sum(len(fs) for _, _, fs in os.walk(OUT))
    print(f'deploy: {count} files, {total / 1e6:.1f} MB, {len(packs)} packs, page {len(page) / 1e6:.2f} MB')


if __name__ == '__main__':
    main()

"""Decode Gameloft .bsprite layouts: modules (atlas rects) and frames (module placements on a 960x640 screen)."""
import struct, json, sys, os
def parse(path):
    d=open(path,'rb').read()
    h=struct.unpack('<20I',d[:80])
    nmod,nfr,nfm=h[1],h[3],h[4]
    om,ofr,ofm=h[8],h[9],h[11]
    mods=[struct.unpack_from('<5H',d,om+i*10)[1:] for i in range(nmod)]
    frames=[]
    for i in range(nfr):
        r=struct.unpack_from('<7i',d,ofr+i*28)
        n,first=r[0],r[5]
        fms=[struct.unpack_from('<Hhhh',d,ofm+(first+k)*8) for k in range(n)]
        frames.append(fms)
    return {'modules': mods, 'frames': frames}


def convert_all(paths, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for p in paths:
        json.dump(parse(p), open(os.path.join(out_dir, os.path.basename(p).replace('.bsprite', '.json')), 'w'))
def compose(sprite_path, image_path, out_path, size=(960, 640)):
    """Rebuild a full image (e.g. the 960x640 title splash) from its tiled sprite frame 0."""
    from PIL import Image
    s = parse(sprite_path)
    im = Image.open(image_path).convert('RGB')
    out = Image.new('RGB', size)
    for m, x, y, fl in s['frames'][0]:
        mx, my, mw, mh = s['modules'][m]
        out.paste(im.crop((mx, my, mx + mw, my + mh)), (x, y))
    out.save(out_path, quality=92)


if __name__=='__main__':
    s=parse(sys.argv[1]); json.dump(s,open(sys.argv[2],'w'))
    print(len(s['modules']),len(s['frames']), s['frames'][:6])

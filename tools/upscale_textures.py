"""HD texture pack: AI-upscale the original textures 2x with Real-ESRGAN (compact general model) on CPU.

Usage: python3 tools/upscale_textures.py [public/assets] [weights.pth]
Writes public/assets/tex_hd/<name>.webp and tex_hd/manifest.json. Needs: pip install torch (CPU) numpy pillow.
Weights: realesr-general-x4v3.pth from the xinntao/Real-ESRGAN v0.2.5.0 release (downloaded automatically).
"""
import json, os, re, sys, time, urllib.request
import numpy as np
from PIL import Image, ImageFilter

WEIGHTS_URL = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth'
# day textures worth upscaling (night atlases keep their original size: they only drive emissive light)
PATTERN = re.compile(r'^(atlas\d+|alpha_atlas\d+|ground_\d+|concrete_\d+|concretepost|tile|fields|fields_cap|vegetation_00|forest|'
                     r'entrance|parking_lot_blank|tennis|helipad|jump_00|fence\d+|grafitti_tags_01_00|metromover_00|sm_pool_inside|'
                     r'car_texture_d|car_poor_texture_d|car_cops_texture_d|car_interior_d|char_all|prop_gun_col|props_alpha_02|water|'
                     r'bridge_side|bridge_under|guardfence|expaniolaway|stairs_01|park_01|swamp_sentier_\d+_00|lod_city_\d+)\.webp$')
MAX = 2048


def model(weights):
    import torch
    import torch.nn as nn

    class SRVGGNetCompact(nn.Module):
        def __init__(self, num_feat=64, num_conv=32, upscale=4):
            super().__init__()
            self.upscale = upscale
            body = [nn.Conv2d(3, num_feat, 3, 1, 1), nn.PReLU(num_parameters=num_feat)]
            for _ in range(num_conv):
                body += [nn.Conv2d(num_feat, num_feat, 3, 1, 1), nn.PReLU(num_parameters=num_feat)]
            body += [nn.Conv2d(num_feat, 3 * upscale * upscale, 3, 1, 1)]
            self.body = nn.ModuleList(body)
            self.upsampler = nn.PixelShuffle(upscale)

        def forward(self, x):
            out = x
            for layer in self.body:
                out = layer(out)
            out = self.upsampler(out)
            return out + nn.functional.interpolate(x, scale_factor=self.upscale, mode='nearest')

    net = SRVGGNetCompact()
    sd = torch.load(weights, map_location='cpu')
    net.load_state_dict(sd.get('params', sd), strict=True)
    net.eval()
    return net


def upscale_rgb(net, rgb, tile=256, pad=10):
    import torch
    h, w, _ = rgb.shape
    out = np.zeros((h * 4, w * 4, 3), np.float32)
    x = torch.from_numpy(rgb.transpose(2, 0, 1)[None].astype(np.float32) / 255.0)
    with torch.no_grad():
        for ty in range(0, h, tile):
            for tx in range(0, w, tile):
                y0, x0 = max(0, ty - pad), max(0, tx - pad)
                y1, x1 = min(h, ty + tile + pad), min(w, tx + tile + pad)
                o = net(x[:, :, y0:y1, x0:x1])[0].clamp(0, 1).numpy().transpose(1, 2, 0)
                oy, ox = (ty - y0) * 4, (tx - x0) * 4
                th, tw = min(tile, h - ty) * 4, min(tile, w - tx) * 4
                out[ty * 4:ty * 4 + th, tx * 4:tx * 4 + tw] = o[oy:oy + th, ox:ox + tw]
    return (out * 255 + 0.5).astype(np.uint8)


def make_specs(assets='public/assets', size=512):
    """Per-atlas material map (G = roughness, B = metalness): windows become glass.

    Windows are found from the original night atlases (lit at night) plus glass-tinted day texels.
    """
    src = os.path.join(assets, 'tex')
    done = []
    for n in sorted(os.listdir(src)):
        m = re.match(r'^(alpha_)?atlas(\d+)\.webp$', n)
        if not m:
            continue
        night = os.path.join(src, f"{'alpha_night' if m.group(1) else 'night'}{m.group(2)}.webp")
        day = np.asarray(Image.open(os.path.join(src, n)).convert('RGB').resize((size, size), Image.BILINEAR)).astype(np.float32) / 255
        r, g, b = day[..., 0], day[..., 1], day[..., 2]
        mx, mn = day.max(-1), day.min(-1)
        sat = (mx - mn) / (mx + 1e-4)
        glass = (b > r + 0.07) & (b >= g - 0.03) & (sat > 0.12) & (mx > 0.25) & (mx < 0.97)
        if os.path.exists(night):
            nt = np.asarray(Image.open(night).convert('RGB').resize((size, size), Image.BILINEAR)).astype(np.float32) / 255
            lum = nt @ np.array([0.299, 0.587, 0.114], np.float32)
            glass |= lum > 0.42
        im = Image.fromarray((glass * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
        im = im.filter(ImageFilter.GaussianBlur(0.6))
        k = np.asarray(im).astype(np.float32) / 255
        rough = 0.86 - 0.78 * k
        metal = 0.55 * k
        out = np.stack([np.full_like(k, 1.0), rough, metal], -1)
        Image.fromarray((out * 255).astype(np.uint8)).save(os.path.join(src, 'spec_' + n), quality=88, method=4)
        done.append(n)
    json.dump(done, open(os.path.join(src, 'spec_manifest.json'), 'w'))
    print('material maps', len(done))


def main(assets='public/assets', weights=None):
    make_specs(assets)
    import torch
    torch.set_num_threads(max(1, (os.cpu_count() or 4) - 1))
    src, dst = os.path.join(assets, 'tex'), os.path.join(assets, 'tex_hd')
    os.makedirs(dst, exist_ok=True)
    weights = weights or os.path.join(dst, '_realesr-general-x4v3.pth')
    if not os.path.exists(weights):
        urllib.request.urlretrieve(WEIGHTS_URL, weights)
    net = model(weights)
    names = sorted(n for n in os.listdir(src) if PATTERN.match(n))
    done = []
    for n in names:
        out = os.path.join(dst, n)
        if not os.path.exists(out):
            t = time.time()
            im = Image.open(os.path.join(src, n))
            alpha = im.getchannel('A') if im.mode == 'RGBA' else None
            # soften PVRTC block artefacts a touch before super-resolution
            rgb = im.convert('RGB').filter(ImageFilter.GaussianBlur(0.35))
            big = Image.fromarray(upscale_rgb(net, np.asarray(rgb)))
            target = (min(MAX, im.width * 2), min(MAX, im.height * 2))
            big = big.resize(target, Image.LANCZOS)
            if alpha is not None:
                big.putalpha(alpha.resize(target, Image.LANCZOS))
            big.save(out, quality=90, method=4)
            print(f'{n} {im.size}->{target} {time.time() - t:.0f}s', flush=True)
        done.append(n)
    json.dump(done, open(os.path.join(dst, 'manifest.json'), 'w'))
    print('hd textures', len(done))


if __name__ == '__main__':
    main(*sys.argv[1:])

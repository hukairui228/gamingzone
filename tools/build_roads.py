"""Derive the road graph from the original minimap (white roads) -> public/assets/city/roads.json.

The minimap maps to world (Y-up metres) as: x = MAP_X0 + u * MAP_SCALE, z = MAP_Z0 + v * MAP_SCALE.
"""
import json, os, sys
import numpy as np
from PIL import Image

MAP_X0, MAP_Z0, MAP_SCALE = -1046.8, -1124.8, 1.95


def thin(img):
    """Zhang-Suen thinning, vectorised."""
    a = img.astype(np.uint8).copy()
    while True:
        changed = False
        for step in (0, 1):
            p = np.pad(a, 1)
            n = [p[:-2, 1:-1], p[:-2, 2:], p[1:-1, 2:], p[2:, 2:], p[2:, 1:-1], p[2:, :-2], p[1:-1, :-2], p[:-2, :-2]]
            b = sum(n)
            seq = n + [n[0]]
            t = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(np.uint8) for i in range(8))
            if step == 0:
                c = (n[0] * n[2] * n[4] == 0) & (n[2] * n[4] * n[6] == 0)
            else:
                c = (n[0] * n[2] * n[6] == 0) & (n[0] * n[4] * n[6] == 0)
            rm = (a == 1) & (b >= 2) & (b <= 6) & (t == 1) & c
            if rm.any():
                a[rm] = 0
                changed = True
        if not changed:
            return a


def simplify(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0], float), np.array(pts[-1], float)
    ab = b - a
    L = np.hypot(*ab) or 1e-9
    d = [abs(ab[0] * (p[1] - a[1]) - ab[1] * (p[0] - a[0])) / L for p in pts[1:-1]]
    i = int(np.argmax(d)) + 1
    if d[i - 1] > eps:
        return simplify(pts[:i + 1], eps)[:-1] + simplify(pts[i:], eps)
    return [pts[0], pts[-1]]


def main(minimap, out):
    rgb = np.asarray(Image.open(minimap).convert('RGB')).astype(int)
    road = (rgb.min(2) > 225)
    # close small gaps, drop specks
    from PIL import ImageFilter
    im = Image.fromarray((road * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    road = np.asarray(im) > 0
    # distance to non-road for width estimate
    dist = np.zeros(road.shape)
    cur = road.copy()
    k = 0
    while cur.any() and k < 20:
        k += 1
        dist[cur] = k
        p = np.pad(cur, 1)
        cur = cur & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    sk = thin(road)
    H, W = sk.shape
    nb = lambda y, x: [(y + dy, x + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                       if (dy or dx) and 0 <= y + dy < H and 0 <= x + dx < W and sk[y + dy, x + dx]]
    ys, xs = np.nonzero(sk)
    deg = {(y, x): len(nb(y, x)) for y, x in zip(ys, xs)}
    is_node = {p for p, d in deg.items() if d != 2}
    # merge clustered junction pixels into one node
    node_id, nodes = {}, []
    for p in sorted(is_node):
        if p in node_id:
            continue
        stack, cluster = [p], []
        node_id[p] = len(nodes)
        while stack:
            q = stack.pop()
            cluster.append(q)
            for r in nb(*q):
                if r in is_node and r not in node_id:
                    node_id[r] = len(nodes)
                    stack.append(r)
        cy = np.mean([c[0] for c in cluster]); cx = np.mean([c[1] for c in cluster])
        nodes.append([cx, cy])
    edges, seen = [], set()
    for p in is_node:
        for q in nb(*p):
            if q in is_node or (p, q) in seen:
                continue
            path, prev, cur = [p], p, q
            while cur not in is_node:
                path.append(cur)
                nxt = [r for r in nb(*cur) if r != prev and r not in path[-3:]]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
            path.append(cur)
            seen.add((path[-1], path[-2]))
            if cur not in is_node:
                continue
            a, b = node_id[p], node_id[cur]
            if a == b and len(path) < 8:
                continue
            width = float(np.median([dist[y, x] for y, x in path])) * 2 * MAP_SCALE
            pts = simplify([(x, y) for y, x in path], 1.2)
            edges.append([a, b, round(width, 1), [[round(MAP_X0 + x * MAP_SCALE, 1), round(MAP_Z0 + y * MAP_SCALE, 1)] for x, y in pts]])
    # drop tiny spurs (dead-end stubs shorter than 12 m)
    def length(e):
        return sum(np.hypot(e[3][i + 1][0] - e[3][i][0], e[3][i + 1][1] - e[3][i][1]) for i in range(len(e[3]) - 1))
    deg_n = np.zeros(len(nodes), int)
    for e in edges:
        deg_n[e[0]] += 1; deg_n[e[1]] += 1
    edges = [e for e in edges if not ((deg_n[e[0]] == 1 or deg_n[e[1]] == 1) and length(e) < 12)]
    out_nodes = [[round(MAP_X0 + x * MAP_SCALE, 1), round(MAP_Z0 + y * MAP_SCALE, 1)] for x, y in nodes]
    json.dump({'nodes': out_nodes, 'edges': edges,
               'map': {'x0': MAP_X0, 'z0': MAP_Z0, 'scale': MAP_SCALE, 'size': W}}, open(out, 'w'))
    print('roads: nodes', len(out_nodes), 'edges', len(edges))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

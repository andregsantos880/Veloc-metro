#!/usr/bin/env python3
"""
Gera os blocos (tiles) de vias do Velocímetro Alerta a partir de um extrato do OpenStreetMap.

Entrada : um arquivo .osm.pbf já recortado na região de interesse (ex.: Grande São Paulo).
Saída   : tiles/sp/<ty>_<tx>.json  (um por bloco de 0,02° ≈ 2 km) + tiles/sp/index.json

Cada bloco usa exatamente o formato que o app monta a partir do Overpass (função compact() do app.js):
  ways : [{i, h, n, m, f, b, c?, t?, o, g:[[lat,lon],...]}]   (t = maxspeed:hgv, limite para veículos pesados)
  nodes: [{i, k:'cam'|'calm', lat, lon, m, n}]

Uso: python3 tools/build_tiles.py recorte.osm.pbf tiles/sp
"""
import json, math, os, re, sys, time
import osmium

TILE = 0.02
HW = {
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
    'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
}
CALM = {'bump', 'hump', 'table', 'cushion', 'yes', 'rumble_strip', 'choker'}
SERVICE_SKIP = {'parking_aisle', 'driveway', 'drive-through', 'emergency_access'}


def parse_maxspeed(v):
    if not v:
        return None
    m = re.search(r'(\d+(?:\.\d+)?)\s*(mph)?', str(v), re.I)
    if not m:
        return None
    n = float(m.group(1))
    if m.group(2):
        n *= 1.609
    return int(round(n))


def tile_of(lat, lon):
    return (math.floor(lat / TILE), math.floor(lon / TILE))


class Handler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.tiles = {}          # (ty,tx) -> {'ways': {id: way}, 'nodes': {id: node}}
        self.nways = 0
        self.nnodes = 0

    def _tile(self, k):
        t = self.tiles.get(k)
        if t is None:
            t = self.tiles[k] = {'ways': {}, 'nodes': {}}
        return t

    def node(self, n):
        t = n.tags
        kind = None
        if t.get('highway') == 'speed_camera':
            kind = 'cam'
        elif t.get('traffic_calming') in CALM:
            kind = 'calm'
        if not kind or not n.location.valid():
            return
        lat, lon = round(n.location.lat, 5), round(n.location.lon, 5)
        rec = {'i': n.id, 'k': kind, 'lat': lat, 'lon': lon, 'm': parse_maxspeed(t.get('maxspeed')), 'n': t.get('name', '')}
        self._tile(tile_of(lat, lon))['nodes'][n.id] = rec
        self.nnodes += 1

    def way(self, w):
        t = w.tags
        h = t.get('highway')
        if h not in HW:
            return
        if h == 'service':
            # Vias de serviço só entram se tiverem limite ou nome (estacionamentos e garagens ficam de fora)
            if t.get('service') in SERVICE_SKIP:
                return
            if not (t.get('maxspeed') or t.get('name')):
                return
        g = []
        for nd in w.nodes:
            if nd.location.valid():
                g.append([round(nd.location.lat, 5), round(nd.location.lon, 5)])
        if len(g) < 2:
            return
        oneway = t.get('oneway')
        ow = 1 if (oneway in ('yes', '1') or h == 'motorway' or t.get('junction') == 'roundabout') else (-1 if oneway == '-1' else 0)
        rec = {
            'i': w.id, 'h': h, 'n': t.get('name') or t.get('ref') or '',
            'm': parse_maxspeed(t.get('maxspeed')), 'f': parse_maxspeed(t.get('maxspeed:forward')), 'b': parse_maxspeed(t.get('maxspeed:backward')),
            'o': ow, 'g': g,
        }
        if t.get('maxspeed:conditional'):
            rec['c'] = t.get('maxspeed:conditional')
        hgv = parse_maxspeed(t.get('maxspeed:hgv')) or parse_maxspeed(t.get('maxspeed:hgv:forward')) or parse_maxspeed(t.get('maxspeed:bus'))
        if hgv:
            rec['t'] = hgv
        # Em quais blocos a via entra: os dos seus pontos e os que cada segmento atravessa
        keys = set()
        for i, p in enumerate(g):
            keys.add(tile_of(p[0], p[1]))
            if i:
                q = g[i - 1]
                steps = int(max(abs(p[0] - q[0]), abs(p[1] - q[1])) / (TILE / 4)) + 1
                for s in range(1, steps):
                    f = s / steps
                    keys.add(tile_of(q[0] + (p[0] - q[0]) * f, q[1] + (p[1] - q[1]) * f))
        for k in keys:
            self._tile(k)['ways'][w.id] = rec
        self.nways += 1


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    t0 = time.time()
    h = Handler()
    h.apply_file(src, locations=True, idx='flex_mem')
    print(f'lidas {h.nways} vias e {h.nnodes} radares/lombadas em {time.time() - t0:.0f}s; {len(h.tiles)} blocos')

    # Limpa blocos antigos e grava os novos
    for f in os.listdir(out):
        if f.endswith('.json'):
            os.remove(os.path.join(out, f))
    total = 0
    lats, lons = [], []
    for (ty, tx), t in h.tiles.items():
        ways = sorted(t['ways'].values(), key=lambda w: w['i'])
        nodes = sorted(t['nodes'].values(), key=lambda n: n['i'])
        if not ways and not nodes:
            continue
        data = json.dumps({'ways': ways, 'nodes': nodes}, ensure_ascii=False, separators=(',', ':'))
        with open(os.path.join(out, f'{ty}_{tx}.json'), 'w', encoding='utf-8') as fh:
            fh.write(data)
        total += len(data)
        lats.append(ty); lons.append(tx)
    index = {
        'v': 1, 'tile': TILE,
        'bbox': [min(lats) * TILE, min(lons) * TILE, (max(lats) + 1) * TILE, (max(lons) + 1) * TILE],
        'tiles': len(lats), 'ways': h.nways, 'cams': h.nnodes,
        'generated': time.strftime('%Y-%m-%d'),
    }
    with open(os.path.join(out, 'index.json'), 'w', encoding='utf-8') as fh:
        json.dump(index, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'gravados {len(lats)} blocos, {total / 1e6:.1f} MB; bbox {index["bbox"]}')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Build compact static intel-layer JSON for Global Pulse (run once, commit the output).

Sources and licences are written into each file's `meta` and into data/intel/SOURCES.md.
Only open, redistributable datasets are used. TeleGeography cable GeoJSON is not bundled
(their underlying data is licensed separately).
"""
from __future__ import annotations

import csv
import json
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = Path("/tmp/gp-intel")
OUT = ROOT / "data" / "intel"
OUT.mkdir(parents=True, exist_ok=True)
UA = "global-pulse-data/1.0 (+https://github.com/ashswin-git/global-pulse)"
TODAY = date.today().isoformat()
ISO = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get(url: str, headers=None, timeout=90, tries=3):
    h = {"User-Agent": UA, "Accept": "*/*"}
    if headers:
        h.update(headers)
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            last = e
            time.sleep(2 * (i + 1))
    raise last


def get_json(url, headers=None, timeout=90, tries=3):
    return json.loads(get(url, headers=headers, timeout=timeout, tries=tries))


def wr(path, payload):
    path = OUT / path
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text)
    print(f"wrote {path.name:22} {path.stat().st_size:8} bytes  n={payload.get('n') or len(payload.get('items', []))}")
    return path


def rlat(x, n=3):
    return round(float(x), n)


def hav(a, b):
    r = math.pi / 180
    lat1, lon1 = a
    lat2, lon2 = b
    x = math.sin((lat2 - lat1) * r / 2) ** 2 + math.cos(lat1 * r) * math.cos(lat2 * r) * math.sin((lon2 - lon1) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(max(0, x)))


def line_km(coords):
    return sum(hav(coords[i], coords[i + 1]) for i in range(len(coords) - 1)) if len(coords) > 1 else 0


def perp_dist(p, a, b):
    # approximate degrees; good enough for world-scale simplification
    if a == b:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    # handle longitude wrap roughly: not critical at this scale
    t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)
    t = max(0, min(1, t))
    return math.hypot(p[0] - (a[0] + t * (b[0] - a[0])), p[1] - (a[1] + t * (b[1] - a[1])))


def simplify(coords, tol=0.12, min_pts=2, max_pts=40):
    if len(coords) <= min_pts:
        return coords
    def dp(pts, eps):
        if len(pts) <= 2:
            return pts
        a, b = pts[0], pts[-1]
        idx, dist = max(((i, perp_dist(pts[i], a, b)) for i in range(1, len(pts) - 1)), key=lambda x: x[1], default=(0, 0))
        if dist > eps:
            left, right = dp(pts[: idx + 1], eps), dp(pts[idx:], eps)
            return left[:-1] + right
        return [a, b]
    out = dp(coords, tol)
    # further thin if still too many points
    if len(out) > max_pts:
        step = math.ceil(len(out) / max_pts)
        out = out[::step]
        if out[-1] != coords[-1]:
            out.append(coords[-1])
        if out[0] != coords[0]:
            out.insert(0, coords[0])
    return [[rlat(lat, 2), rlat(lng, 2)] for lat, lng in out]


def osm_way_coords(el):
    geom = el.get("geometry") or []
    return [[g["lat"], g["lon"]] for g in geom if "lat" in g and "lon" in g]


def osm_rel_lines(el, ways_by_id):
    lines = []
    cur = []
    for m in el.get("members") or []:
        pts = []
        if m.get("geometry"):
            pts = [[g["lat"], g["lon"]] for g in m["geometry"] if "lat" in g]
        elif m.get("type") == "way" and m.get("ref") in ways_by_id:
            pts = osm_way_coords(ways_by_id[m["ref"]])
        if not pts:
            if cur:
                lines.append(cur)
                cur = []
            continue
        if not cur:
            cur = pts
        elif cur[-1] == pts[0]:
            cur += pts[1:]
        elif cur[-1] == pts[-1]:
            cur += list(reversed(pts[:-1]))
        elif cur[0] == pts[-1]:
            cur = pts[:-1] + cur
        elif cur[0] == pts[0]:
            cur = list(reversed(pts[1:])) + cur
        else:
            lines.append(cur)
            cur = pts
    if cur:
        lines.append(cur)
    return [ln for ln in lines if len(ln) >= 2]


def bbox_center(geom):
    def collect(g, acc):
        t, c = g.get("type"), g.get("coordinates")
        if t == "Point":
            acc.append(c)
        elif t in ("LineString", "MultiPoint"):
            acc.extend(c)
        elif t in ("Polygon", "MultiLineString"):
            for ring in c:
                acc.extend(ring)
        elif t == "MultiPolygon":
            for poly in c:
                if poly:
                    acc.extend(poly[0])
    acc = []
    collect(geom, acc)
    if not acc:
        return None
    xs = [p[0] for p in acc]
    ys = [p[1] for p in acc]
    return rlat((min(ys) + max(ys)) / 2), rlat((min(xs) + max(xs)) / 2)


# ---------- Wikidata ----------
WD = "https://query.wikidata.org/sparql"

def parse_point(val):
    if not val:
        return None
    m = re.search(r"Point\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\)", val, re.I)
    if not m:
        return None
    lng, lat = float(m.group(1)), float(m.group(2))
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return rlat(lat), rlat(lng)


def sparql(query, timeout=90):
    body = urllib.parse.urlencode({"query": query, "format": "json"}).encode()
    last = None
    for i in range(3):
        try:
            req = urllib.request.Request(
                WD, data=body,
                headers={"Accept": "application/sparql-results+json", "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.loads(r.read())
            return [{k: v.get("value") for k, v in b.items()} for b in data.get("results", {}).get("bindings", [])]
        except Exception as e:
            last = e
            time.sleep(2 * (i + 1))
    raise last


def qid(uri):
    return uri.rsplit("/", 1)[-1] if uri else None


# ---------- power plants ----------
def build_plants():
    src = RAW / "gppd.csv"
    nuclear, major = [], []
    with src.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                lat, lng = float(row["latitude"]), float(row["longitude"])
                mw = float(row["capacity_mw"] or 0)
            except (TypeError, ValueError):
                continue
            if not (-90 <= lat <= 90 and -180 <= lng <= 180) or mw <= 0:
                continue
            rec = {
                "n": row["name"].strip(),
                "c": (row["country_long"] or row["country"] or "").strip(),
                "fuel": row["primary_fuel"].strip(),
                "mw": round(mw, 1),
                "lat": rlat(lat),
                "lng": rlat(lng),
            }
            own = (row.get("owner") or "").strip()
            if own:
                rec["own"] = own
            yr = (row.get("commissioning_year") or "").strip()
            if yr:
                try:
                    rec["yr"] = int(float(yr))
                except ValueError:
                    pass
            if row["primary_fuel"] == "Nuclear":
                nuclear.append(rec)
            elif mw >= 1000:
                major.append(rec)
    nuclear.sort(key=lambda x: -x["mw"])
    major.sort(key=lambda x: -x["mw"])
    meta_common = {
        "source": "WRI Global Power Plant Database v1.3.0 (2021)",
        "url": "https://github.com/wri/global-power-plant-database",
        "license": "CC BY 4.0",
        "retrieved": TODAY,
        "note": "Database is no longer updated (last WRI release 2021). Plants built after that year are missing.",
        "attribution": "Global Power Plant Database, World Resources Institute, CC BY 4.0",
    }
    wr("nuclear.json", {"meta": {**meta_common, "title": "Nuclear power plants", "filter": "primary_fuel = Nuclear, valid coordinates"}, "n": len(nuclear), "items": nuclear})
    wr("power.json", {"meta": {**meta_common, "title": "Major power plants", "filter": "capacity_mw >= 1000, excluding nuclear (shown on the nuclear layer)"}, "n": len(major), "items": major})


# ---------- ports ----------
def build_ports():
    data = json.loads((RAW / "ne_ports.geojson").read_text())
    items = []
    for f in data.get("features") or []:
        p, g = f.get("properties") or {}, f.get("geometry") or {}
        if (p.get("scalerank") or 99) > 5:
            continue
        if not g or g.get("type") != "Point":
            continue
        lng, lat = g["coordinates"][:2]
        rec = {"n": (p.get("name") or "Port").strip(), "lat": rlat(lat), "lng": rlat(lng), "rank": p.get("scalerank")}
        if p.get("website"):
            rec["web"] = p["website"] if str(p["website"]).startswith("http") else "https://" + str(p["website"])
        items.append(rec)
    items.sort(key=lambda x: (x.get("rank") or 99, x["n"]))
    wr("ports.json", {
        "meta": {
            "title": "Major ports",
            "source": "Natural Earth 10m ports (public domain)",
            "url": "https://www.naturalearthdata.com/downloads/10m-cultural-vectors/ports/",
            "license": "Public domain (Natural Earth)",
            "retrieved": TODAY,
            "filter": "scalerank <= 5 (major ports at world scale)",
            "attribution": "Natural Earth, public domain",
        },
        "n": len(items),
        "items": items,
    })


# ---------- cables ----------
def build_cables():
    data = json.loads((RAW / "cables.osm.json").read_text())
    groups = defaultdict(list)
    info = {}
    for el in data.get("elements") or []:
        tags = el.get("tags") or {}
        name = (tags.get("name") or "").strip()
        coords = osm_way_coords(el)
        if not name or len(coords) < 2:
            continue
        key = tags.get("wikidata") or name
        groups[key].append(coords)
        info.setdefault(key, {
            "n": name,
            "op": tags.get("operator") or tags.get("owner"),
            "cat": tags.get("seamark:cable_submarine:category") or tags.get("telecom:medium") or tags.get("communication"),
            "wd": tags.get("wikidata"),
            "wp": (tags.get("wikipedia") or "").replace("en:", "https://en.wikipedia.org/wiki/") if tags.get("wikipedia") else None,
        })
    items = []
    for key, lines in groups.items():
        slim = [simplify(ln, tol=0.1, max_pts=36) for ln in lines]
        slim = [ln for ln in slim if len(ln) >= 2]
        if not slim:
            continue
        rec = {k: v for k, v in info[key].items() if v}
        rec["km"] = int(round(sum(line_km(ln) for ln in slim)))
        rec["lines"] = slim
        items.append(rec)
    items.sort(key=lambda x: -x.get("km", 0))
    wr("cables.json", {
        "meta": {
            "title": "Undersea internet / communication cables",
            "source": "OpenStreetMap (named submarine communication cables)",
            "url": "https://www.openstreetmap.org/copyright",
            "license": "ODbL 1.0",
            "retrieved": TODAY,
            "osm_base": data.get("osm3s", {}).get("timestamp_osm_base"),
            "filter": "Named ways tagged communication=line and location=underwater/submarine, or seamark:type=cable_submarine with a telephone/fibre category. Geometries simplified for a world map.",
            "note": "OSM coverage is incomplete compared with commercial cable maps. Routes are as mapped in OSM and may be approximate. © OpenStreetMap contributors.",
            "attribution": "© OpenStreetMap contributors (ODbL 1.0)",
        },
        "n": len(items),
        "items": items,
    })


# ---------- pipelines ----------
def build_pipelines():
    data = json.loads((RAW / "pipes.osm.json").read_text())
    ways = {el["id"]: el for el in data.get("elements") or [] if el.get("type") == "way"}
    used_ways = set()
    items = []

    def add(name, tags, lines):
        slim = [simplify(ln, tol=0.12, max_pts=32) for ln in lines if len(ln) >= 2]
        slim = [ln for ln in slim if len(ln) >= 2]
        if not slim:
            return
        km = int(round(sum(line_km(ln) for ln in slim)))
        rec = {"n": name, "fuel": (tags.get("substance") or tags.get("content") or "").split(";")[0], "lines": slim, "km": km}
        if tags.get("operator"):
            rec["op"] = tags["operator"]
        if tags.get("wikidata"):
            rec["wd"] = tags["wikidata"]
        items.append(rec)

    for el in data.get("elements") or []:
        if el.get("type") != "relation":
            continue
        tags = el.get("tags") or {}
        name = (tags.get("name:en") or tags.get("name") or "").strip()
        if not name:
            continue
        lines = osm_rel_lines(el, ways)
        if not lines:
            continue
        for m in el.get("members") or []:
            if m.get("type") == "way" and m.get("ref"):
                used_ways.add(m["ref"])
        add(name, tags, lines)

    # long independent ways not already in a relation, grouped by name
    leftover = defaultdict(list)
    leftover_tags = {}
    for el in ways.values():
        if el["id"] in used_ways:
            continue
        tags = el.get("tags") or {}
        name = (tags.get("name:en") or tags.get("name") or "").strip()
        coords = osm_way_coords(el)
        if not name or len(coords) < 2:
            continue
        leftover[name].append(coords)
        leftover_tags[name] = tags
    for name, lines in leftover.items():
        km = sum(line_km(ln) for ln in lines)
        if km < 250:
            continue
        add(name, leftover_tags[name], lines)

    # dedupe exact names keeping the longer record
    best = {}
    for rec in items:
        prev = best.get(rec["n"])
        if not prev or rec["km"] > prev["km"]:
            best[rec["n"]] = rec
    items = sorted(best.values(), key=lambda x: -x["km"])
    wr("pipelines.json", {
        "meta": {
            "title": "Major oil and gas pipelines",
            "source": "OpenStreetMap (named oil/gas pipelines)",
            "url": "https://www.openstreetmap.org/copyright",
            "license": "ODbL 1.0",
            "retrieved": TODAY,
            "osm_base": data.get("osm3s", {}).get("timestamp_osm_base"),
            "filter": "Named OSM pipeline relations (oil/gas/crude/petroleum/natural gas) plus independent named ways whose mapped length is at least 250 km. Geometries simplified for a world map; routes can be approximate.",
            "attribution": "© OpenStreetMap contributors (ODbL 1.0)",
        },
        "n": len(items),
        "items": items,
    })


# ---------- military bases ----------
COMPONENT = {
    "army": "US Army", "usar": "US Army", "usa": "US Army",
    "navy": "US Navy", "usn": "US Navy", "usna": "US Navy",
    "air force": "US Air Force", "usaf": "US Air Force",
    "marine": "US Marine Corps", "usmc": "US Marine Corps",
    "coast": "US Coast Guard", "uscg": "US Coast Guard",
    "dod": "US DoD", "nga": "NGA", "nsa": "NSA", "dia": "DIA",
    "whepp": "DoD", "af": "US Air Force",
}


def map_component(raw):
    s = (raw or "").strip().lower()
    for k, v in COMPONENT.items():
        if k in s:
            return v
    return (raw or "").upper() or None


def build_bases_ntad():
    data = json.loads((RAW / "ntad.geojson").read_text())
    by_site = {}
    for f in data.get("features") or []:
        p, g = f.get("properties") or {}, f.get("geometry")
        if not g:
            continue
        if (p.get("isCui") or "no").lower() not in ("no", "false", "0", ""):
            continue
        if (p.get("siteOperationalStatus") or "act").lower() not in ("act", "active", ""):
            continue
        c = bbox_center(g)
        if not c:
            continue
        lat, lng = c
        name = (p.get("siteName") or p.get("featureName") or "").strip()
        if not name:
            continue
        area = float(p.get("Shape__Area") or 0)
        rec = {
            "n": name,
            "c": (p.get("countryName") or "").strip().upper(),
            "arm": map_component(p.get("siteReportingComponent")),
            "lat": lat,
            "lng": lng,
            "src": "NTAD",
            "_area": area,
        }
        prev = by_site.get(name.lower())
        if not prev or area > prev["_area"]:
            by_site[name.lower()] = rec
    # Keep the largest US sites plus every non-US (overseas) site
    sites = list(by_site.values())
    overseas = [s for s in sites if s["c"] and s["c"] not in ("USA", "US", "UNITED STATES")]
    domestic = [s for s in sites if s not in overseas]
    domestic.sort(key=lambda x: -x["_area"])
    kept = overseas + domestic[:280]
    for s in kept:
        s.pop("_area", None)
        if s["c"] in ("USA", "US"):
            s["c"] = "United States"
    return kept


def build_bases_wikidata():
    q = """
    SELECT DISTINCT ?item ?itemLabel ?coord ?countryLabel ?typeLabel WHERE {
      VALUES ?type { wd:Q245016 wd:Q695850 wd:Q1324633 }
      ?item wdt:P31 ?type.
      ?item wdt:P625 ?coord.
      ?item wikibase:sitelinks ?links.
      FILTER(?links >= 8)
      OPTIONAL { ?item wdt:P17 ?country. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    """
    rows = sparql(q, timeout=120)
    items = []
    seen = set()
    for r in rows:
        pt = parse_point(r.get("coord"))
        name = (r.get("itemLabel") or "").strip()
        if not pt or not name or name.startswith("Q") or name.lower() in seen:
            continue
        seen.add(name.lower())
        rec = {"n": name, "lat": pt[0], "lng": pt[1], "src": "Wikidata", "wd": qid(r.get("item"))}
        if r.get("countryLabel"):
            rec["c"] = r["countryLabel"]
        if r.get("typeLabel"):
            rec["typ"] = r["typeLabel"]
        items.append(rec)
    return items


def close(a, b, km=25):
    return hav((a["lat"], a["lng"]), (b["lat"], b["lng"])) <= km


def build_bases():
    ntad = build_bases_ntad()
    wd = build_bases_wikidata()
    merged = list(ntad)
    for rec in wd:
        if any(close(rec, x, 30) for x in merged):
            continue
        merged.append(rec)
    merged.sort(key=lambda x: (x.get("c") or "", x["n"]))
    wr("bases.json", {
        "meta": {
            "title": "Military bases",
            "source": "USDOT/BTS National Transportation Atlas Database (NTAD) Military Bases, plus notable non-overlapping bases from Wikidata",
            "url": "https://geodata.bts.gov/",
            "license": "NTAD: work of the U.S. government, public domain (17 U.S.C. § 101). Wikidata: CC0.",
            "retrieved": TODAY,
            "filter": "NTAD: operational (act), not CUI, unique site name (largest polygon), all overseas sites plus the 280 largest U.S. sites. Wikidata: instance of military base (Q245016), airbase (Q695850) or naval base (Q1324633) with ≥8 Wikipedia sitelinks; dropped if within 30 km of an NTAD site.",
            "note": "Not a complete inventory of all military facilities. NTAD covers publicly released U.S. DoD sites worldwide. Other countries come from well-documented Wikidata items only.",
            "attribution": "U.S. Department of Transportation, Bureau of Transportation Statistics, National Transportation Atlas Database (Military Bases); Wikidata contributors (CC0)",
        },
        "n": len(merged),
        "items": merged,
    })


# ---------- tech (data centers, hubs, AI labs) ----------
TECH_HUBS = [
    # Well-known technology hubs; coordinates and labels come from Wikidata (not invented).
    "Q163820",  # Silicon Valley
    "Q62",      # San Francisco
    "Q5083",    # Seattle
    "Q16559",   # Austin
    "Q100",     # Boston
    "Q60",      # New York City
    "Q172",     # Toronto
    "Q84",      # London
    "Q64",      # Berlin
    "Q90",      # Paris
    "Q727",     # Amsterdam
    "Q1761",    # Dublin
    "Q1754",    # Stockholm
    "Q72",      # Zurich
    "Q33935",   # Tel Aviv
    "Q1355",    # Bengaluru
    "Q1361",    # Hyderabad
    "Q1538",    # Pune
    "Q238508",  # Gurugram / Gurgaon
    "Q15174",   # Shenzhen
    "Q956",     # Beijing
    "Q8686",    # Shanghai
    "Q4970",    # Hangzhou
    "Q1490",    # Tokyo
    "Q8684",    # Seoul
    "Q1867",    # Taipei
    "Q334",     # Singapore
    "Q3130",    # Sydney
    "Q174",     # São Paulo
    "Q612",     # Dubai
    "Q3870",    # Nairobi
    "Q8673",    # Lagos
]


def build_tech():
    items = []
    # Hubs
    values = " ".join(f"wd:{q}" for q in TECH_HUBS)
    rows = sparql(f"""
    SELECT ?item ?itemLabel ?coord ?countryLabel WHERE {{
      VALUES ?item {{ {values} }}
      ?item wdt:P625 ?coord.
      OPTIONAL {{ ?item wdt:P17 ?country. }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }}
    """, timeout=60)
    seen = set()
    for r in rows:
        pt = parse_point(r.get("coord"))
        name = (r.get("itemLabel") or "").strip()
        if not pt or not name:
            continue
        rec = {"n": name, "lat": pt[0], "lng": pt[1], "typ": "Tech hub", "wd": qid(r.get("item"))}
        if r.get("countryLabel"):
            rec["c"] = r["countryLabel"]
        items.append(rec)
        seen.add((round(pt[0], 2), round(pt[1], 2)))

    # Notable data centers
    dc_rows = sparql("""
    SELECT DISTINCT ?item ?itemLabel ?coord ?countryLabel ?operatorLabel ?typ WHERE {
      VALUES ?class { wd:Q671224 wd:Q1433061 }
      ?item wdt:P31 ?class.
      OPTIONAL { ?item wdt:P625 ?c1. }
      OPTIONAL { ?item wdt:P276 ?loc. ?loc wdt:P625 ?c2. }
      BIND(COALESCE(?c1, ?c2) AS ?coord)
      FILTER(BOUND(?coord))
      OPTIONAL { ?item wdt:P17 ?country. }
      OPTIONAL { ?item wdt:P137 ?operator. }
      BIND(IF(?class = wd:Q1433061, "Internet exchange", "Data center") AS ?typ)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 400
    """, timeout=120)
    for r in dc_rows:
        pt = parse_point(r.get("coord"))
        name = (r.get("itemLabel") or "").strip()
        if not pt or not name or name.startswith("Q"):
            continue
        key = (round(pt[0], 2), round(pt[1], 2))
        rec = {"n": name, "lat": pt[0], "lng": pt[1], "typ": r.get("typ") or "Data center", "wd": qid(r.get("item"))}
        if r.get("countryLabel"):
            rec["c"] = r["countryLabel"]
        if r.get("operatorLabel") and not r["operatorLabel"].startswith("Q"):
            rec["op"] = r["operatorLabel"]
        items.append(rec)
        seen.add(key)

    # AI labs / companies
    ai_rows = sparql("""
    SELECT DISTINCT ?item ?itemLabel ?coord ?countryLabel WHERE {
      { ?item wdt:P452 wd:Q11660. } UNION { ?item wdt:P101 wd:Q11660. }
      OPTIONAL { ?item wdt:P625 ?c1. }
      OPTIONAL { ?item wdt:P159 ?hq. ?hq wdt:P625 ?c2. }
      BIND(COALESCE(?c1, ?c2) AS ?coord)
      FILTER(BOUND(?coord))
      ?item wikibase:sitelinks ?links. FILTER(?links >= 3)
      OPTIONAL { ?item wdt:P17 ?country. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 250
    """, timeout=120)
    for r in ai_rows:
        pt = parse_point(r.get("coord"))
        name = (r.get("itemLabel") or "").strip()
        if not pt or not name or name.startswith("Q"):
            continue
        rec = {"n": name, "lat": pt[0], "lng": pt[1], "typ": "AI lab / company", "wd": qid(r.get("item"))}
        if r.get("countryLabel"):
            rec["c"] = r["countryLabel"]
        items.append(rec)

    # de-dupe by qid or name+approx coord
    best, keys = [], set()
    for rec in items:
        k = rec.get("wd") or (rec["n"].lower(), round(rec["lat"], 2), round(rec["lng"], 2))
        if k in keys:
            continue
        keys.add(k)
        best.append(rec)
    best.sort(key=lambda x: (x.get("typ") or "", x["n"]))
    wr("tech.json", {
        "meta": {
            "title": "Data centers, tech hubs and AI labs",
            "source": "Wikidata",
            "url": "https://www.wikidata.org/",
            "license": "CC0",
            "retrieved": TODAY,
            "filter": "Tech hubs: a fixed list of well-known hub cities/regions with Wikidata coordinates. Data centers and internet exchanges: instance of data center (Q671224) or internet exchange point (Q1433061) with item or location coordinates. AI labs/companies: industry or field of work artificial intelligence (Q11660), item or headquarters coordinates, and at least 3 Wikipedia sitelinks.",
            "note": "This is a notable-item sample from Wikidata, not a complete inventory of data centers or labs.",
            "attribution": "Wikidata contributors (CC0)",
        },
        "n": len(best),
        "items": best,
    })


# ---------- crypto exchanges ----------
def build_crypto_exchanges():
    rows = sparql("""
    SELECT DISTINCT ?item ?itemLabel ?coord ?countryLabel ?url WHERE {
      ?item wdt:P31/wdt:P279? wd:Q25401607.
      OPTIONAL { ?item wdt:P625 ?c1. }
      OPTIONAL { ?item wdt:P159 ?hq. ?hq wdt:P625 ?c2. }
      BIND(COALESCE(?c1, ?c2) AS ?coord)
      FILTER(BOUND(?coord))
      OPTIONAL { ?item wdt:P17 ?country. }
      OPTIONAL { ?item wdt:P856 ?url. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    """, timeout=90)
    items, keys = [], set()
    for r in rows:
        pt = parse_point(r.get("coord"))
        name = (r.get("itemLabel") or "").strip()
        wd = qid(r.get("item"))
        if not pt or not name or not wd or wd in keys or name.startswith("Q"):
            continue
        keys.add(wd)
        rec = {"n": name, "lat": pt[0], "lng": pt[1], "typ": "Crypto exchange", "wd": wd}
        if r.get("countryLabel"):
            rec["c"] = r["countryLabel"]
        if r.get("url") and r["url"].startswith("http"):
            rec["url"] = r["url"]
        items.append(rec)
    items.sort(key=lambda x: x["n"])
    wr("crypto-exchanges.json", {
        "meta": {
            "title": "Cryptocurrency exchanges",
            "source": "Wikidata (exchange or headquarters coordinates)",
            "url": "https://www.wikidata.org/",
            "license": "CC0",
            "retrieved": TODAY,
            "filter": "Items instance of cryptocurrency exchange (Q25401607), with item or HQ coordinates. Live prices on the dashboard still come from the CoinGecko API (with CoinPaprika fallback), not from this file.",
            "note": "Headquarters / registered locations only — not trading volume and not a complete list of exchanges.",
            "attribution": "Wikidata contributors (CC0)",
        },
        "n": len(items),
        "items": items,
    })


# ---------- chokepoints ----------
# Official EIA World Oil Transit Chokepoints, plus a few additional widely cited
# strategic maritime chokepoints (clearly labelled). Coordinates from Wikidata.
CHOKEPOINTS = [
    ("Q79883", "eia", "Strait of Hormuz", "Busiest oil chokepoint, between the Persian Gulf and the Gulf of Oman."),
    ("Q48359", "eia", "Strait of Malacca", "Main shipping lane between the Indian Ocean and the South China Sea."),
    ("Q899", "eia", "Suez Canal", "Links the Red Sea and the Mediterranean. EIA groups this with the SUMED pipeline."),
    ("Q83318", "eia", "Bab el-Mandeb", "Links the Red Sea and the Gulf of Aden / Arabian Sea."),
    ("Q816210", "eia", "Danish Straits", "The Danish straits (including the Great Belt and Øresund) connecting the Baltic Sea to the North Sea."),
    ("Q1051401", "eia", "Turkish Straits", "Bosporus and Dardanelles, linking the Black Sea to the Mediterranean."),
    ("Q7350", "eia", "Panama Canal", "Links the Pacific and Atlantic Oceans across the Isthmus of Panama."),
    ("Q4092", "eia", "Cape of Good Hope", "Listed by EIA as an alternative route around southern Africa when other chokepoints are disrupted."),
    ("Q36124", "extra", "Strait of Gibraltar", "Entrance to the Mediterranean Sea; widely cited strategic maritime chokepoint (not on EIA's oil-transit list)."),
    ("Q127031", "extra", "Taiwan Strait", "Separates Taiwan and mainland China; widely cited strategic maritime chokepoint (not on EIA's oil-transit list)."),
    ("Q745025", "extra", "Lombok Strait", "Alternative to Malacca for larger vessels; widely cited strategic maritime chokepoint (not on EIA's oil-transit list)."),
    ("Q159898", "extra", "Strait of Dover", "Busiest shipping lane in the English Channel; widely cited strategic maritime chokepoint (not on EIA's oil-transit list)."),
]


def build_chokepoints():
    values = " ".join(f"wd:{q}" for q, *_ in CHOKEPOINTS)
    rows = sparql(f"""
    SELECT ?item ?itemLabel ?coord WHERE {{
      VALUES ?item {{ {values} }}
      ?item wdt:P625 ?coord.
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }}
    """, timeout=60)
    by_id = {qid(r.get("item")): r for r in rows}
    items = []
    missing = []
    for q, kind, title, note in CHOKEPOINTS:
        r = by_id.get(q)
        pt = parse_point((r or {}).get("coord"))
        if not pt:
            missing.append(q + " " + title)
            continue
        items.append({
            "n": title,
            "lat": pt[0],
            "lng": pt[1],
            "typ": "EIA oil transit chokepoint" if kind == "eia" else "Strategic maritime chokepoint",
            "note": note,
            "wd": q,
            "src": "EIA World Oil Transit Chokepoints" if kind == "eia" else "Additional widely cited chokepoint (not on the EIA oil-transit list)",
        })
    if missing:
        print("WARNING missing chokepoint coords:", missing)
    wr("chokepoints.json", {
        "meta": {
            "title": "Strategic chokepoints",
            "source": "U.S. EIA World Oil Transit Chokepoints (list of named straits/canals); coordinates from Wikidata (CC0)",
            "url": "https://www.eia.gov/international/analysis/special-topics/World_Oil_Transit_Chokepoints",
            "license": "EIA information is U.S. government work (public domain). Wikidata coordinates: CC0.",
            "retrieved": TODAY,
            "note": "Eight entries follow the EIA oil-transit chokepoint list. Four extra maritime chokepoints are labelled as such. Locations are the Wikidata coordinate of the named feature, not a shipping-lane centerline.",
            "attribution": "U.S. Energy Information Administration, World Oil Transit Chokepoints; Wikidata contributors (CC0)",
        },
        "n": len(items),
        "items": items,
    })


def write_sources():
    (OUT / "SOURCES.md").write_text(f"""# Global Pulse intel-layer sources

Built {ISO}. Every file in this folder is a slim, static extract of an open dataset.
Do not add datasets that cannot be redistributed (for example TeleGeography's cable GeoJSON,
which requires a separate data licence).

| File | Layer | Source | Licence | Filter |
|---|---|---|---|---|
| `cables.json` | Undersea internet cables | OpenStreetMap named submarine communication cables | ODbL 1.0 | Named communication/fibre submarine ways; simplified |
| `nuclear.json` | Nuclear power plants | WRI Global Power Plant Database v1.3.0 | CC BY 4.0 | `primary_fuel = Nuclear` |
| `power.json` | Major power plants | WRI Global Power Plant Database v1.3.0 | CC BY 4.0 | `capacity_mw >= 1000`, excluding nuclear |
| `crypto-exchanges.json` | Crypto exchanges (map) | Wikidata | CC0 | Crypto-exchange items with HQ/item coordinates |
| `tech.json` | Data centers, tech hubs, AI labs | Wikidata | CC0 | Notable items; see file `meta.filter` |
| `bases.json` | Military bases | NTAD Military Bases (US DoD, via USDOT/BTS) + Wikidata | Public domain + CC0 | Operational public NTAD sites + notable Wikidata bases |
| `ports.json` | Major ports | Natural Earth 10m ports | Public domain | `scalerank <= 5` |
| `pipelines.json` | Oil & gas pipelines | OpenStreetMap named oil/gas pipelines | ODbL 1.0 | Relations + independent ways ≥ 250 km; simplified |
| `chokepoints.json` | Strategic chokepoints | EIA World Oil Transit Chokepoints + Wikidata coordinates | Public domain + CC0 | EIA list plus 4 clearly labelled extras |

Live (not stored here): CoinGecko / CoinPaprika prices, GDELT conflict points, GDACS, USGS quakes, NASA EONET.

Rebuild: `python3 scripts/build-intel.py` (expects raw extracts in `/tmp/gp-intel/` as produced by the documented curl/Overpass steps).
""")
    print("wrote SOURCES.md")


def main():
    build_plants()
    build_ports()
    build_cables()
    build_pipelines()
    build_bases()
    build_tech()
    build_crypto_exchanges()
    build_chokepoints()
    write_sources()


if __name__ == "__main__":
    main()

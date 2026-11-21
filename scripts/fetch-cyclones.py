#!/usr/bin/env python3
"""Fetch live tropical cyclones for all basins into data/cyclones.json.

Sources (all keyless): NHC CurrentStorms + GIS when present (Atlantic, E/C Pacific);
JTWC RSS + warning text + KMZ tracks/cones (W Pacific, North Indian, South Indian,
Australia, South Pacific); GDACS TC list as a fallback for current position.
No API keys. Run locally or from CI: python3 scripts/fetch-cyclones.py
"""
from __future__ import annotations

import io
import json
import re
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "cyclones.json"
UA = "global-pulse-data-bot (+https://github.com/ashswin-git/global-pulse)"


def get(url: str, timeout=30) -> bytes:
    req = Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urlopen(req, timeout=timeout) as r:
        return r.read()


def basin_of(lat: float, lng: float) -> str:
    if lat >= 0:
        if 40 <= lng < 100:
            return "North Indian" + (" (Bay of Bengal)" if lng >= 78 else " (Arabian Sea)")
        if 100 <= lng <= 180:
            return "W Pacific"
        if -180 <= lng < -140:
            return "C Pacific"
        if -140 <= lng < -80:
            return "E Pacific"
        if -80 <= lng <= 10:
            return "Atlantic"
        return "North Indian (Arabian Sea)" if 10 < lng < 40 else "W Pacific"
    if 20 <= lng < 90:
        return "South Indian"
    if 90 <= lng < 160:
        return "Australia"
    return "South Pacific"



def parse_ll(token_lat: str, token_lng: str | None = None):
    """Parse 11.5S 164.2W or 11.5S164.2W."""
    s = (token_lat + " " + (token_lng or "")).upper().replace(",", " ")
    m = re.search(r"(\d+(?:\.\d+)?)\s*([NS])\s+(\d+(?:\.\d+)?)\s*([EW])", s)
    if not m:
        return None
    lat, ns, lng, ew = float(m.group(1)), m.group(2), float(m.group(3)), m.group(4)
    if ns == "S":
        lat = -lat
    if ew == "W":
        lng = -lng
    return [round(lat, 2), round(lng, 2)]


def kml_coords(block: str) -> list[list[float]]:
    m = re.search(r"<coordinates>\s*([\s\S]*?)</coordinates>", block, re.I)
    if not m:
        return []
    pts = []
    for trip in re.split(r"\s+", m.group(1).strip()):
        parts = trip.split(",")
        if len(parts) >= 2:
            try:
                lon, lat = float(parts[0]), float(parts[1])
                pts.append([round(lat, 4), round(lon, 4)])
            except ValueError:
                pass
    return pts


def parse_kml(kml: str, storm: dict) -> None:
    for m in re.finditer(r"<Placemark>([\s\S]*?)</Placemark>", kml):
        b = m.group(1)
        name = re.search(r"<name>([^<]+)</name>", b)
        nm = (name.group(1) if name else "").strip()
        low = nm.lower()
        if "LineString" in b and ("best track" in low or "storm track" in low or "forecast" in low):
            line = kml_coords(b)
            if "best" in low:
                storm["past"] = line
            elif len(line) >= 2:
                storm["forecast"] = line
        elif "Polygon" in b and ("danger swath" in low or "cone" in low or "swath" in low):
            ring = kml_coords(b)
            if len(ring) >= 4:
                storm["cone"] = ring
        elif "<Point>" in b:
            pt = kml_coords(b)
            if not pt:
                continue
            if re.match(r"\d{6,}", nm) or "previous" in low:
                storm.setdefault("pastPts", []).append({"t": nm, "lat": pt[0][0], "lng": pt[0][1]})
            elif "kt" in low or "warning" in low or re.match(r"\d{2}/\d{2}Z", nm):
                # forecast / current point with intensity in the name
                kt = re.search(r"(\d+)\s*knots", nm, re.I)
                rec = {"lat": pt[0][0], "lng": pt[0][1], "label": nm}
                if kt:
                    rec["kt"] = int(kt.group(1))
                if "warning" in low or "00Z" in nm[:6]:
                    if not storm.get("lat"):
                        storm["lat"], storm["lng"] = rec["lat"], rec["lng"]
                        if rec.get("kt"):
                            storm["kt"] = rec["kt"]
                storm.setdefault("forecastPts", []).append(rec)


def parse_warning_text(txt: str, storm: dict) -> None:
    # Current position
    m = re.search(r"WARNING POSITION:.*?NEAR\s+(\d+(?:\.\d+)?[NS])\s+(\d+(?:\.\d+)?[EW])", txt, re.S | re.I)
    if m:
        ll = parse_ll(m.group(1), m.group(2))
        if ll:
            storm["lat"], storm["lng"] = ll
    mv = re.search(r"MOVEMENT PAST SIX HOURS\s*-\s*(\d+)\s*DEGREES AT\s*(\d+)\s*KTS", txt, re.I)
    if mv:
        storm["movement"] = f"{mv.group(1)}° at {mv.group(2)} kt"
    w = re.search(r"MAX SUSTAINED WINDS\s*-\s*(\d+)\s*KT,\s*GUSTS\s*(\d+)\s*KT", txt, re.I)
    if w:
        storm["kt"] = int(w.group(1))
        storm["gustKt"] = int(w.group(2))
    # Forecast points: 12 HRS, VALID AT: 211200Z --- 12.0S 165.2W
    fpts = []
    for fm in re.finditer(
        r"(\d+)\s*HRS, VALID AT:\s*(\d{6}Z)\s*---\s*(\d+(?:\.\d+)?[NS])\s+(\d+(?:\.\d+)?[EW]).*?MAX SUSTAINED WINDS\s*-\s*(\d+)\s*KT",
        txt,
        re.S | re.I,
    ):
        ll = parse_ll(fm.group(3), fm.group(4))
        if ll:
            fpts.append({"hrs": int(fm.group(1)), "t": fm.group(2), "lat": ll[0], "lng": ll[1], "kt": int(fm.group(5))})
    if fpts:
        storm["forecastPts"] = fpts
        storm["forecast"] = [[p["lat"], p["lng"]] for p in fpts]
        if storm.get("lat") is not None:
            storm["forecast"] = [[storm["lat"], storm["lng"]]] + storm["forecast"]
    # Build a simple widening cone if none from KMZ
    if fpts and not storm.get("cone"):
        storm["cone"] = widen_cone([[storm["lat"], storm["lng"]]] + [[p["lat"], p["lng"]] for p in fpts] if storm.get("lat") else [[p["lat"], p["lng"]] for p in fpts])


def widen_cone(line: list[list[float]], nm0: float = 50) -> list[list[float]]:
    """Simple forecast cone: offset the track left/right with widening radius."""
    if len(line) < 2:
        return []
    left, right = [], []
    n = len(line)
    for i, (lat, lng) in enumerate(line):
        # radius in km, ~ (50 + 30*i) nm
        rad_km = (nm0 + 35 * i) * 1.852
        dlat = rad_km / 111.0
        dlng = rad_km / (111.0 * max(0.2, abs(__import__("math").cos(lat * 3.14159 / 180))))
        # perpendicular from next/prev point
        j = min(i + 1, n - 1)
        k = max(i - 1, 0)
        dy, dx = line[j][0] - line[k][0], line[j][1] - line[k][1]
        L = max(1e-6, (dy * dy + dx * dx) ** 0.5)
        ux, uy = -dy / L * dlat, dx / L * dlng  # rough perpendicular
        # fix: use consistent units
        px, py = -dy / L, dx / L
        left.append([round(lat + px * dlat, 3), round(lng + py * dlng, 3)])
        right.append([round(lat - px * dlat, 3), round(lng - py * dlng, 3)])
    return left + list(reversed(right)) + left[:1]


def parse_jtwc_rss(xml: str) -> list[str]:
    urls = []
    for href in re.findall(r"https?://[^'\"<\s]+web\.txt", xml, re.I):
        if href not in urls:
            urls.append(href)
    kmz = []
    for href in re.findall(r"https?://[^'\"<\s]+\.kmz", xml, re.I):
        if href not in kmz:
            kmz.append(href)
    return urls, kmz


def warn_to_storm(txt: str, url: str) -> dict:
    title = re.search(r"SUBJ/([^/\n]+)", txt)
    name = "Tropical cyclone"
    ident = ""
    if title:
        raw = title.group(1).replace("//", "").strip()
        raw = re.sub(r"\s+WARNING.*", "", raw, flags=re.I)
        name = raw.title() if raw.isupper() else raw
    m = re.search(r"(TROPICAL CYCLONE|TYPHOON|HURRICANE|TROPICAL STORM|TROPICAL DEPRESSION)\s+(\d+[A-Z]?)\s*(?:\(([A-Z ]+)\))?", txt, re.I)
    if m:
        ident = m.group(2).upper()
        if m.group(3):
            name = f"{m.group(1).title()} {m.group(2).upper()} ({m.group(3).title()})"
        else:
            name = f"{m.group(1).title()} {m.group(2).upper()}"
    storm = {
        "id": ident or url.rsplit("/", 1)[-1].replace("web.txt", ""),
        "name": name,
        "source": "JTWC",
        "sourceUrl": url,
        "agency": "Joint Typhoon Warning Center",
    }
    parse_warning_text(txt, storm)
    if storm.get("lat") is not None:
        storm["basin"] = basin_of(storm["lat"], storm["lng"])
    return storm


def load_kmz(url: str, storm: dict) -> None:
    try:
        raw = get(url, timeout=40)
        zf = zipfile.ZipFile(io.BytesIO(raw))
        kml_name = next((n for n in zf.namelist() if n.lower().endswith(".kml")), None)
        if not kml_name:
            return
        kml = zf.read(kml_name).decode("utf-8", "replace")
        parse_kml(kml, storm)
        if storm.get("lat") is not None and not storm.get("basin"):
            storm["basin"] = basin_of(storm["lat"], storm["lng"])
    except Exception as e:
        storm.setdefault("notes", []).append("KMZ: " + str(e)[:120])


def fetch_jtwc() -> list[dict]:
    storms = []
    try:
        xml = get("https://www.metoc.navy.mil/jtwc/rss/jtwc.rss").decode("utf-8", "replace")
    except Exception as e:
        print("jtwc rss", e)
        return storms
    texts, kmzs = parse_jtwc_rss(xml)
    # pair kmz by stem
    kmz_by_stem = {}
    for u in kmzs:
        stem = re.sub(r"\.[^.]+$", "", u.rsplit("/", 1)[-1]).lower()
        kmz_by_stem[stem] = u
    for tu in texts:
        try:
            txt = get(tu).decode("utf-8", "replace")
        except Exception as e:
            print("jtwc warn", tu, e)
            continue
        if "NO CURRENT TROPICAL" in txt.upper() and "WARNING POSITION" not in txt.upper():
            continue
        if "WARNING POSITION" not in txt.upper() and "MAX SUSTAINED WINDS" not in txt.upper():
            continue
        st = warn_to_storm(txt, tu)
        stem = re.sub(r"web\.txt$", "", tu.rsplit("/", 1)[-1], flags=re.I).lower()
        if stem in kmz_by_stem:
            load_kmz(kmz_by_stem[stem], st)
        if st.get("lat") is not None:
            storms.append(st)
            print("jtwc", st.get("name"), st.get("basin"), st.get("lat"), st.get("lng"), "kt", st.get("kt"))
    return storms


def fetch_nhc() -> list[dict]:
    storms = []
    try:
        data = json.loads(get("https://www.nhc.noaa.gov/CurrentStorms.json").decode())
    except Exception as e:
        print("nhc", e)
        return storms
    for s in data.get("activeStorms") or []:
        lat, lng = s.get("latitude") or s.get("lat"), s.get("longitude") or s.get("lon")
        try:
            lat, lng = float(lat), float(lng)
        except (TypeError, ValueError):
            continue
        rec = {
            "id": s.get("id") or s.get("binNumber") or s.get("name"),
            "name": s.get("name") or "NHC storm",
            "lat": lat,
            "lng": lng,
            "kt": s.get("intensity") or s.get("windSpeed") or s.get("wind"),
            "movement": s.get("movement") or s.get("direction"),
            "basin": basin_of(lat, lng),
            "source": "NHC",
            "agency": "NOAA National Hurricane Center",
            "sourceUrl": s.get("url") or "https://www.nhc.noaa.gov/",
            "classification": s.get("classification") or s.get("type"),
        }
        # Try public GIS cone / track if an id like AL092026 is present
        sid = str(rec["id"]).upper()
        for cand in (
            f"https://www.nhc.noaa.gov/storm_graphics/{sid[:2]}/{sid}_TRACK.kml",
            f"https://www.nhc.noaa.gov/gis/forecast/archive/{sid.lower()}_5day_cone_no_line_and_wind.kml",
        ):
            try:
                kml = get(cand, timeout=15).decode("utf-8", "replace")
                if "<Placemark>" in kml:
                    parse_kml(kml, rec)
                    break
            except Exception:
                pass
        if rec.get("forecast") and not rec.get("cone"):
            rec["cone"] = widen_cone(rec["forecast"])
        storms.append(rec)
        print("nhc", rec["name"], rec["basin"])
    return storms


def fetch_gdacs_fallback(existing: list[dict]) -> list[dict]:
    """Add recent GDACS TCs not already covered (position only / optional geometry)."""
    extra = []
    try:
        data = json.loads(
            get(
                "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&alertlevel=Green;Orange;Red"
            ).decode()
        )
    except Exception as e:
        print("gdacs tc", e)
        return extra
    names = {re.sub(r"[^a-z0-9]+", "", (s.get("name") or "").lower()) for s in existing}
    cutoff = datetime.now(timezone.utc) - timedelta(hours=36)
    for f in data.get("features") or []:
        p = f.get("properties") or {}
        g = f.get("geometry") or {}
        coords = g.get("coordinates") or []
        if g.get("type") != "Point" or len(coords) < 2:
            continue
        lng, lat = float(coords[0]), float(coords[1])
        to = p.get("todate") or p.get("fromdate") or ""
        try:
            dt = datetime.fromisoformat(to[:19])
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt < cutoff:
                continue
        except ValueError:
            continue
        nm = p.get("name") or "GDACS tropical cyclone"
        # Drop GDACS rows already covered (same storm within ~3° or shared name token).
        if any(abs((s.get("lat") or 0) - lat) < 3 and abs((s.get("lng") or 0) - lng) < 3 for s in existing):
            continue
        skip = {"tropical", "cyclone", "typhoon", "hurricane", "storm", "depression"}
        def words_of(n):
            return set(re.findall(r"[a-z]{3,}", re.sub(r"[^a-z]+", " ", (n or "").lower()))) - skip
        if any(words_of(nm) & words_of(s.get("name")) for s in existing):
            continue
        rec = {
            "id": f"gdacs-{p.get('eventid')}",
            "name": nm,
            "lat": lat,
            "lng": lng,
            "basin": basin_of(lat, lng),
            "source": "GDACS",
            "agency": "GDACS / GDACS partners",
            "alert": p.get("alertlevel"),
            "from": p.get("fromdate"),
            "to": p.get("todate"),
            "country": p.get("country"),
            "sourceUrl": (p.get("url") or {}).get("report") if isinstance(p.get("url"), dict) else p.get("url"),
        }
        extra.append(rec)
        names.add(key)
        print("gdacs", nm, rec["basin"], lat, lng)
    return extra


def main():
    storms = []
    storms.extend(fetch_nhc())
    storms.extend(fetch_jtwc())
    storms.extend(fetch_gdacs_fallback(storms))
    # drop entries without coordinates
    storms = [s for s in storms if isinstance(s.get("lat"), (int, float)) and isinstance(s.get("lng"), (int, float))]
    payload = {
        "meta": {
            "title": "Live tropical cyclones (all basins)",
            "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sources": "NOAA NHC CurrentStorms (Atlantic, E/C Pacific); JTWC RSS, warning text and KMZ tracks/cones (W Pacific, North Indian, South Indian, Australia, South Pacific); GDACS TC list as fallback. All keyless.",
            "note": "Official tracks and cones when the agency publishes them (NHC GIS / JTWC KMZ). A simple widening cone is derived from the forecast track when no official cone is available. Off-season basins may be empty.",
        },
        "items": storms,
        "n": len(storms),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload))
    print("wrote", OUT, "n=", len(storms))


if __name__ == "__main__":
    main()

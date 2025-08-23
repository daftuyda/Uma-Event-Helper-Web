import json
from pathlib import Path
from typing import Dict, List
from fastapi import FastAPI, HTTPException, Query
from starlette.middleware.base import BaseHTTPMiddleware
from rapidfuzz import process, fuzz

BASE_DIR = Path(__file__).resolve().parents[1]
ASSETS = BASE_DIR / "assets"

app = FastAPI()

class StripPathPrefix(BaseHTTPMiddleware):
    def __init__(self, app, prefixes=()):
        super().__init__(app)
        self.prefixes = tuple(p.rstrip('/') for p in prefixes)
    async def dispatch(self, request, call_next):
        path = request.scope.get("path", "")
        for p in self.prefixes:
            if path == p or path.startswith(p + "/"):
                request.scope["path"] = path[len(p):] or "/"
                break
        return await call_next(request)

app.add_middleware(StripPathPrefix, prefixes=("/api", "/index", "/api/index"))

def _json_load_bom_tolerant(path: Path):
    """
    Load JSON allowing for optional UTF-8 BOM.
    Tries utf-8-sig first; falls back to utf-8 for safety.
    """
    try:
        with path.open(encoding="utf-8-sig") as f:
            return json.load(f)
    except json.JSONDecodeError:
        with path.open(encoding="utf-8") as f:
            return json.load(f)

def _split_lines(s: str) -> List[str]:
    return [ln.strip() for ln in str(s).replace("\r\n", "\n").split("\n") if ln.strip()]

def _add_group(events: Dict[str, Dict], event_name: str, option_label: str, rewards_blob: str) -> None:
    groups = events[event_name]["options"].setdefault(option_label, [])
    groups.append(_split_lines(rewards_blob))

def _ensure_event(events: Dict[str, Dict], event_name: str) -> None:
    if event_name not in events:
        events[event_name] = {"event_name": event_name, "options": {}}

def _load_support_or_ura(path: Path, events: Dict[str, Dict]) -> None:
    """
    Load flat list shaped like:
    [{ "EventName": "...", "EventOptions": { "Top Option": "..." } }, ...]
    """
    data = _json_load_bom_tolerant(path)
    for row in data:
        ev_name = (row.get("EventName") or "").strip()
        opts = row.get("EventOptions") or {}
        if not ev_name or not isinstance(opts, dict):
            continue
        _ensure_event(events, ev_name)
        for label, blob in opts.items():
            _add_group(events, ev_name, (label or "").strip(), blob)

def _load_uma_data(path: Path, events: Dict[str, Dict]) -> None:
    """
    Load list of Umas with UmaEvents similar to support entries:
    { "UmaName": "...", "UmaEvents": [ { "EventName": "...", "EventOptions": {...} }, ... ] }
    """
    data = _json_load_bom_tolerant(path)
    for uma in data:
        uma_events = uma.get("UmaEvents") or []
        for row in uma_events:
            ev_name = (row.get("EventName") or "").strip()
            opts = row.get("EventOptions") or {}
            if not ev_name or not isinstance(opts, dict):
                continue
            _ensure_event(events, ev_name)
            for label, blob in opts.items():
                _add_group(events, ev_name, (label or "").strip(), blob)

def _first_existing(paths: List[Path]) -> Path:
    for p in paths:
        if p.exists():
            return p
    raise FileNotFoundError("None of the candidate paths exist:\n" + "\n".join(str(p) for p in paths))

def load_all_events() -> List[Dict]:
    assets_root = ASSETS  # /<repo>/assets

    support_file = assets_root / "support_card.json"
    uma_file     = assets_root / "uma_data.json"
    ura_file     = assets_root / "career.json"

    for p in (support_file, uma_file, ura_file):
        if not p.exists():
            raise FileNotFoundError(
                f"Missing required data file: {p}. "
                "Ensure it's committed to the repository so Vercel includes it at build time."
            )

    events_map: Dict[str, Dict] = {}
    _load_support_or_ura(support_file, events_map)
    _load_uma_data(uma_file, events_map)
    _load_support_or_ura(ura_file, events_map)

    return [events_map[name] for name in sorted(events_map)]

EVENTS = load_all_events()
EVENT_MAP = {e["event_name"]: e for e in EVENTS}
EVENT_NAMES = list(EVENT_MAP.keys())

@app.get("/events")
async def list_events():
    return {"events": EVENT_NAMES}

@app.get("/event_by_name")
async def get_event_by_name(
    event_name: str = Query(..., description="Event name to lookup"),
    limit: int = Query(5, description="Maximum number of fuzzy matches to return"),
    min_score: float = Query(0, ge=0, le=100, description="Minimum score threshold for matches"),
):
    matches = process.extract(event_name, EVENT_NAMES, scorer=fuzz.ratio, limit=limit)
    filtered = [m for m in matches if m[1] >= min_score]
    if not filtered:
        raise HTTPException(status_code=404, detail="No matches found")

    top_name, top_score, _ = filtered[0]
    top_event = EVENT_MAP[top_name]
    other_matches = [{"event_name": n, "score": s} for n, s, _ in filtered[1:]]

    return {
        "match": {
            "event_name": top_name,
            "score": float(top_score),
            "data": top_event,
        },
        "other_matches": other_matches,
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)

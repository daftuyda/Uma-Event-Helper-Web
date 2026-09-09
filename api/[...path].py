import json
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import Dict, List

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import Response
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
from rapidfuzz import fuzz, process
from starlette.middleware.base import BaseHTTPMiddleware

BASE_DIR = Path(__file__).resolve().parents[1]
# Vercel excludes public/ from Python bundles. The build stages runtime files
# separately; direct local development can still use the source assets.
RUNTIME_ASSETS = BASE_DIR / "runtime-assets"
ASSETS = RUNTIME_ASSETS if RUNTIME_ASSETS.is_dir() else BASE_DIR / "public" / "assets"
OG_FONT = ASSETS / "fonts" / "PlusJakartaSans-Variable.ttf"
OG_ICON = ASSETS / "icon-512.png"

OG_PAGES = {
    "home": {
        "title": "Uma Musume Tools & Calculators",
        "description": "Free Uma Musume tools for skill builds, rating calculations, support decks, stamina checks, race planning, game data, and character challenges.",
    },
    "guides": {
        "title": "UmaTools Documentation",
        "description": "Explore Uma Musume references for rating, skills, stamina, acceleration, support decks, Team Trials, Event OCR, and Grand Live.",
    },
    "guide-rating-system": {
        "title": "Rating & Skill Optimization Reference",
        "description": "Understand Uma Musume stat scoring, skill value, hint discounts, dependencies, optimization modes, and every rating rank.",
    },
    "guide-team-trials": {
        "title": "Team Trials Skill Selection Reference",
        "description": "Learn how course coverage, activation probability, Wisdom, dependencies, and expected value determine a Team Trials skill build.",
    },
    "guide-accel-checker": {
        "title": "Acceleration Skill Timing Reference",
        "description": "Learn which acceleration skills can activate in a useful last-spurt window and how race conditions change the result.",
    },
    "guide-stamina-calculator": {
        "title": "Stamina Calculator Reference",
        "description": "Follow the Uma Musume stamina model through race inputs, stat adjustments, recovery skills, phase costs, and result thresholds.",
    },
    "guide-deck-tools": {
        "title": "Support Deck Builder Reference",
        "description": "Understand limit-break rules, compatibility scoring, templates, skill-hint hand-offs, and saved Uma Musume support decks.",
    },
    "guide-token-planner": {
        "title": "Grand Live Token Planner Reference",
        "description": "Plan Grand Live songs, calculate Performance Points still needed, use presets, and understand saved planner state.",
    },
    "guide-ocr-guide": {
        "title": "Event OCR & Skill Recognition Reference",
        "description": "See how screenshots move through cropping, preprocessing, OCR, fuzzy skill matching, confidence checks, and corrections.",
    },
    "guide-persistence-and-sharing": {
        "title": "Data, Privacy & Share Links Reference",
        "description": "Understand browser storage, shareable deck and skill-build URLs, privacy boundaries, migrations, and safe reset options.",
    },
    "guide-translations": {
        "title": "Translation Contribution Reference",
        "description": "Contribute UmaTools interface translations using shared modules, fallback rules, placeholders, HTML attributes, and validation tools.",
    },
    "about": {
        "title": "About UmaTools & Uma Musume Documentation",
        "description": "Learn how UmaTools supports skill, rating, race, and deck planning, then explore nine player and technical documents.",
    },
    "accel": {
        "title": "Uma Musume Acceleration Skill Checker",
        "description": "Check which Uma Musume acceleration skills are valid for a race setup using VAC timing logic and Global or Japanese skill data.",
    },
    "calculator": {
        "title": "Uma Musume Rating Calculator",
        "description": "Calculate an Uma Musume character rating from stats, skills, and race aptitudes with a live breakdown of rating points.",
    },
    "deck": {
        "title": "Uma Musume Support Deck Builder",
        "description": "Build an Uma Musume training deck with one character and six support cards, then review combined skill hints, bonuses, and aptitudes.",
    },
    "events": {
        "title": "Uma Musume Event OCR Search",
        "description": "Capture an Uma Musume event screen with OCR, find the matching event, and check choice outcomes without typing the event name.",
    },
    "hints": {
        "title": "Uma Musume Support Card Hint Finder",
        "description": "Find Uma Musume support cards that teach the skill hints you need. Search by hint, rarity, and match rules to plan a training deck.",
    },
    "optimizer": {
        "title": "Uma Musume Skill Optimizer",
        "description": "Plan an Uma Musume skill build by skill point budget and target race, compare rating value, and share the optimized result.",
    },
    "random": {
        "title": "Uma Musume Character & Support Randomizer",
        "description": "Randomly select an Uma Musume character or generate a support deck with rarity, type, and animation speed filters.",
    },
    "rank": {
        "title": "Uma Musume Rating Rank List",
        "description": "Browse every Uma Musume character rating rank threshold and badge, from G through LS24, in one searchable reference.",
    },
    "skills": {
        "title": "Uma Musume Skill Database",
        "description": "Search the Uma Musume skill database by name or type, then compare skill point cost, rating score, and rating efficiency.",
    },
    "stamina": {
        "title": "Uma Musume Stamina Calculator",
        "description": "Estimate the stamina an Uma Musume needs for a race using distance, stats, recovery skills, strategy, track condition, and mood.",
    },
    "token-planner": {
        "title": "Uma Musume Grand Live Token Planner",
        "description": "Plan Grand Live songs and track Dance, Passion, Vocal, Visual, and Composure Performance Points for your Uma Musume training run.",
    },
    "umadle": {
        "title": "Umadle: Uma Musume Character Guessing Game",
        "description": "Play Umadle, an Uma Musume character guessing game. Use stats and clues to identify a randomly selected mystery trainee.",
    },
    "not-found": {
        "title": "Page Not Found",
        "description": "The page you requested could not be found. Return to UmaTools to browse Uma Musume calculators, planners, and game data.",
    },
}

app = FastAPI()


def _font(size: int, weight: str = "Regular") -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(OG_FONT), size=size)
    try:
        font.set_variation_by_name(weight)
    except (OSError, ValueError):
        pass
    return font


def _wrap_text(
    draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int
) -> List[str]:
    words = text.split()
    lines: List[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if not current or draw.textbbox((0, 0), candidate, font=font)[2] <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


@lru_cache(maxsize=2)
def _brand_icon(size: int) -> Image.Image:
    icon = Image.open(OG_ICON).convert("RGB")
    difference = ImageChops.difference(icon, Image.new("RGB", icon.size, "white"))
    bounds = difference.getbbox()
    if bounds:
        icon = icon.crop(bounds)
    icon.thumbnail((size, size), Image.Resampling.LANCZOS)
    icon = icon.convert("RGBA")

    mask = Image.new("L", icon.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, icon.width, icon.height), radius=min(icon.size) // 5, fill=255
    )
    icon.putalpha(mask)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(icon, ((size - icon.width) // 2, (size - icon.height) // 2))
    return canvas


@lru_cache(maxsize=len(OG_PAGES))
def _render_og_image(page: str) -> bytes:
    config = OG_PAGES[page]
    image = Image.new("RGBA", (1200, 630), (17, 20, 26, 255))

    # Match the site's dark-mode radial background without adding visual noise.
    glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((-260, -330, 760, 650), fill=(100, 116, 139, 42))
    glow_draw.ellipse((760, -330, 1420, 430), fill=(71, 85, 105, 30))
    glow_draw.ellipse((720, 300, 1370, 900), fill=(148, 163, 184, 20))
    image = Image.alpha_composite(image, glow.filter(ImageFilter.GaussianBlur(120)))
    draw = ImageDraw.Draw(image)

    image.alpha_composite(_brand_icon(56), (72, 56))
    draw.text((146, 66), "UmaTools", font=_font(31, "Bold"), fill=(241, 245, 249, 255))
    draw.rounded_rectangle((72, 137, 142, 144), radius=4, fill=(148, 163, 184, 255))

    title = config["title"]
    title_size = 70 if len(title) > 25 else 78
    title_font = _font(title_size, "Bold")
    title_lines = _wrap_text(draw, title, title_font, 920)[:2]
    title_y = 180
    for line in title_lines:
        draw.text((72, title_y), line, font=title_font, fill=(241, 245, 249, 255))
        title_y += title_size + 8

    body_font = _font(25)
    description_y = max(388, title_y + 14)
    for line in _wrap_text(draw, config["description"], body_font, 880)[:2]:
        draw.text((75, description_y), line, font=body_font, fill=(203, 213, 225, 255))
        description_y += 39

    draw.text((75, 557), "daftuyda.moe", font=_font(20, "Bold"), fill=(226, 232, 240, 255))
    draw.ellipse((1085, 559, 1097, 571), fill=(203, 213, 225, 255))
    draw.ellipse((1105, 559, 1117, 571), fill=(148, 163, 184, 255))
    draw.ellipse((1125, 559, 1137, 571), fill=(71, 85, 105, 255))

    output = BytesIO()
    image.convert("RGB").save(output, format="PNG", optimize=True)
    return output.getvalue()


class StripPathPrefix(BaseHTTPMiddleware):
    def __init__(self, app, prefixes=()):
        super().__init__(app)
        self.prefixes = tuple(p.rstrip("/") for p in prefixes)

    async def dispatch(self, request, call_next):
        path = request.scope.get("path", "")
        for p in self.prefixes:
            if path == p or path.startswith(p + "/"):
                request.scope["path"] = path[len(p) :] or "/"
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


def _add_group(
    events: Dict[str, Dict], event_name: str, option_label: str, rewards_blob: str
) -> None:
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
    raise FileNotFoundError(
        "None of the candidate paths exist:\n" + "\n".join(str(p) for p in paths)
    )


def load_all_events() -> List[Dict]:
    assets_root = ASSETS  # /<repo>/assets

    support_file = assets_root / "support_card.json"
    uma_file = assets_root / "uma_data.json"
    ura_file = assets_root / "career.json"

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


@lru_cache(maxsize=1)
def _event_index():
    events = load_all_events()
    event_map = {event["event_name"]: event for event in events}
    return event_map, list(event_map.keys())


@app.get("/events")
async def list_events():
    _, event_names = _event_index()
    return {"events": event_names}


@app.get("/og", response_class=Response)
async def open_graph_image(page: str = Query(..., description="Open Graph page key")):
    return _open_graph_response(page)


@app.get("/og/{page}.png", response_class=Response)
async def open_graph_image_file(page: str):
    return _open_graph_response(page)


@app.get("/og/v1/{page}.png", response_class=Response)
async def open_graph_image_file_v1(page: str):
    return _open_graph_response(page)


@app.head("/og", response_class=Response, include_in_schema=False)
async def open_graph_image_head(page: str = Query(..., description="Open Graph page key")):
    return _open_graph_response(page)


@app.head("/og/{page}.png", response_class=Response, include_in_schema=False)
@app.head("/og/v1/{page}.png", response_class=Response, include_in_schema=False)
async def open_graph_image_file_head(page: str):
    return _open_graph_response(page)


def _open_graph_response(page: str) -> Response:
    if page not in OG_PAGES:
        raise HTTPException(status_code=404, detail="Unknown Open Graph image")

    return Response(
        content=_render_og_image(page),
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
            "Content-Disposition": f'inline; filename="umatools-{page}.png"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.get("/event_by_name")
async def get_event_by_name(
    event_name: str = Query(..., description="Event name to lookup"),
    limit: int = Query(5, description="Maximum number of fuzzy matches to return"),
    min_score: float = Query(0, ge=0, le=100, description="Minimum score threshold for matches"),
):
    event_map, event_names = _event_index()
    matches = process.extract(event_name, event_names, scorer=fuzz.ratio, limit=limit)
    filtered = [m for m in matches if m[1] >= min_score]
    if not filtered:
        raise HTTPException(status_code=404, detail="No matches found")

    top_name, top_score, _ = filtered[0]
    top_event = event_map[top_name]
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

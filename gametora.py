import argparse, json, os, sys, time, re, requests
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse
from urllib3.exceptions import ReadTimeoutError
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.common.exceptions import (
    NoSuchElementException, TimeoutException, WebDriverException, StaleElementReferenceException
)
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

DELAY = 0.25
RETRIES = 3
NAV_TIMEOUT = 45
JS_TIMEOUT  = 45


def _read_json_list(path: str) -> List[Any]:
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []

def _atomic_write(path: str, data: List[Any]) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)

def append_json_item(path: str, item: Dict[str, Any], dedup_key: Optional[Tuple[str, ...]] = None) -> bool:
    data = _read_json_list(path)
    if dedup_key:
        def pluck(d: Dict[str, Any], dotted: str) -> Any:
            cur: Any = d
            for part in dotted.split("."):
                cur = cur.get(part, None) if isinstance(cur, dict) else None
            return cur
        probe = tuple(str(pluck(item, k)) for k in dedup_key)
        for existing in data:
            if tuple(str(pluck(existing, k)) for k in dedup_key) == probe:
                return False
    data.append(item)
    _atomic_write(path, data)
    return True

def upsert_json_item(path: str, match_key: str, match_value: str, patch: Dict[str, Any]) -> None:
    data = _read_json_list(path)
    for obj in data:
        if isinstance(obj, dict) and obj.get(match_key) == match_value:
            obj.update(patch)
            _atomic_write(path, data)
            return
    data.append({match_key: match_value, **patch})
    _atomic_write(path, data)

def _make_uma_key(name: str, nickname: str | None, slug: str | None) -> str:
    """Stable key to disambiguate variants."""
    if nickname:
        return f"{name} :: {nickname}"
    if slug:
        return f"{name} :: {slug}"
    return name

def _count_stars(text: str) -> int:
    t = (text or "")
    return t.count("⭐") or t.count("★") or 0

def _get_caption_el(d, caption_text: str):
    """Find a caption div by text, regardless of hashed class suffix."""
    return safe_find(
        d, By.XPATH,
        "//div[contains(@class,'characters_infobox_caption')][contains(translate(normalize-space(.),"
        "'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),"
        f"'{caption_text.lower()}')]"
    )

def _stats_blocks_after_caption(d, cap_el):
    """Collect consecutive stats blocks after caption until the next caption."""
    if not cap_el:
        return []
    try:
        blocks = d.execute_script("""
            const cap = arguments[0];
            const isCaption = n => n && n.classList && [...n.classList].some(c => c.startsWith('characters_infobox_caption__'));
            const isStats   = n => n && n.classList && [...n.classList].some(c => c.startsWith('characters_infobox_stats__'));
            const out = [];
            let el = cap.nextElementSibling;
            while (el && !isCaption(el)) {
              if (isStats(el)) out.push(el);
              el = el.nextElementSibling;
            }
            return out;
        """, cap_el) or []
        # keep only visible nodes
        return [b for b in blocks if is_visible(d, b)]
    except Exception:
        return []

def _label_value(d, label_text: str) -> str:
    el = safe_find(d, By.XPATH,
        f"//div[contains(@class,'characters_infobox_bold_text')][normalize-space()='{label_text}']/following-sibling::div[1]")
    return txt(el)

def _parse_three_sizes(s: str):
    m = re.search(r"(\d+)\s*-\s*(\d+)\s*-\s*(\d+)", s or "")
    if not m: return {}
    return {"B": int(m.group(1)), "W": int(m.group(2)), "H": int(m.group(3))}

def _parse_base_stats_from_block(block) -> dict:
    """Given a single 'characters_infobox_stats' block, return {'stars': 3|5, 'stats': {...}} or {}."""
    stars = 0
    try:
        star_el = block.find_element(By.CSS_SELECTOR, 'div[class*="characters_infobox_row__"] span')
        stars = _count_stars(txt(star_el))
    except Exception:
        pass
    stats = {}
    for split in safe_find_all(block, By.CSS_SELECTOR, 'div[class*="characters_infobox_row_split"]'):
        img = safe_find(split, By.CSS_SELECTOR, 'img[alt]')
        stat_name = img.get_attribute("alt") if img else ""
        if not stat_name: continue
        # last numeric-looking div is the value
        val = None
        for dv in split.find_elements(By.CSS_SELECTOR, "div"):
            m = re.search(r"\d+", txt(dv))
            if m: val = int(m.group(0))
        if val is not None:
            stats[stat_name] = val
    if stars and stats:
        return {"stars": stars, "stats": stats}
    return {}

def _parse_stat_bonuses(block) -> dict:
    """Parse the 'Stat bonuses' single block."""
    out = {}
    for split in safe_find_all(block, By.CSS_SELECTOR, 'div[class*="characters_infobox_row_split"]'):
        img = safe_find(split, By.CSS_SELECTOR, 'img[alt]')
        name = img.get_attribute("alt") if img else ""
        if not name: continue
        raw = ""
        # value sits in a sibling <div>
        for dv in split.find_elements(By.CSS_SELECTOR, "div"):
            t = txt(dv)
            if "%" in t or t == "-" or re.search(r"\d", t): raw = t
        if raw == "-":
            out[name] = 0
        else:
            m = re.search(r"(-?\d+)", raw)
            out[name] = int(m.group(1)) if m else 0
    return out

def _parse_aptitudes(blocks) -> dict:
    """Given blocks after 'Aptitude' and before next caption, return nested dict."""
    apt = {}
    for b in blocks:
        title = txt(safe_find(b, By.CSS_SELECTOR, 'div[class*="characters_infobox_bold_text"]'))
        if not title:  # sometimes the title is on its own row; try again
            try:
                title = b.find_element(By.XPATH, ".//div[contains(@class,'characters_infobox_bold_text')]").text
            except Exception:
                title = ""
        title = title.strip()
        if not title: continue

        sec = {}
        for row in safe_find_all(b, By.CSS_SELECTOR, 'div[class*="characters_infobox_row__"]'):
            for split in safe_find_all(row, By.CSS_SELECTOR, 'div[class*="characters_infobox_row_split"]'):
                cells = split.find_elements(By.CSS_SELECTOR, "div")
                if len(cells) >= 2:
                    key = txt(cells[0])
                    val = txt(cells[-1])
                    if key and val: sec[key] = val
        if sec:
            apt[title] = sec
    return apt

def _parse_top_meta(d) -> tuple[str, int]:
    """Return (nickname, base_stars) from the top infobox area."""
    nickname = ""
    base_stars = 0
    top = safe_find(d, By.CSS_SELECTOR, 'div[class*="characters_infobox_top"]')
    if top:
        # nickname is usually the first italic 'item' text that is not stars
        for it in safe_find_all(top, By.CSS_SELECTOR, 'div[class*="characters_infobox_item"]'):
            t = txt(it)
            if not t: continue
            if "⭐" in t or "★" in t:
                base_stars = max(base_stars, _count_stars(t))
            elif not nickname:
                nickname = t
    return nickname, base_stars

def _abs_url(driver, src: str) -> str:
    if not src: return ""
    if src.startswith("http://") or src.startswith("https://"): return src
    origin = driver.execute_script("return location.origin;") or "https://gametora.com"
    if src.startswith("/"): return origin + src
    return origin + "/" + src

def _slug_and_id_from_url(url: str) -> tuple[str, Optional[str]]:
    path = urlparse(url).path.rstrip("/")
    parts = [p for p in path.split("/") if p]
    slug = parts[-1] if parts else ""
    m = re.search(r"(\d{4,})", slug)
    sup_id = m.group(1) if m else None
    return slug, sup_id

def _id_from_img_src(src: str) -> Optional[str]:
    m = re.search(r"support_card_[a-z]_(\d+)\.(?:png|jpg|jpeg|webp)$", src)
    return m.group(1) if m else None

def _ensure_dir(p: str) -> Path:
    d = Path(p)
    d.mkdir(parents=True, exist_ok=True)
    return d

def _save_thumb(url: str, thumbs_dir: str, slug: Optional[str], sup_id: Optional[str]) -> str:
    if not url: return ""
    _ensure_dir(thumbs_dir)
    ext = Path(urlparse(url).path).suffix or ".png"
    base = slug or sup_id or _id_from_img_src(url) or "support"
    # keep it filesystem-safe
    safe = re.sub(r"[^a-z0-9\-_.]", "-", base.lower())
    fname = f"{safe}{ext}"
    dest = Path(thumbs_dir) / fname
    if not dest.exists() or dest.stat().st_size == 0:
        try:
            r = requests.get(url, timeout=20)
            r.raise_for_status()
            dest.write_bytes(r.content)
            time.sleep(0.05)  # be polite
        except Exception as e:
            print(f"[thumb] failed {url}: {e}")
            return ""
    # return site-relative path for the front-end
    rel = "/" + str(dest.as_posix()).lstrip("/")
    # normalize to your site’s assets folder form:
    rel = rel.replace("//", "/")
    return rel

def collect_support_previews(driver, thumbs_dir: str) -> dict[str, dict]:
    previews: dict[str, dict] = {}
    anchors = filter_visible(
        driver,
        safe_find_all(driver, By.CSS_SELECTOR, "main main div:last-child a[href*='/umamusume/supports/']")
    )
    for a in anchors:
        href = a.get_attribute("href") or ""
        slug, sid = _slug_and_id_from_url(href)
        if not slug:
            continue
        img = safe_find(a, By.CSS_SELECTOR, "img[src*='/images/umamusume/supports/']")
        src = _abs_url(driver, img.get_attribute("src") or "") if img else ""
        local = _save_thumb(src, thumbs_dir, slug, sid)
        previews[slug] = {"SupportImage": local or src, "SupportId": sid or _id_from_img_src(src)}
    return previews


def new_driver(headless: bool = True) -> webdriver.Chrome:
    opts = Options()
    if headless:
        opts.add_argument("--headless=new")
    opts.add_argument("--window-size=1920,1080")

    opts.add_argument(
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    )

    # Force SwiftShader / software GPU (Chrome 139+)
    opts.add_argument("--enable-unsafe-swiftshader")
    opts.add_argument("--use-gl=swiftshader")
    opts.add_argument("--use-angle=swiftshader")
    opts.add_argument("--ignore-gpu-blocklist")

    # Stable for servers/VMs
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")

    # Quieter + faster loads
    opts.add_argument("--log-level=3")
    opts.add_experimental_option("excludeSwitches", ["enable-logging"])
    opts.set_capability("pageLoadStrategy", "eager")

    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=opts)
    driver.set_page_load_timeout(NAV_TIMEOUT)
    driver.set_script_timeout(JS_TIMEOUT)
    
    try:
        driver.command_executor._client_config.timeout = 300
    except Exception:
        pass

    try:
        print("[debug] User-Agent:", driver.execute_script("return navigator.userAgent;"))
    except Exception:
        pass

    return driver

def safe_find(driver, by, sel):
    try: return driver.find_element(by, sel)
    except NoSuchElementException: return None

def safe_find_all(driver, by, sel) -> List[Any]:
    try: return driver.find_elements(by, sel)
    except NoSuchElementException: return []

def wait_css(driver, css: str, timeout: int = 8):
    try:
        return WebDriverWait(driver, timeout).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, css))
        )
    except (TimeoutException, WebDriverException, ReadTimeoutError):
        return None

def nav(driver, url: str, wait_for_css: Optional[str] = None) -> bool:
    try:
        driver.get(url)
    except (TimeoutException, ReadTimeoutError, WebDriverException):
        try:
            driver.execute_script("window.stop();")
        except Exception:
            pass
    if wait_for_css:
        return wait_css(driver, wait_for_css, timeout=10) is not None
    return True

def txt(el) -> str:
    if not el: return ""
    try: return (el.get_attribute("innerText") or "").strip().replace("\u00a0", " ")
    except Exception: return ""

# ---------- Visibility helpers ----------
def is_visible(driver, el) -> bool:
    if el is None: return False
    try:
        return bool(driver.execute_script("""
            function isVisible(e){
              if(!e) return false;
              const doc=e.ownerDocument||document;
              function vis(n){
                if(!n||n.nodeType!==1) return true;
                const cs=doc.defaultView.getComputedStyle(n);
                if(cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity)===0) return false;
                return vis(n.parentElement);
              }
              if(!vis(e)) return false;
              const r=e.getBoundingClientRect();
              return r.width>0&&r.height>0;
            }
            return isVisible(arguments[0]);
        """, el))
    except Exception:
        try: return el.is_displayed()
        except Exception: return False

def filter_visible(driver, elements: List[Any]) -> List[Any]:
    return [e for e in elements if is_visible(driver, e)]


def _click(driver, css) -> bool:
    el = safe_find(driver, By.CSS_SELECTOR, css)
    if not el: return False
    try: el.click(); return True
    except Exception: return False

def accept_cookies(driver):
    _click(driver, 'body > div#__next > div[class*=legal_cookie_banner_wrapper__] '
                   '> div > div[class*=legal_cookie_banner_selection__] '
                   '> div:last-child > button[class*=legal_cookie_banner_button__]')
    time.sleep(0.2)

def open_settings(driver):
    _click(driver, 'body > div#__next > div > div[class*=styles_page__] '
                   '> header[id*=styles_page-header__] '
                   '> div[class*=styles_header_settings__]')
    time.sleep(0.15)

def _click_label_by_partial_text(driver, *candidates: str) -> bool:
    try: labels = driver.find_elements(By.CSS_SELECTOR, 'div[data-tippy-root] label')
    except Exception: labels = []
    for lb in labels:
        t = (lb.text or "").strip().lower()
        for want in candidates:
            if want.lower() in t:
                try: lb.click(); time.sleep(0.1); return True
                except Exception: pass
    return False

def ensure_server(driver, server: str = "global", keep_raw_en: bool = True):
    accept_cookies(driver); open_settings(driver)
    if server == "global":
        _click_label_by_partial_text(driver, "Global", "EN (Global)", "English (Global)")
    else:
        _click_label_by_partial_text(driver, "Japan", "JP", "Japanese")
    if keep_raw_en:
        _click(driver, 'body > div[data-tippy-root] > div.tippy-box > div.tippy-content > div '
                       '> div[class*=tooltips_tooltip__] > div:last-child > div:last-child > div:last-child > label')
    driver.execute_script("""
        try {
          localStorage.setItem('i18nextLng','en');
          localStorage.setItem('umamusume_server', arguments[0]);
          localStorage.setItem('u-eh-server', arguments[0]);
          localStorage.setItem('u-eh-region', arguments[0]);
          localStorage.setItem('server', arguments[0]);
        } catch(e) {}
    """, "global" if server == "global" else "japan")
    try: driver.find_element(By.TAG_NAME, "body").click()
    except Exception: pass
    time.sleep(0.15); driver.refresh(); time.sleep(0.3)


def tippy_show_and_get_popper(driver, ref_el):
    try:
        popper = driver.execute_script("""
            const el = arguments[0];
            if (!el || !el._tippy) return null;
            const t = el._tippy;
            t.setProps({ trigger: 'manual', allowHTML: true, interactive: true, placement: 'bottom' });
            t.show();
            return t.popper || null;
        """, ref_el)
        time.sleep(0.05)
        return popper
    except Exception:
        return None

def tippy_hide(driver, ref_el):
    try: driver.execute_script("if(arguments[0] && arguments[0]._tippy){arguments[0]._tippy.hide();}", ref_el)
    except Exception: pass


def parse_event_from_tippy_popper(popper_el) -> List[Dict[str, str]]:
    results: List[Dict[str, str]] = []
    if not popper_el: return results
    rows = popper_el.find_elements(By.CSS_SELECTOR, 'table[class*="tooltips_ttable__"] > tbody > tr')
    if rows:
        for tr in rows:
            try:
                opt = txt(tr.find_element(By.CSS_SELECTOR, "td:nth-of-type(1)"))
                val = txt(tr.find_element(By.CSS_SELECTOR, "td:nth-of-type(2)"))
                if opt or val: results.append({opt: val})
            except Exception: continue
        return results
    many = popper_el.find_elements(By.CSS_SELECTOR, 'div[class*="tooltips_ttable_cell___"] > div')
    if many:
        for dv in many:
            s = txt(dv)
            if s: results.append({"": s})
        return results
    try:
        single = popper_el.find_element(By.CSS_SELECTOR, 'div[class*="tooltips_ttable_cell__"]')
        s = txt(single)
        if s: results.append({"": s})
    except Exception:
        pass
    return results


def _first_tippy_anchor_under(driver, root):
    """Return the first descendant element that has a Tippy instance (._tippy), if any."""
    try:
        return driver.execute_script("""
            const root = arguments[0];
            const it = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT);
            let n;
            while ((n = it.nextNode())) {
              if (n._tippy) return n;
            }
            return null;
        """, root)
    except Exception:
        return None

def _skill_id_from_href(href: str) -> str:
    if not href:
        return ""
    href = href.split("?")[0].rstrip("/")
    if "/umamusume/skills/" in href:
        return href.split("/")[-1]
    return ""

def parse_hint_level_from_text(text: str) -> Optional[int]:
    m = re.search(r"hint\s*lv\.?\s*([0-5])", text or "", flags=re.I)
    if m: return int(m.group(1))
    m = re.search(r"lv\.?\s*([0-5])\s*hint", text or "", flags=re.I)
    if m: return int(m.group(1))
    return None

def parse_support_hints_on_page(d) -> List[Dict[str, Any]]:
    """
    Collect only the tiles that appear after the 'Support hints' caption
    and before the very next caption block (class startswith 'supports_infobox_caption__'),
    regardless of nesting. Prevents mixing in 'Skills from events'.
    """
    hints: List[Dict[str, Any]] = []
    seen_names = set()

    # Find visible "Support hints" captions
    captions = d.find_elements(
        By.XPATH,
        "//*[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'support hints')]"
    )
    captions = [c for c in captions if is_visible(d, c)]
    if not captions:
        return hints

    for cap in captions:
        # JS: walk the DOM forward from this caption; collect skill-icon <img>s
        # until the next caption (class startswith supports_infobox_caption__).
        imgs = d.execute_script("""
            const cap = arguments[0];
            const isCaption = (el) => {
              if (!el || !el.classList) return false;
              for (const cls of el.classList) {
                if (String(cls).startsWith('supports_infobox_caption__')) return true;
              }
              return false;
            };

            // TreeWalker across the full document so nested captions are seen.
            const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
            // advance to 'cap'
            let n = tw.currentNode;
            while (n && n !== cap) n = tw.nextNode();
            // now walk forward, collecting imgs until the next caption is hit
            const out = [];
            while ((n = tw.nextNode())) {
              if (n !== cap && isCaption(n)) break; // stop at the next caption
              if (n.tagName === 'IMG' && n.src && n.src.includes('/images/umamusume/skill_icons/utx_ico_skill_')) {
                out.push(n);
              }
            }
            return out;
        """, cap) or []

        # Per-block hint level (if they show "Hint Lv.X" near the hints)
        block_text = ""
        try:
            # gather text from nodes between cap and next caption (for hint-lv scan)
            block_text = d.execute_script("""
                const cap = arguments[0];
                const isCaption = (el) => {
                  if (!el || !el.classList) return false;
                  for (const cls of el.classList) {
                    if (String(cls).startsWith('supports_infobox_caption__')) return true;
                  }
                  return false;
                };
                const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
                let n = tw.currentNode, txt = '';
                while (n && n !== cap) n = tw.nextNode();
                while ((n = tw.nextNode())) {
                  if (n !== cap && isCaption(n)) break;
                  txt += ' ' + (n.innerText || '');
                }
                return txt;
            """, cap) or ""
        except Exception:
            pass
        block_hint_lv = parse_hint_level_from_text(block_text)

        # Turn images into tiles (climb to the element that contains <b>name</b>)
        for img in imgs:
            if not is_visible(d, img):
                continue

            # climb to the tile block that has a <b> name
            tile = img
            for _ in range(6):
                try:
                    if tile.find_elements(By.XPATH, ".//b"):
                        break
                except Exception:
                    pass
                try:
                    tile = tile.find_element(By.XPATH, "..")
                except Exception:
                    tile = None
                    break
            if not tile:
                continue

            # read the name from this tile only
            try:
                b = tile.find_element(By.XPATH, ".//b[1]")
                name = (b.get_attribute("innerText") or "").strip()
            except Exception:
                name = ""
            if not name or name in seen_names:
                continue

            # Try to find a real /umamusume/skills/<id> link inside the tile
            sid = ""
            try:
                for a in tile.find_elements(By.XPATH, ".//a[contains(@href,'/umamusume/skills/')]"):
                    sid = _skill_id_from_href(a.get_attribute("href") or "")
                    if sid:
                        break
            except Exception:
                pass

            # Fallback: open tooltip on the tile (if any) and look for a link there
            if not sid:
                tippy_anchor = _first_tippy_anchor_under(d, tile)
                pop = None
                if tippy_anchor is not None:
                    pop = tippy_show_and_get_popper(d, tippy_anchor)
                try:
                    if pop:
                        for l in pop.find_elements(By.CSS_SELECTOR, 'a[href*="/umamusume/skills/"]'):
                            sid = _skill_id_from_href(l.get_attribute("href") or "")
                            if sid:
                                break
                finally:
                    if tippy_anchor is not None:
                        tippy_hide(d, tippy_anchor)

            hints.append({
                "SkillId": sid,            # stays "" if no link is exposed
                "Name": name,
                "HintLevel": block_hint_lv # None when not shown
            })
            seen_names.add(name)

    return hints


def make_support_card(event_name: str, opts: Dict[str, str]) -> Dict[str, Any]:
    return {"EventName": event_name, "EventOptions": opts}

def make_career(event_name: str, opts: Dict[str, Any]) -> Dict[str, Any]:
    return {"EventName": event_name, "EventOptions": opts}

def make_race(race_name: str, schedule: str, grade: str, terrain: str,
              distance_type: str, distance_meter: str, season: str,
              fans_required: str, fans_gained: str) -> Dict[str, Any]:
    return {
        "RaceName": race_name,
        "Schedule": schedule,
        "Grade": grade,
        "Terrain": terrain,
        "DistanceType": distance_type,
        "DistanceMeter": distance_meter,
        "Season": season,
        "FansRequired": fans_required,
        "FansGained": fans_gained
    }


def with_retries(func, *args, **kwargs):
    last_exc = None
    for attempt in range(RETRIES + 1):
        try:
            return func(*args, **kwargs)
        except (TimeoutException, WebDriverException, StaleElementReferenceException, ReadTimeoutError) as e:
            last_exc = e
            time.sleep(0.6 + attempt * 0.4)
            continue
    if last_exc:
        raise last_exc
    return None


def scrape_characters(save_path: str, server: str, headless: bool = True):
    d = new_driver(headless=headless)
    try:
        with_retries(nav, d, "https://gametora.com/umamusume/characters", "main main")
        ensure_server(d, server=server, keep_raw_en=True)

        anchors = filter_visible(d, safe_find_all(d, By.CSS_SELECTOR, "main main div:last-child a[href*='/umamusume/characters/']"))
        urls = []
        for a in anchors:
            try:
                inner = a.find_element(By.CSS_SELECTOR, "div")
                if not is_visible(d, inner): continue
            except Exception: pass
            href = a.get_attribute("href") or ""
            if href and href not in urls: urls.append(href)

        total = len(urls)
        for i, url in enumerate(urls, 1):
            for attempt in range(RETRIES + 1):
                try:
                    ok = with_retries(nav, d, url, "body")
                    slug, uma_id = _slug_and_id_from_url(url)
                    if not ok: raise TimeoutException("no body")

                    # --- Core identity ---
                    wait_css(d, 'div[class*=characters_infobox_character_name] > a', 8)
                    name_el = safe_find(d, By.CSS_SELECTOR, 'div[class*=characters_infobox_character_name] > a')
                    name = (txt(name_el) or "").replace("\n","")
                    if not name:
                        raise WebDriverException("Missing character name")

                    # top meta: nickname + base-stars
                    nickname, base_stars = _parse_top_meta(d)
                    uma_key = _make_uma_key(name, nickname, slug)

                    # height + three sizes
                    height_cm = None
                    try:
                        h_raw = _label_value(d, "Height")
                        m = re.search(r"(\d+)", h_raw or "")
                        height_cm = int(m.group(1)) if m else None
                    except Exception:
                        pass
                    sizes_raw = _label_value(d, "Three sizes")
                    sizes = _parse_three_sizes(sizes_raw)

                    # --- Base stats (3★ / 5★) ---
                    base_stats: dict = {}
                    cap_base = _get_caption_el(d, "Base stats")
                    base_blocks = _stats_blocks_after_caption(d, cap_base)

                    for idx, blk in enumerate(base_blocks[:2]):  # usually two blocks: 3★ then 5★
                        parsed = _parse_base_stats_from_block(blk)  # {'stars': 3|5, 'stats': {...}} or {}
                        stars = parsed.get("stars") or (3 if idx == 0 else 5)
                        stats = parsed.get("stats", {})
                        if stats:
                            base_stats[f"{stars}★"] = stats

                    # --- Stat bonuses ---
                    stat_bonuses: dict = {}
                    cap_bonus = _get_caption_el(d, "Stat bonuses")
                    bonus_blocks = _stats_blocks_after_caption(d, cap_bonus)
                    if bonus_blocks:
                        stat_bonuses = _parse_stat_bonuses(bonus_blocks[0])

                    # --- Aptitudes (Surface / Distance / Strategy) ---
                    aptitudes: dict = {}
                    cap_apt = _get_caption_el(d, "Aptitude")
                    apt_blocks = _stats_blocks_after_caption(d, cap_apt)
                    if apt_blocks:
                        aptitudes = _parse_aptitudes(apt_blocks)

                    # --- Objectives ---
                    objectives = []
                    for card in safe_find_all(d, By.CSS_SELECTOR,
                        'div[class*=characters_objective_box] > div[class*=characters_objective]'):
                        if not is_visible(d, card): continue
                        objective_name = txt(safe_find(card, By.CSS_SELECTOR,
                            'div[class*=characters_objective_text] > div:nth-of-type(1)'))
                        turn = txt(safe_find(card, By.CSS_SELECTOR,
                            'div[class*=characters_objective_text] > div:nth-of-type(2)'))
                        tim = txt(safe_find(card, By.CSS_SELECTOR,
                            'div[class*=characters_objective_text] > div:nth-of-type(3)'))
                        cond = txt(safe_find(card, By.CSS_SELECTOR,
                            'div[class*=characters_objective_text] > div:nth-of-type(4)'))
                        objectives.append({
                            "ObjectiveName": objective_name, "Turn": turn, "Time": tim, "ObjectiveCondition": cond
                        })

                    # --- Events ---
                    events: List[Dict[str, Any]] = []
                    for elist in safe_find_all(d, By.CSS_SELECTOR, 'div[class*=eventhelper_elist]'):
                        if not is_visible(d, elist): continue
                        for it in elist.find_elements(By.CSS_SELECTOR, 'div[class*=compatibility_viewer_item]'):
                            if not is_visible(d, it): continue
                            event_name = txt(it)
                            if not event_name: continue
                            pop = tippy_show_and_get_popper(d, it)
                            try:
                                for kv in parse_event_from_tippy_popper(pop):
                                    events.append({"EventName": event_name, "EventOptions": kv})
                            finally:
                                tippy_hide(d, it)

                    # --- Upsert record ---
                    upsert_json_item(save_path, "UmaKey", uma_key, {
                        "UmaKey": uma_key,
                        "UmaName": name,
                        "UmaNickname": nickname or None,
                        "UmaSlug": slug,
                        "UmaId": uma_id,
                        "UmaBaseStars": base_stars or None,
                        "UmaBaseStats": base_stats,
                        "UmaStatBonuses": stat_bonuses,
                        "UmaAptitudes": aptitudes,
                        "UmaHeightCm": height_cm,
                        "UmaThreeSizes": sizes,
                        "UmaObjectives": objectives,
                        "UmaEvents": events
                    })

                    print(f"[{i}/{total}] UMA ✓ {name} ({nickname or slug or 'default'})  "
                        f"(★{base_stars} | base:{'/'.join(base_stats.keys()) or '-'} "
                        f"| bonuses:{len(stat_bonuses)} | apt:{len(aptitudes)} "
                        f"| {len(objectives)} objectives, {len(events)} events)")
                    break

                except (TimeoutException, WebDriverException, StaleElementReferenceException, ReadTimeoutError) as e:
                    if attempt < RETRIES:
                        try: d.quit()
                        except Exception: pass
                        d = new_driver(headless=headless)
                        with_retries(nav, d, "https://gametora.com/umamusume/characters", "main main")
                        ensure_server(d, server=server, keep_raw_en=True)
                        continue
                    else:
                        print(f"[{i}/{total}] UMA ERROR {url}: {e}")
                        break
    finally:
        try: d.quit()
        except Exception: pass


def scrape_supports(out_events_path: str, out_hints_path: str, server: str, headless: bool = True, thumbs_dir: str = "assets/support_thumbs"):
    d = new_driver(headless=headless)
    try:
        with_retries(nav, d, "https://gametora.com/umamusume/supports", "main main")
        ensure_server(d, server=server, keep_raw_en=True)

        # NEW: collect preview thumbnails by slug/id once
        previews = collect_support_previews(d, thumbs_dir)

        cards = filter_visible(d, safe_find_all(d, By.CSS_SELECTOR, "main main div:last-child a[href*='/umamusume/supports/']"))
        urls = []
        for a in cards:
            try:
                inner = a.find_element(By.CSS_SELECTOR, "div")
                if not is_visible(d, inner): continue
            except Exception:
                pass
            href = a.get_attribute("href") or ""
            if href and href not in urls:
                urls.append(href)

        total = len(urls)
        for i, url in enumerate(urls, 1):
            for attempt in range(RETRIES + 1):
                try:
                    ok = with_retries(nav, d, url, "body")
                    if not ok:
                        raise TimeoutException("no body")

                    slug, sup_id = _slug_and_id_from_url(url)

                    name_el = safe_find(d, By.CSS_SELECTOR, 'h1, div[class*=supports_infobox_] [class*="name"], [class*="support_name"]')
                    sname = txt(name_el) or url.rstrip("/").split("/")[-1]

                    m = re.search(r"\((SSR|SR|R)\)", sname, flags=re.I)
                    rarity = m.group(1).upper() if m else "UNKNOWN"

                    # Always define this before event parsing so the print never errors
                    added = 0

                    # ----- parse hints (as before) -----
                    hints = parse_support_hints_on_page(d)

                    # ----- choose/download image (as before) -----
                    img_url = ""
                    if slug in previews:
                        img_url = previews[slug].get("SupportImage", "") or ""
                        if not sup_id:
                            sup_id = previews[slug].get("SupportId", None)
                    if not img_url:
                        big = safe_find(d, By.CSS_SELECTOR, "img[src*='/images/umamusume/supports/']")
                        src = _abs_url(d, big.get_attribute("src") or "") if big else ""
                        img_url = _save_thumb(src, thumbs_dir, slug, sup_id)

                    # ----- parse events (optional) -----
                    for elist in safe_find_all(d, By.CSS_SELECTOR, 'div[class*=eventhelper_elist]'):
                        if not is_visible(d, elist):
                            continue
                        for it in elist.find_elements(By.CSS_SELECTOR, 'div[class*=compatibility_viewer_item]'):
                            if not is_visible(d, it):
                                continue
                            ev_name = txt(it)
                            if not ev_name:
                                continue
                            pop = tippy_show_and_get_popper(d, it)
                            try:
                                rows = parse_event_from_tippy_popper(pop)
                                for kv in rows:
                                    if append_json_item(
                                        out_events_path,
                                        make_support_card(ev_name, kv),
                                        dedup_key=("EventName", "EventOptions")
                                    ):
                                        added += 1
                            finally:
                                tippy_hide(d, it)

                    # ----- upsert hints (slug-keyed) -----
                    upsert_json_item(out_hints_path, "SupportSlug", slug or sname, {
                        "SupportSlug": slug or sname,
                        "SupportId": sup_id,
                        "SupportName": sname,
                        "SupportRarity": rarity,
                        "SupportImage": img_url,
                        "SupportHints": hints,
                    })

                    print(f"[{i}/{total}] SUPPORT ✓ {sname} (slug:{slug or '-'} id:{sup_id or '-'} "
                        f"+{added} events, {len(hints)} hints)")
                    break

                except (TimeoutException, WebDriverException, StaleElementReferenceException, ReadTimeoutError) as e:
                    if attempt < RETRIES:
                        try: d.quit()
                        except Exception: pass
                        d = new_driver(headless=headless)
                        with_retries(nav, d, "https://gametora.com/umamusume/supports", "main main")
                        ensure_server(d, server=server, keep_raw_en=True)
                        # rebuild previews after driver restart
                        previews = collect_support_previews(d, thumbs_dir)
                        continue
                    else:
                        print(f"[{i}/{total}] SUPPORT ERROR {url}: {e}")
                        break
    finally:
        try: d.quit()
        except Exception: pass
        
def scrape_career(save_path: str, server: str, headless: bool = True):
    d = new_driver(headless=headless)
    try:
        with_retries(nav, d, "https://gametora.com/umamusume/training-event-helper", "body")
        # Pre-set deck
        d.execute_script('localStorage.setItem("u-eh-d1","[\\"Deck 1\\",106101,1,30024,30024,30009,30024,30009,30008]")')
        d.refresh()
        ensure_server(d, server=server, keep_raw_en=True)

        _click(d, "#boxScenario"); time.sleep(DELAY)
        scenario_entries = safe_find_all(d, By.CSS_SELECTOR, 'div[class*=tooltips_tooltip_striped] > div')
        total = len(scenario_entries)

        for idx in range(total):
            _click(d, "#boxScenario"); time.sleep(DELAY)
            entry = safe_find(d, By.CSS_SELECTOR, f'div[class*=tooltips_tooltip_striped] > div:nth-of-type({idx + 1})')
            if not entry or not is_visible(d, entry): continue
            try: entry.click()
            except Exception: pass
            time.sleep(DELAY)

            btn = safe_find(d, By.CSS_SELECTOR, f'[id="{idx + 1}"][class*="filters_viewer_image_"]')
            if btn:
                try: btn.click()
                except Exception: pass
                time.sleep(DELAY)

                added = 0
                for it in safe_find_all(d, By.CSS_SELECTOR,
                        'div[class*=eventhelper_elist] > div[class*=compatibility_viewer_item]'):
                    if not is_visible(d, it): continue
                    name = txt(it)
                    if not name: continue
                    pop = tippy_show_and_get_popper(d, it)
                    try:
                        for kv in parse_event_from_tippy_popper(pop):
                            if append_json_item(save_path, make_career(name, kv),
                                                dedup_key=("EventName","EventOptions")):
                                added += 1
                    finally:
                        tippy_hide(d, it)

                print(f"[{idx + 1}/{total}] CAREER +{added} rows")
    finally:
        try: d.quit()
        except Exception: pass


def _parse_schedule(year_label: str, month_label: str) -> str:
    year_map = {"First Year": "Junior Year", "Second Year": "Classic Year", "Third Year": "Senior Year"}
    year_text = year_map.get(year_label, year_label)
    from datetime import datetime
    try:
        dt = datetime.strptime(month_label, "%B %d")
        earlylate = "Early" if dt.day == 1 else "Late"
        month_text = f"{earlylate} {dt.strftime('%b')}"
    except Exception:
        month_text = month_label
    return f"{year_text} {month_text}"

def scrape_races(save_path: str, server: str, headless: bool = True):
    d = new_driver(headless=headless)
    try:
        with_retries(nav, d, "https://gametora.com/umamusume/races", "body")
        ensure_server(d, server=server, keep_raw_en=True)

        rows = filter_visible(d, safe_find_all(d, By.CSS_SELECTOR, 'div[class*="races_race_list"] > div[class*="races_row"]'))
        total = len(rows)
        for idx, row in enumerate(rows, 1):
            name_el = safe_find(row, By.CSS_SELECTOR, 'div[class*="races_name"] > div[class*="races_item"]')
            if name_el and not is_visible(d, name_el): continue
            race_name = txt(name_el)
            if not race_name:
                print(f"[{idx}/{total}] (skip unnamed race)"); continue

            if race_name in ("Junior Make Debut", "Junior Maiden Race"):
                item = make_race(
                    race_name, "Junior Year Pre-Debut", "Pre Debut",
                    "Varies", "Varies", "Varies", "Varies", "Varies", "Varies"
                )
                append_json_item(save_path, item, dedup_key=("RaceName","Schedule","DistanceMeter"))
                print(f"[{idx}/{total}] {race_name} (special) ✓")
                continue

            date_el = safe_find(row, By.CSS_SELECTOR, 'div[class*="races_date"]')
            if not date_el or not is_visible(d, date_el):
                print(f"[{idx}/{total}] {race_name} (no date) skip"); continue

            year = txt(safe_find(date_el, By.CSS_SELECTOR, "div:nth-of-type(1)"))
            month = txt(safe_find(date_el, By.CSS_SELECTOR, "div:nth-of-type(2)"))
            if not (year and month):
                print(f"[{idx}/{total}] {race_name} (incomplete date) skip"); continue

            schedule = _parse_schedule(year, month)

            right1 = safe_find(row, By.CSS_SELECTOR, 'div[class*="aces_desc_right"] > div:nth-of-type(1)')
            right2 = safe_find(row, By.CSS_SELECTOR, 'div[class*="aces_desc_right"] > div:nth-of-type(2)')
            if not (right1 and right2) or not (is_visible(d, right1) and is_visible(d, right2)):
                print(f"[{idx}/{total}] {race_name} (no descriptors) skip"); continue

            tab1 = txt(safe_find(right1, By.CSS_SELECTOR, 'div[class*="races_tabtext"]'))
            tab2 = txt(safe_find(right2, By.CSS_SELECTOR, 'div[class*="races_tabtext"]'))
            terrain = (txt(right1) or "").replace(tab1, "").strip()
            distance_type = (txt(right2) or "").replace(tab2, "").strip()
            distance_meter = tab2

            details = safe_find(row, By.CSS_SELECTOR, 'div[class*="races_ribbon"] > div[class*="utils_linkcolor"]')
            if details and is_visible(d, details):
                try: details.click()
                except Exception: pass
                time.sleep(DELAY)

            dialog = safe_find(d, By.CSS_SELECTOR, 'div[role="dialog"]')
            if not dialog:
                print(f"[{idx}/{total}] {race_name} (no dialog) skip"); continue

            grade_text = txt(safe_find(dialog, By.CSS_SELECTOR, 'div[class*="races_det_item"]:nth-of-type(8)'))
            try:
                int(grade_text)
                grade_text = txt(safe_find(dialog, By.CSS_SELECTOR, 'div[class*="races_det_item"]:nth-of-type(10)'))
            except Exception:
                pass

            season_text = txt(safe_find(dialog, By.CSS_SELECTOR, 'div[class*="races_det_item"]:nth-of-type(16)'))

            schedule_items = safe_find_all(dialog, By.CSS_SELECTOR, 'div[class*="races_schedule_item"]')
            if len(schedule_items) < 2:
                print(f"[{idx}/{total}] {race_name} (no fans info) skip")
                close_btn = safe_find(dialog, By.CSS_SELECTOR, "img")
                if close_btn:
                    try: close_btn.click()
                    except Exception: pass
                time.sleep(DELAY)
                continue

            fans_required = (txt(schedule_items[0]) or "").replace("Fans required", "").strip()
            fans_gained = (txt(schedule_items[1]) or "").replace("Fans gained", "").replace("See all", "").strip()

            item = make_race(
                race_name, schedule, grade_text, terrain,
                distance_type, distance_meter, season_text,
                fans_required, fans_gained
            )
            append_json_item(save_path, item, dedup_key=("RaceName","Schedule","DistanceMeter"))

            close_btn = safe_find(dialog, By.CSS_SELECTOR, "img")
            if close_btn:
                try: close_btn.click()
                except Exception: pass
            time.sleep(DELAY)

            print(f"[{idx}/{total}] {race_name} ✓")
    finally:
        try: d.quit()
        except Exception: pass


def main():
    ap = argparse.ArgumentParser(description="GameTora scraper (robust + accurate Support hints; UMA skills removed)")
    ap.add_argument("--out-uma", default="Assets/uma_data.json", help="Output JSON for characters (objectives/events only)")
    ap.add_argument("--out-supports", default="Assets/support_card.json", help="Output JSON for support events")
    ap.add_argument("--out-support-hints", default="Assets/support_hints.json", help="Output JSON for support hint skills")
    ap.add_argument("--out-career", default="Assets/career.json", help="Output JSON for career events")
    ap.add_argument("--out-races", default="Assets/races.json", help="Output JSON for races")
    ap.add_argument("--thumb-dir", default="assets/support_thumbs", help="Where to save support thumbnails")
    ap.add_argument("--what", choices=["uma","supports","career","races","all"], default="all")
    ap.add_argument("--server", choices=["global","japan"], default="global")
    ap.add_argument("--headful", action="store_true")
    args = ap.parse_args()
    headless = not args.headful

    try:
        if args.what in ("uma","all"):
            print("\n=== Characters (objectives/events only) ===")
            scrape_characters(args.out_uma, server=args.server, headless=headless)
        if args.what in ("supports","all"):
            print("\n=== Supports (events + support hints) ===")
            scrape_supports(args.out_supports, args.out_support_hints, server=args.server, headless=headless)
        if args.what in ("career","all"):
            print("\n=== Career ===")
            scrape_career(args.out_career, server=args.server, headless=headless)
        if args.what in ("races","all"):
            print("\n=== Races ===")
            scrape_races(args.out_races, server=args.server, headless=headless)
    except WebDriverException as e:
        print(f"[fatal] WebDriver error: {e}", file=sys.stderr); sys.exit(2)

if __name__ == "__main__":
    main()

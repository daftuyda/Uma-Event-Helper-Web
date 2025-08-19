import { chooseRecommendedOption, renderRecommendationBadge } from "./recommend.js";

const API_BASE = window.API_BASE || `${location.protocol}//${location.host}`;

let LAST_QUERY_KEY = null;   // normalized key for last query
let LAST_PAYLOAD = null;     // optional cache (if you decide to reuse it later)

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, className, text) => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = String(text);
  return n;
};
const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

function scrubMarkers(s) {
  const str = String(s ?? "");
  if (/^\s*❯+\s*$/.test(str)) return "";
  return str
    .replace(/^\s*❯+\s*/g, "")
    .replace(/\s*❯+\s*$/g, "")
    .trim();
}

function preferLabeledOptions(optionsObj) {
  if (!optionsObj || typeof optionsObj !== "object") return optionsObj;
  const labels = Object.keys(optionsObj);
  if (labels.length === 0) return optionsObj;

  const hasLabeled = labels.some(l => String(l || "").trim() !== "");
  if (!hasLabeled) return optionsObj; // only unlabeled -> keep as-is

  const cleaned = {};
  for (const [label, groups] of Object.entries(optionsObj)) {
    if (String(label || "").trim() === "") continue; // drop
    cleaned[label] = groups;
  }
  return Object.keys(cleaned).length ? cleaned : optionsObj;
}

function normalizeQueryKey(q) {
  return scrubMarkers(q).toLowerCase();
}

function renderLine(raw) {
  let txt = scrubMarkers(raw);
  if (!txt) return null; // drop empty/marker-only lines

  if (/^※\s*/.test(txt)) {
    const div = el("div");
    div.style.fontWeight = "700";
    div.style.marginBottom = "6px";
    div.style.color = "rgb(214, 158, 46)";
    div.style.lineHeight = "1.5";
    div.textContent = txt.replace(/^※\s*/, "");
    return div;
  }

  txt = txt.replace(/\bhint\s*([+-]\d+)\b/i, "hint: $1");
  const p = el("p");
  p.textContent = txt;
  return p;
}

function splitChanceOutcomes(lines) {
  const outcomes = [];
  let current = null;
  const isEither = (s) => /^randomly either(?:\s*\([^)]+\))?$/i.test(String(s).trim());
  const isOr     = (s) => /^or(?:\s*\([^)]+\))?$/i.test(String(s).trim());

  for (const raw of (lines || [])) {
    const rawStr = String(raw);
    const line = scrubMarkers(rawStr).trim();
    if (!line) continue;
    if (isEither(line) || isOr(line)) {
      if (current && (current.header || current.bodyLines.length)) outcomes.push(current);
      current = { header: line, bodyLines: [] };
    } else {
      if (!current) return null; // no header yet → not a chance pattern
      current.bodyLines.push(rawStr);
    }
  }
  if (current && (current.header || current.bodyLines.length)) outcomes.push(current);
  return outcomes.length >= 2 ? outcomes : null;
}

function renderRewardGroup(lines) {
  const groupDiv = el("div", "reward-group");
  const outcomes = splitChanceOutcomes(lines);

  if (outcomes) {
    if (outcomes[0] && /^randomly either(?:\s*\([^)]+\))?$/i.test(outcomes[0].header || "")) {
      outcomes[0].header = "";
    }

    outcomes.forEach((oc, idx) => {
      if (idx > 0 && oc.header) {
        const sep = el("div", "outcome-separator");
        const em = document.createElement("em");
        em.textContent = oc.header; // e.g., "or (50%)"
        sep.appendChild(em);
        groupDiv.appendChild(sep);
      }

      const wrap = el("div", `outcome-alt alt-${idx % 2}`);

      (oc.bodyLines || []).forEach(line => {
        const node = renderLine(line);
        if (node) wrap.appendChild(node);
      });

      groupDiv.appendChild(wrap);
    });
    return groupDiv;
  }

  (lines || []).forEach(line => {
    const s = String(line).trim();
    if (/^randomly either(?:\s*\([^)]+\))?$/i.test(s)) return;
    const node = renderLine(line);
    if (node) groupDiv.appendChild(node);
  });

  return groupDiv;
}

function renderRewardGroups(groups) {
  const container = el("div", "reward-groups");
  (groups || []).forEach(lines => {
    const arr = Array.isArray(lines) ? lines : [String(lines)];
    container.appendChild(renderRewardGroup(arr));
  });
  return container;
}

const normalizeLine = (s) =>
  scrubMarkers(s).replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim().toLowerCase();
const groupKey = (lines) => (lines || []).map(normalizeLine).filter(Boolean).join(" | ");
function dedupeGroups(groups) {
  const seen = new Set();
  const out = [];
  for (const g of (groups || [])) {
    const arr = Array.isArray(g) ? g : [String(g)];
    const key = groupKey(arr);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(arr);
  }
  return out;
}

async function fetchEventByName(q, { limit = 5, min_score = 0 } = {}) {
  const cleanQ = scrubMarkers(q);
  const url = `${API_BASE}/event_by_name?event_name=${encodeURIComponent(cleanQ)}&limit=${limit}&min_score=${min_score}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}: ${(await res.text().catch(() => "")) || res.statusText}`);
  return res.json();
}

async function performSearch(q) {
  const status = $("#status");
  const result = $("#result");
  const queryKey = normalizeQueryKey(q);

  if (queryKey && queryKey === LAST_QUERY_KEY) {
    return; // silently skip re-rendering
  }

  clear(status); clear(result);

  const qClean = scrubMarkers(q);
  if (!qClean) { status.textContent = "Type an event name and press Search."; return; }
  status.textContent = "Searching…";

  let payload;
  try {
    payload = await fetchEventByName(qClean, { limit: 6, min_score: 0 });
  } catch (e) {
    clear(status);
    status.textContent = e.message || "Search failed.";
    return;
  }

  clear(status);

  const match = payload?.match?.data;
  if (!match || !match.options) { status.textContent = "No event found."; return; }

  const options = {};
  for (const [label, groups] of Object.entries(match.options)) {
    options[label] = dedupeGroups(groups);
  }

  const prunedOptions = preferLabeledOptions(options);

  const cleaned = { ...match, options: prunedOptions };
  renderEvent(cleaned, payload?.other_matches || []);

  LAST_QUERY_KEY = queryKey;
  LAST_PAYLOAD = payload;
}

function renderEvent(evt, otherMatches) {
  const result = $("#result");
  clear(result);

  result.appendChild(el("h2", null, scrubMarkers(evt.event_name) || "Event"));

  let rec = chooseRecommendedOption(evt);

  if (rec && rec.byLabel) {
    const EPS = 1e-6; // float tolerance
    const entries = Object.entries(rec.byLabel);
    if (entries.length > 1) {
      const maxScore = Math.max(...entries.map(([, v]) => v.score));
      const numAtMax = entries.reduce(
        (n, [, v]) => n + (Math.abs(v.score - maxScore) < EPS ? 1 : 0),
        0
      );
      if (numAtMax > 1) {
        rec = { ...rec, label: null }; // neutralize the badge
      }
    }
  }

  for (const [rawLabel, groups] of Object.entries(evt.options || {})) {
    const label = scrubMarkers(rawLabel) || "Option";
    const choice = el("div", "choice");
    const h3 = el("h3", null, label);
    if (rec?.label === rawLabel || rec?.label === label) {
      h3.appendChild(renderRecommendationBadge(rec));
    }
    choice.appendChild(h3);
    choice.appendChild(renderRewardGroups(groups));
    const total = rec?.byLabel?.[label]?.score;
    if (typeof total === 'number') {
      const scoreTag = document.createElement('div');
      scoreTag.className = 'option-score';
      scoreTag.textContent = `Score: ${total.toFixed(1)}`;
      choice.appendChild(scoreTag);
    }

    result.appendChild(choice);
  }

  if (Array.isArray(otherMatches) && otherMatches.length) {
    const wrap = el("div");
    wrap.style.marginTop = "12px";
    const cap = el("div", null, "Other matches:"); cap.style.fontWeight = "600";
    wrap.appendChild(cap);
    const ul = el("ul");
    otherMatches.forEach(m => {
      const name = scrubMarkers(m.event_name);
      const li = el("li");
      const a = el("a"); a.href = "#"; a.textContent = `${name} (${Math.round(m.score)}%)`;
      a.addEventListener("click", e => {
        e.preventDefault();
        $("#query").value = name;
        performSearch(name);
      });
      li.appendChild(a);
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    result.appendChild(wrap);
  }
}

function attachUI() {
  const form = $("#search-form");
  const input = $("#query");
  form.addEventListener("submit", e => { e.preventDefault(); performSearch(input.value); });

  try {
    const q = new URLSearchParams(location.search).get("q");
    if (q) { input.value = scrubMarkers(q); performSearch(q); }
  } catch {}
}
document.addEventListener("DOMContentLoaded", attachUI);

window.performSearch = performSearch;

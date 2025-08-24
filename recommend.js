const STAT_KEYS = new Set([
  "speed",
  "stamina",
  "power",
  "guts",
  "intelligence",
  "wit",
  "wisdom",
  "sp",
  "sta",
  "pwr",
  "int",
]);
const ENERGY_KEYS = new Set(["energy", "stamina (energy)"]);
const BOND_KEY = "bond";
const MOOD_KEY = "mood";
const HINT_KEY = "hint";

function toNum(val) {
  const n = Number(String(val).replace(/[^\-0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function norm(s) {
  return String(s || "").trim();
}
function lc(s) {
  return norm(s).toLowerCase();
}

function normStatusName(text) {
  let s = String(text || "");
  s = s.replace(/\bstatus\b/i, ""); // drop the trailing word "status"
  s = s.replace(/^("|'|Get\s+|Lose\s+)/i, ""); // remove leading quotes/Get/Lose
  s = s.replace(/^get\s+/i, "").replace(/^lose\s+/i, "");
  s = s.replace(/[○●◎◇◆]/g, "").trim();
  s = s.trim();
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function splitChanceOutcomesFromLines(lines) {
  const out = [];
  let current = null;
  const isEither = (s) =>
    /^randomly either(?:\s*\([^)]+\))?$/i.test(String(s).trim());
  const isOr = (s) => /^or(?:\s*\([^)]+\))?$/i.test(String(s).trim());

  for (const raw of lines || []) {
    const line = String(raw).trim();
    if (!line) continue;

    if (isEither(line) || isOr(line)) {
      if (current && (current.header || current.bodyLines.length))
        out.push(current);
      current = { header: line, bodyLines: [] };
    } else {
      if (!current) {
        // no header yet -> not a chance pattern
        return null;
      }
      current.bodyLines.push(raw);
    }
  }
  if (current && (current.header || current.bodyLines.length))
    out.push(current);
  return out.length >= 2 ? out : null;
}

function parseHeaderPercent(header) {
  const m = String(header || "").match(/\((\d+)\s*%\)/);
  return m ? Number(m[1]) : null;
}

export function parseRewardLine(line) {
  const raw = norm(line);
  const lower = lc(raw);

  if (!raw) return { type: "text", text: raw };

  const hintMatch = lower.match(/(.+?)\s+hint\s*([+\-]?\d+)?$/i);
  if (hintMatch) {
    const name = norm(hintMatch[1]);
    const val = toNum(hintMatch[2] ?? 1);
    return { type: "hint", name, value: val, raw };
  }

  const statPair = raw.match(/^([A-Za-z]+)\s*([+\-]\s*\d+)/);
  if (statPair) {
    const keyRaw = statPair[1];
    const val = toNum(statPair[2]);
    const keyLc = lc(keyRaw);

    const key =
      keyLc === "sp" || keyLc === "speed"
        ? "speed"
        : keyLc === "sta" || keyLc === "stamina"
        ? "stamina"
        : keyLc === "pwr" || keyLc === "power"
        ? "power"
        : keyLc === "guts"
        ? "guts"
        : keyLc === "int" ||
          keyLc === "intelligence" ||
          keyLc === "wit" ||
          keyLc === "wisdom"
        ? "intelligence"
        : keyLc;

    if (STAT_KEYS.has(key)) {
      return { type: "stat", key, value: val, raw };
    }
  }

  if (lower.startsWith("energy ")) {
    const num = toNum(raw.split(/\s+/).slice(1).join(" "));
    return { type: "energy", value: num, raw };
  }

  if (lower.startsWith("mood ")) {
    const num = toNum(raw.split(/\s+/).slice(1).join(" "));
    return { type: "mood", value: num, raw };
  }
  if (/mood (up|down)/i.test(raw)) {
    const sign = /up/i.test(raw) ? +1 : -1;
    return { type: "mood", value: sign, raw };
  }

  const bondMatch = raw.match(/bond\s*([+\-]?\d+)/i);
  if (bondMatch) {
    return { type: "bond", value: toNum(bondMatch[1]), raw };
  }

  if (/^skill\s*points?\s*[+\-]?\d+/i.test(raw)) {
    const m = raw.match(/^skill\s*points?\s*([+\-]?\d+)/i);
    return { type: "skill_points", value: toNum(m?.[1] ?? 0), raw };
  }

  if (/^get\s+/i.test(raw)) {
    return { type: "status_gain", text: raw.replace(/^get\s+/i, ""), raw };
  }
  if (/^lose\s+/i.test(raw)) {
    return { type: "status_loss", text: raw.replace(/^lose\s+/i, ""), raw };
  }

  return { type: "text", text: raw };
}

export function parseGroup(lines) {
  return (lines || []).map(parseRewardLine);
}

const WEIGHTS = {
  energy: 1.2, // energy is very important
  stat: 1.0, // each stat point
  bond: 0.25, // bond is useful early
  mood: 3.0, // mood effect
  hint: 4.0, // skill hints in certain contexts
  status_gain: -1.0, // mild fallback for unknown gains
  status_loss: 1.0, // mild fallback for unknown removals
  text: 0.0, // neutral for unknown text
};

const STATUS_WEIGHTS = {
  Charming: 20,
  "Fast Learner": 20,
  "Hot Topic": 20,
  "Practice Perfect": 20,

  "Practice Poor": -20,
  Slacker: -20,
  "Slow Metabolism": -20,
  Gatekept: -20,
};

const STAT_MULT = {
  speed: 1.0,
  stamina: 1.0,
  power: 1.0,
  guts: 0.6,
  intelligence: 0.8,
};

function scoreItem(item) {
  switch (item.type) {
    case "energy":
      return {
        score: WEIGHTS.energy * (item.value || 0),
        note: `Energy ${fmtPlus(item.value)}`,
      };
    case "stat": {
      const mult = STAT_MULT[item.key] ?? 1.0;
      const s = WEIGHTS.stat * mult * item.value;
      return {
        score: s,
        note: `${cap(item.key)} ${fmtPlus(item.value)} (${mult.toFixed(2)}×)`,
      };
    }
    case "bond":
      return {
        score: WEIGHTS.bond * item.value,
        note: `Bond ${fmtPlus(item.value)}`,
      };
    case "skill_points":
      return {
        score: 0.25 * (item.value || 0),
        note: `Skill points ${fmtPlus(item.value)}`,
      };
    case "mood":
      return {
        score: WEIGHTS.mood * item.value,
        note: `Mood ${item.value > 0 ? "Up" : "Down"}`,
      };
    case "hint":
      return {
        score: WEIGHTS.hint * (item.value || 1),
        note: `Hint: ${item.name} ${fmtPlus(item.value || 1)}`,
      };
    case "status_gain": {
      const name = normStatusName(item.text);
      const custom = STATUS_WEIGHTS[name];
      const s = custom !== undefined ? custom : WEIGHTS.status_gain;
      const note =
        custom !== undefined
          ? `Status gained: ${name}`
          : `Status gained: ${name || item.text}`;
      return { score: s, note };
    }
    case "status_loss": {
      const name = normStatusName(item.text);
      const custom = STATUS_WEIGHTS[name];
      const s = custom !== undefined ? -custom : WEIGHTS.status_loss;
      const note =
        custom !== undefined
          ? `Status removed: ${name}`
          : `Status removed: ${name || item.text}`;
      return { score: s, note };
    }
    default:
      return { score: WEIGHTS.text, note: item.text || item.raw || "" };
  }
}

export function scoreGroup(parsedGroup) {
  let total = 0;
  const details = [];
  for (const it of parsedGroup) {
    const { score, note } = scoreItem(it);
    total += score;
    if (note) details.push({ score, note, type: it.type });
  }
  return { score: total, details };
}

export function scoreOption(groups) {
  const parsed = (groups || []).map(parseGroup); // keep for tie-breakers
  let total = 0;
  const breakdown = [];
  const keptGroups = groups;

  const add = (label, val) => {
    breakdown.push(`${label} → ${val >= 0 ? "+" : ""}${val}`);
    total += val;
  };

  function scoreLineRaw(s) {
    let m = s.match(/^Energy\s*([+\-]?\d+)/i);
    if (m) return WEIGHTS.energy * Number(m[1]);

    m = s.match(/^(Skill\s*points?)\s*([+\-]?\d+)/i);
    if (m) return 0.25 * Number(m[2]);

    m = s.match(/^All\s*stats\s*([+\-]?\d+)/i);
    if (m) {
      const amt = m[1]; // keeps +/-
      return (
        scoreLineRaw(`Speed ${amt}`) +
        scoreLineRaw(`Stamina ${amt}`) +
        scoreLineRaw(`Power ${amt}`) +
        scoreLineRaw(`Guts ${amt}`) +
        scoreLineRaw(`Wisdom ${amt}`)
      );
    }

    m = s.match(/^Last\s*trained\s*stat\s*([+\-]?\d+)/i);
    if (m) {
      const amt = m[1];
      const sum =
        scoreLineRaw(`Speed ${amt}`) +
        scoreLineRaw(`Stamina ${amt}`) +
        scoreLineRaw(`Power ${amt}`) +
        scoreLineRaw(`Guts ${amt}`) +
        scoreLineRaw(`Wisdom ${amt}`);
      return sum / 5; // expected value when we don't know which stat was last trained
    }

    m = s.match(
      /^(Speed|Power|Stamina|Guts|Wisdom|Intelligence)\s*([+\-]?\d+)/i
    );
    if (m) {
      const key = m[1].toLowerCase();
      const val = Number(m[2]);
      const mult =
        key === "guts"
          ? 0.6
          : key === "wisdom" || key === "intelligence"
          ? 0.8 // matches your file’s STAT_MULT
          : 1.0;
      return 1.0 * mult * val;
    }

    m = s.match(/\bbond\s*([+\-]?\d+)/i);
    if (m) return 0.25 * Number(m[1]);

    m = s.match(/^Mood\s*([+\-]?\d+)/i);
    if (m) return 3.0 * Number(m[1]);

    m = s.match(/\bhint\s*([+\-]?\d+)/i);
    if (m) return 4.0 * Number(m[1] || 1);

    if (/^Get\s+/i.test(s) || /status$/i.test(s)) {
      const name = normStatusName(s);
      const custom = STATUS_WEIGHTS[name];
      return custom !== undefined ? custom : -1.0;
    }
    if (/^Lose\s+/i.test(s)) {
      const name = normStatusName(s);
      const custom = STATUS_WEIGHTS[name];
      return custom !== undefined ? -custom : 1.0;
    }

    return 0;
  }

  const isStatLine = (ln) =>
    /^(Speed|Power|Stamina|Guts|Wisdom|Intelligence)\s*[+\-]?\d+/i.test(ln);

  let pendingStatRun = []; // holds numeric scores for a contiguous run of stat-only single-line groups

  function flushStatRun() {
    if (pendingStatRun.length >= 2) {
      const ev =
        pendingStatRun.reduce((a, b) => a + b, 0) / pendingStatRun.length;
      add(
        `Stat set EV (${pendingStatRun.length} outcomes)`,
        Number(ev.toFixed(2))
      );
    } else if (pendingStatRun.length === 1) {
      add(`Stat`, pendingStatRun[0]);
    }
    pendingStatRun = [];
  }

  (groups || []).forEach((lines, gi) => {
    const arr = Array.isArray(lines) ? lines : [String(lines)];
    const outcomes = splitChanceOutcomesFromLines(arr);

    if (outcomes) {
      flushStatRun();

      const vals = [];
      const weights = [];
      let explicitWeights = true;

      outcomes.forEach((oc) => {
        const v = (oc.bodyLines || []).reduce(
          (acc, ln) => acc + scoreLineRaw(String(ln)),
          0
        );
        const p = parseHeaderPercent(oc.header);
        if (p == null) explicitWeights = false;
        vals.push(v);
        weights.push(p == null ? 0 : p);
      });

      let groupEV = 0;
      if (explicitWeights && weights.some((w) => w > 0)) {
        const sumW = weights.reduce((a, b) => a + b, 0) || 100;
        groupEV = vals.reduce((acc, v, i) => acc + v * (weights[i] / sumW), 0);
        add(`Group ${gi + 1} (EV, weighted)`, Number(groupEV.toFixed(2)));
      } else {
        groupEV = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
        add(`Group ${gi + 1} (EV, average)`, Number(groupEV.toFixed(2)));
      }
      return;
    }

    const arrNorm = arr.map((x) => String(x));
    const statOnlyLines = arrNorm.filter(isStatLine);

    if (statOnlyLines.length >= 2 && statOnlyLines.length === arrNorm.length) {
      flushStatRun();
      const scores = statOnlyLines.map((ln) => scoreLineRaw(ln));
      const sum = scores.reduce((a, b) => a + b, 0);
      add(`Group ${gi + 1}`, Number(sum.toFixed(2)));
      return;
    }

    if (arrNorm.length === 1 && isStatLine(arrNorm[0])) {
      pendingStatRun.push(scoreLineRaw(arrNorm[0]));
      return; // do not add yet; wait to see if the run continues
    }

    flushStatRun();
    arrNorm.forEach((ln) => {
      const s = scoreLineRaw(ln);
      if (s !== 0) add(ln, s);
    });
  });

  flushStatRun();

  return { total, breakdown, parsed, groups: keptGroups };
}

function sumEnergyEntry(entry) {
  let s = 0;
  if (entry?.parsed) {
    entry.parsed.flat().forEach((it) => {
      if (it && it.type === "energy") s += it.value || 0;
    });
    return s;
  }
  (entry?.groups || []).forEach((lines) => {
    (lines || []).forEach((line) => {
      const m = String(line).match(/^Energy\s*([+\-]?\d+)/i);
      if (m) s += Number(m[1]) || 0;
    });
  });
  return s;
}

function sumHintsEntry(entry) {
  let s = 0;
  if (entry?.parsed) {
    entry.parsed.flat().forEach((it) => {
      if (it && it.type === "hint") s += it.value || 1;
    });
    return s;
  }
  (entry?.groups || []).forEach((lines) => {
    (lines || []).forEach((line) => {
      const m = String(line).match(/\bhint\s*([+\-]?\d+)/i);
      if (m) s += Number(m[1] || 1);
    });
  });
  return s;
}

export function chooseRecommendedOption(eventData) {
  const notes = [];
  if (
    !eventData ||
    !eventData.options ||
    typeof eventData.options !== "object"
  ) {
    return {
      label: null,
      score: 0,
      byLabel: {},
      notes: ["No options to evaluate."],
    };
  }

  const byLabel = {};
  for (const [label, groups] of Object.entries(eventData.options)) {
    const { total, breakdown, parsed, groups: kept } = scoreOption(groups);
    byLabel[label] = {
      score: total,
      breakdown,
      parsed,
      groups: kept || groups,
    };
  }

  const labels = Object.keys(byLabel);
  if (labels.length === 0) return { label: null, score: 0, byLabel, notes };

  const EPS = 1e-6;
  const maxScore = Math.max(...labels.map((l) => byLabel[l].score));
  const numAtMax = labels.reduce(
    (n, l) => n + (Math.abs(byLabel[l].score - maxScore) < EPS ? 1 : 0),
    0
  );
  let best = null;

  if (numAtMax === 1) {
    best = labels.find((l) => Math.abs(byLabel[l].score - maxScore) < EPS);
  } else {
    let candidates = labels.filter(
      (l) => Math.abs(byLabel[l].score - maxScore) < EPS
    );

    let bestEnergy = -Infinity,
      energyWinners = [];
    candidates.forEach((l) => {
      const e = sumEnergyEntry(byLabel[l]);
      if (e > bestEnergy) {
        bestEnergy = e;
        energyWinners = [l];
      } else if (e === bestEnergy) {
        energyWinners.push(l);
      }
    });

    if (energyWinners.length === 1) {
      best = energyWinners[0];
    } else {
      let bestHints = -Infinity,
        hintWinners = [];
      energyWinners.forEach((l) => {
        const h = sumHintsEntry(byLabel[l]);
        if (h > bestHints) {
          bestHints = h;
          hintWinners = [l];
        } else if (h === bestHints) {
          hintWinners.push(l);
        }
      });

      best = hintWinners.length === 1 ? hintWinners[0] : null;
    }
  }

  if (best)
    notes.push(
      `Recommended “${best}” (score ${byLabel[best].score.toFixed(1)})`
    );

  return { label: best, score: best ? byLabel[best].score : 0, byLabel, notes };
}

function fmtPlus(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return (num >= 0 ? "+" : "") + num;
}
function cap(s) {
  s = String(s || "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function renderRecommendationBadge(result) {
  const span = document.createElement("span");
  span.className = "recommended-badge";
  span.title = "This option is recommended based on rewards";
  span.style.marginLeft = "8px";
  span.style.backgroundColor = "#48BB78";
  span.style.color = "white";
  span.style.fontSize = "0.75em";
  span.style.padding = "2px 6px";
  span.style.borderRadius = "12px";
  span.style.fontWeight = "600";
  span.textContent = "Recommended";
  if (!result || !result.label) span.style.display = "none";
  return span;
}

export function explainRecommendation(result) {
  const wrap = document.createElement("div");
  wrap.style.marginTop = "6px";
  wrap.style.fontSize = "0.9em";

  if (!result || !result.label) {
    wrap.textContent = "No recommendation available.";
    return wrap;
  }

  const best = result.byLabel[result.label];
  const hdr = document.createElement("div");
  hdr.style.fontWeight = "700";
  hdr.textContent = `Why “${result.label}”? (score ${best.score.toFixed(1)})`;
  wrap.appendChild(hdr);

  best.breakdown.forEach((g) => {
    const gdiv = document.createElement("div");
    gdiv.style.margin = "4px 0 2px";
    const title = document.createElement("div");
    title.style.color = "var(--text-secondary, #666)";
    title.textContent = `Group ${g.group}: ${g.score.toFixed(1)}`;
    gdiv.appendChild(title);

    const ul = document.createElement("ul");
    ul.style.margin = "2px 0 0 18px";
    g.topContribs.forEach((c) => {
      const li = document.createElement("li");
      li.textContent = `${c.note} (${c.score >= 0 ? "+" : ""}${c.score.toFixed(
        1
      )})`;
      ul.appendChild(li);
    });
    gdiv.appendChild(ul);
    wrap.appendChild(gdiv);
  });

  return wrap;
}

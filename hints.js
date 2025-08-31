(async function () {
  const DATA_URL = "/assets/support_hints.json";
  const res = await fetch(DATA_URL, { cache: "no-store" });
  const data = await res.json();

  // Normalizer used for fuzzy matching (unchanged behavior)
  const norm = (s) =>
    (s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[○•\u25CB]/g, "")
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  function cleanCardName(full){
    return String(full || "")
      .replace(/\s*\((?:SSR|SR|R)\)\s*/i, " ") // drop rarity tag
      .replace(/Support\s*Card/i, "")          // drop suffix
      .replace(/\s+/g, " ")
      .trim();
  }

  function initialsOf(title){
    const cleaned = String(title || "")
      .replace(/\(.*?\)/g, "")
      .replace(/Support\s*Card/i, "")
      .trim();

    const tokens = cleaned
      .split(/\s+/)
      .map(t => t.replace(/[^A-Za-z]/g, ""))   // letters only for initials
      .filter(Boolean);

    if (tokens.length >= 2) return (tokens[0][0] + tokens[1][0]).toUpperCase();
    if (tokens.length === 1) {
      const t = tokens[0];
      return (t.slice(0, 2) || t[0] || "?").toUpperCase();  // e.g., “Vo” for “Vodka”
    }
    return "?";
  }

  // Parse raw data
  const cards = (data ?? []).map((c) => {
    const rawName = c?.SupportName ?? "";
    const name = cleanCardName(rawName); // assumes you added cleanCardName()
    const rarity =
      (c?.SupportRarity ||
        (/\((SSR|SR|R)\)/i.exec(rawName)?.[1]) ||
        "UNKNOWN").toUpperCase();

    const hints = Array.isArray(c?.SupportHints)
      ? c.SupportHints
          .map(h => (typeof h === "string" ? h : h?.Name || ""))
          .filter(Boolean)
      : [];

    const img  = c?.SupportImage || c?.Image || c?.Thumb || null;  // thumbnail if present
    const slug = c?.SupportSlug || c?.slug || null;                 // unique key per card
    const id   = c?.SupportId ?? null;

    return { name, rawName, rarity, hints, img, slug, id };
  });

  const allHints = Array.from(new Set(cards.flatMap((c) => c.hints))).sort(
    (a, b) => a.localeCompare(b)
  );

  // Elements
  const hintInput   = document.getElementById("hintInput");
  const addBtn      = document.getElementById("addBtn");
  const modeSelect  = document.getElementById("modeSelect");
  const fSSR        = document.getElementById("fSSR");
  const fSR         = document.getElementById("fSR");
  const fR          = document.getElementById("fR");
  const clearBtn    = document.getElementById("clearBtn");
  const copyLinkBtn = document.getElementById("copyLinkBtn"); // optional
  const exportBtn   = document.getElementById("exportBtn");   // optional
  const chips       = document.getElementById("chips");
  const results     = document.getElementById("results");
  const counts      = document.getElementById("counts");
  const hintList    = document.getElementById("hintList");

  // Fill datalist
  hintList.innerHTML = allHints.map((h) => `<option value="${h}"></option>`).join("");

  let selected = [];

  // --- URL state ---
  function readFromURL() {
    const p = new URLSearchParams(location.search);
    const q = (p.get("hints") || "")
      .split(",")
      .map(decodeURIComponent)
      .map((s) => s.trim())
      .filter(Boolean);
    const mode = p.get("mode");
    const rar = (p.get("rar") || "SSR,SR,R")
      .split(",")
      .map((s) => s.trim().toUpperCase());
    if (q.length) selected = q;
    if (mode === "OR") modeSelect.value = "OR";
    fSSR.checked = rar.includes("SSR");
    fSR.checked  = rar.includes("SR");
    fR.checked   = rar.includes("R");
  }
  function writeToURL() {
    const p = new URLSearchParams();
    if (selected.length) p.set("hints", selected.map(encodeURIComponent).join(","));
    p.set("mode", modeSelect.value);
    const rar = [
      fSSR.checked ? "SSR" : null,
      fSR.checked  ? "SR"  : null,
      fR.checked   ? "R"   : null,
    ].filter(Boolean).join(",");
    p.set("rar", rar || "none");
    history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
  }

  // --- Rendering ---
  function renderChips() {
    chips.innerHTML = selected
      .map(
        (h, i) =>
          `<span class="chip">${h}<button aria-label="Remove ${h}" data-i="${i}">×</button></span>`
      )
      .join("");
    chips.querySelectorAll("button[data-i]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selected.splice(Number(btn.dataset.i), 1);
        update();
      });
    });
  }

  function rarityAllowed(r) {
    if (r === "SSR") return fSSR.checked;
    if (r === "SR")  return fSR.checked;
    if (r === "R")   return fR.checked;
    return true;
  }

  function matchCard(card) {
    if (!rarityAllowed(card.rarity)) return false;
    if (!selected.length) return true;

    const cardHintsNorm = new Set(card.hints.map(norm));
    const wanted = selected.map(norm);

    if (modeSelect.value === "AND") {
      return wanted.every((w) =>
        Array.from(cardHintsNorm).some((h) => h.includes(w))
      );
    } else {
      return wanted.some((w) =>
        Array.from(cardHintsNorm).some((h) => h.includes(w))
      );
    }
  }

  function highlightMatches(hint) {
    const wanted = selected.map(norm).filter(Boolean);
    const hN = norm(hint);
    const isMatch = wanted.some((w) => hN.includes(w));
    return `<span class="pill ${isMatch ? "match" : ""}">${hint}</span>`;
  }

  function initialsOf(name){
    const parts = String(name).trim().split(/\s+/);
    return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
  }

  function renderResults(list) {
    results.innerHTML = list.map((card) => {
      const rarityClass = `badge-${card.rarity}`; // badge-SSR | badge-SR | badge-R
      const thumb = card.img
        ? `<img src="${card.img}" alt="${card.name}" loading="lazy">`
        : `<span>${initialsOf(card.name)}</span>`;
      return `
        <div class="card card-support">
          <div class="card-thumb">${thumb}</div>
          <div class="card-title">
            <h3>${card.name}</h3>
            <span class="badge ${rarityClass}">${card.rarity}</span>
          </div>
          <div style="grid-column: 1 / -1;">
            ${card.hints.map(highlightMatches).join("")}
          </div>
        </div>
      `;
    }).join("");
  }

  function updateCounts(list) {
    const totalCards = cards.length;
    const totalHints = allHints.length;
    counts.textContent = `${list.length} card(s) matched | ${totalCards} cards total | ${totalHints} unique hints`;
  }

  function update() {
    renderChips();
    writeToURL();
    const matched = cards
      .filter(matchCard)
      .sort((a, b) => a.name.localeCompare(b.name));
    renderResults(matched);
    updateCounts(matched);
  }

  // --- Input handling ---

  // Smart split: commas BETWEEN digits are preserved (1,500,000 CC stays whole).
  function smartSplit(raw) {
    // Temporarily protect numeric commas: 1,234 -> 1␟234
    const PROTECT = "\u241F"; // symbol for visual clarity if ever seen
    const protectedStr = raw.replace(/(\d),(?=\d)/g, `$1${PROTECT}`);
    // Split on commas that aren't part of numbers
    return protectedStr
      .split(",")
      .map((s) => s.replace(new RegExp(PROTECT, "g"), ",").trim())
      .filter(Boolean);
  }

  function addFromInput() {
    const raw = hintInput.value.trim();
    if (!raw) return;
    const many = smartSplit(raw);
    many.forEach((h) => {
      if (!selected.includes(h)) selected.push(h);
    });
    hintInput.value = "";
    update();
  }

  // Bindings (safe even if optional buttons don't exist)
  addBtn.addEventListener("click", addFromInput);
  hintInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addFromInput();
    }
  });
  [modeSelect, fSSR, fSR, fR].forEach((el) => el.addEventListener("change", update));
  clearBtn.addEventListener("click", () => {
    selected = [];
    update();
  });

  if (copyLinkBtn) {
    copyLinkBtn.addEventListener("click", async () => {
      writeToURL();
      try {
        await navigator.clipboard.writeText(location.href);
        copyLinkBtn.textContent = "Copied!";
        setTimeout(() => (copyLinkBtn.textContent = "Copy link"), 1200);
      } catch {
        alert("Copy failed—select the address bar to copy.");
      }
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      const matched = cards.filter(matchCard).map((c) => {
        const wanted = selected.map(norm);
        const matchedHints = c.hints.filter((h) => {
          const hN = norm(h);
          return wanted.length ? wanted.some((w) => hN.includes(w)) : true;
        });
        return { SupportName: c.name, Rarity: c.rarity, Hints: matchedHints };
      });
      const blob = new Blob([JSON.stringify(matched, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "support_hint_search.json";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // Init
  readFromURL();
  update();
})();

const DATA_URL = "/assets/uma_data.json";

const STAT_KEYS = ["Speed", "Stamina", "Power", "Guts", "Wit"];
const GRADE_ORDER = { S:7, A:6, B:5, C:4, D:3, E:2, F:1, G:0 };

const $ = (s, r=document)=>r.querySelector(s);
const el = (t,c,txt)=>{ const n=document.createElement(t); if(c) n.className=c; if(txt!=null) n.textContent=txt; return n; };

function pickBaseStats(uma) {
  const obj = uma && uma.UmaBaseStats;
  if (!obj || typeof obj !== "object") return null;
  const keys = Object.keys(obj);
  return keys.length ? obj[keys[0]] : null;
}

function cmpNumDir(guess, target){
  if (guess==null || target==null) return null;
  const g = +guess, t = +target;
  if (Number.isNaN(g) || Number.isNaN(t)) return null;
  if (g === t) return 0;
  return g < t ? 1 : -1;
}
function gradeVal(ch) { return GRADE_ORDER[String(ch||'').toUpperCase()] ?? null; }
function cmpGradeDir(guess, target){
  const g = gradeVal(guess), t = gradeVal(target);
  if (g==null || t==null) return null;
  if (g === t) return 0;
  return g < t ? 1 : -1;
}
function sym(c){ return c===0 ? "✓" : (c>0 ? "▲" : "▼"); }
function cls(c){ return c===0 ? "match" : (c>0 ? "up" : "down"); }

function buildLabel(u) {
  return u.UmaNickname ? `${u.UmaName} — ${u.UmaNickname}` : u.UmaName;
}

function fillDatalist(listEl, labels) {
  listEl.innerHTML = labels.map(n => `<option value="${n}"></option>`).join("\n");
}

function cellLine(labelText, valueText, cmpVal){
  const cell = el("div", `cell ${cls(cmpVal)}`);
  const k = el("span","k", `${labelText}: ${valueText}`);
  const s = el("span",`sym ${cls(cmpVal)}`, sym(cmpVal));
  cell.append(k, s);
  return cell;
}

function renderGuess(rowsWrap, g, target) {
  const card = el("div","row card");

  // Name
  card.append(el("div","uma-name", g.UmaName || "Unknown"));
  if (g.UmaNickname) card.append(el("div","uma-nick muted", `(${g.UmaNickname})`));

  // Base Stats
  const baseG = pickBaseStats(g) || {};
  const baseT = pickBaseStats(target) || {};
  const baseWrap = el("div","section");
  baseWrap.append(el("div","section-title","Base stats"));
  const baseRow = el("div","group");
  STAT_KEYS.forEach(k=>{
    const cmp = cmpNumDir(baseG[k], baseT[k]);
    baseRow.append(cellLine(k, baseG[k] ?? "–", cmp));
  });
  baseWrap.append(baseRow);
  card.append(baseWrap);

  // Stat Bonuses
  const bonusWrap = el("div","section");
  bonusWrap.append(el("div","section-title","Stat bonuses"));
  const bonusRow = el("div","group");
  STAT_KEYS.forEach(k=>{
    const gV = (g.UmaStatBonuses||{})[k];
    const tV = (target.UmaStatBonuses||{})[k];
    const cmp = cmpNumDir(typeof gV === 'number' ? gV : parseInt(gV), typeof tV === 'number' ? tV : parseInt(tV));
    const show = (gV==null ? "–" : `${gV}%`);
    bonusRow.append(cellLine(k, show, cmp));
  });
  bonusWrap.append(bonusRow);
  card.append(bonusWrap);

  // Aptitudes (three separate rows)
  const aptWrap = el("div","section");
  aptWrap.append(el("div","section-title","Aptitudes"));
  const aptG = g.UmaAptitudes || {};
  const aptT = target.UmaAptitudes || {};

  const addAptRow = (title, keys, groupKey) => {
    aptWrap.append(el("div","group-title", title));
    const row = el("div","group");
    keys.forEach(k=>{
      const gv = aptG?.[groupKey]?.[k];
      const tv = aptT?.[groupKey]?.[k];
      const cmp = cmpGradeDir(gv, tv);
      row.append(cellLine(k, gv ?? "–", cmp));
    });
    aptWrap.append(row);
  };

  addAptRow("Surface", ["Turf","Dirt"], "Surface");
  addAptRow("Distance", ["Short","Mile","Medium","Long"], "Distance");
  addAptRow("Strategy", ["Front","Pace","Late","End"], "Strategy");

  card.append(aptWrap);

  // PREPEND so newest guess is first
  rowsWrap.prepend(card);
}

(function init(){
  fetch(DATA_URL, {cache:"no-store"})
    .then(r=>r.json())
    .then(data=>{
      const byLabel = {};
      const labels = data.map(u => buildLabel(u)).sort((a,b)=>a.localeCompare(b));
      data.forEach(u => { byLabel[buildLabel(u).toLowerCase()] = u; });
      fillDatalist(document.getElementById("umaList"), labels);

      const params = new URLSearchParams(location.search);
      const targetParam = (params.get("target") || "").toLowerCase();
      let target = targetParam ? byLabel[targetParam] : null;
      if (!target) target = data[Math.floor(Math.random() * data.length)];

      const rows = document.getElementById("rows");
      const form = document.getElementById("guess-form");
      const input = document.getElementById("guess");
      const footer = document.getElementById("footer");

      // --- Win modal helpers ---
      const modal = $("#winModal");
      const winMsg = $("#winMsg");
      const winNewBtn = $("#winNewBtn");
      const winCloseBtn = $("#winCloseBtn");

      function openWinModal() {
        winMsg.textContent = `${target.UmaName}${target.UmaNickname ? " ("+target.UmaNickname+")" : ""}`;
        modal.classList.add("open");
        modal.setAttribute("aria-hidden","false");
        setTimeout(()=> winNewBtn.focus(), 0);
      }
      function closeWinModal() {
        modal.classList.remove("open");
        modal.setAttribute("aria-hidden","true");
      }

      modal.addEventListener("click", (e)=> {
        if (e.target === modal) closeWinModal();
      });
      document.addEventListener("keydown", (e)=> {
        if (modal.classList.contains("open") && e.key === "Escape") closeWinModal();
      });

      // Start a new game
      function newGame() {
        if (data.length > 1) {
          const pool = data.filter(u => buildLabel(u) !== buildLabel(target));
          target = pool[Math.floor(Math.random() * pool.length)];
        }
        rows.innerHTML = "";
        footer.textContent = "";
        input.value = "";
        input.focus();
      }

      winNewBtn.addEventListener("click", ()=>{
        closeWinModal();
        newGame();
      });
      winCloseBtn.addEventListener("click", ()=>{
        closeWinModal();
      });

      // --- Guess flow ---
      form.addEventListener("submit", e => {
        e.preventDefault();
        const val = input.value.trim();
        const g = byLabel[val.toLowerCase()];
        if (!g) { footer.textContent = "No such UMA. Pick from suggestions."; return; }
        footer.textContent = "";
        renderGuess(rows, g, target);

        // victory check
        const baseEq  = STAT_KEYS.every(k => (pickBaseStats(g)?.[k] ?? null) === (pickBaseStats(target)?.[k] ?? null));
        const bonusEq = STAT_KEYS.every(k => (g.UmaStatBonuses||{})[k] == (target.UmaStatBonuses||{})[k]);
        const eqA = (grp, ks)=> ks.every(k => (g.UmaAptitudes?.[grp]?.[k] || null) === (target.UmaAptitudes?.[grp]?.[k] || null));
        const aptEq  = eqA("Surface",["Turf","Dirt"]) && eqA("Distance",["Short","Mile","Medium","Long"]) && eqA("Strategy",["Front","Pace","Late","End"]);

        if (baseEq && bonusEq && aptEq) {
          footer.textContent = "You got it! All stats match.";
          footer.style.fontWeight = "700";
          openWinModal();
        }
        input.value = "";
        input.focus();
      });
    });
})();

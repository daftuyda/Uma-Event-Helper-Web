// Skill Optimizer Page Script
// Loads skills from JSON or CSV, lets you select purchasable skills with costs,
// and maximizes total score under a budget with goldÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢lower mutual-exclusion.

(function () {
  const rowsEl = document.getElementById('rows');
  const addRowBtn = document.getElementById('add-row');
  const optimizeBtn = document.getElementById('optimize');
  const clearAllBtn = document.getElementById('clear-all');
  const budgetInput = document.getElementById('budget');
  const libStatus = document.getElementById('lib-status');

  const resultsEl = document.getElementById('results');
  const bestScoreEl = document.getElementById('best-score');
  const usedPointsEl = document.getElementById('used-points');
  const totalPointsEl = document.getElementById('total-points');
  const remainingPointsEl = document.getElementById('remaining-points');
  const selectedListEl = document.getElementById('selected-list');

  // Race config selects (mirroring main page)
  const cfg = {
    turf: document.getElementById('cfg-turf'),
    dirt: document.getElementById('cfg-dirt'),
    sprint: document.getElementById('cfg-sprint'),
    mile: document.getElementById('cfg-mile'),
    medium: document.getElementById('cfg-medium'),
    long: document.getElementById('cfg-long'),
    front: document.getElementById('cfg-front'),
    pace: document.getElementById('cfg-pace'),
    late: document.getElementById('cfg-late'),
    end: document.getElementById('cfg-end'),
  };

  let skillsByCategory = {};    // category -> [{ name, score, checkType }]
  let categories = [];
  const preferredOrder = ['golden','yellow','blue','green','red','purple','ius'];

  function normalize(str) { return (str || '').toString().trim().toLowerCase(); }

  function getBucketForGrade(grade) {
    switch ((grade || '').toUpperCase()) {
      case 'S':
      case 'A': return 'good';
      case 'B':
      case 'C': return 'average';
      case 'D':
      case 'E':
      case 'F': return 'bad';
      default: return 'terrible';
    }
  }

  function updateAffinityStyles() {
    const grades = ['good','average','bad','terrible'];
    Object.values(cfg).forEach(sel => {
      if (!sel) return;
      const bucket = getBucketForGrade(sel.value);
      grades.forEach(g => sel.classList.remove(`aff-grade-${g}`));
      sel.classList.add(`aff-grade-${bucket}`);
    });
  }

  function getBucketForSkill(checkType) {
    const ct = normalize(checkType);
    const map = {
      'turf': cfg.turf,
      'dirt': cfg.dirt,
      'sprint': cfg.sprint,
      'mile': cfg.mile,
      'medium': cfg.medium,
      'long': cfg.long,
      'front': cfg.front,
      'pace': cfg.pace,
      'late': cfg.late,
      'end': cfg.end,
    };
    const sel = map[ct];
    if (!sel) return 'base';
    return getBucketForGrade(sel.value);
  }

  function evaluateSkillScore(skill) {
    if (typeof skill.score === 'number') return skill.score;
    if (!skill.score || typeof skill.score !== 'object') return 0;
    const bucket = getBucketForSkill(skill.checkType);
    const val = skill.score[bucket];
    return typeof val === 'number' ? val : 0;
  }

  function clearResults() {
    if (resultsEl) resultsEl.hidden = true;
    if (bestScoreEl) bestScoreEl.textContent = '0';
    if (usedPointsEl) usedPointsEl.textContent = '0';
    if (totalPointsEl) totalPointsEl.textContent = String(parseInt(budgetInput.value || '0', 10) || 0);
    if (remainingPointsEl) remainingPointsEl.textContent = totalPointsEl.textContent;
    if (selectedListEl) selectedListEl.innerHTML = '';
  }

  // ---------- Live optimize helpers ----------
  function debounce(fn, ms) { let t; return function(...args){ clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); }; }

  function tryAutoOptimize() {
    const budget = parseInt(budgetInput.value, 10);
    if (isNaN(budget) || budget < 0) return;
    const { items, rowsMeta } = collectItems();
    if (!items.length) return;
    const groups = buildGroups(items, rowsMeta);
    const result = optimizeGrouped(groups, items, budget);
    renderResults(result, budget);
  }
  const autoOptimizeDebounced = debounce(tryAutoOptimize, 120);

  function applyFallbackSkills(reason) {
    skillsByCategory = {
      golden: [
        { name: 'Concentration', score: { base: 508, good: 508, average: 415, bad: 369, terrible: 323 }, checkType: 'End' },
        { name: 'Professor of Curvature', score: { base: 508, good: 508, average: 415, bad: 369, terrible: 323 }, checkType: 'Medium' }
      ],
      yellow: [
        { name: 'Groundwork', score: { base: 217, good: 217, average: 177, bad: 158, terrible: 138 }, checkType: 'Front' },
        { name: 'Corner Recovery', score: { base: 217, good: 217, average: 177, bad: 158, terrible: 138 }, checkType: 'Late' }
      ],
      blue: [ { name: 'Stealth Mode', score: { base: 195, good: 195, average: 159, bad: 142, terrible: 124 }, checkType: 'Late' } ]
    };
    categories = Object.keys(skillsByCategory);
    libStatus.textContent = `Using fallback skills (${reason})`;
  }

  async function loadSkillsLib() {
    const candidates = [ '../../libs/skills_lib.json', '../libs/skills_lib.json', './libs/skills_lib.json', '/libs/skills_lib.json' ];
    let lib = null; let lastErr = null;
    for (const url of candidates) {
      try { const res = await fetch(url, { cache: 'no-store' }); if (!res.ok) throw new Error(`HTTP ${res.status}`); lib = await res.json(); libStatus.textContent = `Loaded skills from ${url}`; break; } catch (e) { lastErr = e; }
    }
    if (!lib) { console.error('Failed to load skills_lib.json from all candidates', lastErr); applyFallbackSkills('not found / blocked'); return; }
    skillsByCategory = {}; categories = [];
    for (const [color, list] of Object.entries(lib)) {
      if (!Array.isArray(list)) continue;
      categories.push(color);
      skillsByCategory[color] = list.map(item => ({ name: item.name, score: item.score, checkType: item['check-type'] || '' }));
    }
    categories.sort((a, b) => { const ia = preferredOrder.indexOf(a), ib = preferredOrder.indexOf(b); if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib); return a.localeCompare(b); });
    const totalSkills = Object.values(skillsByCategory).reduce((acc, arr) => acc + arr.length, 0);
    if (categories.length === 0 || totalSkills === 0) applyFallbackSkills('empty library'); else libStatus.textContent += ` ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ ${totalSkills} skills in ${categories.length} categories`;
  }

  function parseCSV(text) {
    const rows = []; let i = 0, field = '', row = [], inQuotes = false;
    while (i < text.length) {
      const c = text[i];
      if (inQuotes) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; } } else { field += c; } }
      else { if (c === '"') inQuotes = true; else if (c === ',') { row.push(field); field = ''; } else if (c === '\r') { } else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else { field += c; } }
      i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function loadFromCSVContent(csvText) {
    const rows = parseCSV(csvText); if (!rows.length) return false;
    const header = rows[0].map(h => (h || '').toString().trim().toLowerCase());
    const idx = { type: header.indexOf('skill_type'), name: header.indexOf('name'), base: header.indexOf('base_value'), sa: header.indexOf('s_a'), bc: header.indexOf('b_c'), def: header.indexOf('d_e_f'), g: header.indexOf('g'), check: header.indexOf('affinity_role') };
    if (idx.name === -1) return false;
    const catMap = {};
    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r]; if (!cols || !cols.length) continue;
      const name = (cols[idx.name] || '').trim(); if (!name) continue;
      const type = idx.type !== -1 ? (cols[idx.type] || '').trim().toLowerCase() : 'misc';
      const base = idx.base !== -1 ? parseInt(cols[idx.base] || '', 10) : NaN;
      const sa = idx.sa !== -1 ? parseInt(cols[idx.sa] || '', 10) : NaN;
      const bc = idx.bc !== -1 ? parseInt(cols[idx.bc] || '', 10) : NaN;
      const def = idx.def !== -1 ? parseInt(cols[idx.def] || '', 10) : NaN;
      const g = idx.g !== -1 ? parseInt(cols[idx.g] || '', 10) : NaN;
      const checkType = idx.check !== -1 ? (cols[idx.check] || '').trim() : '';
      const score = {}; if (!isNaN(base)) score.base = base; if (!isNaN(sa)) score.good = sa; if (!isNaN(bc)) score.average = bc; if (!isNaN(def)) score.bad = def; if (!isNaN(g)) score.terrible = g;
      if (!catMap[type]) catMap[type] = []; catMap[type].push({ name, score, checkType });
    }
    skillsByCategory = catMap; categories = Object.keys(catMap).sort((a,b)=>{const ia=preferredOrder.indexOf(a), ib=preferredOrder.indexOf(b); if(ia!==-1||ib!==-1) return (ia===-1?999:ia) - (ib===-1?999:ib); return a.localeCompare(b)});
    const totalSkills = Object.values(skillsByCategory).reduce((acc, arr) => acc + arr.length, 0);
    refreshAllRows();
    return true;
  }

  async function loadSkillsCSV() {
    const candidates = [
      // new canonical location (moved into assets and renamed)
      '/assets/uma_skills.csv',
      './assets/uma_skills.csv',
    ];
    let lastErr = null;
    for (const url of candidates) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const ok = loadFromCSVContent(text);
        if (ok) {
          return true;
        }
      } catch (e) {
        lastErr = e;
      }
    }
    console.error('Failed to load CSV from known locations', lastErr);
    libStatus.textContent = 'Failed to load CSV (using fallback)';
    applyFallbackSkills('CSV not found / blocked');
    return false;
  }

  function buildCategoryOptions(selectEl) {
    selectEl.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '';
    selectEl.appendChild(blank);
    categories.forEach(cat => { const opt = document.createElement('option'); opt.value = cat; opt.textContent = cat; selectEl.appendChild(opt); });
  }

  function isGoldCategory(cat) {
    const v = (cat || '').toLowerCase();
    return v === 'golden' || v === 'gold' || v.includes('gold');
  }

  function pickLowerCategory() {
    const allowed = ['yellow','blue','red','green'];
    for (const a of allowed) { if (categories.includes(a)) return a; }
    const alt = categories.find(c => !isGoldCategory(c));
    return alt || '';
  }

  function buildLowerCategoryOptions(selectEl) {
    selectEl.innerHTML = '';
    const allowed = ['yellow','blue','red','green'];
    const present = allowed.filter(a => categories.includes(a));
    present.forEach(cat => { const opt = document.createElement('option'); opt.value = cat; opt.textContent = cat; selectEl.appendChild(opt); });
    if (!present.length) {
      const opt = document.createElement('option'); opt.value = ''; opt.textContent = ''; selectEl.appendChild(opt);
    }
  }

  function canonicalCategory(cat) {
    const v = (cat || '').toLowerCase();
    if (!v) return '';
    if (v === 'golden' || v === 'gold' || v.includes('gold')) return 'gold';
    if (v === 'ius' || v.includes('ius')) return 'ius';
    if (v === 'yellow' || v === 'blue' || v === 'green' || v === 'red') return v;
    return v;
  }

  function applyCategoryAccent(row, category) {
    const cls = ['cat-gold','cat-yellow','cat-blue','cat-green','cat-red','cat-ius','cat-orange'];
    row.classList.remove(...cls);
    const c = canonicalCategory(category);
    if (!c) return;
    if (c === 'gold') row.classList.add('cat-gold');
    else if (c === 'yellow') row.classList.add('cat-yellow');
    else if (c === 'blue') row.classList.add('cat-blue');
    else if (c === 'green') row.classList.add('cat-green');
    else if (c === 'red') row.classList.add('cat-red');
    else if (c === 'ius') row.classList.add('cat-ius');
  }

  function populateSkillDatalist(datalistEl, category) {
    datalistEl.innerHTML = '';
    const list = skillsByCategory[category] || [];
    list.forEach(item => { const opt = document.createElement('option'); opt.value = item.name; datalistEl.appendChild(opt); });
  }

  function refreshAllRows() {
    const dataRows = rowsEl.querySelectorAll('.optimizer-row');
    dataRows.forEach(row => {
      const catSel = row.querySelector('.category');
      const skillInput = row.querySelector('.skill-name');
      const skillList = row.querySelector('datalist[id^="skills-datalist-"]');
      if (!catSel || !skillInput || !skillList) return;
      const prevCat = catSel.value, prevSkill = skillInput.value;
      buildCategoryOptions(catSel);
      if (prevCat && (prevCat === '' || categories.includes(prevCat))) catSel.value = prevCat;
      populateSkillDatalist(skillList, catSel.value);
      if (prevSkill) skillInput.value = prevSkill; // do not auto-fill
    });
  }

  function isTopLevelRow(row) { return !row.dataset.parentGoldId; }
  function isRowFilled(row) {
    const cat = (row.querySelector('.category')?.value || '').trim();
    const name = (row.querySelector('.skill-name')?.value || '').trim();
    const costVal = row.querySelector('.cost')?.value;
    const cost = typeof costVal === 'string' && costVal.length ? parseInt(costVal, 10) : NaN;
    return !!cat && !!name && !isNaN(cost) && cost >= 0;
  }
  function ensureOneEmptyRow() {
    const rows = Array.from(rowsEl.querySelectorAll('.optimizer-row'))
      .filter(isTopLevelRow);
    if (!rows.length) { rowsEl.appendChild(makeRow()); return; }
    const last = rows[rows.length - 1];
    const lastFilled = isRowFilled(last);
    if (lastFilled) {
      rowsEl.appendChild(makeRow());
    } else {
      // Remove extra trailing empty top-level rows, keep exactly one empty
      for (let i = rows.length - 2; i >= 0; i--) {
        if (!isRowFilled(rows[i])) { rows[i].remove(); }
        else break;
      }
    }
  }

  function clearAllRows() {
    // remove all rows (both top-level and linked)
    Array.from(rowsEl.querySelectorAll('.optimizer-row')).forEach(n => n.remove());
    // add a fresh empty row and reset UI
    rowsEl.appendChild(makeRow());
    ensureOneEmptyRow();
    clearResults();
    saveState();
  }

  function makeRow() {
    const row = document.createElement('div'); row.className = 'optimizer-row';
    const id = Math.random().toString(36).slice(2);
    row.dataset.rowId = id;
    row.innerHTML = `
      <select class="category"></select>
      <div>
        <input type="text" class="skill-name" list="skills-datalist-${id}" placeholder="Start typing..." />
        <datalist id="skills-datalist-${id}"></datalist>
      </div>
      <input type="number" min="0" step="1" class="cost" placeholder="Cost" />
      <button type="button" class="btn remove">Remove</button>
    `;
    row.querySelector('.remove').addEventListener('click', () => {
      if (row.dataset.lowerRowId) {
        const linked = rowsEl.querySelector(`.optimizer-row[data-row-id="${row.dataset.lowerRowId}"]`);
        if (linked) linked.remove();
        delete row.dataset.lowerRowId;
      }
      row.remove();
      saveState();
      ensureOneEmptyRow();
      autoOptimizeDebounced();
    });
    const catSel = row.querySelector('.category');
    const skillInput = row.querySelector('.skill-name');
    const skillList = row.querySelector(`#skills-datalist-${id}`);
    buildCategoryOptions(catSel);
    populateSkillDatalist(skillList, catSel.value);

    function ensureLinkedLowerForGold() {
      const isGold = isGoldCategory(catSel.value);
      const currentLinkedId = row.dataset.lowerRowId;
      applyCategoryAccent(row, catSel.value);
      if (!isGold) {
        if (currentLinkedId) {
          const linked = rowsEl.querySelector(`.optimizer-row[data-row-id="${currentLinkedId}"]`);
          if (linked) linked.remove();
          delete row.dataset.lowerRowId; saveState();
        }
        return;
      }
      if (currentLinkedId) return; // already exists
      const linked = document.createElement('div'); linked.className = 'optimizer-row linked-lower';
      const lid = Math.random().toString(36).slice(2);
      linked.dataset.rowId = lid; linked.dataset.parentGoldId = id;
      const lowerCat = pickLowerCategory();
      linked.innerHTML = `
        <select class="category"></select>
        <div>
          <input type="text" class="skill-name" list="skills-datalist-${lid}" placeholder="Lower skill..." />
          <datalist id="skills-datalist-${lid}"></datalist>
        </div>
        <input type="number" min="0" step="1" class="cost" placeholder="Cost" />
        <button type="button" class="btn remove">Remove</button>
      `;
      const linkedRemove = linked.querySelector('.remove');
      if (linkedRemove) { linkedRemove.disabled = true; linkedRemove.title = 'Remove the gold row to unlink'; linkedRemove.style.pointerEvents = 'none'; linkedRemove.style.opacity = '0.4'; }
      const linkedSkillList = linked.querySelector(`#skills-datalist-${lid}`);
      const lowerSel = linked.querySelector('.category');
      buildLowerCategoryOptions(lowerSel);
      if (lowerCat) lowerSel.value = lowerCat;
      populateSkillDatalist(linkedSkillList, lowerSel.value);
      applyCategoryAccent(linked, lowerSel.value);
      lowerSel.addEventListener('change', () => { populateSkillDatalist(linkedSkillList, lowerSel.value); applyCategoryAccent(linked, lowerSel.value); saveState(); });
      linked.style.background = '#fafafa';
      rowsEl.insertBefore(linked, row.nextSibling);
      row.dataset.lowerRowId = lid;
      saveState();
      ensureOneEmptyRow();
      autoOptimizeDebounced();
    }

  catSel.addEventListener('change', () => {
    populateSkillDatalist(skillList, catSel.value);
    ensureLinkedLowerForGold();
    ensureOneEmptyRow();
    autoOptimizeDebounced();
  });
  // Ensure proper state if category preset programmatically
  ensureLinkedLowerForGold();
  return row;
}

  function collectItems() {
    const items = []; const rowsMeta = [];
    const rows = rowsEl.querySelectorAll('.optimizer-row');
    rows.forEach(row => {
      const catSel = row.querySelector('.category');
      const nameInput = row.querySelector('.skill-name');
      const costEl = row.querySelector('.cost');
      if (!catSel || !nameInput || !costEl) return; // header row
      const category = catSel.value;
      const name = (nameInput.value || '').trim();
      const cost = parseInt(costEl.value, 10);
      if (!name || isNaN(cost)) return;
      const list = skillsByCategory[category] || [];
      const skill = list.find(s => s.name === name);
      if (!skill) return;
      const score = evaluateSkillScore(skill);
      const rowId = row.dataset.rowId || Math.random().toString(36).slice(2);
      const parentGoldId = row.dataset.parentGoldId || '';
      const lowerRowId = row.dataset.lowerRowId || '';
      items.push({ id: rowId, name: skill.name, cost, score, category, parentGoldId, lowerRowId });
      rowsMeta.push({ id: rowId, category, parentGoldId, lowerRowId });
    });
    return { items, rowsMeta };
  }

  function buildGroups(items, rowsMeta) {
    const idToIndex = new Map(items.map((it, i) => [it.id, i]));
    const used = new Array(items.length).fill(false);
    const groups = [];
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue;
      const it = items[i];
      const isGold = isGoldCategory(it.category);
      if (isGold && it.lowerRowId && idToIndex.has(it.lowerRowId)) {
        const j = idToIndex.get(it.lowerRowId);
        if (!used[j]) {
          groups.push([ { none: true }, { pick: i, cost: it.cost, score: it.score }, { pick: j, cost: items[j].cost, score: items[j].score } ]);
          used[i] = used[j] = true;
          continue;
        }
      }
      // If this is a lower-linked row, and its parent gold appears later, it will be grouped there.
      groups.push([ { none: true }, { pick: i, cost: it.cost, score: it.score } ]);
      used[i] = true;
    }
    return groups;
  }

  function optimizeGrouped(groups, items, budget) {
    const B = Math.max(0, Math.floor(budget));
    const G = groups.length;
    const dp = Array.from({ length: G + 1 }, () => new Array(B + 1).fill(0));
    const choice = Array.from({ length: G + 1 }, () => new Array(B + 1).fill(-1));
    for (let g = 1; g <= G; g++) {
      const opts = groups[g - 1];
      for (let b = 0; b <= B; b++) {
        dp[g][b] = dp[g - 1][b]; choice[g][b] = -1;
        for (let k = 0; k < opts.length; k++) {
          const o = opts[k]; if (o.none) continue;
          const w = Math.max(0, Math.floor(o.cost)); const v = Math.max(0, Math.floor(o.score));
          if (w <= b) { const cand = dp[g - 1][b - w] + v; if (cand > dp[g][b]) { dp[g][b] = cand; choice[g][b] = k; } }
        }
      }
    }
    // reconstruct
    let b = B; const chosen = [];
    for (let g = G; g >= 1; g--) { const k = choice[g][b]; if (k > 0) { const o = groups[g - 1][k]; chosen.push(items[o.pick]); b -= Math.max(0, Math.floor(o.cost)); } }
    chosen.reverse();
    const used = chosen.reduce((sum, it) => sum + Math.max(0, Math.floor(it.cost)), 0);
    return { best: dp[G][B], chosen, used };
  }

  function renderResults(result, budget) {
    resultsEl.hidden = false;
    bestScoreEl.textContent = String(result.best);
    usedPointsEl.textContent = String(result.used);
    totalPointsEl.textContent = String(budget);
    remainingPointsEl.textContent = String(Math.max(0, budget - result.used));
    selectedListEl.innerHTML = '';
    result.chosen.forEach(it => {
      const li = document.createElement('li');
      li.className = 'result-item';
      const cat = it.category || 'unknown';
      const canon = (function(v){ v=(v||'').toLowerCase(); if(v.includes('gold')) return 'gold'; if(v==='ius'||v.includes('ius')) return 'ius'; return v; })(cat);
      if (canon) li.classList.add(`cat-${canon}`);
      li.innerHTML = `<span class="res-name">${it.name}</span> <span class="res-meta">- cost ${it.cost}, score ${it.score}</span>`;
      selectedListEl.appendChild(li);
    });
  }

  // persistence
  function saveState() {
    const state = { budget: parseInt(budgetInput.value, 10) || 0, cfg: {}, rows: [] };
    Object.entries(cfg).forEach(([k, el]) => { state.cfg[k] = el ? el.value : 'A'; });
    const rows = rowsEl.querySelectorAll('.optimizer-row');
    rows.forEach(row => {
      const catSel = row.querySelector('.category');
      const nameInput = row.querySelector('.skill-name');
      const costEl = row.querySelector('.cost');
      if (!catSel || !nameInput || !costEl) return;
      state.rows.push({ id: row.dataset.rowId || '', category: catSel.value || '', name: nameInput.value || '', cost: parseInt(costEl.value, 10) || 0, parentGoldId: row.dataset.parentGoldId || '', lowerRowId: row.dataset.lowerRowId || '' });
    });
    try { localStorage.setItem('optimizerState', JSON.stringify(state)); } catch {}
  }

  function loadState() {
  try {
    const raw = localStorage.getItem('optimizerState'); if (!raw) return false;
    const state = JSON.parse(raw); if (!state || !Array.isArray(state.rows)) return false;
    budgetInput.value = state.budget || 0;
    Object.entries(state.cfg || {}).forEach(([k, v]) => { if (cfg[k]) cfg[k].value = v; });
    // clear existing rows (keep header)
    Array.from(rowsEl.querySelectorAll('.optimizer-row')).slice(1).forEach(n => n.remove());
    const created = new Map();
    // First pass: create all rows
    state.rows.forEach(r => {
      const row = makeRow(); rowsEl.appendChild(row);
      if (r.id) row.dataset.rowId = r.id;
      const catSel = row.querySelector('.category');
      catSel.value = r.category || catSel.value;
      const skillInput = row.querySelector('.skill-name');
      const skillList = row.querySelector('datalist[id^="skills-datalist-"]');
      populateSkillDatalist(skillList, catSel.value);
      skillInput.value = r.name || '';
      row.querySelector('.cost').value = r.cost || 0;
      applyCategoryAccent(row, catSel.value);
      if (r.parentGoldId) {
        row.dataset.parentGoldId = r.parentGoldId;
        // style as linked lower
        row.classList.add('linked-lower');
        const linkedCat = row.querySelector('.category');
        linkedCat.value = r.category || linkedCat.value; const sl2 = row.querySelector('datalist[id^="skills-datalist-"]'); populateSkillDatalist(sl2, linkedCat.value);
        applyCategoryAccent(row, linkedCat.value);
      }
      created.set(row.dataset.rowId, row);
    });
    // Second pass: attach lower linkage on parent rows
    state.rows.forEach(r => {
      if (r.parentGoldId && created.has(r.parentGoldId)) {
        const parent = created.get(r.parentGoldId);
        parent.dataset.lowerRowId = r.id || '';
        // ensure linked row is just below parent
        const child = created.get(r.id);
        if (child && child.previousSibling !== parent) {
          rowsEl.removeChild(child);
          rowsEl.insertBefore(child, parent.nextSibling);
        }
      }
    });
    // persist any normalized changes (e.g., after library categories load)
    saveState();
    return true;
  } catch { return false; }
}

  // events
  if (addRowBtn) addRowBtn.addEventListener('click', () => { rowsEl.appendChild(makeRow()); saveState(); });

  if (optimizeBtn) optimizeBtn.addEventListener('click', () => {
    const budget = parseInt(budgetInput.value, 10); if (isNaN(budget) || budget < 0) { alert('Please enter a valid skill points budget.'); return; }
    const { items, rowsMeta } = collectItems(); if (!items.length) { alert('Add at least one skill with a valid cost.'); return; }
    const groups = buildGroups(items, rowsMeta);
    const result = optimizeGrouped(groups, items, budget);
    renderResults(result, budget); saveState();
  });
  if (clearAllBtn) clearAllBtn.addEventListener('click', () => { clearAllRows(); });

  // CSV loader
  const csvFileInput = document.getElementById('csv-file');
  const loadCsvBtn = document.getElementById('load-csv');
  if (loadCsvBtn && csvFileInput) {
    loadCsvBtn.addEventListener('click', () => csvFileInput.click());
    csvFileInput.addEventListener('change', () => { const file = csvFileInput.files && csvFileInput.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { const ok = loadFromCSVContent(reader.result || ''); if (!ok) alert('CSV not recognized. Expected headers: skill_type,name,base_value,S_A,B_C,D_E_F,G,affinity_role'); saveState(); }; reader.readAsText(file); });
  }

  // Init: prefer CSV by default
  loadSkillsCSV().then(() => {
    const had = loadState();
    if (!had) {
      rowsEl.appendChild(makeRow());
    }
    updateAffinityStyles();
    ensureOneEmptyRow();
    autoOptimizeDebounced();
  });
  const persistIfRelevant = (e) => {
    const t = e.target; if (!t) return;
    if (t.closest('.race-config-container')) updateAffinityStyles();
    if (t.closest('.optimizer-row') || t.id === 'budget' || t.closest('.race-config-container')) {
      saveState();
      ensureOneEmptyRow();
      autoOptimizeDebounced();
    }
  };
  document.addEventListener('change', persistIfRelevant);
  document.addEventListener('input', persistIfRelevant);
  document.addEventListener('input', persistIfRelevant);
})();

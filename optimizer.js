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
  const autoBuildBtn = document.getElementById('auto-build-btn');
  const autoTargetInputs = document.querySelectorAll('input[name="auto-target"]');
  const autoBuilderStatus = document.getElementById('auto-builder-status');
  const copyBuildBtn = document.getElementById('copy-build');
  const loadBuildBtn = document.getElementById('load-build');

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
  let skillIndex = new Map();   // normalized name -> { name, score, checkType, category }
  let allSkillNames = [];

  function normalize(str) { return (str || '').toString().trim().toLowerCase(); }

  async function tryWriteClipboard(text) {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    return false;
  }

  async function copyViaFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('execCommand copy failed');
  }

  async function tryReadClipboard() {
    if (navigator?.clipboard?.readText) {
      return await navigator.clipboard.readText();
    }
    return '';
  }

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

  function setAutoStatus(message, isError = false) {
    if (!autoBuilderStatus) return;
    autoBuilderStatus.textContent = message || '';
    autoBuilderStatus.dataset.state = isError ? 'error' : 'info';
  }

  function getSelectedAutoTargets() {
    if (!autoTargetInputs || !autoTargetInputs.length) return [];
    return Array.from(autoTargetInputs)
      .filter(input => input.checked)
      .map(input => normalize(input.value))
      .filter(Boolean);
  }

  function setAutoTargetSelections(list) {
    if (!autoTargetInputs || !autoTargetInputs.length) return;
    const normalized = Array.isArray(list) ? new Set(list.map(v => normalize(v))) : null;
    autoTargetInputs.forEach(input => {
      if (!normalized || !normalized.size) {
        input.checked = true;
      } else {
        input.checked = normalized.has(normalize(input.value));
      }
    });
  }

  let autoHighlightTimer = null;

  function matchesAutoTargets(item, targetSet, includeGeneral) {
    const check = normalize(item.checkType);
    if (!check) return includeGeneral;
    if (!targetSet.has(check)) return false;
    return getBucketForSkill(item.checkType) === 'good';
  }

  function replaceRowsWithItems(items) {
    if (!rowsEl) return;
    clearAutoHighlights();
    Array.from(rowsEl.querySelectorAll('.optimizer-row')).forEach(n => n.remove());
    items.forEach(it => {
      const row = makeRow();
      rowsEl.appendChild(row);
      const nameInput = row.querySelector('.skill-name');
      if (nameInput) nameInput.value = it.name;
      const costInput = row.querySelector('.cost');
      if (costInput) costInput.value = it.cost;
      row.dataset.skillCategory = it.category || '';
      if (typeof row.syncSkillCategory === 'function') {
        row.syncSkillCategory({ triggerOptimize: false, allowLinking: false });
      } else {
        applyCategoryAccent(row, it.category || '');
      }
    });
    ensureOneEmptyRow();
    saveState();
    autoOptimizeDebounced();
  }

  function clearAutoHighlights() {
    if (autoHighlightTimer) {
      clearTimeout(autoHighlightTimer);
      autoHighlightTimer = null;
    }
    if (!rowsEl) return;
    Array.from(rowsEl.querySelectorAll('.optimizer-row')).forEach(row => {
      row.classList.remove('auto-picked');
      row.classList.remove('auto-excluded');
    });
  }

  function applyAutoHighlights(selectedIds = [], candidateIds = []) {
    clearTimeout(autoHighlightTimer);
    const selected = new Set(selectedIds);
    const candidates = new Set(candidateIds);
    Array.from(rowsEl.querySelectorAll('.optimizer-row')).forEach(row => {
      const id = row.dataset.rowId;
      if (!id) return;
      row.classList.remove('auto-picked', 'auto-excluded');
      if (!candidates.size || !candidates.has(id)) return;
      if (selected.has(id)) row.classList.add('auto-picked');
      else row.classList.add('auto-excluded');
    });
    autoHighlightTimer = setTimeout(() => clearAutoHighlights(), 4000);
  }

  function serializeRows() {
    const rows = [];
    rowsEl.querySelectorAll('.optimizer-row').forEach(row => {
      const name = row.querySelector('.skill-name')?.value?.trim();
      const costVal = row.querySelector('.cost')?.value;
      const cost = typeof costVal === 'string' && costVal.length ? parseInt(costVal, 10) : NaN;
      if (!name || isNaN(cost)) return;
      rows.push(`${name}=${cost}`);
    });
    return rows.join('\n');
  }

  function loadRowsFromString(str) {
    const normalized = (str || '').replace(/\r\n?/g, '\n');
    const entries = normalized.split(/\n+/).map(line => line.trim()).filter(Boolean);
    if (!entries.length) throw new Error('No rows detected.');
    Array.from(rowsEl.querySelectorAll('.optimizer-row')).forEach(n => n.remove());
    clearAutoHighlights();
    entries.forEach(entry => {
      const [nameRaw, costRaw] = entry.split('=');
      const name = (nameRaw || '').trim();
      const cost = parseInt((costRaw || '').trim(), 10);
      if (!name || isNaN(cost)) return;
      const row = makeRow();
      rowsEl.appendChild(row);
      const nameInput = row.querySelector('.skill-name');
      const costInput = row.querySelector('.cost');
      if (nameInput) nameInput.value = name;
      if (costInput) costInput.value = cost;
      if (typeof row.syncSkillCategory === 'function') {
        row.syncSkillCategory({ triggerOptimize: false, allowLinking: false });
      } else {
        applyCategoryAccent(row, row.dataset.skillCategory || '');
      }
    });
    ensureOneEmptyRow();
    saveState();
    autoOptimizeDebounced();
  }

  function autoBuildIdealSkills() {
    if (!categories.length || !Object.keys(skillsByCategory).length) {
      setAutoStatus('Skill library is still loading. Please try again once it finishes.', true);
      return;
    }
    const targets = getSelectedAutoTargets();
    if (!targets.length) {
      setAutoStatus('Select at least one target aptitude before generating a build.', true);
      return;
    }
    const budget = parseInt(budgetInput.value, 10);
    if (isNaN(budget) || budget <= 0) {
      setAutoStatus('Enter a valid positive skill points budget first.', true);
      budgetInput && budgetInput.focus();
      return;
    }
    const { items, rowsMeta } = collectItems();
    if (!items.length) {
      setAutoStatus('Add at least one recognized skill with a cost before generating a build.', true);
      return;
    }
    const includeGeneral = targets.includes('general');
    const targetSet = new Set(targets.filter(t => t !== 'general'));
    const candidates = items.filter(it => matchesAutoTargets(it, targetSet, includeGeneral));
    if (!candidates.length) {
      setAutoStatus('No existing rows match the selected targets with S-A affinity.', true);
      return;
    }
    const groups = buildGroups(candidates, rowsMeta);
    const result = optimizeGrouped(groups, candidates, budget);
    if (!result.chosen.length) {
      setAutoStatus('Budget too low to purchase any of the matching skills you entered.', true);
      return;
    }
    applyAutoHighlights(result.chosen.map(it => it.id), candidates.map(it => it.id));
    renderResults(result, budget);
    setAutoStatus(`Highlighted ${result.chosen.length}/${candidates.length} matching skills (cost ${result.used}/${budget}).`);
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

  function rebuildSkillCaches() {
    const nextIndex = new Map();
    const names = [];
    Object.entries(skillsByCategory).forEach(([category, list = []]) => {
      list.forEach(skill => {
        if (!skill || !skill.name) return;
        const key = normalize(skill.name);
        if (!nextIndex.has(key)) {
          names.push(skill.name);
        }
        nextIndex.set(key, { ...skill, category });
      });
    });
    skillIndex = nextIndex;
    const uniqueNames = Array.from(new Set(names));
    uniqueNames.sort((a, b) => a.localeCompare(b));
    allSkillNames = uniqueNames;
    refreshAllRows();
  }

  function findSkillByName(name) {
    const key = normalize(name);
    return skillIndex.get(key) || null;
  }

  function formatCategoryLabel(cat) {
    if (!cat) return 'Auto';
    const canon = canonicalCategory(cat);
    if (canon === 'gold') return 'Gold';
    if (canon === 'ius') return 'Unique';
    return cat.charAt(0).toUpperCase() + cat.slice(1);
  }

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
    rebuildSkillCaches();
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
    rebuildSkillCaches();
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
    rebuildSkillCaches();
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

  function isGoldCategory(cat) {
    const v = (cat || '').toLowerCase();
    return v === 'golden' || v === 'gold' || v.includes('gold');
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

  function populateSkillDatalist(datalistEl) {
    datalistEl.innerHTML = '';
    allSkillNames.forEach(name => { const opt = document.createElement('option'); opt.value = name; datalistEl.appendChild(opt); });
  }

  function refreshAllRows() {
    const dataRows = rowsEl.querySelectorAll('.optimizer-row');
    dataRows.forEach(row => {
      const skillList = row.querySelector('datalist[id^="skills-datalist-"]');
      if (skillList) populateSkillDatalist(skillList);
      if (typeof row.syncSkillCategory === 'function') {
        row.syncSkillCategory({ triggerOptimize: false, allowLinking: false });
      }
    });
  }

  function isTopLevelRow(row) { return !row.dataset.parentGoldId; }
  function isRowFilled(row) {
    const name = (row.querySelector('.skill-name')?.value || '').trim();
    const costVal = row.querySelector('.cost')?.value;
    const cost = typeof costVal === 'string' && costVal.length ? parseInt(costVal, 10) : NaN;
    const skillKnown = !!findSkillByName(name);
    return skillKnown && !isNaN(cost) && cost >= 0;
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
      <div class="type-cell">
        <label>Type</label>
        <div class="category-chip" data-empty="true">Auto</div>
      </div>
      <div>
        <label>Skill</label>
        <input type="text" class="skill-name" list="skills-datalist-${id}" placeholder="Start typing..." />
        <datalist id="skills-datalist-${id}"></datalist>
      </div>
      <div>
        <label>Cost</label>
        <input type="number" min="0" step="1" class="cost" placeholder="Cost" />
      </div>
      <div class="remove-cell">
        <label class="remove-label">&nbsp;</label>
        <button type="button" class="btn remove">Remove</button>
      </div>
    `;
    const removeBtn = row.querySelector('.remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
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
    }
    const skillInput = row.querySelector('.skill-name');
    const skillList = row.querySelector(`#skills-datalist-${id}`);
    const categoryChip = row.querySelector('.category-chip');
    if (skillList) populateSkillDatalist(skillList);

    function setCategoryDisplay(category) {
      row.dataset.skillCategory = category || '';
      if (categoryChip) {
        if (category) {
          categoryChip.textContent = formatCategoryLabel(category);
          categoryChip.dataset.empty = 'false';
        } else {
          categoryChip.textContent = 'Auto';
          categoryChip.dataset.empty = 'true';
        }
      }
      applyCategoryAccent(row, category);
    }

    function ensureLinkedLowerForGold(category, { allowCreate = true } = {}) {
      if (row.dataset.parentGoldId) return;
      const isGold = isGoldCategory(category);
      const currentLinkedId = row.dataset.lowerRowId;
      if (!isGold) {
        if (currentLinkedId) {
          const linked = rowsEl.querySelector(`.optimizer-row[data-row-id="${currentLinkedId}"]`);
          if (linked) linked.remove();
          delete row.dataset.lowerRowId;
          saveState();
          ensureOneEmptyRow();
          autoOptimizeDebounced();
        }
        return;
      }
      if (!allowCreate || currentLinkedId) return;
      const linked = makeRow();
      linked.classList.add('linked-lower');
      linked.dataset.parentGoldId = id;
      const lid = linked.dataset.rowId;
      const linkedInput = linked.querySelector('.skill-name');
      if (linkedInput) linkedInput.placeholder = 'Lower skill...';
      const linkedRemove = linked.querySelector('.remove');
      if (linkedRemove) {
        linkedRemove.disabled = true;
        linkedRemove.title = 'Remove the gold row to unlink';
        linkedRemove.style.pointerEvents = 'none';
        linkedRemove.style.opacity = '0.4';
      }
      rowsEl.insertBefore(linked, row.nextSibling);
      row.dataset.lowerRowId = lid;
      if (typeof linked.syncSkillCategory === 'function') {
        linked.syncSkillCategory({ triggerOptimize: false, allowLinking: false });
      }
      saveState();
      ensureOneEmptyRow();
      autoOptimizeDebounced();
    }

    function syncSkillCategory({ triggerOptimize = false, allowLinking = true } = {}) {
      if (!skillInput) return;
      const skill = findSkillByName(skillInput.value);
      const category = skill ? skill.category : '';
      setCategoryDisplay(category);
      ensureLinkedLowerForGold(category, { allowCreate: allowLinking });
      if (triggerOptimize) {
        saveState();
        ensureOneEmptyRow();
        autoOptimizeDebounced();
      }
    }

    row.syncSkillCategory = syncSkillCategory;
    setCategoryDisplay(row.dataset.skillCategory || '');
    if (skillInput) {
      skillInput.addEventListener('input', () => syncSkillCategory({ triggerOptimize: true }));
      skillInput.addEventListener('change', () => syncSkillCategory({ triggerOptimize: true }));
    }
    return row;
  }

  function collectItems() {
    const items = []; const rowsMeta = [];
    const rows = rowsEl.querySelectorAll('.optimizer-row');
    rows.forEach(row => {
      const nameInput = row.querySelector('.skill-name');
      const costEl = row.querySelector('.cost');
      if (!nameInput || !costEl) return;
      const name = (nameInput.value || '').trim();
      const cost = parseInt(costEl.value, 10);
      if (!name || isNaN(cost)) return;
      const skill = findSkillByName(name);
      if (!skill) return;
      const category = skill.category || '';
      const score = evaluateSkillScore(skill);
      const rowId = row.dataset.rowId || Math.random().toString(36).slice(2);
      const parentGoldId = row.dataset.parentGoldId || '';
      const lowerRowId = row.dataset.lowerRowId || '';
      items.push({ id: rowId, name: skill.name, cost, score, category, parentGoldId, lowerRowId, checkType: skill.checkType || '' });
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
    const state = { budget: parseInt(budgetInput.value, 10) || 0, cfg: {}, rows: [], autoTargets: [] };
    Object.entries(cfg).forEach(([k, el]) => { state.cfg[k] = el ? el.value : 'A'; });
    if (autoTargetInputs && autoTargetInputs.length) {
      state.autoTargets = Array.from(autoTargetInputs)
        .filter(input => input.checked)
        .map(input => input.value);
    }
    const rows = rowsEl.querySelectorAll('.optimizer-row');
    rows.forEach(row => {
      const nameInput = row.querySelector('.skill-name');
      const costEl = row.querySelector('.cost');
      if (!nameInput || !costEl) return;
      state.rows.push({
        id: row.dataset.rowId || '',
        category: row.dataset.skillCategory || '',
        name: nameInput.value || '',
        cost: parseInt(costEl.value, 10) || 0,
        parentGoldId: row.dataset.parentGoldId || '',
        lowerRowId: row.dataset.lowerRowId || ''
      });
    });
    try { localStorage.setItem('optimizerState', JSON.stringify(state)); } catch {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem('optimizerState'); if (!raw) return false;
      const state = JSON.parse(raw); if (!state || !Array.isArray(state.rows)) return false;
      budgetInput.value = state.budget || 0;
      Object.entries(state.cfg || {}).forEach(([k, v]) => { if (cfg[k]) cfg[k].value = v; });
      if (Array.isArray(state.autoTargets) && state.autoTargets.length) {
        setAutoTargetSelections(state.autoTargets);
      } else {
        setAutoTargetSelections(null);
      }
      Array.from(rowsEl.querySelectorAll('.optimizer-row')).forEach(n => n.remove());
      const created = new Map();
      let createdAny = false;
      state.rows.forEach(r => {
        const row = makeRow(); rowsEl.appendChild(row);
        createdAny = true;
        if (r.id) row.dataset.rowId = r.id;
        if (r.parentGoldId) {
          row.dataset.parentGoldId = r.parentGoldId;
          row.classList.add('linked-lower');
          const linkedInput = row.querySelector('.skill-name');
          if (linkedInput) linkedInput.placeholder = 'Lower skill...';
        }
        const skillInput = row.querySelector('.skill-name');
        if (skillInput) skillInput.value = r.name || '';
        const costEl = row.querySelector('.cost');
        if (costEl) costEl.value = typeof r.cost === 'number' && !isNaN(r.cost) ? r.cost : 0;
        if (r.category) row.dataset.skillCategory = r.category;
        if (typeof row.syncSkillCategory === 'function') {
          row.syncSkillCategory({ triggerOptimize: false, allowLinking: false });
        } else {
          applyCategoryAccent(row, r.category || '');
        }
        created.set(row.dataset.rowId, row);
      });
      state.rows.forEach(r => {
        if (r.parentGoldId && created.has(r.parentGoldId)) {
          const parent = created.get(r.parentGoldId);
          parent.dataset.lowerRowId = r.id || '';
          const child = created.get(r.id);
          if (child && child.previousSibling !== parent) {
            rowsEl.removeChild(child);
            rowsEl.insertBefore(child, parent.nextSibling);
          }
        }
      });
      if (!createdAny) return false;
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
  if (copyBuildBtn) {
    copyBuildBtn.addEventListener('click', async () => {
      const data = serializeRows();
      if (!data) { setAutoStatus('No rows to copy.', true); return; }
      try {
        let copied = false;
        try {
          copied = await tryWriteClipboard(data);
        } catch (err) {
          console.warn('Clipboard API write failed', err);
        }
        if (!copied) {
          await copyViaFallback(data);
        }
        setAutoStatus('Build copied to clipboard.');
      } catch (err) {
        console.error('Copy failed', err);
        alert('Unable to copy build automatically. Select rows manually and copy them.');
      }
    });
  }
  if (loadBuildBtn) {
    loadBuildBtn.addEventListener('click', async () => {
      let payload = '';
      try {
        payload = await tryReadClipboard();
      } catch (err) {
        console.warn('Clipboard read failed', err);
      }
      if (!payload || !payload.trim()) {
        const manual = window.prompt('Paste build string (Skill=Cost per line):', '');
        if (!manual) return;
        payload = manual;
      }
      try {
        loadRowsFromString(payload);
        setAutoStatus('Build loaded from clipboard.');
      } catch (err) {
        console.error('Failed to load build', err);
        alert('Could not parse build string. Use lines like "Skill Name=120".');
      }
    });
  }
  if (autoBuildBtn) autoBuildBtn.addEventListener('click', autoBuildIdealSkills);

  // CSV loader
  const csvFileInput = document.getElementById('csv-file');
  const loadCsvBtn = document.getElementById('load-csv');
  if (loadCsvBtn && csvFileInput) {
    loadCsvBtn.addEventListener('click', () => csvFileInput.click());
    csvFileInput.addEventListener('change', () => { const file = csvFileInput.files && csvFileInput.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { const ok = loadFromCSVContent(reader.result || ''); if (!ok) alert('CSV not recognized. Expected headers: skill_type,name,base_value,S_A,B_C,D_E_F,G,affinity_role'); saveState(); }; reader.readAsText(file); });
  }

  function finishInit() {
    const had = loadState();
    if (!had) {
      rowsEl.appendChild(makeRow());
    }
    updateAffinityStyles();
    ensureOneEmptyRow();
    autoOptimizeDebounced();
  }

  // Init: prefer CSV by default
  loadSkillsCSV()
    .then(finishInit)
    .catch(err => {
      console.error('Initialization failed', err);
      finishInit();
    });
  const persistIfRelevant = (e) => {
    const t = e.target; if (!t) return;
    if (t.closest('.race-config-container')) updateAffinityStyles();
    if (t.closest('.auto-targets')) {
      saveState();
      clearAutoHighlights();
      autoOptimizeDebounced();
      return;
    }
    if (t.closest('.optimizer-row') || t.id === 'budget' || t.closest('.race-config-container')) {
      saveState();
      ensureOneEmptyRow();
      clearAutoHighlights();
      autoOptimizeDebounced();
    }
  };
  document.addEventListener('change', persistIfRelevant);
  document.addEventListener('input', persistIfRelevant);
  document.addEventListener('input', persistIfRelevant);
})();

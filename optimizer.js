// Skill Optimizer Page Script
// Loads skills from JSON or CSV, lets you select purchasable skills with costs,
// and maximizes total score under a budget with goldÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢lower mutual-exclusion.

(function () {
  const rowsEl = document.getElementById('rows');
  const addRowBtn = document.getElementById('add-row');
  const optimizeBtn = document.getElementById('optimize');
  const clearAllBtn = document.getElementById('clear-all');
  const budgetInput = document.getElementById('budget');
  const fastLearnerToggle = document.getElementById('fast-learner');
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

  const ratingInputs = {
    speed: document.getElementById('stat-speed'),
    stamina: document.getElementById('stat-stamina'),
    power: document.getElementById('stat-power'),
    guts: document.getElementById('stat-guts'),
    wisdom: document.getElementById('stat-wisdom'),
    star: document.getElementById('star-level'),
    unique: document.getElementById('unique-level')
  };
  const ratingDisplays = {
    stats: document.getElementById('rating-stats-score'),
    skills: document.getElementById('rating-skills-score'),
    unique: document.getElementById('rating-unique-bonus'),
    total: document.getElementById('rating-total'),
    badgeSprite: document.getElementById('rating-badge-sprite'),
    floatTotal: document.getElementById('rating-float-total'),
    floatBadgeSprite: document.getElementById('rating-float-badge-sprite'),
    nextLabel: document.getElementById('rating-next-label'),
    nextNeeded: document.getElementById('rating-next-needed'),
    progressFill: document.getElementById('rating-progress-fill'),
    progressBar: document.querySelector('.rating-progress-bar')
  };
  const MAX_STAT_VALUE = 2000;
  const STAT_BLOCK_SIZE = 50;
  const STAT_MULTIPLIERS = [
    0.5, 0.8, 1, 1.3, 1.6, 1.8, 2.1, 2.4, 2.6, 2.8, 2.9, 3, 3.1, 3.3, 3.4,
    3.5, 3.9, 4.1, 4.2, 4.3, 5.2, 5.5, 6.6, 6.8, 6.9
  ];
  let lastSkillScore = 0;

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
  let skillIdIndex = new Map(); // id string -> skill object
  let allSkillNames = [];
  const HINT_DISCOUNT_STEP = 0.10;
  const HINT_DISCOUNTS = { 0: 0.0, 1: 0.10, 2: 0.20, 3: 0.30, 4: 0.35, 5: 0.40 };
  const HINT_LEVELS = [0, 1, 2, 3, 4, 5];

  function getFastLearnerDiscount() {
    return fastLearnerToggle && fastLearnerToggle.checked ? 0.10 : 0;
  }

  function getHintDiscountPct(lvl) {
    const discount = Object.prototype.hasOwnProperty.call(HINT_DISCOUNTS, lvl)
      ? HINT_DISCOUNTS[lvl]
      : (HINT_DISCOUNT_STEP * lvl);
    return Math.round(discount * 100);
  }

  function getTotalHintDiscountPct(lvl) {
    const base = Object.prototype.hasOwnProperty.call(HINT_DISCOUNTS, lvl)
      ? HINT_DISCOUNTS[lvl]
      : (HINT_DISCOUNT_STEP * lvl);
    return Math.round((base + getFastLearnerDiscount()) * 100);
  }
  const skillCostMapNormalized = new Map(); // punctuation-stripped key -> meta
  const skillCostMapExact = new Map(); // exact lowercased name -> meta
  const skillCostById = new Map(); // skillId -> base cost
  const skillMetaById = new Map(); // skillId -> { cost, versions, parents }

  function normalize(str) { return (str || '').toString().trim().toLowerCase(); }
  function normalizeCostKey(str) {
    return normalize(str).replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  }

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

  function calculateDiscountedCost(baseCost, hintLevel) {
    if (typeof baseCost !== 'number' || isNaN(baseCost)) return NaN;
    const lvl = Math.max(0, Math.min(5, parseInt(hintLevel, 10) || 0));
    const discount = Object.prototype.hasOwnProperty.call(HINT_DISCOUNTS, lvl)
      ? HINT_DISCOUNTS[lvl]
      : (HINT_DISCOUNT_STEP * lvl);
    const multiplier = Math.max(0, 1 - discount - getFastLearnerDiscount());
    const rawCost = baseCost * multiplier;
    const frac = rawCost - Math.floor(rawCost);
    const epsilon = 1e-9;
    const rounded = Math.abs(frac - 0.5) < epsilon ? Math.floor(rawCost) : Math.ceil(rawCost);
    return Math.max(0, rounded);
  }

  function updateHintOptionLabels() {
    const selects = rowsEl ? rowsEl.querySelectorAll('.hint-level') : [];
    selects.forEach(select => {
      Array.from(select.options).forEach(opt => {
        const lvl = parseInt(opt.value, 10);
        if (isNaN(lvl)) return;
        opt.textContent = `Lv${lvl} (${getTotalHintDiscountPct(lvl)}% off)`;
      });
    });
  }

  function refreshAllRowCosts() {
    const dataRows = rowsEl ? rowsEl.querySelectorAll('.optimizer-row') : [];
    dataRows.forEach(row => {
      if (typeof row.syncSkillCategory === 'function') {
        row.syncSkillCategory({ triggerOptimize: false, allowLinking: false, updateCost: true });
      }
    });
  }

  async function loadSkillCostsJSON() {
    const candidates = ['/assets/skills_all.json', './assets/skills_all.json'];
    for (const url of candidates) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const list = await res.json();
        if (!Array.isArray(list) || !list.length) continue;
        list.forEach(entry => {
          const name = entry?.name_en || entry?.enname;
          if (!name) return;
          const exactKey = normalize(name);
          const key = normalizeCostKey(name);
          const cost = (() => {
            if (entry?.gene_version && typeof entry.gene_version.cost === 'number') return entry.gene_version.cost;
            if (typeof entry?.cost === 'number') return entry.cost;
            return null;
          })();
          const parents = Array.isArray(entry?.parent_skills) ? entry.parent_skills : [];
          const versions = Array.isArray(entry?.versions) ? entry.versions : [];
          const id = entry?.id;
          if (cost !== null) {
            const meta = { cost, id, parents, versions };
            if (id !== undefined && id !== null) {
              const sid = String(id);
              if (!skillCostById.has(sid)) skillCostById.set(sid, cost);
              if (!skillMetaById.has(sid)) skillMetaById.set(sid, { cost, parents, versions });
            }
            if (!skillCostMapExact.has(exactKey)) skillCostMapExact.set(exactKey, meta);
            if (!skillCostMapNormalized.has(key)) skillCostMapNormalized.set(key, meta);
          }
        });
        console.log(`Loaded skill costs from ${url}: ${skillCostMapExact.size} exact, ${skillCostMapNormalized.size} normalized`);
        return true;
      } catch (err) {
        console.warn('Failed loading skill costs', url, err);
      }
    }
    return false;
  }

  function clampStatValue(value) {
    if (typeof value !== 'number' || isNaN(value)) return 0;
    return Math.max(0, Math.min(MAX_STAT_VALUE, value));
  }

  function getCurrentStarLevel() {
    const raw = ratingInputs.star ? parseInt(ratingInputs.star.value, 10) : 0;
    return isNaN(raw) ? 0 : raw;
  }

  function getCurrentUniqueLevel() {
    const raw = ratingInputs.unique ? parseInt(ratingInputs.unique.value, 10) : 0;
    return isNaN(raw) ? 0 : raw;
  }

  function calcUniqueBonus(starLevel, uniqueLevel) {
    const lvl = typeof uniqueLevel === 'number' && uniqueLevel > 0 ? uniqueLevel : 0;
    if (!lvl) return 0;
    const multiplier = starLevel === 1 || starLevel === 2 ? 120 : 170;
    return lvl * multiplier;
  }

  const RATING_SPRITE = {
    url: 'assets/rank_badges.png',
    columns: 6,
    rows: 6,
    tileWidth: 125,
    tileHeight: 125,
    loaded: false
  };

  const RATING_BADGES = [
    { threshold: 300, label: 'G', sprite: { col: 0, row: 0 } },
    { threshold: 600, label: 'G+', sprite: { col: 0, row: 1 } },
    { threshold: 900, label: 'F', sprite: { col: 0, row: 2 } },
    { threshold: 1300, label: 'F+', sprite: { col: 0, row: 3 } },
    { threshold: 1800, label: 'E', sprite: { col: 0, row: 4 } },
    { threshold: 2300, label: 'E+', sprite: { col: 0, row: 5 } },
    { threshold: 2900, label: 'D', sprite: { col: 1, row: 0 } },
    { threshold: 3500, label: 'D+', sprite: { col: 1, row: 1 } },
    { threshold: 4900, label: 'C', sprite: { col: 1, row: 2 } },
    { threshold: 6500, label: 'C+', sprite: { col: 1, row: 3 } },
    { threshold: 8200, label: 'B', sprite: { col: 1, row: 4 } },
    { threshold: 10000, label: 'B+', sprite: { col: 1, row: 5 } },
    { threshold: 12100, label: 'A', sprite: { col: 2, row: 0 } },
    { threshold: 14500, label: 'A+', sprite: { col: 2, row: 1 } },
    { threshold: 15900, label: 'S', sprite: { col: 2, row: 2 } },
    { threshold: 17500, label: 'S+', sprite: { col: 2, row: 3 } },
    { threshold: 19200, label: 'SS', sprite: { col: 2, row: 4 } },
    { threshold: 19600, label: 'SS+', sprite: { col: 2, row: 5 } },
    { threshold: 20000, label: 'UG', sprite: { col: 3, row: 0 } },
    { threshold: 20400, label: 'UG1', sprite: { col: 3, row: 1 } },
    { threshold: 20800, label: 'UG2', sprite: { col: 3, row: 2 } },
    { threshold: 21200, label: 'UG3', sprite: { col: 3, row: 3 } },
    { threshold: 21600, label: 'UG4', sprite: { col: 3, row: 4 } },
    { threshold: 22100, label: 'UG5', sprite: { col: 3, row: 5 } },
    { threshold: 22500, label: 'UG6', sprite: { col: 4, row: 0 } },
    { threshold: 23000, label: 'UG7', sprite: { col: 4, row: 1 } },
    { threshold: 23400, label: 'UG8', sprite: { col: 4, row: 2 } },
    { threshold: 23900, label: 'UG9', sprite: { col: 4, row: 3 } },
    { threshold: 24300, label: 'UF', sprite: { col: 4, row: 4 } },
    { threshold: 24800, label: 'UF1', sprite: { col: 4, row: 5 } },
    { threshold: 25300, label: 'UF2', sprite: { col: 5, row: 0 } },
    { threshold: 25800, label: 'UF3', sprite: { col: 5, row: 1 } },
    { threshold: 26300, label: 'UF4', sprite: { col: 5, row: 2 } },
    { threshold: 26800, label: 'UF5', sprite: { col: 5, row: 3 } },
    { threshold: 27300, label: 'UF6', sprite: { col: 5, row: 4 } },
    { threshold: 27800, label: 'UF7', sprite: { col: 5, row: 5 } },
    { threshold: Infinity, label: 'UF7', sprite: { col: 5, row: 5 } },
  ];

  function getRatingBadge(totalScore) {
    for (const badge of RATING_BADGES) {
      if (totalScore < badge.threshold) return badge;
    }
    return RATING_BADGES[RATING_BADGES.length - 1];
  }

  function getRatingBadgeIndex(totalScore) {
    for (let i = 0; i < RATING_BADGES.length; i++) {
      if (totalScore < RATING_BADGES[i].threshold) return i;
    }
    return RATING_BADGES.length - 1;
  }

  function applyBadgeSpriteStyles(target, spriteUrl, sheetWidth, sheetHeight) {
    if (!target) return;
    const badgeWidth = target.clientWidth || RATING_SPRITE.tileWidth;
    const badgeHeight = target.clientHeight || RATING_SPRITE.tileHeight;
    const scaleX = badgeWidth / RATING_SPRITE.tileWidth;
    const scaleY = badgeHeight / RATING_SPRITE.tileHeight;
    const bgWidth = sheetWidth * scaleX;
    const bgHeight = sheetHeight * scaleY;
    target.style.backgroundImage = `url(${spriteUrl})`;
    target.style.backgroundSize = `${bgWidth}px ${bgHeight}px`;
  }

  function loadRatingSprite() {
    if (!ratingDisplays.badgeSprite && !ratingDisplays.floatBadgeSprite) return;
    const spriteUrl = `${RATING_SPRITE.url}?v=${Date.now()}`;
    const img = new Image();
    img.onload = () => {
      const sheetWidth = img.naturalWidth;
      const sheetHeight = img.naturalHeight;
      RATING_SPRITE.tileWidth = sheetWidth / RATING_SPRITE.columns;
      RATING_SPRITE.tileHeight = sheetHeight / RATING_SPRITE.rows;
      RATING_SPRITE.loaded = true;
      applyBadgeSpriteStyles(ratingDisplays.badgeSprite, spriteUrl, sheetWidth, sheetHeight);
      applyBadgeSpriteStyles(ratingDisplays.floatBadgeSprite, spriteUrl, sheetWidth, sheetHeight);
      updateRatingDisplay();
    };
    img.onerror = () => {
      RATING_SPRITE.loaded = false;
      if (ratingDisplays.badgeSprite) ratingDisplays.badgeSprite.textContent = '';
      if (ratingDisplays.floatBadgeSprite) ratingDisplays.floatBadgeSprite.textContent = '';
    };
    img.src = spriteUrl;
  }

  function readRatingStats() {
    return {
      speed: clampStatValue(parseInt(ratingInputs.speed?.value, 10)),
      stamina: clampStatValue(parseInt(ratingInputs.stamina?.value, 10)),
      power: clampStatValue(parseInt(ratingInputs.power?.value, 10)),
      guts: clampStatValue(parseInt(ratingInputs.guts?.value, 10)),
      wisdom: clampStatValue(parseInt(ratingInputs.wisdom?.value, 10))
    };
  }

  function getMultiplierForBlock(blockIndex) {
    if (blockIndex < STAT_MULTIPLIERS.length) {
      return STAT_MULTIPLIERS[blockIndex];
    }
    return STAT_MULTIPLIERS[STAT_MULTIPLIERS.length - 1];
  }

  function calcStatScore(statValue) {
    const value = clampStatValue(statValue);
    const blocks = Math.floor(value / STAT_BLOCK_SIZE);
    let blockSum = 0;
    for (let i = 0; i < blocks && i < STAT_MULTIPLIERS.length; i++) {
      blockSum += STAT_MULTIPLIERS[i] * STAT_BLOCK_SIZE;
    }
    const remainder = value % STAT_BLOCK_SIZE;
    const multiplier = getMultiplierForBlock(blocks);
    const remainderSum = multiplier * (remainder + 1);
    return Math.floor(blockSum + remainderSum);
  }

  function calculateRatingBreakdown(skillScoreOverride) {
    if (typeof skillScoreOverride === 'number' && !isNaN(skillScoreOverride)) {
      lastSkillScore = Math.max(0, Math.round(skillScoreOverride));
    }
    const stats = readRatingStats();
    const statsScore = Object.values(stats).reduce((sum, val) => sum + calcStatScore(val), 0);
    const starLevel = getCurrentStarLevel();
    const uniqueLevel = getCurrentUniqueLevel();
    const uniqueBonus = calcUniqueBonus(starLevel, uniqueLevel);
    const total = statsScore + uniqueBonus + lastSkillScore;
    return { statsScore, uniqueBonus, skillScore: lastSkillScore, total };
  }

  function updateBadgeSprite(target, badge) {
    if (!target) return;
    if (RATING_SPRITE.loaded && badge.sprite) {
      const badgeWidth = target.clientWidth || RATING_SPRITE.tileWidth;
      const badgeHeight = target.clientHeight || RATING_SPRITE.tileHeight;
      const offsetX = badge.sprite.col * badgeWidth;
      const offsetY = badge.sprite.row * badgeHeight;
      target.style.backgroundPosition = `-${offsetX}px -${offsetY}px`;
      target.textContent = '';
    } else {
      target.style.backgroundImage = 'none';
      target.textContent = badge.label;
    }
  }

  function updateRatingDisplay(skillScoreOverride) {
    const breakdown = calculateRatingBreakdown(skillScoreOverride);
    if (ratingDisplays.stats) ratingDisplays.stats.textContent = breakdown.statsScore.toString();
    if (ratingDisplays.skills) ratingDisplays.skills.textContent = breakdown.skillScore.toString();
    if (ratingDisplays.unique) ratingDisplays.unique.textContent = breakdown.uniqueBonus.toString();
    if (ratingDisplays.total) ratingDisplays.total.textContent = breakdown.total.toString();
    if (ratingDisplays.floatTotal) ratingDisplays.floatTotal.textContent = breakdown.total.toString();
    const badge = getRatingBadge(breakdown.total);
    updateBadgeSprite(ratingDisplays.badgeSprite, badge);
    updateBadgeSprite(ratingDisplays.floatBadgeSprite, badge);
    if (ratingDisplays.progressFill && ratingDisplays.nextLabel && ratingDisplays.nextNeeded) {
      const idx = getRatingBadgeIndex(breakdown.total);
      const current = RATING_BADGES[idx];
      const prevThreshold = idx === 0 ? 0 : RATING_BADGES[idx - 1].threshold;
      const nextThreshold = current.threshold;
      const hasNext = Number.isFinite(nextThreshold);
      const range = hasNext ? Math.max(1, nextThreshold - prevThreshold) : 1;
      const clampedTotal = Math.max(prevThreshold, breakdown.total);
      const progress = hasNext
        ? Math.min(1, Math.max(0, (clampedTotal - prevThreshold) / range))
        : 1;
      const nextBadge = hasNext ? RATING_BADGES[idx + 1] : current;
      const needed = hasNext ? Math.max(0, nextThreshold - breakdown.total) : 0;
      ratingDisplays.progressFill.style.width = `${Math.round(progress * 100)}%`;
      ratingDisplays.nextLabel.textContent = hasNext
        ? `Next: ${nextBadge?.label || current.label} at ${nextThreshold}`
        : 'Max rank reached';
      ratingDisplays.nextNeeded.textContent = hasNext ? `+${needed}` : '';
      if (ratingDisplays.progressBar) {
        ratingDisplays.progressBar.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
      }
    }
  }

  function readRatingState() {
    const stats = readRatingStats();
    return {
      stats,
      star: getCurrentStarLevel(),
      unique: getCurrentUniqueLevel()
    };
  }

  function applyRatingState(data) {
    if (!data || typeof data !== 'object') return;
    const stats = data.stats || {};
    if (ratingInputs.speed && typeof stats.speed === 'number') ratingInputs.speed.value = stats.speed;
    if (ratingInputs.stamina && typeof stats.stamina === 'number') ratingInputs.stamina.value = stats.stamina;
    if (ratingInputs.power && typeof stats.power === 'number') ratingInputs.power.value = stats.power;
    if (ratingInputs.guts && typeof stats.guts === 'number') ratingInputs.guts.value = stats.guts;
    if (ratingInputs.wisdom && typeof stats.wisdom === 'number') ratingInputs.wisdom.value = stats.wisdom;
    if (ratingInputs.star && typeof data.star === 'number') ratingInputs.star.value = String(data.star);
    if (ratingInputs.unique && typeof data.unique === 'number') ratingInputs.unique.value = String(data.unique);
  }

  function handleRatingInputChange() {
    updateRatingDisplay();
    saveState();
  }

  function initRatingInputs() {
    Object.values(ratingInputs).forEach(input => {
      if (!input) return;
      input.addEventListener('input', handleRatingInputChange);
      input.addEventListener('change', handleRatingInputChange);
    });
    updateRatingDisplay();
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
        row.syncSkillCategory({ triggerOptimize: false, allowLinking: false, updateCost: false });
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
      const hintVal = row.querySelector('.hint-level')?.value;
      const hintLevel = parseInt(hintVal, 10);
      const required = row.querySelector('.required-skill')?.checked;
      if (!name || isNaN(cost)) return;
      const hintSuffix = !isNaN(hintLevel) ? `|H${hintLevel}` : '';
      const reqSuffix = required ? '|R' : '';
      rows.push(`${name}=${cost}${hintSuffix}${reqSuffix}`);
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
      let costText = (costRaw || '').trim();
      let hintLevel = 0;
      let required = false;
      if (/\|R\b/i.test(costText)) {
        required = true;
        costText = costText.replace(/\|R\b/ig, '').trim();
      }
      const hintMatch = costText.match(/\|H?\s*([0-5])\s*$/i);
      if (hintMatch) {
        hintLevel = parseInt(hintMatch[1], 10) || 0;
        costText = costText.slice(0, hintMatch.index).trim();
      }
      const cost = parseInt(costText, 10);
      if (!name || isNaN(cost)) return;
      const row = makeRow();
      rowsEl.appendChild(row);
      const nameInput = row.querySelector('.skill-name');
      const costInput = row.querySelector('.cost');
      const hintSelect = row.querySelector('.hint-level');
      const requiredToggle = row.querySelector('.required-skill');
      if (nameInput) nameInput.value = name;
      if (costInput) costInput.value = cost;
      if (hintSelect) hintSelect.value = String(hintLevel);
      if (requiredToggle) {
        requiredToggle.checked = required;
        row.classList.toggle('required', required);
      }
      if (typeof row.syncSkillCategory === 'function') {
        row.syncSkillCategory({ triggerOptimize: false, allowLinking: false, updateCost: false });
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
    const requiredSummary = expandRequired(items);
    if (requiredSummary.requiredCost > budget) {
      setAutoStatus('Required skills exceed the current budget.', true);
      renderResults({ best: 0, chosen: [], used: 0, error: 'required_unreachable' }, budget);
      return;
    }
    const includeGeneral = targets.includes('general');
    const targetSet = new Set(targets.filter(t => t !== 'general'));
    const optionalCandidates = items.filter(it => !requiredSummary.requiredIds.has(it.id) && matchesAutoTargets(it, targetSet, includeGeneral));
    const candidates = optionalCandidates.concat(requiredSummary.requiredItems);
    if (!candidates.length) {
      setAutoStatus('No existing rows match the selected targets with S-A affinity.', true);
      return;
    }
    const groups = buildGroups(optionalCandidates, rowsMeta);
    const result = optimizeGrouped(groups, optionalCandidates, budget - requiredSummary.requiredCost);
    if (result.error === 'required_unreachable') {
      setAutoStatus('Required skills exceed the current budget.', true);
      renderResults(result, budget);
      return;
    }
    if (!result.chosen.length) {
      setAutoStatus('Budget too low to purchase any of the matching skills you entered.', true);
      return;
    }
    const mergedResult = {
      ...result,
      chosen: requiredSummary.requiredItems.concat(result.chosen),
      used: result.used + requiredSummary.requiredCost,
      best: result.best + requiredSummary.requiredScore
    };
    applyAutoHighlights(mergedResult.chosen.map(it => it.id), candidates.map(it => it.id));
    renderResults(mergedResult, budget);
    setAutoStatus(`Highlighted ${mergedResult.chosen.length}/${candidates.length} matching skills (cost ${mergedResult.used}/${budget}).`);
  }

  function clearResults() {
    if (resultsEl) resultsEl.hidden = true;
    if (bestScoreEl) bestScoreEl.textContent = '0';
    if (usedPointsEl) usedPointsEl.textContent = '0';
    if (totalPointsEl) totalPointsEl.textContent = String(parseInt(budgetInput.value || '0', 10) || 0);
    if (remainingPointsEl) remainingPointsEl.textContent = totalPointsEl.textContent;
    if (selectedListEl) selectedListEl.innerHTML = '';
    lastSkillScore = 0;
    updateRatingDisplay(0);
  }

  // ---------- Live optimize helpers ----------
  function debounce(fn, ms) { let t; return function(...args){ clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); }; }

  function tryAutoOptimize() {
    const budget = parseInt(budgetInput.value, 10);
    if (isNaN(budget) || budget < 0) return;
    const { items, rowsMeta } = collectItems();
    if (!items.length) return;
    const requiredSummary = expandRequired(items);
    if (requiredSummary.requiredCost > budget) {
      renderResults({ best: 0, chosen: [], used: 0, error: 'required_unreachable' }, budget);
      return;
    }
    const optionalItems = items.filter(it => !requiredSummary.requiredIds.has(it.id));
    const groups = buildGroups(optionalItems, rowsMeta);
    const result = optimizeGrouped(groups, optionalItems, budget - requiredSummary.requiredCost);
    const mergedResult = {
      ...result,
      chosen: requiredSummary.requiredItems.concat(result.chosen),
      used: result.used + requiredSummary.requiredCost,
      best: result.best + requiredSummary.requiredScore
    };
    renderResults(mergedResult, budget);
  }
  const autoOptimizeDebounced = debounce(tryAutoOptimize, 120);

  function rebuildSkillCaches() {
    const nextIndex = new Map();
    const nextIdIndex = new Map();
    const names = [];
    Object.entries(skillsByCategory).forEach(([category, list = []]) => {
      list.forEach(skill => {
        if (!skill || !skill.name) return;
        const key = normalize(skill.name);
        const enriched = { ...skill, category };
        if (!nextIndex.has(key)) {
          names.push(skill.name);
        }
        nextIndex.set(key, enriched);
        if (skill.skillId) {
          const sid = String(skill.skillId);
          if (!nextIdIndex.has(sid)) nextIdIndex.set(sid, enriched);
        }
      });
    });
    skillIndex = nextIndex;
    skillIdIndex = nextIdIndex;
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
        { name: 'Concentration', score: { base: 508, good: 508, average: 415, bad: 369, terrible: 323 }, baseCost: 508, checkType: 'End' },
        { name: 'Professor of Curvature', score: { base: 508, good: 508, average: 415, bad: 369, terrible: 323 }, baseCost: 508, checkType: 'Medium' }
      ],
      yellow: [
        { name: 'Groundwork', score: { base: 217, good: 217, average: 177, bad: 158, terrible: 138 }, baseCost: 217, checkType: 'Front' },
        { name: 'Corner Recovery', score: { base: 217, good: 217, average: 177, bad: 158, terrible: 138 }, baseCost: 217, checkType: 'Late' }
      ],
      blue: [ { name: 'Stealth Mode', score: { base: 195, good: 195, average: 159, bad: 142, terrible: 124 }, baseCost: 195, checkType: 'Late' } ]
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
      skillsByCategory[color] = list.map(item => ({
        name: item.name,
        score: item.score,
        baseCost: item.baseCost || item.base || item.cost,
        checkType: item['check-type'] || ''
      }));
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
    const idx = {
      type: header.indexOf('skill_type'),
      name: header.indexOf('name'),
      base: header.indexOf('base_value'),
      baseCost: header.indexOf('base'),        // new CSV uses `base` for raw cost
      sa: header.indexOf('s_a'),
      bc: header.indexOf('b_c'),
      def: header.indexOf('d_e_f'),
      g: header.indexOf('g'),
      apt1: header.indexOf('apt_1'),
      apt2: header.indexOf('apt_2'),
      apt3: header.indexOf('apt_3'),
      apt4: header.indexOf('apt_4'),
      check: header.indexOf('affinity_role'),
      checkAlt: header.indexOf('affinity')
    };
    if (idx.name === -1) return false;
    const catMap = {};
    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r]; if (!cols || !cols.length) continue;
      const name = (cols[idx.name] || '').trim(); if (!name) continue;
      const type = idx.type !== -1 ? (cols[idx.type] || '').trim().toLowerCase() : 'misc';
      const baseCost = idx.baseCost !== -1 ? parseInt(cols[idx.baseCost] || '', 10) : NaN;
      const base = idx.base !== -1 ? parseInt(cols[idx.base] || '', 10) : NaN;
      const sa = idx.sa !== -1 ? parseInt(cols[idx.sa] || '', 10) : NaN;
      const bc = idx.bc !== -1 ? parseInt(cols[idx.bc] || '', 10) : NaN;
      const def = idx.def !== -1 ? parseInt(cols[idx.def] || '', 10) : NaN;
      const g = idx.g !== -1 ? parseInt(cols[idx.g] || '', 10) : NaN;
      // Alt columns used by the shipped CSV (apt_1..apt_4 for bucketed values)
      const apt1 = idx.apt1 !== -1 ? parseInt(cols[idx.apt1] || '', 10) : NaN;
      const apt2 = idx.apt2 !== -1 ? parseInt(cols[idx.apt2] || '', 10) : NaN;
      const apt3 = idx.apt3 !== -1 ? parseInt(cols[idx.apt3] || '', 10) : NaN;
      const apt4 = idx.apt4 !== -1 ? parseInt(cols[idx.apt4] || '', 10) : NaN;
      const checkTypeRaw = idx.check !== -1 ? (cols[idx.check] || '').trim() : (idx.checkAlt !== -1 ? (cols[idx.checkAlt] || '').trim() : '');
      const score = {};
      const baseBucket = !isNaN(base) ? base : (!isNaN(baseCost) ? baseCost : NaN);
      const goodVal = !isNaN(sa) ? sa : (!isNaN(apt1) ? apt1 : baseBucket);
      const avgVal = !isNaN(bc) ? bc : (!isNaN(apt2) ? apt2 : goodVal);
      const badVal = !isNaN(def) ? def : (!isNaN(apt3) ? apt3 : avgVal);
      const terrVal = !isNaN(g) ? g : (!isNaN(apt4) ? apt4 : badVal);
      if (!isNaN(baseBucket)) score.base = baseBucket;
      if (!isNaN(goodVal)) score.good = goodVal;
      if (!isNaN(avgVal)) score.average = avgVal;
      if (!isNaN(badVal)) score.bad = badVal;
      if (!isNaN(terrVal)) score.terrible = terrVal;
      const exactKey = normalize(name);
      const lookupKey = normalizeCostKey(name);
      const meta = skillCostMapExact.get(exactKey) || skillCostMapNormalized.get(lookupKey) || null;
      const resolvedCost = (meta && typeof meta.cost === 'number')
        ? meta.cost
        : (isNaN(baseCost) ? undefined : baseCost);
      const isUnique = type === 'ius' || type.includes('ius');
      const parents = !isUnique && Array.isArray(meta?.parents) ? meta.parents : [];
      const lowerSkillId = !isUnique && Array.isArray(meta?.versions) && meta.versions.length ? String(meta.versions[0]) : '';
      const skillId = meta?.id;
      if (!catMap[type]) catMap[type] = [];
      catMap[type].push({
        name,
        score,
        baseCost: resolvedCost,
        checkType: checkTypeRaw,
        parentIds: parents,
        skillId,
        lowerSkillId
      });
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
        row.syncSkillCategory({ triggerOptimize: false, allowLinking: false, updateCost: false });
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
  function scrollRowIntoView(row, { focus = true } = {}) {
    if (!row) return;
    const input = row.querySelector('.skill-name');
    const target = input || row;
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (focus && input) input.focus({ preventScroll: true });
    });
  }
  function shouldAutoScrollNewRow() {
    return rowsEl && rowsEl.contains(document.activeElement);
  }
  function ensureOneEmptyRow() {
    const rows = Array.from(rowsEl.querySelectorAll('.optimizer-row'))
      .filter(isTopLevelRow);
    if (!rows.length) { rowsEl.appendChild(makeRow()); return; }
    const last = rows[rows.length - 1];
    const lastFilled = isRowFilled(last);
    if (lastFilled) {
      const newRow = makeRow();
      rowsEl.appendChild(newRow);
      if (shouldAutoScrollNewRow()) scrollRowIntoView(newRow);
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
      <div class="skill-cell">
        <label>Skill</label>
        <input type="text" class="skill-name" list="skills-datalist-${id}" placeholder="Start typing..." />
        <datalist id="skills-datalist-${id}"></datalist>
        <div class="dup-warning" role="status" aria-live="polite"></div>
      </div>
      <div class="hint-cell">
        <label>Hint Discount</label>
        <div class="hint-controls">
          <select class="hint-level">
            ${HINT_LEVELS.map(lvl => `<option value="${lvl}">Lv${lvl} (${getTotalHintDiscountPct(lvl)}% off)</option>`).join('')}
          </select>
          <div class="base-cost" data-empty="true">Base ?</div>
        </div>
      </div>
      <div class="cost-cell">
        <label>Cost</label>
        <input type="number" min="0" step="1" class="cost" placeholder="Cost" />
      </div>
      <div class="actions-cell">
        <div class="required-cell">
          <label>Must Buy</label>
          <label class="required-toggle">
            <input type="checkbox" class="required-skill" />
            Lock
          </label>
        </div>
        <div class="remove-cell">
          <label class="remove-label">&nbsp;</label>
          <button type="button" class="btn remove">Remove</button>
        </div>
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
    const hintSelect = row.querySelector('.hint-level');
    const dupWarning = row.querySelector('.dup-warning');
    let dupWarningTimer = null;
    const baseCostDisplay = row.querySelector('.base-cost');
    const costInput = row.querySelector('.cost');
    const requiredToggle = row.querySelector('.required-skill');
    if (skillList) populateSkillDatalist(skillList);

    function getHintLevel() {
      if (!hintSelect) return 0;
      const val = parseInt(hintSelect.value, 10);
      return isNaN(val) ? 0 : val;
    }

    function updateBaseCostDisplay(skill) {
      if (!baseCostDisplay) return;
      const baseCost = skill && typeof skill.baseCost === 'number' && !isNaN(skill.baseCost) ? skill.baseCost : NaN;
      const baseScore = skill && skill.score && typeof skill.score === 'object' ? skill.score.base : NaN;
      if (!isNaN(baseCost)) row.dataset.baseCost = String(baseCost); else delete row.dataset.baseCost;
      const displayScore = !isNaN(baseScore) ? baseScore : evaluateSkillScore(skill || {});
      if (!isNaN(displayScore)) {
        baseCostDisplay.textContent = `Score ${displayScore}`;
        baseCostDisplay.dataset.empty = 'false';
      } else {
        baseCostDisplay.textContent = 'Score ?';
        baseCostDisplay.dataset.empty = 'true';
      }
    }

    function getLowerDiscountedCost(skill) {
      let lowerBaseCost = NaN;
      let lowerHintLevel = 0;
      if (row.dataset.lowerRowId) {
        const linked = rowsEl.querySelector(`.optimizer-row[data-row-id="${row.dataset.lowerRowId}"]`);
        if (linked) {
          const hintEl = linked.querySelector('.hint-level');
          const hintVal = parseInt(hintEl?.value || '0', 10);
          lowerHintLevel = isNaN(hintVal) ? 0 : hintVal;
          if (linked.dataset.baseCost) {
            const parsed = parseInt(linked.dataset.baseCost, 10);
            if (!isNaN(parsed)) lowerBaseCost = parsed;
          }
        }
      }
      if (isNaN(lowerBaseCost)) {
        const candidateId = skill.lowerSkillId || (Array.isArray(skill.parentIds) ? skill.parentIds[0] : '');
        if (candidateId) {
          const lower = skillIdIndex.get(String(candidateId));
          if (lower && typeof lower.baseCost === 'number') lowerBaseCost = lower.baseCost;
        }
      }
      if (isNaN(lowerBaseCost)) return NaN;
      return calculateDiscountedCost(lowerBaseCost, lowerHintLevel);
    }

    function applyHintedCost(skill) {
      if (!costInput) return;
      const baseCost = (() => {
        if (skill && typeof skill.baseCost === 'number' && !isNaN(skill.baseCost)) return skill.baseCost;
        if (row.dataset.baseCost) {
          const parsed = parseInt(row.dataset.baseCost, 10);
          return isNaN(parsed) ? NaN : parsed;
        }
        return NaN;
      })();
      if (isNaN(baseCost)) return;
      const discounted = calculateDiscountedCost(baseCost, getHintLevel());
      if (isNaN(discounted)) return;
      const isGoldRow = isGoldCategory(row.dataset.skillCategory || '');
      if (isGoldRow && skill) {
        const lowerDiscounted = getLowerDiscountedCost(skill);
        if (!isNaN(lowerDiscounted)) {
          costInput.value = discounted + lowerDiscounted;
          return;
        }
      }
      costInput.value = discounted;
    }

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

    function getSkillIdentity(name) {
      const skill = findSkillByName(name);
      const id = skill?.skillId ?? skill?.id ?? '';
      const canonicalName = skill?.name || name;
      return { id: id ? String(id) : '', name: canonicalName, skill };
    }

    function isDuplicateSkill(identity) {
      if (!rowsEl || !identity || !identity.name) return false;
      const primaryKey = identity.id || normalize(identity.name);
      if (!primaryKey) return false;
      const rows = rowsEl.querySelectorAll('.optimizer-row');
      for (const other of rows) {
        if (other === row) continue;
        const otherName = other.querySelector('.skill-name')?.value?.trim();
        if (!otherName) continue;
        const otherIdentity = getSkillIdentity(otherName);
        const otherKey = otherIdentity.id || normalize(otherIdentity.name);
        if (otherKey && otherKey === primaryKey) return true;
      }
      return false;
    }

    function showDupWarning(message) {
      if (!dupWarning) return;
      dupWarning.textContent = message;
      dupWarning.classList.add('visible');
      row.dataset.dupWarningHold = '1';
      if (dupWarningTimer) window.clearTimeout(dupWarningTimer);
      dupWarningTimer = window.setTimeout(() => {
        if (dupWarning) {
          dupWarning.textContent = '';
          dupWarning.classList.remove('visible');
        }
        delete row.dataset.dupWarningHold;
        dupWarningTimer = null;
      }, 2500);
    }

    function clearDupWarning() {
      if (!dupWarning) return;
      if (row.dataset.dupWarningHold) return;
      if (dupWarningTimer) {
        window.clearTimeout(dupWarningTimer);
        dupWarningTimer = null;
      }
      dupWarning.textContent = '';
      dupWarning.classList.remove('visible');
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
      linked.syncSkillCategory({ triggerOptimize: false, allowLinking: false, updateCost: false });
    }
    autofillLinkedLower(linked);
    saveState();
    ensureOneEmptyRow();
    autoOptimizeDebounced();
  }

    function ensureLinkedLowerForParent(skill, { allowCreate = true } = {}) {
      if (!skill || !Array.isArray(skill.parentIds) || !skill.parentIds.length) return;
      if (row.dataset.lowerRowId) {
        const linked = rowsEl.querySelector(`.optimizer-row[data-row-id="${row.dataset.lowerRowId}"]`);
        autofillLinkedLower(linked);
        return;
      }
      if (!allowCreate) return;
      const linked = makeRow();
      linked.classList.add('linked-lower');
      linked.dataset.parentSkillLink = id;
      const lid = linked.dataset.rowId;
      const linkedInput = linked.querySelector('.skill-name');
      if (linkedInput) linkedInput.placeholder = 'Lower skill...';
      const linkedRemove = linked.querySelector('.remove');
      if (linkedRemove) {
        linkedRemove.disabled = true;
        linkedRemove.title = 'Remove the parent row to unlink';
        linkedRemove.style.pointerEvents = 'none';
        linkedRemove.style.opacity = '0.4';
      }
      rowsEl.insertBefore(linked, row.nextSibling);
      row.dataset.lowerRowId = lid;
      autofillLinkedLower(linked);
      saveState();
      ensureOneEmptyRow();
      autoOptimizeDebounced();
    }

    function syncSkillCategory({ triggerOptimize = false, allowLinking = true, updateCost = false } = {}) {
      if (!skillInput) return;
      const rawName = (skillInput.value || '').trim();
      if (!rawName) {
        delete row.dataset.lastSkillName;
        if (!row.dataset.dupWarningHold) clearDupWarning();
      }
      const identity = getSkillIdentity(rawName);
      const skill = identity.skill;
      if (rawName) {
        const canonical = identity.name || rawName;
        if (isDuplicateSkill(identity)) {
          showDupWarning('This skill has already been added.');
          const fallback = row.dataset.lastSkillName || '';
          if (fallback) {
            skillInput.value = fallback;
            const prev = findSkillByName(fallback);
            const prevCategory = prev ? prev.category : '';
            setCategoryDisplay(prevCategory);
            updateBaseCostDisplay(prev);
            if (updateCost) applyHintedCost(prev);
          } else {
            skillInput.value = '';
            setCategoryDisplay('');
            updateBaseCostDisplay(null);
            if (costInput) costInput.value = '';
            delete row.dataset.baseCost;
          }
          return;
        }
        row.dataset.lastSkillName = canonical;
      }
      clearDupWarning();
      const category = skill ? skill.category : '';
      setCategoryDisplay(category);
      updateBaseCostDisplay(skill);
      ensureLinkedLowerForGold(category, { allowCreate: allowLinking });
      ensureLinkedLowerForParent(skill, { allowCreate: allowLinking });
      if (updateCost) applyHintedCost(skill);
      if (triggerOptimize) {
        saveState();
        ensureOneEmptyRow();
        autoOptimizeDebounced();
      }
    }

    function autofillLinkedLower(linkedRow) {
      if (!linkedRow || !skillInput) return;
      const skill = findSkillByName(skillInput.value);
      if (!skill) return;
      // Prefer explicit lowerSkillId; otherwise, try parentIds (common for gold -> lower)
      const candidateId = skill.lowerSkillId || (Array.isArray(skill.parentIds) ? skill.parentIds[0] : '');
      if (!candidateId) return;
      const lower = skillIdIndex.get(String(candidateId));
      if (!lower) return;
      const lowerInput = linkedRow.querySelector('.skill-name');
      const lowerCostInput = linkedRow.querySelector('.cost');
      const lowerHint = linkedRow.querySelector('.hint-level');
      if (lowerInput && !lowerInput.value) lowerInput.value = lower.name;
      const baseCost = typeof lower.baseCost === 'number' ? lower.baseCost : skillCostById.get(String(candidateId));
      if (lowerCostInput && typeof baseCost === 'number') {
        linkedRow.dataset.baseCost = String(baseCost);
        const hintLevel = lowerHint ? parseInt(lowerHint.value || '0', 10) || 0 : (hintSelect ? parseInt(hintSelect.value || '0', 10) || 0 : 0);
        const discounted = calculateDiscountedCost(baseCost, hintLevel);
        if (!isNaN(discounted)) lowerCostInput.value = discounted;
      }
      if (typeof linkedRow.syncSkillCategory === 'function') {
        linkedRow.syncSkillCategory({ triggerOptimize: false, allowLinking: false, updateCost: true });
      }
    }

    row.syncSkillCategory = syncSkillCategory;
    setCategoryDisplay(row.dataset.skillCategory || '');
    if (skillInput) {
      const syncFromInput = () => syncSkillCategory({ triggerOptimize: true, updateCost: true });
      skillInput.addEventListener('input', syncFromInput);
      skillInput.addEventListener('change', syncFromInput);
      skillInput.addEventListener('blur', syncFromInput);
      skillInput.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') syncFromInput();
      });
      let monitorId = null;
      const startMonitor = () => {
        if (monitorId) return;
        let lastValue = skillInput.value;
        monitorId = window.setInterval(() => {
          if (!document.body.contains(skillInput)) return;
          if (skillInput.value !== lastValue) {
            lastValue = skillInput.value;
            syncFromInput();
          }
        }, 120);
      };
      const stopMonitor = () => {
        if (!monitorId) return;
        window.clearInterval(monitorId);
        monitorId = null;
      };
      skillInput.addEventListener('focus', startMonitor);
      skillInput.addEventListener('blur', stopMonitor);
    }
    if (hintSelect) {
      hintSelect.addEventListener('change', () => {
        const skill = skillInput ? findSkillByName(skillInput.value) : null;
        applyHintedCost(skill);
        if (row.dataset.parentGoldId) {
          const parent = rowsEl.querySelector(`.optimizer-row[data-row-id="${row.dataset.parentGoldId}"]`);
          if (parent && typeof parent.syncSkillCategory === 'function') {
            parent.syncSkillCategory({ triggerOptimize: false, allowLinking: false, updateCost: true });
          }
        }
        saveState();
        ensureOneEmptyRow();
        autoOptimizeDebounced();
      });
    }
    if (requiredToggle) {
      requiredToggle.addEventListener('change', () => {
        row.classList.toggle('required', requiredToggle.checked);
        if (requiredToggle.checked) {
          const isGoldRow = isGoldCategory(row.dataset.skillCategory || '');
          if (isGoldRow) {
            let linked = null;
            if (row.dataset.lowerRowId) {
              linked = rowsEl.querySelector(`.optimizer-row[data-row-id="${row.dataset.lowerRowId}"]`);
            }
            if (!linked) {
              linked = rowsEl.querySelector(`.optimizer-row[data-parent-gold-id="${id}"]`);
            }
            if (linked) {
              const linkedToggle = linked.querySelector('.required-skill');
              if (linkedToggle) {
                linkedToggle.checked = true;
                linked.classList.add('required');
              }
            }
          }
        }
        saveState();
        ensureOneEmptyRow();
        autoOptimizeDebounced();
      });
    }
    return row;
  }

  function collectItems() {
    const items = []; const rowsMeta = [];
    const rows = rowsEl.querySelectorAll('.optimizer-row');
    rows.forEach(row => {
      const nameInput = row.querySelector('.skill-name');
      const costEl = row.querySelector('.cost');
      const hintEl = row.querySelector('.hint-level');
      const requiredEl = row.querySelector('.required-skill');
      if (!nameInput || !costEl) return;
      const name = (nameInput.value || '').trim();
      const rawCost = parseInt(costEl.value, 10);
      const hintLevel = parseInt(hintEl?.value || '', 10) || 0;
      const required = !!requiredEl?.checked;
      const baseCostStored = row.dataset.baseCost ? parseInt(row.dataset.baseCost, 10) : NaN;
      const cost = !isNaN(rawCost)
        ? rawCost
        : (!isNaN(baseCostStored) ? calculateDiscountedCost(baseCostStored, hintLevel) : NaN);
      if (!name || isNaN(cost)) return;
      const skill = findSkillByName(name);
      if (!skill) return;
      const category = skill.category || '';
      const score = evaluateSkillScore(skill);
      const rowId = row.dataset.rowId || Math.random().toString(36).slice(2);
      const parentGoldId = row.dataset.parentGoldId || '';
      const lowerRowId = row.dataset.lowerRowId || '';
      const parentSkillIds = Array.isArray(skill.parentIds) && skill.parentIds.length ? skill.parentIds : [];
      const lowerSkillId = skill.lowerSkillId || '';
      const skillId = skill.skillId || skill.id || '';
      items.push({ id: rowId, name: skill.name, cost, score, baseCost: baseCostStored, category, parentGoldId, lowerRowId, checkType: skill.checkType || '', parentSkillIds, lowerSkillId, skillId, hintLevel, required });
      rowsMeta.push({ id: rowId, category, parentGoldId, lowerRowId });
    });
    return { items, rowsMeta };
  }

  function buildGroups(items, rowsMeta) {
    const idToIndex = new Map(items.map((it, i) => [it.id, i]));
    const skillIdToIndex = new Map();
    items.forEach((it, i) => {
      if (it.skillId) skillIdToIndex.set(String(it.skillId), i);
      if (it.lowerSkillId) skillIdToIndex.set(String(it.lowerSkillId), i);
    });
    const used = new Array(items.length).fill(false);
    const groups = [];
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue;
      const it = items[i];
      let handled = false;

      // Dependency: if item has a parent (single-circle) present, offer choices (none, parent only, parent+child).
      const parentCandidates = [];
      if (Array.isArray(it.parentSkillIds) && it.parentSkillIds.length) parentCandidates.push(...it.parentSkillIds);
      if (it.lowerSkillId) parentCandidates.push(it.lowerSkillId);
      const pid = parentCandidates.find(pid => skillIdToIndex.has(String(pid)));
      if (pid !== undefined) {
        const j = skillIdToIndex.get(String(pid));
        if (!used[j]) {
          const parent = items[j];
          const childIsGold = isGoldCategory(it.category);
          const parentId = parent.id;
          const parentMatchesLower = it.lowerRowId && it.lowerRowId === parentId;
          const comboCost = (childIsGold && parentMatchesLower) ? it.cost : parent.cost + it.cost;
          groups.push([
            { none: true, items: [] },
            { pick: j, cost: parent.cost, score: parent.score, items: [j] },
            // Upgraded (double-circle): pay both costs, only upgraded score counts.
            { combo: [j, i], cost: comboCost, score: it.score, items: [j, i] }
          ]);
          used[j] = used[i] = true;
          handled = true;
        }
      }
      if (handled) continue;

      const isGold = isGoldCategory(it.category);
      if (isGold && it.lowerRowId && idToIndex.has(it.lowerRowId)) {
        const j = idToIndex.get(it.lowerRowId);
        if (!used[j]) {
          // gold requires lower: offer none, lower only, or gold with lower cost included
          groups.push([
            { none: true, items: [] },
            { pick: j, cost: items[j].cost, score: items[j].score, items: [j] },
            { combo: [j, i], cost: it.cost, score: it.score, items: [j, i] }
          ]);
          used[i] = used[j] = true;
          continue;
        }
      }
      // If this is a lower-linked row, and its parent gold appears later, it will be grouped there.
      groups.push([ { none: true, items: [] }, { pick: i, cost: it.cost, score: it.score, items: [i] } ]);
      used[i] = true;
    }
    return groups;
  }

  function optimizeGrouped(groups, items, budget) {
    const B = Math.max(0, Math.floor(budget));
    const requiredSet = new Set();
    items.forEach((it, idx) => { if (it.required) requiredSet.add(idx); });
    const filteredGroups = groups.map(opts => {
      const reqInGroup = new Set();
      opts.forEach(o => {
        (o.items || []).forEach(idx => {
          if (requiredSet.has(idx)) reqInGroup.add(idx);
        });
      });
      if (!reqInGroup.size) return opts;
      return opts.filter(o => {
        const present = o.items || [];
        for (const reqIdx of reqInGroup) {
          if (!present.includes(reqIdx)) return false;
        }
        return true;
      });
    });
    if (filteredGroups.some(opts => !opts.length)) {
      return { best: 0, chosen: [], used: 0, error: 'required_unreachable' };
    }
    const G = filteredGroups.length;
    const NEG = -1e15;
    const dp = Array.from({ length: G + 1 }, () => new Array(B + 1).fill(NEG));
    const choice = Array.from({ length: G + 1 }, () => new Array(B + 1).fill(-1));
    for (let b = 0; b <= B; b++) dp[0][b] = 0;
    for (let g = 1; g <= G; g++) {
      const opts = filteredGroups[g - 1];
      const hasNone = opts.some(o => o.none);
      for (let b = 0; b <= B; b++) {
        if (hasNone) {
          dp[g][b] = dp[g - 1][b];
          choice[g][b] = -1;
        } else {
          dp[g][b] = NEG;
          choice[g][b] = -1;
        }
        for (let k = 0; k < opts.length; k++) {
          const o = opts[k]; if (o.none) continue;
          const w = Math.max(0, Math.floor(o.cost)); const v = Math.max(0, Math.floor(o.score));
          if (w <= b && dp[g - 1][b - w] > NEG / 2) {
            const cand = dp[g - 1][b - w] + v;
            if (cand > dp[g][b]) { dp[g][b] = cand; choice[g][b] = k; }
          }
        }
      }
    }
    if (dp[G][B] <= NEG / 2) {
      return { best: 0, chosen: [], used: 0, error: 'required_unreachable' };
    }
    // reconstruct
    let b = B; const chosen = [];
    for (let g = G; g >= 1; g--) {
      const opts = filteredGroups[g - 1];
      const k = choice[g][b];
      if (k > 0) {
        const o = opts[k];
        const picks = o.combo || (typeof o.pick === 'number' ? [o.pick] : []);
        if (o.combo) {
          const lastIdx = picks[picks.length - 1];
          const baseItem = items[lastIdx];
          chosen.push({
            ...baseItem,
            id: baseItem.id,
            cost: o.cost,
            score: o.score,
            combo: true,
            components: picks.map(idx => items[idx]?.id).filter(Boolean)
          });
          const comboParentName = baseItem.name;
          picks.slice(0, -1).forEach(idx => {
            const comp = items[idx];
            if (!comp) return;
            chosen.push({
              ...comp,
              cost: 0,
              score: 0,
              comboComponent: true,
              comboParentName
            });
          });
        } else {
          picks.forEach(idx => chosen.push(items[idx]));
        }
        b -= Math.max(0, Math.floor(o.cost));
      }
    }
    chosen.reverse();
    const idToIndex = new Map(items.map((it, idx) => [it.id, idx]));
    const chosenIds = new Set(chosen.map(it => it.id));
    let addedScore = 0;
    let addedCost = 0;
    requiredSet.forEach(idx => {
      const it = items[idx];
      if (!it || chosenIds.has(it.id)) return;
      chosen.push({ ...it, forced: true });
      chosenIds.add(it.id);
      addedScore += Math.max(0, Math.floor(it.score || 0));
      addedCost += Math.max(0, Math.floor(it.cost || 0));
      if (it.lowerRowId && idToIndex.has(it.lowerRowId)) {
        const lower = items[idToIndex.get(it.lowerRowId)];
        if (lower && !chosenIds.has(lower.id)) {
          chosen.push({ ...lower, forced: true });
          chosenIds.add(lower.id);
          addedScore += Math.max(0, Math.floor(lower.score || 0));
          addedCost += Math.max(0, Math.floor(lower.cost || 0));
        }
      }
    });
    const used = chosen.reduce((sum, it) => it.comboComponent ? sum : sum + Math.max(0, Math.floor(it.cost)), 0);
    const best = dp[G][B] + addedScore;
    if (used > B) {
      return { best: 0, chosen: [], used: 0, error: 'required_unreachable' };
    }
    return { best, chosen, used };
  }

  function expandRequired(items) {
    const idToIndex = new Map(items.map((it, idx) => [it.id, idx]));
    const skillIdToIndex = new Map();
    const parentGoldToChild = new Map();
    items.forEach((it, idx) => {
      if (it.skillId !== undefined && it.skillId !== null) {
        skillIdToIndex.set(String(it.skillId), idx);
      }
      if (it.parentGoldId) {
        parentGoldToChild.set(it.parentGoldId, idx);
      }
    });
    const requiredIds = new Set(items.filter(it => it.required).map(it => it.id));
    let changed = true;
    while (changed) {
      changed = false;
      Array.from(requiredIds).forEach(id => {
        const idx = idToIndex.get(id);
        if (idx === undefined) return;
        const it = items[idx];
        if (it.lowerRowId && idToIndex.has(it.lowerRowId) && !requiredIds.has(it.lowerRowId)) {
          requiredIds.add(it.lowerRowId);
          changed = true;
        }
        if (it.lowerSkillId !== undefined && it.lowerSkillId !== null) {
          const lowerIdx = skillIdToIndex.get(String(it.lowerSkillId));
          if (lowerIdx !== undefined) {
            const lowerId = items[lowerIdx]?.id;
            if (lowerId && !requiredIds.has(lowerId)) {
              requiredIds.add(lowerId);
              changed = true;
            }
          }
        }
        const parents = Array.isArray(it.parentSkillIds) ? it.parentSkillIds : [];
        parents.forEach(pid => {
          const pidx = skillIdToIndex.get(String(pid));
          if (pidx === undefined) return;
          const pidId = items[pidx]?.id;
          if (pidId && !requiredIds.has(pidId)) {
            requiredIds.add(pidId);
            changed = true;
          }
        });
        if (it.id && parentGoldToChild.has(it.id)) {
          const childIdx = parentGoldToChild.get(it.id);
          const childId = items[childIdx]?.id;
          if (childId && !requiredIds.has(childId)) {
            requiredIds.add(childId);
            changed = true;
          }
        }
      });
    }
    const requiredItems = items.filter(it => requiredIds.has(it.id));
    const requiredGoldIds = new Set(requiredItems.filter(it => isGoldCategory(it.category)).map(it => it.id));
    const lowerIncludedIds = new Set();
    requiredItems.forEach(it => {
      if (!requiredGoldIds.has(it.id)) return;
      if (it.lowerRowId && requiredIds.has(it.lowerRowId)) lowerIncludedIds.add(it.lowerRowId);
      if (it.lowerSkillId !== undefined && it.lowerSkillId !== null) {
        const lowerIdx = skillIdToIndex.get(String(it.lowerSkillId));
        if (lowerIdx !== undefined) {
          const lowerId = items[lowerIdx]?.id;
          if (lowerId && requiredIds.has(lowerId)) lowerIncludedIds.add(lowerId);
        }
      }
      if (it.id && parentGoldToChild.has(it.id)) {
        const childIdx = parentGoldToChild.get(it.id);
        const childId = items[childIdx]?.id;
        if (childId && requiredIds.has(childId)) lowerIncludedIds.add(childId);
      }
    });
    const requiredCost = requiredItems.reduce((sum, it) => {
      if (lowerIncludedIds.has(it.id)) return sum;
      return sum + Math.max(0, Math.floor(it.cost));
    }, 0);
    const requiredScore = requiredItems.reduce((sum, it) => {
      if (lowerIncludedIds.has(it.id)) return sum;
      return sum + Math.max(0, Math.floor(it.score));
    }, 0);
    return { requiredIds, requiredItems, requiredCost, requiredScore };
  }

  function renderResults(result, budget) {
    resultsEl.hidden = false;
    bestScoreEl.textContent = String(result.best);
    usedPointsEl.textContent = String(result.used);
    totalPointsEl.textContent = String(budget);
    remainingPointsEl.textContent = String(Math.max(0, budget - result.used));
    selectedListEl.innerHTML = '';
    if (result.error === 'required_unreachable') {
      const li = document.createElement('li');
      li.className = 'result-item';
      li.textContent = 'Required skills cannot fit within the current budget.';
      selectedListEl.appendChild(li);
      updateRatingDisplay(result.best);
      return;
    }
    const ordered = Array.isArray(result.chosen) ? [...result.chosen] : [];
    const indexMap = new Map(ordered.map((it, idx) => [it.id, idx]));
    const byId = new Map(ordered.map(it => [it.id, it]));
    const bySkillId = new Map();
    ordered.forEach(it => {
      if (it.skillId !== undefined && it.skillId !== null) {
        bySkillId.set(String(it.skillId), it);
      }
    });
    const lowerToGold = new Map();
    const goldToLower = new Map();
    ordered.forEach(it => {
      if (!isGoldCategory(it.category)) return;
      if (it.lowerRowId && byId.has(it.lowerRowId)) {
        lowerToGold.set(it.lowerRowId, it);
        goldToLower.set(it.id, byId.get(it.lowerRowId));
        return;
      }
      if (it.lowerSkillId !== undefined && it.lowerSkillId !== null) {
        const lower = bySkillId.get(String(it.lowerSkillId));
        if (lower) {
          lowerToGold.set(lower.id, it);
          goldToLower.set(it.id, lower);
        }
      }
    });
    ordered.sort((a, b) => {
      const ag = lowerToGold.get(a.id);
      const bg = lowerToGold.get(b.id);
      if (ag && ag.id === b.id) return 1;
      if (bg && bg.id === a.id) return -1;
      return (indexMap.get(a.id) || 0) - (indexMap.get(b.id) || 0);
    });
    ordered.forEach(it => {
      const li = document.createElement('li');
      li.className = 'result-item';
      const cat = it.category || 'unknown';
      const canon = (function(v){ v=(v||'').toLowerCase(); if(v.includes('gold')) return 'gold'; if(v==='ius'||v.includes('ius')) return 'ius'; return v; })(cat);
      if (canon) li.classList.add(`cat-${canon}`);
      const includedWith = it.comboComponent
        ? it.comboParentName
        : (lowerToGold.has(it.id) ? lowerToGold.get(it.id)?.name : '');
      const meta = includedWith
        ? `- included with ${includedWith}`
        : `- cost ${it.cost}, score ${it.score}`;
      li.innerHTML = `<span class="res-name">${it.name}</span> <span class="res-meta">${meta}</span>`;
      selectedListEl.appendChild(li);
    });
    updateRatingDisplay(result.best);
  }

  // persistence
  function saveState() {
    const state = { budget: parseInt(budgetInput.value, 10) || 0, cfg: {}, rows: [], autoTargets: [], rating: readRatingState(), fastLearner: !!fastLearnerToggle?.checked };
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
      const hintEl = row.querySelector('.hint-level');
      const requiredEl = row.querySelector('.required-skill');
      if (!nameInput || !costEl) return;
      state.rows.push({
        id: row.dataset.rowId || '',
        category: row.dataset.skillCategory || '',
        name: nameInput.value || '',
        cost: parseInt(costEl.value, 10) || 0,
        hintLevel: parseInt(hintEl?.value, 10) || 0,
        required: !!requiredEl?.checked,
        baseCost: row.dataset.baseCost || '',
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
      if (fastLearnerToggle) fastLearnerToggle.checked = !!state.fastLearner;
      Object.entries(state.cfg || {}).forEach(([k, v]) => { if (cfg[k]) cfg[k].value = v; });
      if (Array.isArray(state.autoTargets) && state.autoTargets.length) {
        setAutoTargetSelections(state.autoTargets);
      } else {
        setAutoTargetSelections(null);
      }
      if (state.rating) {
        applyRatingState(state.rating);
        updateRatingDisplay();
      } else {
        updateRatingDisplay();
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
        const hintEl = row.querySelector('.hint-level');
        if (hintEl) hintEl.value = typeof r.hintLevel === 'number' && !isNaN(r.hintLevel) ? r.hintLevel : 0;
        const requiredEl = row.querySelector('.required-skill');
        if (requiredEl) {
          requiredEl.checked = !!r.required;
          row.classList.toggle('required', !!r.required);
        }
        if (r.baseCost) row.dataset.baseCost = r.baseCost; else delete row.dataset.baseCost;
        if (r.category) row.dataset.skillCategory = r.category;
        if (typeof row.syncSkillCategory === 'function') {
          row.syncSkillCategory({ triggerOptimize: false, allowLinking: false, updateCost: true });
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
      updateHintOptionLabels();
      refreshAllRowCosts();
      saveState();
      return true;
    } catch { return false; }
  }

  // events
  if (addRowBtn) addRowBtn.addEventListener('click', () => {
    const newRow = makeRow();
    rowsEl.appendChild(newRow);
    scrollRowIntoView(newRow);
    saveState();
  });

  if (optimizeBtn) optimizeBtn.addEventListener('click', () => {
    const budget = parseInt(budgetInput.value, 10); if (isNaN(budget) || budget < 0) { alert('Please enter a valid skill points budget.'); return; }
    const { items, rowsMeta } = collectItems(); if (!items.length) { alert('Add at least one skill with a valid cost.'); return; }
    const requiredSummary = expandRequired(items);
    if (requiredSummary.requiredCost > budget) {
      renderResults({ best: 0, chosen: [], used: 0, error: 'required_unreachable' }, budget);
      saveState();
      return;
    }
    const optionalItems = items.filter(it => !requiredSummary.requiredIds.has(it.id));
    const groups = buildGroups(optionalItems, rowsMeta);
    const result = optimizeGrouped(groups, optionalItems, budget - requiredSummary.requiredCost);
    const mergedResult = {
      ...result,
      chosen: requiredSummary.requiredItems.concat(result.chosen),
      used: result.used + requiredSummary.requiredCost,
      best: result.best + requiredSummary.requiredScore
    };
    renderResults(mergedResult, budget); saveState();
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
        const manual = window.prompt('Paste build string (Skill=Cost|H# per line):', '');
        if (!manual) return;
        payload = manual;
      }
      try {
        loadRowsFromString(payload);
        setAutoStatus('Build loaded from clipboard.');
      } catch (err) {
        console.error('Failed to load build', err);
        alert('Could not parse build string. Use lines like "Skill Name=120|H3".');
      }
    });
  }
  if (autoBuildBtn) autoBuildBtn.addEventListener('click', autoBuildIdealSkills);
  if (fastLearnerToggle) {
    fastLearnerToggle.addEventListener('change', () => {
      updateHintOptionLabels();
      refreshAllRowCosts();
      saveState();
      autoOptimizeDebounced();
    });
  }

  // CSV loader
  const csvFileInput = document.getElementById('csv-file');
  const loadCsvBtn = document.getElementById('load-csv');
  if (loadCsvBtn && csvFileInput) {
    loadCsvBtn.addEventListener('click', () => csvFileInput.click());
    csvFileInput.addEventListener('change', () => { const file = csvFileInput.files && csvFileInput.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { const ok = loadFromCSVContent(reader.result || ''); if (!ok) alert('CSV not recognized. Expected headers like: skill_type,name,base/base_value,S_A/B_C/D_E_F/G or apt_1..apt_4,affinity'); saveState(); }; reader.readAsText(file); });
  }

  function initRatingFloat() {
    const floatRoot = document.getElementById('rating-float');
    const ratingCard = document.getElementById('rating-card');
    if (!floatRoot || !ratingCard) return;
    const updateVisibility = () => {
      const rect = ratingCard.getBoundingClientRect();
      const shouldShow = rect.bottom < 0;
      floatRoot.classList.toggle('is-visible', shouldShow);
    };
    updateVisibility();
    window.addEventListener('scroll', updateVisibility, { passive: true });
    window.addEventListener('resize', updateVisibility);
  }

  function finishInit() {
    const had = loadState();
    if (!had) {
      rowsEl.appendChild(makeRow());
    }
    initRatingInputs();
    loadRatingSprite();
    initRatingFloat();
    updateAffinityStyles();
    updateHintOptionLabels();
    refreshAllRowCosts();
    ensureOneEmptyRow();
    autoOptimizeDebounced();
  }

  // Init: prefer CSV by default
  loadSkillCostsJSON()
    .catch(err => { console.warn('Skill cost JSON load failed', err); })
    .then(() => loadSkillsCSV())
    .then(() => finishInit())
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

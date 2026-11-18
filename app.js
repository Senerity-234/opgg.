(function () {
  let DATA = window.HEX_DATA;
  const SYN = window.HEX_SYNERGY;
  const ENG = window.HEX_ENGINE;
  if (!DATA || !SYN || !ENG) {
    document.body.innerHTML = "<h2 style='padding:40px;color:#f87171'>資料載入失敗，請確認 data.js、synergy.js 與 engine.js 位於同一目錄。</h2>";
    return;
  }

  const ROLE_ZH = { Mage: "法師", Fighter: "戰士", Assassin: "刺客", Marksman: "射手", Tank: "坦克", Support: "輔助" };
  const RARITY_ZH = { 8: "稜鏡", 4: "黃金", 1: "白銀" };
  const TIER_LABEL = { 0: "T0 OP", 1: "T1", 2: "T2", 3: "T3", 4: "T4", 5: "T5" };
  const PROFILE_ZH = { AP: "AP 法傷", AD: "AD 物理", CRIT: "暴擊輸出", ONHIT: "命中特效", TANK: "前排坦克", SUPPORT: "治療護盾輔助" };
  const DMG_TYPE_ZH = { PHYSICAL_DAMAGE: "物理傷害", MAGIC_DAMAGE: "魔法傷害", TRUE_DAMAGE: "真實傷害" };

  let champById = {};
  let champByKey = {};
  let augToChamps = {};

  function toArr(v) {
    return Array.isArray(v) ? v : (v !== null && v !== undefined && v !== "" ? [v] : []);
  }

  function rebuildDataIndexes(newData) {
    DATA = newData;
    champById = {};
    champByKey = {};
    DATA.champions = toArr(DATA.champions);
    DATA.champions.forEach(c => {
      c.roles = toArr(c.roles);
      c.augs = toArr(c.augs);
      c.core = toArr(c.core).map(cr => ({ ...cr, ids: toArr(cr.ids) }));
      c.boots = toArr(c.boots);
      c.starter = toArr(c.starter).map(st => ({ ...st, ids: toArr(st.ids) }));
      c.items = toArr(c.items);
      c.combos = toArr(c.combos).map(cb => ({ ...cb, augs: toArr(cb.augs) }));
      c.arch = toArr(c.arch).map(ar => ({ ...ar, tags: toArr(ar.tags), sit: toArr(ar.sit), cores: toArr(ar.cores).map(cr => ({ ...cr, ids: toArr(cr.ids) })) }));
      c.spells = toArr(c.spells);
      if (c.skills) c.skills.q = toArr(c.skills.q);
      champById[c.id] = c;
      champByKey[c.key] = c;
    });
    Object.values(DATA.items || {}).forEach(it => {
      it.tags = toArr(it.tags);
    });
    augToChamps = {};
    DATA.champions.forEach(c => {
      (c.augs || []).forEach(a => {
        const [aid, tier, perf, pop] = a;
        if (!augToChamps[aid]) augToChamps[aid] = [];
        augToChamps[aid].push({ champ: c, tier, perf, pop });
      });
    });
    Object.keys(augToChamps).forEach(aid => {
      augToChamps[aid].sort((x, y) => (x.tier - y.tier) || (y.perf - x.perf));
    });
    const pb = document.getElementById("patchBadge");
    if (pb && DATA.patch) pb.textContent = DATA.patch;
    const fp = document.getElementById("footerPatch");
    if (fp && DATA.patch) fp.textContent = DATA.patch;
    const fm = document.getElementById("footerSyncMeta");
    if (fm && DATA.generatedAt) fm.textContent = `· 最近同步：${DATA.generatedAt}`;
    if (DATA.patch) document.title = `LoL 海克斯大亂鬥全書 · Patch ${DATA.patch} | 局內選牌決策 × 傷害成長模擬 × 特化裝備攻略`;
  }

  rebuildDataIndexes(DATA);

  const state = {
    view: "champion",
    champSubTab: "decision", // "decision" | "build" | "all"
    selectedChampKey: "caitlyn",
    pinnedAugs: [1195, 1077],
    // Unified 4-Stage Augment Slots & Quick Decision Advisor State
    qLevel: 11,
    qPicks: { 1: 1195, 7: 1077, 11: 0, 15: 0 }, // Canonical 4-stage augment slots!
    qOptions: [1134, 1048, 1022], // 3 offered augment choices
    qQuickRarity: "ALL",
    qQuickSearch: "",
    // Damage & Growth Simulator State
    calcLevel: 16,
    calcCustomRanks: null, // null = auto by level
    calcItems: [3031, 3036, 6676, 2523, 3094, 3006],
    calcAugs: [1195, 1134, 1048], // 巨人殺手 + 拔劍吧(亮劍) + 寶石手套
    calcAugCfg: {}, // per-augment config: { [aid]: { skill: 'Q', val: 120 }, destinyItemId: 0 }
    calcTarget: { hp: 3000, curHpPct: 100, armor: 110, mr: 80, giantDiffPct: 20 },
    calcStacks: { evil: 80, heartsteel: 400, tankEngine: 5, infRec: 5, destiny: 12, duality: 6 },
    // Champion Explorer State
    pickerCollapsed: true,
    roleFilter: "ALL",
    tierFilter: "ALL",
    champSearch: "",
    augTierFilter: "ALL",
    augRarityFilter: "ALL",
    augSynergyOnly: false,
    augSort: "tier",
    augSearch: "",
    showSkills: false,
    activeArchIdx: 0,
    itemSearch: "",
    itemSort: "pr",
    // View 3 Encyclopedia
    encSelectedAugId: 1029,
    encSearch: "",
    encRarity: "ALL",
    encCat: "ALL",
    // View 5 Tier List
    tierSortCol: "rank",
    tierSortAsc: true,
    tierSearch: ""
  };

  const STAGES = [1, 7, 11, 15];

  function getLockedAugs() {
    return STAGES.map(lv => state.qPicks[lv]).filter(Boolean);
  }

  function syncPinnedFromPicks() {
    state.pinnedAugs = getLockedAugs();
  }

  function setAugSlotsFromList(ids) {
    const clean = (ids || []).map(Number).filter(id => {
      const m = DATA.augments[String(id)];
      return m && !ENG.isAugRetired(m);
    }).slice(0, 4);
    // Place early-only (Lv 1 / Lv 7) augments into the earliest slots automatically
    clean.sort((a, b) => Number(ENG.isEarlyOnlyAug(b)) - Number(ENG.isEarlyOnlyAug(a)));
    state.qPicks = { 1: 0, 7: 0, 11: 0, 15: 0 };
    clean.forEach((id, i) => { state.qPicks[STAGES[i]] = id; });
    const nextEmpty = STAGES.find(lv => !state.qPicks[lv]);
    state.qLevel = nextEmpty || 15;
    syncPinnedFromPicks();
  }

  function toggleAugInSlots(aid) {
    const id = Number(aid);
    const existingStage = STAGES.find(lv => state.qPicks[lv] === id);
    if (existingStage) {
      state.qPicks[existingStage] = 0;
    } else {
      const m = DATA.augments[String(id)];
      if (m && ENG.isAugRetired(m)) return;
      let targetStage;
      if (ENG.isEarlyOnlyAug(id)) {
        // Early-only augments can only roll at Lv 1 / Lv 7 -> prefer early slots first!
        if (!state.qPicks[1]) targetStage = 1;
        else if (!state.qPicks[7]) targetStage = 7;
        else targetStage = state.qLevel <= 7 ? state.qLevel : 7;
      } else {
        targetStage = !state.qPicks[state.qLevel]
          ? state.qLevel
          : (STAGES.find(lv => !state.qPicks[lv]) || state.qLevel);
      }
      state.qPicks[targetStage] = id;
    }
    syncPinnedFromPicks();
  }

  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function itemHtml(iid, extraClass = "", statObj = null) {
    const it = DATA.items[String(iid)];
    if (!it) return "";
    const wrStr = statObj && statObj.wr ? `${statObj.wr.toFixed(1)}%` : "";
    return `<span class="item-pill ${extraClass}" data-item-id="${iid}">
      <img src="${esc(it.img)}" alt="${esc(it.name)}" loading="lazy" />
      <span>${esc(it.name)}</span>
      ${wrStr ? `<span class="mono" style="color:${statObj.wr >= 53 ? "var(--green)" : "var(--text-muted)"}">${wrStr}</span>` : ""}
    </span>`;
  }

  function getChampObj() {
    return champByKey[state.selectedChampKey] || DATA.champions[0];
  }

  function renderCurrentView() {
    if (state.view === "champion" || state.view === "quick") { renderChampionGrid(); renderChampionDetail(); }
    else if (state.view === "calc") renderSimulatorCalc();
    else if (state.view === "augments") renderAugmentEncyclopedia();
    else if (state.view === "cheatsheet") renderCheatSheet();
    else if (state.view === "tierlist") renderTierList();
  }

  function switchView(viewName) {
    if (viewName === "quick") {
      viewName = "champion";
      state.champSubTab = "decision";
    }
    state.view = viewName;
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === viewName));
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + viewName));
    renderCurrentView();
  }

  document.getElementById("mainNav").addEventListener("click", (e) => {
    const btn = e.target.closest(".nav-btn");
    if (btn) switchView(btn.dataset.view);
  });

  // Global Search
  const gsInput = document.getElementById("globalSearchInput");
  const gsDrop = document.getElementById("globalSearchDropdown");
  gsInput.addEventListener("input", () => {
    const q = gsInput.value.trim().toLowerCase();
    if (!q) { gsDrop.classList.add("hidden"); return; }
    const cMatches = DATA.champions.filter(c =>
      c.name.toLowerCase().includes(q) || c.key.toLowerCase().includes(q) || (c.title && c.title.toLowerCase().includes(q))
    ).slice(0, 6);
    const aMatches = Object.values(DATA.augments).filter(a =>
      a.name.toLowerCase().includes(q) || (a.key && a.key.toLowerCase().includes(q)) || (a.desc && a.desc.toLowerCase().includes(q))
    ).sort((a, b) => (a.gTier - b.gTier) || (b.gPerf - a.gPerf)).slice(0, 8);

    let html = "";
    if (cMatches.length) {
      html += `<div style="padding:6px 12px;font-size:11px;color:var(--gold);background:var(--bg-card)">英雄 (${cMatches.length})</div>`;
      cMatches.forEach(c => {
        html += `<div class="search-item" data-jump-champ="${esc(c.key)}">
          <img src="${esc(c.img)}" alt="" />
          <div><b>${esc(c.name)}</b> <span class="muted" style="font-size:11px">${esc(c.title)}</span></div>
          <span class="search-item-meta"><span class="t-badge t-${c.tier}">${TIER_LABEL[c.tier]}</span> ${c.wr}%</span>
        </div>`;
      });
    }
    if (aMatches.length) {
      html += `<div style="padding:6px 12px;font-size:11px;color:var(--teal);background:var(--bg-card)">海克斯強化符文 (${aMatches.length})</div>`;
      aMatches.sort((a, b) => Number(ENG.isAugRetired(a)) - Number(ENG.isAugRetired(b))).forEach(a => {
        const ret = ENG.isAugRetired(a);
        const synBadge = (!ret && SYN.RULES[a.id]) ? `<span style="color:var(--teal)">⚡有特化裝備</span>` : "";
        const retBadge = ret ? `<span class="chip" style="padding:0 5px;font-size:10px">非本賽季</span>` : "";
        html += `<div class="search-item ${ret ? "aug-retired" : ""}" ${ret ? "" : `data-jump-aug="${a.id}"`}>
          <img src="${esc(a.img)}" alt="" style="background:#000" />
          <div><b>${esc(a.name)}</b> <span class="muted" style="font-size:11px">${RARITY_ZH[a.rarity] || ""}</span> ${synBadge} ${retBadge}</div>
          <span class="search-item-meta">${ret ? "已移除" : `<span class="t-badge t-${a.gTier}">${TIER_LABEL[a.gTier]}</span>`}</span>
        </div>`;
      });
    }
    if (!html) html = `<div style="padding:14px;text-align:center;color:var(--text-muted)">找不到符合「${esc(q)}」的英雄或海克斯</div>`;
    gsDrop.innerHTML = html;
    gsDrop.classList.remove("hidden");
  });

  gsDrop.addEventListener("click", (e) => {
    const jc = e.target.closest("[data-jump-champ]");
    if (jc) {
      selectChampion(jc.dataset.jumpChamp, null);
      gsDrop.classList.add("hidden");
      gsInput.value = "";
      renderCurrentView();
      return;
    }
    const ja = e.target.closest("[data-jump-aug]");
    if (ja) {
      state.encSelectedAugId = Number(ja.dataset.jumpAug);
      gsDrop.classList.add("hidden");
      gsInput.value = "";
      switchView("augments");
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".global-search-wrap")) gsDrop.classList.add("hidden");
  });

  // Floating Item Tooltip
  const tooltipEl = document.getElementById("floatingTooltip");
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest("[data-item-id]");
    if (!el) return;
    const it = DATA.items[String(el.dataset.itemId)];
    if (!it) return;
    const tagsStr = (it.tags || []).slice(0, 5).join(" · ");
    tooltipEl.innerHTML = `
      <div class="ft-head">
        <img src="${esc(it.img)}" alt="" />
        <div>
          <div class="ft-title">${esc(it.name)}</div>
          <div class="ft-gold">${it.gold ? it.gold + " 金幣" : ""} ${tagsStr ? "· " + esc(tagsStr) : ""}</div>
        </div>
      </div>
      <div class="ft-desc">${esc(it.desc || it.plain || "無詳細說明")}</div>
    `;
    tooltipEl.classList.remove("hidden");
    positionTooltip(e);
  });
  document.addEventListener("mousemove", (e) => {
    if (!tooltipEl.classList.contains("hidden")) positionTooltip(e);
  });
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest("[data-item-id]")) tooltipEl.classList.add("hidden");
  });
  function positionTooltip(e) {
    const pad = 14;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    const rect = tooltipEl.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - 10) x = e.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 10) y = e.clientY - rect.height - pad;
    tooltipEl.style.left = Math.max(8, x) + "px";
    tooltipEl.style.top = Math.max(8, y) + "px";
  }

  // Reusable Searchable Picker Modal (for Champions, Augments, or Items)
  function openPickerModal({ title, placeholder, entries, filters = null, onPick }) {
    let activeFilter = filters && filters[0] ? filters[0].value : "ALL";
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-head">
          <b style="color:var(--gold-bright);font-size:15px">${esc(title)}</b>
          <input id="modalSearchInp" type="search" class="input-sm" placeholder="${esc(placeholder)}" style="flex:1;max-width:300px" />
          <button id="modalCloseBtn" class="btn-ghost">關閉 ✕</button>
        </div>
        ${filters ? `
          <div style="padding:8px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;background:var(--bg-card)">
            <div class="pill-group" id="modalFilterPills">
              ${filters.map(f => `<button class="pill ${f.value === activeFilter ? "active" : ""}" data-mf="${esc(f.value)}">${esc(f.label)}</button>`).join("")}
            </div>
            <span id="modalCountLbl" class="muted" style="font-size:11.5px"></span>
          </div>
        ` : ""}
        <div id="modalListBody" class="modal-body"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const inp = overlay.querySelector("#modalSearchInp");
    const body = overlay.querySelector("#modalListBody");
    const countLbl = overlay.querySelector("#modalCountLbl");

    function renderRows(q) {
      const lq = q.trim().toLowerCase();
      const matched = entries.filter(en => {
        if (filters && activeFilter !== "ALL" && String(en.filterKey) !== activeFilter) return false;
        if (lq && !en.searchText.includes(lq)) return false;
        return true;
      });
      if (countLbl) countLbl.textContent = `顯示 ${matched.length} 個海克斯`;
      const shown = filters ? matched : matched.slice(0, 80);
      body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(195px,1fr));gap:7px">
        ${shown.map(en => `
          <div class="combo-row ${en.cardClass || ""} ${en.disabled ? "aug-retired" : ""}" style="margin:0;padding:7px 9px" ${en.disabled ? "" : `data-pick-val="${esc(en.value)}"`}>
            <div style="display:flex;align-items:center;gap:8px;min-width:0">
              ${en.img ? `<img src="${esc(en.img)}" style="width:30px;height:30px;border-radius:6px;background:#000;flex-shrink:0" />` : ""}
              <div style="min-width:0">
                <div style="font-weight:700;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--gold-bright)">${esc(en.label)}</div>
                ${en.sub ? `<div style="font-size:11px;color:var(--text-muted)">${en.sub}</div>` : ""}
              </div>
            </div>
          </div>
        `).join("") || `<div class="muted">無符合項目</div>`}
      </div>`;
      body.querySelectorAll("[data-pick-val]").forEach(row => {
        row.onclick = () => {
          onPick(row.dataset.pickVal);
          overlay.remove();
        };
      });
    }

    renderRows("");
    inp.focus();
    inp.oninput = () => renderRows(inp.value);
    const fp = overlay.querySelector("#modalFilterPills");
    if (fp) {
      fp.onclick = (e) => {
        const b = e.target.closest("[data-mf]");
        if (!b) return;
        activeFilter = b.dataset.mf;
        fp.querySelectorAll(".pill").forEach(x => x.classList.toggle("active", x === b));
        renderRows(inp.value);
      };
    }
    overlay.querySelector("#modalCloseBtn").onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  }

  function openChampModal(onSelectChamp) {
    const entries = DATA.champions.slice().sort((a, b) => a.rank - b.rank).map(c => ({
      value: c.key,
      label: c.name,
      sub: `#${c.rank} · ${TIER_LABEL[c.tier]} · ${c.wr.toFixed(1)}%`,
      img: c.img,
      searchText: `${c.name} ${c.key} ${c.title || ""}`.toLowerCase()
    }));
    openPickerModal({ title: "選擇英雄 (173 位)", placeholder: "輸入中文名 / 英文 / 稱號...", entries, onPick: onSelectChamp });
  }

  function openAugModal(champ, title, onSelectAug, opts = {}) {
    const onlyEligible = !!opts.onlyEligible;
    const levelStage = opts.levelStage || 0;
    const excludeSet = new Set((opts.excludeIds || []).filter(Boolean).map(Number));
    const augLookup = {};
    (champ.augs || []).forEach(a => { augLookup[a[0]] = a; });
    const entries = Object.values(DATA.augments)
      .filter(a => {
        if (excludeSet.has(a.id)) return false;
        if (onlyEligible) {
          return !ENG.isAugRetired(a) && !!augLookup[a.id];
        }
        return true;
      })
      .map(a => {
        const retired = ENG.isAugRetired(a);
        const earlyOnly = ENG.isEarlyOnlyAug(a.id);
        const stageBlocked = levelStage >= 11 && earlyOnly;
        const st = augLookup[a.id];
        const eligible = !retired && !!st;
        const wr = champ.augWr && champ.augWr[String(a.id)] ? champ.augWr[String(a.id)][0] : null;
        const tier = st ? st[1] : a.gTier;
        const disabled = retired || stageBlocked;
        return {
          value: String(a.id),
          label: a.name,
          filterKey: String(a.rarity),
          cardClass: "rar-" + a.rarity,
          disabled,
          sub: retired
            ? `<span class="chip" style="padding:0 4px;font-size:10px">非本賽季/不可選</span>`
            : (stageBlocked
              ? `<span class="chip" style="padding:0 4px;font-size:10px;color:var(--muted)">🚫 限前兩輪 (Lv 1/7)</span>`
              : `<span class="t-badge rar-tag-${a.rarity}" style="padding:0 4px;font-size:10px">${RARITY_ZH[a.rarity] || ""}</span> ${TIER_LABEL[tier]}${wr ? ` · ${wr.toFixed(1)}%勝` : ""}${earlyOnly ? " ⏳前兩輪限定" : ""}${SYN.RULES[a.id] ? " ⚡" : ""}${!eligible ? " (非本英雄池)" : ""}`),
          img: a.img,
          sortKey: (retired ? 1000000 : 0) + (stageBlocked ? 500000 : 0) + (st && st[3] > 0 ? 0 : 50000) + tier * 1000 - (wr || a.gPerf || 0),
          searchText: `${a.name} ${a.key || ""} ${a.desc || ""}`.toLowerCase()
        };
      }).sort((a, b) => a.sortKey - b.sortKey);
    const filters = [
      { label: "全部品質", value: "ALL" },
      { label: "🌈 稜鏡", value: "8" },
      { label: "🥇 黃金", value: "4" },
      { label: "🥈 白銀", value: "1" }
    ];
    openPickerModal({ title, placeholder: "輸入海克斯名稱或關鍵字 (如: 幻影、寶石、亮劍/拔劍)...", entries, filters, onPick: (v) => onSelectAug(Number(v)) });
  }

  function openItemModal(champ, title, onSelectItem) {
    const champItMap = {};
    (champ.items || []).forEach(it => { champItMap[it.id] = it; });
    const entries = Object.values(DATA.items).filter(it => (it.gold || 0) >= 900 || (it.tags || []).includes("Boots")).map(it => {
      const st = champItMap[it.id];
      return {
        value: String(it.id),
        label: it.name,
        sub: `${it.gold || 0}G${st ? ` · ${st.wr.toFixed(1)}%勝 (${st.pr.toFixed(1)}%選)` : ""}`,
        img: it.img,
        sortKey: st ? -st.pr - 100 : -(it.gold || 0) / 1000,
        searchText: `${it.name} ${it.plain || ""} ${it.desc || ""}`.toLowerCase()
      };
    }).sort((a, b) => a.sortKey - b.sortKey);
    openPickerModal({ title, placeholder: "輸入裝備名稱或屬性 (如: 無盡、多明尼克、巫妖、心鋼)...", entries, onPick: (v) => onSelectItem(Number(v)) });
  }

  // =========================================================================
  // UNIFIED DECISION + BUILD CONTEXT & LISTENERS
  // =========================================================================
  function buildDecisionContext(c) {
    const stageIdx = STAGES.indexOf(state.qLevel);
    const prevLevels = STAGES.slice(0, Math.max(0, stageIdx));
    const activePrev = prevLevels.map(lv => state.qPicks[lv]).filter(Boolean);
    const allLockedAugs = getLockedAugs();

    const evals = ENG.evaluateQuickChoices(c, state.qLevel, activePrev, state.qOptions, DATA);
    const winner = evals[0];
    const nextLv = stageIdx < STAGES.length - 1 ? STAGES[stageIdx + 1] : null;

    const stageDefs = [
      { lv: 1, title: "Lv 1", sub: "第 1 輪" },
      { lv: 7, title: "Lv 7", sub: "第 2 輪" },
      { lv: 11, title: "Lv 11", sub: "第 3 輪" },
      { lv: 15, title: "Lv 15", sub: "第 4 輪" }
    ];

    const timelineHtml = `
      <div class="timeline-track">
        ${stageDefs.map(s => {
          const aid = state.qPicks[s.lv];
          const m = aid ? DATA.augments[String(aid)] : null;
          const isCur = state.qLevel === s.lv;
          return `
            <div class="stage-node ${isCur ? "current" : ""} ${m ? "locked rar-" + m.rarity : ""}" data-q-lv="${s.lv}">
              <div class="stage-node-head">
                <b style="color:${isCur ? "var(--teal)" : "var(--gold-bright)"}">${s.title} · ${s.sub}</b>
                <div style="display:flex;gap:4px;align-items:center">
                  ${isCur ? `<span class="chip" style="padding:0 6px;font-size:10px;border-color:var(--teal);color:var(--teal)">當前輪次</span>` : ""}
                  <button class="btn-ghost" data-edit-stage="${s.lv}" title="選擇或修改此階段海克斯" style="padding:0 5px;font-size:10px">${m ? "改" : "填"}</button>
                  ${m ? `<button class="btn-ghost" data-clear-stage="${s.lv}" title="清除此階段紀錄" style="padding:0 5px;font-size:10px">×</button>` : ""}
                </div>
              </div>
              <div class="stage-node-body">
                ${m ? `
                  <img src="${esc(m.img)}" alt="" />
                  <div style="min-width:0">
                    <div style="font-weight:700;font-size:12.5px;color:var(--gold-bright);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.name)}</div>
                    <div style="font-size:10.5px;color:var(--text-muted)">${RARITY_ZH[m.rarity] || ""} · ${SYN.RULES[aid] ? "⚡特化" : "已鎖定"}</div>
                  </div>
                ` : `<div class="muted" style="font-size:11.5px">${isCur ? "選牌中／點「填」或下方圖鑑加入" : (s.lv < state.qLevel ? "點「填」補選此輪" : "待前置完成")}</div>`}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;

    const prevCarryBar = prevLevels.length === 0
      ? `<span class="muted" style="font-size:12px">Lv 1 開局無前置海克斯，將優先評估全場成長潛力；選完後會自動紀錄並跳轉至 Lv 7！</span>`
      : `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:12px;color:var(--teal);font-weight:700">🔗 已自動帶入前置海克斯連動：</span>
          ${activePrev.length
            ? activePrev.map(aid => {
                const m = DATA.augments[String(aid)];
                return m ? `<span class="combo-aug-pill rar-${m.rarity}"><img src="${esc(m.img)}" /><b>${esc(m.name)}</b></span>` : "";
              }).join("")
            : `<span class="muted" style="font-size:12px">尚未鎖定前置階段（可點擊上方 Lv 卡片補填，或直接選擇本輪海克斯）</span>`}
        </div>`;

    const optSlotsHtml = [0, 1, 2].map(idx => {
      const aid = state.qOptions[idx];
      const m = aid ? DATA.augments[String(aid)] : null;
      return `
        <div class="pick-slot-card ${m ? "filled rar-" + m.rarity : ""}" data-pick-opt="${idx}">
          <div style="font-size:11px;color:var(--gold);margin-bottom:4px;font-weight:700">場上選項 ${["A", "B", "C"][idx]}</div>
          ${m ? `
            <div style="display:flex;align-items:center;gap:8px">
              <img src="${esc(m.img)}" style="width:34px;height:34px;border-radius:6px;background:#000" />
              <div style="min-width:0;flex:1">
                <div style="font-weight:700;font-size:13.5px;color:var(--gold-bright);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.name)}</div>
                <div style="font-size:11px;color:var(--text-muted)">${RARITY_ZH[m.rarity] || ""}</div>
              </div>
              <button class="btn-ghost" data-clear-opt="${idx}" style="padding:2px 6px">×</button>
            </div>
          ` : `<div style="color:var(--teal);font-size:12.5px;font-weight:600">+ 點擊選入選項 ${["A", "B", "C"][idx]}</div>`}
        </div>
      `;
    }).join("");

    const lockedAndOptSet = new Set([...allLockedAugs, ...state.qOptions.filter(Boolean)].map(Number));
    const topAugsForChamp = (c.augs || [])
      .filter(a => a[3] > 0 && !lockedAndOptSet.has(a[0]))
      .map(a => DATA.augments[String(a[0])])
      .filter(a => a && !ENG.isAugRetired(a) && ENG.isAugAvailableAtStage(a, state.qLevel) && (state.qQuickRarity === "ALL" || String(a.rarity) === state.qQuickRarity));

    const resultsHtml = evals.map((ev, rankIdx) => {
      const isWinner = rankIdx === 0;
      const synGuide = SYN.getAugmentGuide(c, ev.id, DATA);
      const bestRoute = synGuide && synGuide.routes[0] ? synGuide.routes[0] : null;
      const ctaText = nextLv
        ? `✓ 選「${ev.meta.name}」並進入 Lv ${nextLv} →`
        : `✓ 鎖定「${ev.meta.name}」（完成 4 輪）`;
      return `
        <div class="decision-card ${isWinner ? "winner" : ""} rar-${ev.meta.rarity} ${ev.unavailableAtStage ? "aug-retired" : ""}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
            ${ev.unavailableAtStage
              ? `<span class="chip" style="border-color:var(--red);color:#fca5a5">🚫 後兩輪正常抽選不會出現</span>`
              : (isWinner ? `<div class="winner-ribbon">👑 最高綜合勝率推薦 · 首選</div>` : `<div class="chip">第 ${rankIdx + 1} 順位選擇</div>`)}
            <div style="display:flex;gap:4px;align-items:center">
              ${ev.isEarlyOnly ? `<span class="t-badge" style="background:rgba(245,158,11,.18);color:var(--gold-bright);border:1px solid rgba(245,158,11,.4)">⏳ 限前兩輪</span>` : ""}
              ${state.qPicks[state.qLevel] === ev.id ? `<span class="chip" style="border-color:var(--green);color:var(--green)">✓ 本輪已選</span>` : ""}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <img src="${esc(ev.meta.img)}" style="width:46px;height:46px;border-radius:8px;background:#000" />
            <div style="flex:1;min-width:0">
              <div style="font-size:17px;font-weight:800;color:var(--gold-bright)">${esc(ev.meta.name)}</div>
              <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:2px">
                <span class="t-badge t-${ev.base.tier}">${TIER_LABEL[ev.base.tier]}</span>
                <span class="t-badge rar-tag-${ev.meta.rarity}">${RARITY_ZH[ev.meta.rarity] || ""}</span>
                <span class="muted mono" style="font-size:11px">表現 ${ev.base.perf}</span>
              </div>
            </div>
            <div style="text-align:right">
              <div class="wr-big mono" style="color:${isWinner ? "var(--teal)" : "var(--gold-bright)"}">${ev.finalScore.toFixed(1)}%</div>
              <div class="muted" style="font-size:11px">預測勝率</div>
            </div>
          </div>

          <div style="font-size:12px;color:var(--text-muted)">${esc(ev.meta.desc)}</div>

          <div class="wr-breakdown">
            <div class="wr-b-row">
              <span class="muted">${ev.base.hasRealSample ? `實戰樣本基礎 (${ev.base.realWr.toFixed(1)}%)` : "OP.GG 階級基準勝率"}</span>
              <b class="mono">${ev.base.baseWr.toFixed(1)}%</b>
            </div>
            <div class="wr-b-row">
              <span class="muted">Lv ${state.qLevel} 階段成長修正</span>
              <b class="mono" style="color:${ev.stageAdj >= 0 ? "var(--green)" : "var(--red)"}">${ev.stageAdj >= 0 ? "+" : ""}${ev.stageAdj.toFixed(1)}%</b>
            </div>
            <div class="wr-b-row">
              <span class="muted">前置海克斯連動加權</span>
              <b class="mono" style="color:${ev.synAdj > 0 ? "var(--teal)" : (ev.synAdj < 0 ? "var(--red)" : "var(--text-muted)")}">${ev.synAdj >= 0 ? "+" : ""}${ev.synAdj.toFixed(1)}%</b>
            </div>
          </div>

          <div style="font-size:12px;display:flex;flex-direction:column;gap:4px">
            ${ev.stageNotes.map(n => `<div>• ${esc(n)}</div>`).join("")}
            ${ev.synReasons.map(r => `<div style="color:${r.includes("⚠️") ? "#fca5a5" : "var(--teal)"}">${esc(r)}</div>`).join("")}
          </div>

          ${bestRoute ? `
            <div style="padding-top:8px;border-top:1px solid rgba(38,53,84,0.6)">
              <div style="font-size:11.5px;font-weight:700;color:var(--gold);margin-bottom:5px">🛠️ 選完後必出特化裝備 (${esc(bestRoute.name)})：</div>
              <div style="display:flex;flex-wrap:wrap;gap:5px">${bestRoute.items.slice(0, 4).map(it => itemHtml(it.id)).join("")}</div>
            </div>
          ` : ""}

          <div style="margin-top:auto;padding-top:6px">
            <button class="btn-pick-advance" data-commit-pick="${ev.id}">${esc(ctaText)}</button>
          </div>
        </div>
      `;
    }).join("");

    const previewAnchorAugs = [...new Set([...activePrev, ...(winner && !winner.unavailableAtStage ? [winner.id] : [])])];
    const nextStageFloor = state.qLevel === 1 ? 7 : 11;
    const nextRecs = state.qLevel < 15 ? ENG.recommendNextAugments(c, nextStageFloor, previewAnchorAugs, DATA) : [];
    const nextRecsHtml = nextRecs.length ? `
      <div class="panel" style="border-color:rgba(56,189,248,0.35)">
        <div class="panel-header" style="margin-bottom:8px">
          <h3>🔮 ${state.qLevel === 1 ? "下一輪起（Lv 7 / 11 / 15）推薦可搭配海克斯" : "後續輪次（Lv 11 / Lv 15）還抽得到的推薦搭配"}</h3>
          <span class="muted" style="font-size:12px">${state.qLevel >= 7 ? "已自動過濾「限前兩輪（心鋼起來／法帽／極度邪惡等）」後兩輪抽不到的海克斯" : "標註 ⏳ 者為限前兩輪海克斯，想配成套須把握 Lv 7 前鎖定"}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px">
          ${nextRecs.map(rc => `
            <div class="combo-row rar-${rc.meta.rarity}" style="margin:0;cursor:default">
              <div style="display:flex;align-items:center;gap:8px;min-width:0">
                <img src="${esc(rc.meta.img)}" style="width:32px;height:32px;border-radius:6px;background:#000;flex-shrink:0" />
                <div style="min-width:0">
                  <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
                    <b style="font-size:13px;color:var(--gold-bright)">${esc(rc.meta.name)}</b>
                    ${rc.isEarly ? `<span class="t-badge" style="font-size:10px;padding:0 5px;background:rgba(245,158,11,.18);color:var(--gold-bright)">⏳ 限Lv7前</span>` : ""}
                  </div>
                  <div style="font-size:11px;color:${rc.synScore > 0 ? "var(--teal)" : "var(--text-muted)"}">${esc(rc.reason)}</div>
                </div>
              </div>
              <div style="text-align:right;white-space:nowrap">
                <span class="t-badge t-${rc.tier}" style="font-size:10px">${TIER_LABEL[rc.tier]}</span>
                ${rc.wr ? `<div class="mono" style="font-size:11px;color:var(--green);margin-top:2px">${rc.wr.toFixed(1)}%</div>` : ""}
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    ` : "";

    const decisionHtml = `
      <div class="panel">
        <div class="panel-header" style="margin-bottom:8px">
          <h3>🎯 正在進行 <span style="color:var(--teal)">Lv ${state.qLevel}</span> 三選一決策</h3>
          <div style="display:flex;gap:6px">
            <button id="qClearOptsBtn" class="btn-ghost">清空選項 A/B/C</button>
          </div>
        </div>

        <div style="background:rgba(7,11,20,0.5);border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:12px">
          ${prevCarryBar}
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px">
          <span class="muted" style="font-size:12px">點選下方 A / B / C 欄位（${state.qLevel >= 11 ? `已自動標灰並停用「限前兩輪」與無資格海克斯` : `僅顯示 ${esc(c.name)} 本賽季可選海克斯`}）或右側快捷填入：</span>
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
            <div class="pill-group">
              ${[["ALL","全部"],["8","🌈 稜鏡"],["4","🥇 黃金"],["1","🥈 白銀"]].map(([v,l]) => `<button class="pill ${state.qQuickRarity===v?"active":""}" data-qrar="${v}" style="padding:2px 7px;font-size:11px">${l}</button>`).join("")}
            </div>
            ${topAugsForChamp.slice(0, 6).map(a => `<button class="pill rar-${a.rarity}" data-qfill="${a.id}" style="padding:2px 8px;font-size:11px">+ ${esc(a.name)}</button>`).join("")}
          </div>
        </div>
        ${optSlotsHtml}
      </div>

      ${evals.length ? `
        <div class="panel">
          <div class="panel-header">
            <h3>🏆 Lv ${state.qLevel} 勝率分析：建議選 <span style="color:var(--teal)">【${esc(winner.meta.name)}】</span>（預測 ${winner.finalScore.toFixed(1)}%）</h3>
            <span class="muted" style="font-size:12px">點擊「選這張並進入下一等級」將自動記錄至上方進度軌並同步下方特化配裝！</span>
          </div>
          <div class="decision-cards">${resultsHtml}</div>
        </div>
      ` : `<div class="panel muted" style="text-align:center;padding:24px">請從上方點選本輪場上的 3 個海克斯選項（A / B / C）以立即分析勝率與連動</div>`}
      ${nextRecsHtml}
    `;

    const liveAugsUsed = allLockedAugs.length ? allLockedAugs : (winner ? [winner.id] : []);
    return { activePrev, allLockedAugs, evals, winner, nextLv, timelineHtml, decisionHtml, liveAugsUsed };
  }

  function attachUnifiedStageListeners(det, c, ctx) {
    const resetBtn = det.querySelector("#qResetRunBtn");
    if (resetBtn) resetBtn.onclick = () => {
      state.qLevel = 1;
      state.qPicks = { 1: 0, 7: 0, 11: 0, 15: 0 };
      syncPinnedFromPicks();
      const top3 = (c.augs || []).filter(a => a[3] > 0 && !ENG.isAugRetired(DATA.augments[String(a[0])])).slice(0, 3).map(a => a[0]);
      state.qOptions = top3.length === 3 ? top3 : [0, 0, 0];
      renderChampionDetail();
    };

    const clrOptsBtn = det.querySelector("#qClearOptsBtn");
    if (clrOptsBtn) clrOptsBtn.onclick = () => { state.qOptions = [0, 0, 0]; renderChampionDetail(); };

    det.querySelectorAll("[data-q-lv]").forEach(el => {
      el.onclick = (e) => {
        if (e.target.closest("[data-edit-stage]") || e.target.closest("[data-clear-stage]")) return;
        state.qLevel = Number(el.dataset.qLv);
        renderChampionDetail();
      };
    });
    det.querySelectorAll("[data-edit-stage]").forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const lv = Number(btn.dataset.editStage);
        const excludeIds = STAGES.filter(s => s !== lv).map(s => state.qPicks[s]).filter(Boolean);
        openAugModal(c, `設定 Lv ${lv} 海克斯 (僅顯示 ${c.name} 本輪可選)`, (aid) => {
          STAGES.forEach(s => { if (state.qPicks[s] === aid) state.qPicks[s] = 0; });
          state.qPicks[lv] = aid;
          syncPinnedFromPicks();
          renderChampionDetail();
        }, { onlyEligible: true, levelStage: lv, excludeIds });
      };
    });
    det.querySelectorAll("[data-clear-stage]").forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        state.qPicks[Number(btn.dataset.clearStage)] = 0;
        syncPinnedFromPicks();
        renderChampionDetail();
      };
    });

    det.querySelectorAll("[data-pick-opt]").forEach(el => {
      el.onclick = (e) => {
        if (e.target.closest("[data-clear-opt]")) return;
        const idx = Number(el.dataset.pickOpt);
        const excludeIds = [...getLockedAugs(), ...state.qOptions.filter((id, i) => i !== idx && id)];
        openAugModal(c, `選擇 Lv ${state.qLevel} 選項 ${["A", "B", "C"][idx]} (僅顯示 ${c.name} 本輪可選)`, (aid) => {
          state.qOptions[idx] = aid;
          renderChampionDetail();
        }, { onlyEligible: true, levelStage: state.qLevel, excludeIds });
      };
    });
    det.querySelectorAll("[data-clear-opt]").forEach(btn => {
      btn.onclick = (e) => { e.stopPropagation(); state.qOptions[Number(btn.dataset.clearOpt)] = 0; renderChampionDetail(); };
    });
    det.querySelectorAll("[data-qrar]").forEach(btn => {
      btn.onclick = () => { state.qQuickRarity = btn.dataset.qrar; renderChampionDetail(); };
    });
    det.querySelectorAll("[data-qfill]").forEach(btn => {
      btn.onclick = () => {
        const aid = Number(btn.dataset.qfill);
        if (state.qOptions.includes(aid)) return;
        const emptyIdx = state.qOptions.findIndex(x => !x);
        if (emptyIdx >= 0) state.qOptions[emptyIdx] = aid;
        else state.qOptions = [state.qOptions[1], state.qOptions[2], aid];
        renderChampionDetail();
      };
    });

    det.querySelectorAll("[data-commit-pick]").forEach(btn => {
      btn.onclick = () => {
        const chosenId = Number(btn.dataset.commitPick);
        STAGES.forEach(s => { if (state.qPicks[s] === chosenId) state.qPicks[s] = 0; });
        state.qPicks[state.qLevel] = chosenId;
        syncPinnedFromPicks();
        if (ctx.nextLv) {
          state.qLevel = ctx.nextLv;
          state.qOptions = [0, 0, 0];
        }
        renderChampionDetail();
      };
    });

    const dCait = det.querySelector("#qDemoCaitBtn");
    if (dCait) dCait.onclick = () => {
      selectChampion("caitlyn", null);
      state.qLevel = 11;
      state.qPicks = { 1: 1195, 7: 1077, 11: 0, 15: 0 };
      syncPinnedFromPicks();
      state.qOptions = [1134, 1048, 1022];
      renderChampionGrid();
      renderChampionDetail();
    };
    const dEkko = det.querySelector("#qDemoEkkoBtn");
    if (dEkko) dEkko.onclick = () => {
      selectChampion("ekko", null);
      state.qLevel = 15;
      state.qPicks = { 1: 1029, 7: 1030, 11: 3078, 15: 0 };
      syncPinnedFromPicks();
      state.qOptions = [1156, 1390, 1048];
      renderChampionGrid();
      renderChampionDetail();
    };
  }

  // =========================================================================
  // VIEW 1: HERO GROWTH & DAMAGE SIMULATOR
  // =========================================================================
  function renderSimulatorCalc() {
    const view = document.getElementById("view-calc");
    const c = getChampObj();
    const sim = ENG.simulateBuild(c, state.calcLevel, state.calcCustomRanks, state.calcItems, state.calcAugs, state.calcTarget, state.calcStacks, state.calcAugCfg, DATA);
    const curve = ENG.computeGrowthCurve(c, state.calcItems, state.calcAugs, state.calcTarget, state.calcStacks, state.calcAugCfg, DATA);
    const st = sim.stats;

    const itemSlotsHtml = [0, 1, 2, 3, 4, 5].map(idx => {
      const iid = state.calcItems[idx];
      const it = iid ? DATA.items[String(iid)] : null;
      return `
        <div class="item-slot-box ${it ? "filled" : ""}" data-calc-item-slot="${idx}" ${it ? `data-item-id="${iid}"` : ""}>
          ${it ? `
            <button class="rm-x" data-calc-rm-item="${idx}">×</button>
            <img src="${esc(it.img)}" alt="" />
            <div style="font-size:11px;font-weight:700;color:var(--gold-bright);line-height:1.2">${esc(it.name)}</div>
          ` : `<span class="muted" style="font-size:11px">+ 裝備 ${idx + 1}</span>`}
        </div>
      `;
    }).join("");

    const quickAugIds = [1134, 1048, 3123, 1195, 1029, 1129, 3081, 1103, 2100, 3060, 1041, 1030, 1007, 1047, 3018, 1084, 1325, 1004, 1389, 1415];
    const selectedAugsHtml = state.calcAugs.map(aid => {
      const m = DATA.augments[String(aid)];
      if (!m) return "";
      return `
        <span class="combo-aug-pill rar-${m.rarity}" style="padding:4px 8px">
          <img src="${esc(m.img)}" alt="" />
          <b>${esc(m.name)}</b>
          <button class="btn-ghost" data-calc-rm-aug="${aid}" style="padding:0 5px;margin-left:4px">×</button>
        </span>
      `;
    }).join("");

    // Dynamic Sub-Controls for Skill-Targeted "?" Augments (寶石手鍊/土司/疾速追擊/追求力量/一片歌手/強化!)
    const activeSkillAugs = state.calcAugs.filter(aid => !!ENG.SKILL_TARGET_AUGS[aid]);
    const skillSubHtml = activeSkillAugs.map(aid => {
      const def = ENG.SKILL_TARGET_AUGS[aid];
      const cur = state.calcAugCfg[aid] || {};
      const curSkill = cur.skill || def.defaultSkill;
      const curVal = cur.val !== undefined ? cur.val : (def.defaultVal || 0);
      return `
        <div class="sim-sub-row">
          <div>
            <b style="color:var(--teal)">${esc(def.name)}</b>
            <span class="muted" style="font-size:11px;margin-left:4px">${esc(def.desc)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <div class="pill-group">
              ${def.allowed.map(sk => `<button class="pill ${curSkill === sk ? "active" : ""}" data-aug-skill="${aid}:${sk}" style="padding:2px 8px;font-size:11px">${sk}</button>`).join("")}
            </div>
            ${def.hasLevelSlider ? `
              <label style="display:flex;align-items:center;gap:5px;font-size:11px">
                ${esc(def.sliderLabel)}: <b class="mono">${curVal}</b>
                <input type="range" min="0" max="${def.maxVal}" step="${def.maxVal > 10 ? 5 : 1}" value="${curVal}" data-aug-val="${aid}" style="width:76px" />
              </label>
            ` : ""}
          </div>
        </div>
      `;
    }).join("");

    // Dynamic Sub-Control for Weapon of Destiny (3081 命定武器)
    const legendaryInBuild = state.calcItems.map(id => DATA.items[String(id)]).filter(it => it && (it.gold || 0) >= 2000 && !(it.tags || []).includes("Boots"));
    const destinySubHtml = state.calcAugs.includes(3081) ? `
      <div class="sim-sub-row" style="border-top:1px solid rgba(38,53,84,0.6);padding-top:6px">
        <div style="flex:1;min-width:160px">
          <b style="color:var(--gold)">命定武器裝備選擇：</b>
          <select id="destinyItemSelect" class="input-sm" style="margin-top:4px;width:100%">
            ${legendaryInBuild.length
              ? legendaryInBuild.map(it => `<option value="${it.id}" ${sim.destinySummary && sim.destinySummary.itemId === it.id ? "selected" : ""}>${esc(it.name)}</option>`).join("")
              : `<option value="0">請先選擇至少一件傳說裝備</option>`}
          </select>
        </div>
        <div style="min-width:145px">
          <label>參與擊殺層數: <b class="mono" style="color:var(--teal)">${state.calcStacks.destiny} 層</b>
            <input id="stackDestiny" type="range" min="0" max="35" step="1" value="${state.calcStacks.destiny}" style="width:100%" />
          </label>
        </div>
        ${sim.destinySummary ? `<div style="width:100%;font-size:11px;color:var(--teal)">✨ 「${esc(sim.destinySummary.itemName)}」命定強化：${esc(sim.destinySummary.bonusText)}</div>` : ""}
      </div>
    ` : "";

    // Dynamic Stack Sliders for Stacking Augments / Heartsteel
    const stackControls = [];
    if (state.calcAugs.includes(1390)) stackControls.push({ key: "evil", label: "極度邪惡疊層 (AP)", min: 0, max: 350, step: 10 });
    if (state.calcItems.includes(3084)) stackControls.push({ key: "heartsteel", label: "雄心之鋼疊層 (HP)", min: 0, max: 1500, step: 50 });
    if (state.calcAugs.includes(1353)) stackControls.push({ key: "tankEngine", label: "坦克引擎層數", min: 0, max: 15, step: 1 });
    if (state.calcAugs.includes(1388)) stackControls.push({ key: "infRec", label: "無限循環擊殺層", min: 0, max: 25, step: 1 });
    if (state.calcAugs.includes(1054)) stackControls.push({ key: "duality", label: "雙修大師戰鬥層數", min: 0, max: 15, step: 1 });

    const stacksSubHtml = stackControls.map(sc => `
      <div class="sim-sub-row">
        <span>${esc(sc.label)}: <b class="mono" style="color:var(--teal)">${state.calcStacks[sc.key]}</b></span>
        <input type="range" min="${sc.min}" max="${sc.max}" step="${sc.step}" value="${state.calcStacks[sc.key]}" data-stack-key="${sc.key}" style="width:140px" />
      </div>
    `).join("");

    const hasSubPanel = !!(skillSubHtml || destinySubHtml || stacksSubHtml);

    // SVG Growth Chart
    const chartW = 660, chartH = 210, padL = 48, padR = 20, padT = 18, padB = 28;
    const maxVal = Math.max(400, ...curve.map(pt => Math.max(pt.combo, pt.rExp)));
    const xAt = (i) => padL + (i / (curve.length - 1)) * (chartW - padL - padR);
    const yAt = (v) => padT + (1 - v / maxVal) * (chartH - padT - padB);
    const ptsCombo = curve.map((pt, i) => `${xAt(i).toFixed(1)},${yAt(pt.combo).toFixed(1)}`).join(" ");
    const ptsBase = curve.map((pt, i) => `${xAt(i).toFixed(1)},${yAt(pt.baseCombo).toFixed(1)}`).join(" ");
    const ptsR = curve.map((pt, i) => `${xAt(i).toFixed(1)},${yAt(pt.rExp).toFixed(1)}`).join(" ");

    const svgChart = `
      <svg viewBox="0 0 ${chartW} ${chartH}" style="width:100%;max-width:740px;height:auto;display:block">
        ${[0, 0.25, 0.5, 0.75, 1].map(f => {
          const y = padT + (1 - f) * (chartH - padT - padB);
          const lbl = Math.round(maxVal * f);
          return `<line x1="${padL}" y1="${y}" x2="${chartW - padR}" y2="${y}" stroke="#1f2d49" stroke-dasharray="3,3" />
                  <text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="10">${lbl}</text>`;
        }).join("")}
        <polyline fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="4,4" points="${ptsBase}" />
        <polyline fill="none" stroke="#0ac8b9" stroke-width="3" points="${ptsCombo}" />
        <polyline fill="none" stroke="#f59e0b" stroke-width="2.5" points="${ptsR}" />
        ${curve.map((pt, i) => `
          <circle cx="${xAt(i)}" cy="${yAt(pt.combo)}" r="3.5" fill="#0ac8b9" />
          <circle cx="${xAt(i)}" cy="${yAt(pt.rExp)}" r="3.5" fill="#f59e0b" />
          <text x="${xAt(i)}" y="${chartH - 8}" text-anchor="middle" fill="#94a3b8" font-size="10">Lv${pt.level}</text>
        `).join("")}
      </svg>
      <div style="display:flex;gap:16px;font-size:11.5px;margin-top:6px;flex-wrap:wrap">
        <span style="color:#0ac8b9">━ 全套連招期望傷害 (含裝備/海克斯)</span>
        <span style="color:#f59e0b">━ R 大絕期望傷害</span>
        <span style="color:#94a3b8">┅ 裸裝基礎連招對照</span>
      </div>
    `;

    view.innerHTML = `
      <div class="panel" style="border-color:var(--border-gold)">
        <div class="panel-header">
          <h3>🧮 英雄數值成長與技能傷害模擬器</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button id="calcDemoCaitBtn" class="btn-gold">🎯 一鍵示範：凱特琳 (巨人殺手 + 無盡 + 亮劍 + 寶石手套)</button>
            <button id="calcDemoEkkoBtn" class="btn-accent">⚡ 一鍵示範：艾克 (幻影武器 + 暮夜巫妖納什)</button>
          </div>
        </div>
      </div>

      <div class="calc-layout">
        <!-- LEFT CONFIG -->
        <div style="display:flex;flex-direction:column;gap:12px">
          <div class="panel" style="margin:0">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
              <img src="${esc(c.img)}" style="width:48px;height:48px;border-radius:8px;border:2px solid var(--gold)" />
              <div style="flex:1">
                <b style="font-size:17px;color:var(--gold-bright)">${esc(c.name)}</b>
                <div class="muted" style="font-size:11.5px">${esc(c.title)} · 基礎射程 ${c.baseStats?.range || 550}</div>
              </div>
              <button id="calcPickChampBtn" class="btn-gold">更換英雄</button>
            </div>

            <div style="margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
                <span>英雄等級：<b>Lv ${state.calcLevel}</b></span>
                <span class="muted">技能點法 Q${sim.ranks.Q} / W${sim.ranks.W} / E${sim.ranks.E} / R${sim.ranks.R}</span>
              </div>
              <input id="calcLevelSlider" type="range" min="1" max="18" value="${state.calcLevel}" style="width:100%" />
              <div class="pill-group" style="margin-top:5px">
                ${[1, 6, 11, 15, 16, 18].map(lv => `<button class="pill ${state.calcLevel === lv ? "active" : ""}" data-clv="${lv}">Lv${lv}</button>`).join("")}
              </div>
            </div>
          </div>

          <div class="panel" style="margin:0">
            <div class="panel-header" style="margin-bottom:8px">
              <h3 style="font-size:14px">⚔️ 自選裝備 (6 格)</h3>
              <div style="display:flex;gap:5px">
                <button id="calcLoadOpggItems" class="btn-ghost">帶入 OP.GG 核心</button>
                <button id="calcClearItems" class="btn-ghost">清空</button>
              </div>
            </div>
            <div class="item-6slots">${itemSlotsHtml}</div>
          </div>

          <div class="panel" style="margin:0">
            <div class="panel-header" style="margin-bottom:8px">
              <h3 style="font-size:14px">✨ 自選海克斯強化</h3>
              <button id="calcAddAugBtn" class="btn-accent">+ 搜尋新增</button>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
              ${selectedAugsHtml || `<span class="muted" style="font-size:12px">尚未選擇海克斯</span>`}
            </div>
            ${hasSubPanel ? `
              <div class="sim-aug-subpanel">
                <div style="font-weight:700;color:var(--gold-bright)">⚙️ 技能目標／命定武器／疊層參數調整</div>
                ${skillSubHtml}
                ${destinySubHtml}
                ${stacksSubHtml}
              </div>
            ` : ""}
            <div class="muted" style="font-size:11px;margin:8px 0 5px">快捷加入數值／機制海克斯（已選項目已從列表移除，點上方 × 可退回）：</div>
            <div style="display:flex;flex-wrap:wrap;gap:5px">
              ${quickAugIds.filter(aid => !state.calcAugs.includes(aid)).map(aid => {
                const m = DATA.augments[String(aid)];
                if (!m || ENG.isAugRetired(m)) return "";
                return `<button class="pill rar-${m.rarity}" data-calc-tgl-aug="${aid}" style="font-size:11px;padding:3px 8px">+ ${esc(m.name)}</button>`;
              }).join("") || `<span class="muted" style="font-size:11px">快捷海克斯皆已加入上方</span>`}
            </div>
          </div>

          <div class="panel" style="margin:0">
            <div class="panel-header" style="margin-bottom:8px">
              <h3 style="font-size:14px">🎯 敵方目標假人設定</h3>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
              <label>目標最大生命: <b class="mono">${state.calcTarget.hp}</b>
                <input id="tgtHp" type="range" min="1500" max="6500" step="100" value="${state.calcTarget.hp}" style="width:100%" />
              </label>
              <label>目標當前血量%: <b class="mono">${state.calcTarget.curHpPct}%</b>
                <input id="tgtCurPct" type="range" min="10" max="100" step="5" value="${state.calcTarget.curHpPct}" style="width:100%" />
              </label>
              <label>目標物防: <b class="mono">${state.calcTarget.armor}</b>
                <input id="tgtAr" type="range" min="30" max="320" step="10" value="${state.calcTarget.armor}" style="width:100%" />
              </label>
              <label>目標魔防: <b class="mono">${state.calcTarget.mr}</b>
                <input id="tgtMr" type="range" min="30" max="260" step="10" value="${state.calcTarget.mr}" style="width:100%" />
              </label>
            </div>
            ${state.calcAugs.includes(1195) ? `
              <div style="margin-top:8px;font-size:12px">
                <label>巨人殺手體型差增傷 (10%~25%): <b class="mono" style="color:var(--teal)">+${state.calcTarget.giantDiffPct}%</b>
                  <input id="tgtGiant" type="range" min="10" max="25" step="1" value="${state.calcTarget.giantDiffPct}" style="width:100%" />
                </label>
              </div>
            ` : ""}
          </div>
        </div>

        <!-- RIGHT RESULTS -->
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="panel" style="margin:0">
            <div class="panel-header">
              <h3>📊 Lv ${state.calcLevel} 英雄屬性總覽</h3>
              <span class="muted" style="font-size:12px">物理實傷係數 ${st.physMit}% · 魔法實傷係數 ${st.magMit}% ${st.dmgFactors.length ? `· (${st.dmgFactors.join(", ")})` : ""}</span>
            </div>
            <div class="stats-grid">
              <div class="stat-cell"><div class="sv mono">${st.ad}</div><div class="sl">總物攻 (基礎 ${st.baseAD} + ${st.bonusAD})</div></div>
              <div class="stat-cell"><div class="sv mono" style="color:#c084fc">${st.ap}</div><div class="sl">魔法攻擊 AP</div></div>
              <div class="stat-cell"><div class="sv mono" style="color:#4ade80">${st.hp}</div><div class="sl">最大生命 HP</div></div>
              <div class="stat-cell"><div class="sv mono">${st.as}</div><div class="sl">攻擊速度 AS</div></div>
              <div class="stat-cell"><div class="sv mono" style="color:#f87171">${st.critChance}%</div><div class="sl">暴擊率 (普攻 ${st.aaCritMult}x)</div></div>
              <div class="stat-cell"><div class="sv mono" style="color:${st.canSkillCrit ? "#f87171" : "var(--text-muted)"}">${esc(st.skillCritLabel)}</div><div class="sl">技能暴擊倍率</div></div>
              <div class="stat-cell"><div class="sv mono">${st.armorPenPct}% / ${st.leth}</div><div class="sl">物理穿透 / 致命</div></div>
              <div class="stat-cell"><div class="sv mono">${st.magicPenPct}% / ${st.magicPenFlat}</div><div class="sl">魔法穿透 (% / 固定)</div></div>
              <div class="stat-cell"><div class="sv mono">${st.ah} / ${st.ultAh}</div><div class="sl">技能加速 / 大絕加速</div></div>
              <div class="stat-cell"><div class="sv mono">${st.armor} / ${st.mr}</div><div class="sl">物防 / 魔防</div></div>
              <div class="stat-cell"><div class="sv mono">${st.ms} / ${st.range}</div><div class="sl">跑速 / 攻擊距離</div></div>
              <div class="stat-cell" style="border-color:var(--teal)"><div class="sv mono" style="color:var(--teal)">${sim.comboBurst}</div><div class="sl">一套連招期望總傷</div></div>
            </div>
          </div>

          <div class="panel" style="margin:0">
            <div class="panel-header">
              <h3>💥 普攻與 Q / W / E / R 技能實戰期望傷害（已扣目標雙防）</h3>
            </div>
            <div class="synth-build-box" style="margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;align-items:center">
                <div>
                  <b style="color:var(--gold-bright)">普攻 (Auto Attack)</b>
                  <span class="muted" style="font-size:12px;margin-left:8px">含特效傷 ${sim.aa.onHit}</span>
                </div>
                <div style="display:flex;gap:18px;flex-wrap:wrap">
                  <div><span class="muted" style="font-size:11px">未暴擊:</span> <b class="mono">${sim.aa.normal}</b></div>
                  <div><span class="muted" style="font-size:11px">暴擊一發:</span> <b class="mono" style="color:#f87171">${sim.aa.crit}</b></div>
                  <div><span class="muted" style="font-size:11px">期望單發:</span> <b class="mono" style="color:var(--teal);font-size:16px">${sim.aa.expected}</b></div>
                  <div><span class="muted" style="font-size:11px">站嚕秒傷 DPS:</span> <b class="mono" style="color:var(--gold);font-size:16px">${sim.aa.dps}</b></div>
                </div>
              </div>
            </div>

            <div class="skill-dmg-grid">
              ${sim.skills.map(sk => `
                <div class="skill-dmg-card ${sk.skillCanCrit ? "crit-enabled" : ""}">
                  <div style="display:flex;align-items:center;gap:9px">
                    ${sk.img ? `<img src="${esc(sk.img)}" style="width:36px;height:36px;border-radius:6px" />` : ""}
                    <div style="flex:1;min-width:0">
                      <div style="font-weight:800;font-size:14px;color:var(--gold-bright)">
                        <span style="color:var(--teal)">${sk.key}</span> ${esc(sk.name)} <span class="muted" style="font-size:11px">(Lv.${sk.rank})</span>
                      </div>
                      <div style="font-size:11px;color:var(--text-muted)">
                        ${sk.hasFormula ? `${DMG_TYPE_ZH[sk.dt] || sk.dt} ${sk.cdDisplay ? "· CD " + sk.cdDisplay : ""}` : "功能 / 非直接傷害技"}
                      </div>
                    </div>
                  </div>
                  ${sk.notes && sk.notes.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap">${sk.notes.map(n => `<span class="chip" style="border-color:var(--teal);color:var(--teal);font-size:10.5px">${esc(n)}</span>`).join("")}</div>` : ""}
                  ${sk.disabledByBasic ? `<div class="warn-note">🚫 已選「基本功夫」，此大絕已被禁用！</div>` : (sk.hasFormula ? `
                    <div style="font-size:11px;color:var(--text-muted);background:rgba(7,11,20,0.5);padding:5px 7px;border-radius:5px">
                      公式：${esc(sk.formulaText)}（稅前 <b>${sk.rawTotal}</b>）
                    </div>
                    <div class="dmg-num-row">
                      <span>✨ 期望實傷</span>
                      <span class="dmg-big mono">${sk.expMit}</span>
                    </div>
                    <div class="dmg-num-row" style="font-size:12px">
                      <span class="muted">未暴擊實傷: <b class="mono" style="color:var(--text)">${sk.nonCritMit}</b></span>
                      ${sk.skillCanCrit
                        ? `<span style="color:#f87171">暴擊(${sk.spellCritMult.toFixed(2)}x): <b class="mono dmg-crit" style="font-size:14px">${sk.critMit}</b></span>`
                        : `<span class="muted">無技能暴擊</span>`}
                    </div>
                    ${sk.ethBonus > 0 ? `<div style="font-size:11px;color:var(--amber)">⚡ 含幻影武器附加特效實傷 +${sk.ethBonus}</div>` : ""}
                    ${sk.procBonus > 0 ? `<div style="font-size:11px;color:var(--purple)">✨ 含海克斯技能觸發附加傷害 +${sk.procBonus}</div>` : ""}
                  ` : `<div class="muted" style="font-size:12px">無主要固定傷害公式</div>`)}
                </div>
              `).join("")}
            </div>
          </div>

          <div class="panel" style="margin:0">
            <div class="panel-header">
              <h3>📈 Lv 1 → Lv 18 成長傷害曲線</h3>
            </div>
            <div class="chart-wrap">${svgChart}</div>
          </div>
        </div>
      </div>
    `;

    view.querySelector("#calcPickChampBtn").onclick = () => openChampModal(ck => { selectChampion(ck, null); renderSimulatorCalc(); });
    view.querySelector("#calcLevelSlider").oninput = (e) => { state.calcLevel = Number(e.target.value); renderSimulatorCalc(); };
    view.querySelectorAll("[data-clv]").forEach(b => b.onclick = () => { state.calcLevel = Number(b.dataset.clv); renderSimulatorCalc(); });

    view.querySelectorAll("[data-calc-item-slot]").forEach(el => {
      el.onclick = (e) => {
        if (e.target.closest("[data-calc-rm-item]")) return;
        const idx = Number(el.dataset.calcItemSlot);
        openItemModal(c, `選擇第 ${idx + 1} 格裝備`, (iid) => {
          state.calcItems[idx] = iid;
          renderSimulatorCalc();
        });
      };
    });
    view.querySelectorAll("[data-calc-rm-item]").forEach(b => {
      b.onclick = (e) => { e.stopPropagation(); state.calcItems[Number(b.dataset.calcRmItem)] = 0; renderSimulatorCalc(); };
    });
    view.querySelector("#calcLoadOpggItems").onclick = () => {
      const core = c.core && c.core[0] ? c.core[0].ids : [];
      const boot = c.boots && c.boots[0] ? [c.boots[0].id] : [];
      const extra = (c.items || []).map(x => x.id).filter(id => !core.includes(id) && !boot.includes(id));
      state.calcItems = [...core, ...boot, ...extra].slice(0, 6);
      while (state.calcItems.length < 6) state.calcItems.push(0);
      renderSimulatorCalc();
    };
    view.querySelector("#calcClearItems").onclick = () => { state.calcItems = [0, 0, 0, 0, 0, 0]; renderSimulatorCalc(); };

    view.querySelector("#calcAddAugBtn").onclick = () => openAugModal(c, "新增海克斯強化至模擬器", (aid) => {
      if (!state.calcAugs.includes(aid)) state.calcAugs.push(aid);
      renderSimulatorCalc();
    }, { excludeIds: state.calcAugs });
    view.querySelectorAll("[data-calc-rm-aug]").forEach(b => {
      b.onclick = () => { state.calcAugs = state.calcAugs.filter(x => x !== Number(b.dataset.calcRmAug)); renderSimulatorCalc(); };
    });
    view.querySelectorAll("[data-calc-tgl-aug]").forEach(b => {
      b.onclick = () => {
        const aid = Number(b.dataset.calcTglAug);
        if (state.calcAugs.includes(aid)) state.calcAugs = state.calcAugs.filter(x => x !== aid);
        else state.calcAugs.push(aid);
        renderSimulatorCalc();
      };
    });

    // Sub-panel listeners: Skill selectors, Destiny Weapon item & stacks, Stack sliders
    view.querySelectorAll("[data-aug-skill]").forEach(b => {
      b.onclick = () => {
        const [aidStr, sk] = b.dataset.augSkill.split(":");
        const aid = Number(aidStr);
        if (!state.calcAugCfg[aid]) state.calcAugCfg[aid] = {};
        state.calcAugCfg[aid].skill = sk;
        renderSimulatorCalc();
      };
    });
    view.querySelectorAll("[data-aug-val]").forEach(inp => {
      inp.oninput = (e) => {
        const aid = Number(inp.dataset.augVal);
        if (!state.calcAugCfg[aid]) state.calcAugCfg[aid] = {};
        state.calcAugCfg[aid].val = Number(e.target.value);
        renderSimulatorCalc();
      };
    });
    const dSel = view.querySelector("#destinyItemSelect");
    if (dSel) dSel.onchange = (e) => { state.calcAugCfg.destinyItemId = Number(e.target.value); renderSimulatorCalc(); };
    const dStk = view.querySelector("#stackDestiny");
    if (dStk) dStk.oninput = (e) => { state.calcStacks.destiny = Number(e.target.value); renderSimulatorCalc(); };
    view.querySelectorAll("[data-stack-key]").forEach(inp => {
      inp.oninput = (e) => { state.calcStacks[inp.dataset.stackKey] = Number(e.target.value); renderSimulatorCalc(); };
    });

    view.querySelector("#tgtHp").oninput = (e) => { state.calcTarget.hp = Number(e.target.value); renderSimulatorCalc(); };
    view.querySelector("#tgtCurPct").oninput = (e) => { state.calcTarget.curHpPct = Number(e.target.value); renderSimulatorCalc(); };
    view.querySelector("#tgtAr").oninput = (e) => { state.calcTarget.armor = Number(e.target.value); renderSimulatorCalc(); };
    view.querySelector("#tgtMr").oninput = (e) => { state.calcTarget.mr = Number(e.target.value); renderSimulatorCalc(); };
    const tg = view.querySelector("#tgtGiant");
    if (tg) tg.oninput = (e) => { state.calcTarget.giantDiffPct = Number(e.target.value); renderSimulatorCalc(); };

    view.querySelector("#calcDemoCaitBtn").onclick = () => {
      selectChampion("caitlyn", null);
      state.calcLevel = 16;
      state.calcItems = [3031, 3036, 6676, 2523, 3094, 3006];
      state.calcAugs = [1195, 1134, 1048];
      state.calcTarget = { hp: 3000, curHpPct: 100, armor: 110, mr: 80, giantDiffPct: 20 };
      renderSimulatorCalc();
    };
    view.querySelector("#calcDemoEkkoBtn").onclick = () => {
      selectChampion("ekko", null);
      state.calcLevel = 16;
      state.calcItems = [2510, 3100, 3115, 4645, 3089, 3020];
      state.calcAugs = [1029, 1030, 3078];
      state.calcTarget = { hp: 2800, curHpPct: 100, armor: 90, mr: 80, giantDiffPct: 15 };
      renderSimulatorCalc();
    };
  }

  // =========================================================================
  // VIEW 2: CHAMPION EXPLORER (EXISTING FULL GUIDE)
  // =========================================================================
  function renderChampionGrid() {
    const q = state.champSearch.trim().toLowerCase();
    const list = DATA.champions.filter(c => {
      if (state.roleFilter !== "ALL" && !(c.roles || []).includes(state.roleFilter)) return false;
      if (state.tierFilter !== "ALL" && String(c.tier) !== state.tierFilter) return false;
      if (q && !(c.name.toLowerCase().includes(q) || c.key.toLowerCase().includes(q) || (c.title || "").toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => a.rank - b.rank);

    document.getElementById("champCountLabel").textContent = `(${list.length} / ${DATA.champions.length})`;
    const panel = document.getElementById("champPickerPanel");
    if (panel) panel.classList.toggle("is-collapsed", state.pickerCollapsed);
    const tBtn = document.getElementById("togglePickerBtn");
    if (tBtn) tBtn.textContent = state.pickerCollapsed ? "展開全英雄網格 ▼" : "收合網格 ▲";
    const grid = document.getElementById("champGrid");
    grid.classList.toggle("collapsed", state.pickerCollapsed);
    grid.innerHTML = list.map(c => `
      <div class="champ-tile ${c.key === state.selectedChampKey ? "selected" : ""}" data-champ-key="${esc(c.key)}" title="${esc(c.name)} (${esc(c.title)})">
        <span class="champ-tile-tier t-${c.tier}">${c.tier === 0 ? "OP" : "T" + c.tier}</span>
        <img src="${esc(c.img)}" alt="${esc(c.name)}" loading="lazy" />
        <div class="champ-tile-name">${esc(c.name)}</div>
      </div>
    `).join("");
  }

  function selectChampion(key, autoPinAugId = null) {
    state.selectedChampKey = key;
    state.activeArchIdx = 0;
    state.itemSearch = "";
    const c = getChampObj();
    if (autoPinAugId !== null) {
      const m = DATA.augments[String(autoPinAugId)];
      if (m && !ENG.isAugRetired(m)) setAugSlotsFromList([Number(autoPinAugId)]);
      else setAugSlotsFromList([]);
    } else {
      state.qLevel = 1;
      state.qPicks = { 1: 0, 7: 0, 11: 0, 15: 0 };
      syncPinnedFromPicks();
    }
    const top3 = (c.augs || []).filter(a => a[3] > 0 && !ENG.isAugRetired(DATA.augments[String(a[0])])).slice(0, 3).map(a => a[0]);
    state.qOptions = top3.length === 3 ? top3 : [0, 0, 0];

    // Sync simulator defaults nicely when switching hero
    const core = c.core && c.core[0] ? c.core[0].ids : [];
    const boot = c.boots && c.boots[0] ? [c.boots[0].id] : [];
    const extra = (c.items || []).map(x => x.id).filter(id => !core.includes(id) && !boot.includes(id));
    state.calcItems = [...core, ...boot, ...extra].slice(0, 6);
    while (state.calcItems.length < 6) state.calcItems.push(0);
    state.calcAugs = [...state.pinnedAugs];
    state.calcAugCfg = {};
  }

  document.getElementById("champGrid").addEventListener("click", (e) => {
    const tile = e.target.closest("[data-champ-key]");
    if (tile) {
      selectChampion(tile.dataset.champKey, null);
      renderChampionGrid();
      renderChampionDetail();
    }
  });
  document.getElementById("togglePickerBtn").addEventListener("click", () => {
    state.pickerCollapsed = !state.pickerCollapsed;
    renderChampionGrid();
  });
  const cmQuick = document.getElementById("champModalQuickBtn");
  if (cmQuick) cmQuick.addEventListener("click", () => {
    openChampModal(ck => { selectChampion(ck, null); renderChampionGrid(); renderChampionDetail(); });
  });
  document.getElementById("champSearchInput").addEventListener("input", (e) => {
    state.champSearch = e.target.value;
    renderChampionGrid();
  });
  document.getElementById("roleFilterGroup").addEventListener("click", (e) => {
    const p = e.target.closest(".pill");
    if (!p) return;
    state.roleFilter = p.dataset.role;
    document.querySelectorAll("#roleFilterGroup .pill").forEach(x => x.classList.toggle("active", x === p));
    renderChampionGrid();
  });
  document.getElementById("tierFilterGroup").addEventListener("click", (e) => {
    const p = e.target.closest(".pill");
    if (!p) return;
    state.tierFilter = p.dataset.tier;
    document.querySelectorAll("#tierFilterGroup .pill").forEach(x => x.classList.toggle("active", x === p));
    renderChampionGrid();
  });

  function renderChampionDetail() {
    const c = getChampObj();
    const container = document.getElementById("champDetailContainer");
    const prof = SYN.detectChampProfile(c, DATA);
    const rolesText = (c.roles || []).map(r => ROLE_ZH[r] || r).join(" / ");
    const wrClass = c.wr >= 52 ? "good" : (c.wr < 48 ? "warn" : "");

    const spellsHtml = (c.spells || []).map(sp => `
      <span class="item-pill" style="cursor:default">
        <img src="${esc(sp.img)}" alt="${esc(sp.name)}" /><span>${esc(sp.name)}</span>
      </span>
    `).join("");

    let skillsDrawerHtml = "";
    if (state.showSkills && c.skills) {
      const p = c.skills.p;
      const list = [
        p ? { key: "被動", name: p.name, desc: p.desc, img: p.img, cd: "" } : null,
        ...(c.skills.q || [])
      ].filter(Boolean);
      skillsDrawerHtml = `<div class="skills-strip">
        ${list.map(sk => `
          <div class="skill-card">
            <img src="${esc(sk.img)}" alt="${esc(sk.name)}" />
            <div>
              <div><span class="skill-key">${esc(sk.key)}</span><b>${esc(sk.name)}</b> ${sk.cd ? `<span class="muted" style="font-size:11px">CD: ${esc(sk.cd)}s</span>` : ""}</div>
              <div class="skill-desc">${esc(sk.desc)}</div>
            </div>
          </div>
        `).join("")}
      </div>`;
    }

    const headerHtml = `
      <div class="hero-header">
        <div class="hero-avatar-wrap">
          <img src="${esc(c.img)}" alt="${esc(c.name)}" />
        </div>
        <div>
          <div class="hero-name-row">
            <span class="hero-name">${esc(c.name)}</span>
            <span class="hero-title">${esc(c.title)} · ${esc(c.key)}</span>
            <span class="t-badge t-${c.tier}">${TIER_LABEL[c.tier]}</span>
            <span class="chip">定位：${esc(rolesText || "未分類")}</span>
            <span class="chip" style="border-color:var(--teal);color:var(--teal)">主要流派：${esc(PROFILE_ZH[prof.primary] || prof.primary)}</span>
          </div>
          <div class="hero-tags" style="margin-top:10px;align-items:center">
            <span class="muted" style="font-size:12px">召喚師技能：</span>${spellsHtml}
            <span class="muted" style="font-size:12px;margin-left:8px">技能點法：</span>
            <span class="chip" style="color:var(--gold-bright);font-weight:700">${esc(c.skillOrder || "Q > E > W")}</span>
            <button id="toggleSkillsBtn" class="btn-ghost" style="margin-left:6px">${state.showSkills ? "隱藏技能說明 ▲" : "展開 P/Q/W/E/R 技能 ▼"}</button>
          </div>
        </div>
        <div class="hero-metrics">
          <div class="metric-box"><div class="metric-val mono">#${c.rank}</div><div class="metric-lbl">OP.GG 排名 / 173</div></div>
          <div class="metric-box"><div class="metric-val mono ${wrClass}">${c.wr.toFixed(2)}%</div><div class="metric-lbl">整體勝率</div></div>
          <div class="metric-box"><div class="metric-val mono">${c.pr.toFixed(2)}%</div><div class="metric-lbl">選取率</div></div>
        </div>
      </div>
      ${skillsDrawerHtml ? `<div class="panel" style="margin-top:-8px">${skillsDrawerHtml}</div>` : ""}
    `;

    const ctx = buildDecisionContext(c);
    const sharedBoxHtml = renderSharedCoreBox(c, ctx);
    const subTabsHtml = `
      <div class="champ-subtabs">
        <button class="subtab-btn ${state.champSubTab === "decision" ? "active" : ""}" data-subtab="decision">⚡ 局內三選一決策</button>
        <button class="subtab-btn ${state.champSubTab === "build" ? "active" : ""}" data-subtab="build">📚 特化詳解與全海克斯 / OP.GG 配裝</button>
        <button class="subtab-btn ${state.champSubTab === "all" ? "active" : ""}" data-subtab="all">🧩 決策＋圖鑑同頁展開</button>
      </div>
    `;

    const showDecision = state.champSubTab === "decision" || state.champSubTab === "all";
    const showBuild = state.champSubTab === "build" || state.champSubTab === "all";

    const buildSubHtml = showBuild ? `
      ${renderBuildSubSection(c, ctx)}
      <div class="detail-columns">
        <div>${renderChampAugmentsSection(c)}</div>
        <div>${renderChampRightColumn(c)}</div>
      </div>
    ` : "";

    container.innerHTML = `
      ${headerHtml}
      ${sharedBoxHtml}
      ${subTabsHtml}
      ${showDecision ? ctx.decisionHtml : ""}
      ${buildSubHtml}
    `;
    attachDetailListeners(c, ctx);
  }

  function renderSharedCoreBox(c, ctx) {
    const augsForSynth = ctx.liveAugsUsed;
    const synth = SYN.synthesizeBuild(c, augsForSynth, DATA);
    const bootHtml = synth.boots ? `
      <div class="item-card-lg" data-item-id="${synth.boots.id}">
        <img src="${esc(synth.boots.img)}" alt="" />
        <div class="iname">${esc(synth.boots.name)}</div>
        <div class="ireason">推薦鞋履</div>
        <div class="istat mono">${synth.boots.wr}% 勝率</div>
      </div>` : "";
    const itemsHtml = synth.items.map(it => {
      const isSpec = it.reasons.some(r => r.includes("特化"));
      return `
        <div class="item-card-lg ${isSpec ? "specialized" : ""}" data-item-id="${it.id}">
          <img src="${esc(it.img)}" alt="" />
          <div class="iname">${esc(it.name)}</div>
          <div class="ireason">${esc(it.reasons[0])}</div>
          <div class="istat mono">${it.wr !== null ? it.wr.toFixed(1) + "% 勝率" : (it.gold ? it.gold + "G" : "特化推薦")}</div>
        </div>
      `;
    }).join("");

    const avoidHtml = synth.avoid.length ? `
      <div class="avoid-strip">
        <b>🚫 衝突避坑提醒：</b>由於已選海克斯機制限制，本場<b>請勿購買</b>：
        ${synth.avoid.map(av => itemHtml(av.id)).join("")}
      </div>` : "";

    const lockedCount = ctx.allLockedAugs.length;
    const statusLabel = lockedCount
      ? `依據已選 ${lockedCount} 個海克斯即時合成`
      : (ctx.winner ? `尚未鎖定海克斯 · 先以首選「${ctx.winner.meta.name}」預覽` : "OP.GG 英雄標準配裝");

    return `
      <div class="sim-panel">
        <div class="panel-header" style="margin-bottom:8px">
          <h3>⬡ 4 階段海克斯槽位與即時 6 神裝合成台 <span class="chip" style="border-color:var(--teal);color:var(--teal);font-weight:600">${esc(statusLabel)}</span></h3>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button id="qResetRunBtn" class="btn-ghost">🔄 清空/重新開局</button>
            <button id="qDemoCaitBtn" class="btn-gold">示範：凱特琳 Lv 11</button>
            <button id="qDemoEkkoBtn" class="btn-accent">示範：艾克 Lv 15</button>
            <button id="sendPinToCalcBtn" class="btn-accent">帶入傷害模擬 🧮</button>
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
          選牌決策與英雄配裝<b>共用此 4 格海克斯紀錄</b>：在決策中選牌會自動填入並跳下一級，或在「全海克斯圖鑑」直接點擊卡片快速增減。
        </div>
        ${ctx.timelineHtml}
        <div class="synth-build-box" style="margin-top:12px">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:8px">
            <span style="font-size:13px;font-weight:700;color:var(--gold-bright)">🎯 綜合推薦 6 件神裝（青色框＝海克斯專屬特化裝，懸停查看 Riot 16.22 數值）</span>
            ${state.champSubTab === "decision" ? `<button class="btn-ghost" data-subtab="build" style="font-size:11.5px">展開特化路線詳解 / OP.GG 數據 →</button>` : ""}
          </div>
          <div class="synth-row">${bootHtml}${itemsHtml}</div>
          ${avoidHtml}
        </div>
      </div>
    `;
  }

  function renderBuildSubSection(c, ctx) {
    const pinned = ctx.allLockedAugs;
    const pinnedSet = new Set(pinned);
    const topSynAugs = (c.augs || []).filter(a => SYN.RULES[a[0]] && a[1] <= 2 && !ENG.isAugRetired(DATA.augments[String(a[0])]) && !pinnedSet.has(a[0])).sort((a, b) => (a[1] - b[1]) || (b[2] - a[2])).slice(0, 10);
    const quickIds = [...new Set([...topSynAugs.map(x => x[0]), 1029, 1002, 1030, 1048, 1129, 1045])].filter(aid => !pinnedSet.has(aid)).slice(0, 10);
    const quickPillsHtml = quickIds.map(aid => {
      const m = DATA.augments[String(aid)];
      if (!m || ENG.isAugRetired(m)) return "";
      return `<button class="pill" data-toggle-pin="${aid}">+ ${esc(m.name)}</button>`;
    }).join("");

    const synergyDetails = pinned.map(aid => {
      const g = SYN.getAugmentGuide(c, aid, DATA);
      if (!g) return "";
      const m = DATA.augments[String(aid)];
      const routesHtml = g.routes.map(r => `
        <div class="route-box ${r.isPrimary ? "primary" : ""}">
          <div class="route-title"><span>${r.isPrimary ? "⭐ 最適合此英雄 · " : ""}${esc(r.name)}</span></div>
          <div class="route-items">${r.items.map(it => itemHtml(it.id, "", it.wr ? it : null)).join("")}</div>
          <div class="route-note">${esc(r.note)}</div>
        </div>
      `).join("");

      return `
        <div class="synergy-card">
          <div class="synergy-card-head">
            <img src="${esc(m.img)}" alt="" />
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <b style="font-size:16px;color:var(--gold-bright)">${esc(m.name)}</b>
                <span class="chip" style="border-color:${g.catMeta.color};color:${g.catMeta.color}">${g.catMeta.icon} ${esc(g.catMeta.label)}</span>
              </div>
              <div class="synergy-headline">${esc(g.headline)}</div>
              <div class="synergy-mechanic">${esc(g.mechanic)}</div>
            </div>
          </div>
          <div class="route-grid">${routesHtml}</div>
          ${g.specialNote ? `<div class="warn-note">${esc(g.specialNote)}</div>` : ""}
        </div>
      `;
    }).filter(Boolean).join("");

    return `
      <div class="panel">
        <div class="panel-header" style="margin-bottom:8px">
          <h3>🧪 快速海克斯配裝試算與機制特化路線詳解</h3>
          <span class="muted" style="font-size:12px">點選下方常用／全海克斯卡片，即會同步寫入上方 4 階段槽位並更新 6 神裝</span>
        </div>
        <div class="sim-quick-pills" style="margin-bottom:10px">
          <span class="muted" style="font-size:12px">常用特化快選：</span>
          ${quickPillsHtml}
        </div>
        ${synergyDetails ? `<div class="synergy-cards">${synergyDetails}</div>` : `<div class="muted" style="font-size:12px">提示：目前槽位內為純數值強化或尚未選擇機制海克斯；可點擊上方常用特化或下方海克斯卡片查看特化配裝路線！</div>`}
      </div>
    `;
  }

  function renderChampAugmentsSection(c) {
    const q = state.augSearch.trim().toLowerCase();
    const pinnedSet = new Set(getLockedAugs());
    let list = (c.augs || []).map(a => {
      const [aid, tier, perf, pop] = a;
      const meta = DATA.augments[String(aid)];
      const realWr = c.augWr && c.augWr[String(aid)] ? c.augWr[String(aid)][0] : null;
      const retired = meta ? ENG.isAugRetired(meta) : false;
      return { aid, tier, perf, pop, realWr, meta, retired };
    }).filter(x => x.meta && !pinnedSet.has(x.aid));

    if (state.augTierFilter !== "ALL") {
      if (state.augTierFilter === "3+") list = list.filter(x => x.tier >= 3);
      else list = list.filter(x => String(x.tier) === state.augTierFilter);
    }
    if (state.augRarityFilter !== "ALL") list = list.filter(x => String(x.meta.rarity) === state.augRarityFilter);
    if (state.augSynergyOnly) list = list.filter(x => !!SYN.RULES[x.aid]);
    if (q) list = list.filter(x => x.meta.name.toLowerCase().includes(q) || (x.meta.desc || "").toLowerCase().includes(q));

    if (state.augSort === "tier") list.sort((a, b) => (Number(a.retired) - Number(b.retired)) || (a.tier - b.tier) || (b.perf - a.perf));
    else if (state.augSort === "perf") list.sort((a, b) => (Number(a.retired) - Number(b.retired)) || (b.perf - a.perf));
    else if (state.augSort === "pop") list.sort((a, b) => (Number(a.retired) - Number(b.retired)) || (b.pop - a.pop));

    const cardsHtml = list.map(x => {
      const m = x.meta;
      const isPin = !x.retired && state.pinnedAugs.includes(x.aid);
      const isEarly = !x.retired && ENG.isEarlyOnlyAug(x.aid);
      const rule = SYN.RULES[x.aid];
      const catMeta = rule ? SYN.CAT_META[rule.cat] : null;
      return `
        <div class="aug-card rar-${m.rarity} ${isPin ? "pinned" : ""} ${x.retired ? "aug-retired" : ""}" ${x.retired ? "" : `data-toggle-pin="${x.aid}"`}>
          <div class="aug-top">
            <img src="${esc(m.img)}" alt="${esc(m.name)}" loading="lazy" />
            <div style="flex:1;min-width:0">
              <div class="aug-name">
                ${esc(m.name)}
                ${x.retired ? `<span class="t-badge" style="background:rgba(148,163,184,.18);color:var(--muted)">非本賽季</span>` : (isEarly ? `<span class="t-badge" style="background:rgba(245,158,11,.15);color:var(--gold);border:1px solid rgba(245,158,11,.35)">⏳ 限前兩輪</span>` : "")}
              </div>
              <div class="aug-stats">
                <span class="t-badge t-${x.tier}">${TIER_LABEL[x.tier]}</span>
                <span class="t-badge rar-tag-${m.rarity}">${RARITY_ZH[m.rarity] || ""}</span>
                ${x.realWr ? `<span class="mono" style="color:var(--green)"><b>${x.realWr.toFixed(1)}%</b>勝</span>` : ""}
                <span class="mono">評分 <b>${x.perf}</b></span>
                <span class="mono">${x.pop}%</span>
              </div>
            </div>
          </div>
          ${catMeta ? `<div class="aug-syn-tag">${catMeta.icon} ${esc(catMeta.label)} · 點擊看特化裝</div>` : ""}
          <div class="aug-desc">${esc(m.desc)}</div>
        </div>
      `;
    }).join("");

    return `
      <div class="panel">
        <div class="panel-header">
          <h3>✨ ${esc(c.name)} 適用海克斯全覽 <span class="muted-count">(${list.length} / ${(c.augs || []).length})</span></h3>
          <span class="muted" style="font-size:12px">點擊卡片加入上方模擬出裝</span>
        </div>
        <div class="aug-filter-bar">
          <input id="augSearchInput" type="search" class="input-sm" placeholder="搜尋海克斯名稱/效果..." value="${esc(state.augSearch)}" style="width:180px" />
          <div class="pill-group">
            ${[["ALL","全部"],["0","T0"],["1","T1"],["2","T2"],["3+","T3+"]].map(([v,l]) => `<button class="pill ${state.augTierFilter===v?"active":""}" data-atier="${v}">${l}</button>`).join("")}
          </div>
          <div class="pill-group">
            ${[["ALL","全稀有"],["8","稜鏡"],["4","黃金"],["1","白銀"]].map(([v,l]) => `<button class="pill ${state.augRarityFilter===v?"active":""}" data-arar="${v}">${l}</button>`).join("")}
          </div>
          <button id="augSynToggle" class="pill ${state.augSynergyOnly?"active":""}">⚡ 僅顯示有特化出裝</button>
          <select id="augSortSelect" class="input-sm" style="margin-left:auto">
            <option value="tier" ${state.augSort==="tier"?"selected":""}>排序：OP.GG 階級</option>
            <option value="perf" ${state.augSort==="perf"?"selected":""}>排序：表現評分</option>
            <option value="pop" ${state.augSort==="pop"?"selected":""}>排序：選取率</option>
          </select>
        </div>
        <div class="aug-grid">${cardsHtml || `<div class="muted" style="padding:20px">無符合篩選條件的海克斯</div>`}</div>
      </div>
    `;
  }

  function renderChampRightColumn(c) {
    const lockedSet = new Set(getLockedAugs());
    const earlyFull = !!(state.qPicks[1] && state.qPicks[7]);
    const combosHtml = (c.combos || []).map((cb, idx) => {
      const earlyIds = cb.augs.filter(aid => ENG.isEarlyOnlyAug(aid));
      const missedEarly = cb.augs.filter(aid => ENG.isEarlyOnlyAug(aid) && !lockedSet.has(aid));
      const blockedNow = (state.qLevel >= 11 || earlyFull) && missedEarly.length > 0;
      return `
      <div class="combo-row" style="${blockedNow ? "opacity:0.65;border-color:rgba(248,113,113,0.35)" : ""}" data-load-combo="${cb.augs.join(",")}" title="${blockedNow ? "含已錯過的「前兩輪限定」海克斯，但仍可點擊載入模擬" : "點擊把這三個海克斯一次依階段載入槽位"}">
        <div class="combo-augs">
          <b class="muted">#${idx + 1}</b>
          ${cb.augs.map(aid => {
            const m = DATA.augments[String(aid)];
            const eTag = ENG.isEarlyOnlyAug(aid) ? ` ⏳` : "";
            return m ? `<span class="combo-aug-pill"><img src="${esc(m.img)}" alt="" />${esc(m.name)}${eTag}</span>` : "";
          }).join("")}
          ${blockedNow ? `<span class="chip" style="padding:0 5px;font-size:10px;border-color:rgba(248,113,113,.45);color:#fca5a5">錯過前兩輪</span>` : (earlyIds.length ? `<span class="chip" style="padding:0 5px;font-size:10px;border-color:rgba(245,158,11,.45);color:var(--gold)">⏳需前兩輪搶</span>` : "")}
        </div>
        <div style="text-align:right;white-space:nowrap">
          <div class="mono" style="font-weight:800;color:var(--green)">${cb.wr.toFixed(1)}%</div>
          <div class="muted mono" style="font-size:11px">${esc(cb.games)} 場</div>
        </div>
      </div>
    `;
    }).join("");

    let archHtml = "";
    if (c.arch && c.arch.length) {
      const activeIdx = Math.min(state.activeArchIdx, c.arch.length - 1);
      const activeArch = c.arch[activeIdx];
      const tabsHtml = c.arch.map((ar, i) => `
        <button class="pill ${i === activeIdx ? "active" : ""}" data-arch-idx="${i}">
          ${esc(ar.tags.join(" "))} <span class="mono" style="margin-left:4px;color:${ar.wr >= 53 ? "var(--green)" : "inherit"}">${ar.wr.toFixed(1)}%</span>
        </button>
      `).join("");
      const coresHtml = (activeArch.cores || []).map((cr, idx) => `
        <div class="core-build-row">
          <div class="build-icons">
            <span class="muted" style="font-size:11px;margin-right:4px">#${idx + 1}</span>
            ${cr.ids.map((iid, j) => {
              const it = DATA.items[String(iid)];
              return (j > 0 ? `<span class="arrow-sep">›</span>` : "") + (it ? `<img src="${esc(it.img)}" alt="${esc(it.name)}" data-item-id="${iid}" />` : "");
            }).join("")}
          </div>
          <div class="mono" style="font-size:12px">
            <b style="color:${cr.wr >= 54 ? "var(--green)" : "var(--gold-bright)"}">${cr.wr.toFixed(1)}%</b>
            <span class="muted" style="margin-left:6px">${cr.pr.toFixed(1)}%選</span>
          </div>
        </div>
      `).join("");
      const sitHtml = (activeArch.sit || []).map(iid => itemHtml(iid)).join("");
      archHtml = `
        <div class="panel">
          <div class="panel-header"><h3>🎭 實戰流派比較 <span class="muted" style="font-size:11px;font-weight:400">(ARAMGG 分流派勝率)</span></h3></div>
          <div class="pill-group" style="margin-bottom:10px">${tabsHtml}</div>
          ${coresHtml}
          ${sitHtml ? `<div style="margin-top:8px"><div class="muted" style="font-size:11px;margin-bottom:5px">此流派常用情境裝備：</div><div style="display:flex;flex-wrap:wrap;gap:5px">${sitHtml}</div></div>` : ""}
        </div>
      `;
    }

    const startersHtml = (c.starter || []).slice(0, 3).map(st => `
      <div class="core-build-row">
        <div class="build-icons">${st.ids.map(iid => {
          const it = DATA.items[String(iid)];
          return it ? `<img src="${esc(it.img)}" alt="${esc(it.name)}" data-item-id="${iid}" />` : "";
        }).join("")}</div>
        <div class="mono" style="font-size:12px"><b>${st.wr.toFixed(1)}%</b> <span class="muted">${st.pr.toFixed(1)}%選</span></div>
      </div>
    `).join("");

    const bootsHtml = (c.boots || []).slice(0, 4).map(b => itemHtml(b.id, "", b)).join("");

    const opggCoresHtml = (c.core || []).slice(0, 5).map((cr, idx) => `
      <div class="core-build-row">
        <div class="build-icons">
          <span class="muted" style="font-size:11px;margin-right:4px">#${idx + 1}</span>
          ${cr.ids.map((iid, j) => {
            const it = DATA.items[String(iid)];
            return (j > 0 ? `<span class="arrow-sep">›</span>` : "") + (it ? `<img src="${esc(it.img)}" alt="${esc(it.name)}" data-item-id="${iid}" />` : "");
          }).join("")}
        </div>
        <div class="mono" style="font-size:12px">
          <b style="color:${cr.wr >= 54 ? "var(--green)" : "var(--gold-bright)"}">${cr.wr.toFixed(1)}%</b>
          <span class="muted" style="margin-left:5px">${cr.pr.toFixed(1)}% (${esc(cr.play)})</span>
        </div>
      </div>
    `).join("");

    const iq = state.itemSearch.trim().toLowerCase();
    let itemRows = (c.items || []).filter(it => {
      const m = DATA.items[String(it.id)];
      return !iq || (m && m.name.toLowerCase().includes(iq));
    });
    if (state.itemSort === "wr") itemRows.sort((a, b) => b.wr - a.wr);
    else itemRows.sort((a, b) => b.pr - a.pr);

    return `
      <div class="panel">
        <div class="panel-header"><h3>🔥 黃金海克斯組合 TOP 5</h3><span class="muted" style="font-size:11px">點擊載入模擬器</span></div>
        ${combosHtml || `<div class="muted" style="font-size:12px">暫無三海克斯組合樣本</div>`}
      </div>
      ${archHtml}
      <div class="panel">
        <div class="panel-header"><h3>⚔️ OP.GG 標準出裝路徑</h3></div>
        <div class="muted" style="font-size:11px;margin-bottom:5px">起手裝備：</div>${startersHtml}
        <div class="muted" style="font-size:11px;margin:8px 0 5px">推薦鞋子：</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${bootsHtml}</div>
        <div class="muted" style="font-size:11px;margin-bottom:5px">OP.GG 核心三件套：</div>${opggCoresHtml}
      </div>
      <div class="panel">
        <div class="panel-header">
          <h3>📊 OP.GG 全裝備單件數據 <span class="muted-count">(${itemRows.length})</span></h3>
          <div style="display:flex;gap:6px">
            <input id="itemSearchInput" type="search" class="input-sm" placeholder="搜裝備..." value="${esc(state.itemSearch)}" style="width:120px" />
            <select id="itemSortSelect" class="input-sm">
              <option value="pr" ${state.itemSort==="pr"?"selected":""}>依選取率</option>
              <option value="wr" ${state.itemSort==="wr"?"selected":""}>依勝率</option>
            </select>
          </div>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>裝備</th><th>勝率</th><th>選取率</th><th>場次</th></tr></thead>
            <tbody>
              ${itemRows.map(it => `
                <tr>
                  <td>${itemHtml(it.id)}</td>
                  <td class="mono" style="font-weight:700;color:${it.wr >= 54 ? "var(--green)" : (it.wr < 48 ? "var(--red)" : "var(--text)")}">${it.wr.toFixed(1)}%</td>
                  <td class="mono">${it.pr.toFixed(1)}%</td>
                  <td class="mono muted">${esc(it.play)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function attachDetailListeners(c, ctx) {
    const det = document.getElementById("champDetailContainer");
    const tsk = document.getElementById("toggleSkillsBtn");
    if (tsk) tsk.onclick = () => { state.showSkills = !state.showSkills; renderChampionDetail(); };

    det.querySelectorAll("[data-subtab]").forEach(b => {
      b.onclick = () => { state.champSubTab = b.dataset.subtab; renderChampionDetail(); };
    });

    attachUnifiedStageListeners(det, c, ctx);

    const spc = document.getElementById("sendPinToCalcBtn");
    if (spc) spc.onclick = () => {
      const augsToUse = ctx.liveAugsUsed;
      const synth = SYN.synthesizeBuild(c, augsToUse, DATA);
      const ids = [];
      if (synth.boots) ids.push(synth.boots.id);
      synth.items.forEach(x => ids.push(x.id));
      while (ids.length < 6) ids.push(0);
      state.calcItems = ids.slice(0, 6);
      state.calcLevel = state.qLevel === 1 ? 3 : (state.qLevel === 7 ? 7 : (state.qLevel === 11 ? 11 : 16));
      state.calcAugs = augsToUse.slice(0, 4);
      switchView("calc");
    };

    det.querySelectorAll("[data-toggle-pin]").forEach(el => {
      el.onclick = () => {
        toggleAugInSlots(Number(el.dataset.togglePin));
        renderChampionDetail();
      };
    });
    det.querySelectorAll("[data-load-combo]").forEach(el => {
      el.onclick = () => {
        const ids = el.dataset.loadCombo.split(",").map(Number).filter(Boolean).slice(0, 4);
        setAugSlotsFromList(ids);
        renderChampionDetail();
        window.scrollTo({ top: 180, behavior: "smooth" });
      };
    });
    det.querySelectorAll("[data-arch-idx]").forEach(el => {
      el.onclick = () => { state.activeArchIdx = Number(el.dataset.archIdx); renderChampionDetail(); };
    });

    const aSearch = document.getElementById("augSearchInput");
    if (aSearch) {
      aSearch.oninput = (e) => {
        const pos = e.target.selectionStart;
        state.augSearch = e.target.value;
        renderChampionDetail();
        const inp = document.getElementById("augSearchInput");
        if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
      };
    }
    det.querySelectorAll("[data-atier]").forEach(b => b.onclick = () => { state.augTierFilter = b.dataset.atier; renderChampionDetail(); });
    det.querySelectorAll("[data-arar]").forEach(b => b.onclick = () => { state.augRarityFilter = b.dataset.arar; renderChampionDetail(); });
    const aSyn = document.getElementById("augSynToggle");
    if (aSyn) aSyn.onclick = () => { state.augSynergyOnly = !state.augSynergyOnly; renderChampionDetail(); };
    const aSort = document.getElementById("augSortSelect");
    if (aSort) aSort.onchange = (e) => { state.augSort = e.target.value; renderChampionDetail(); };

    const iSearch = document.getElementById("itemSearchInput");
    if (iSearch) {
      iSearch.oninput = (e) => {
        const pos = e.target.selectionStart;
        state.itemSearch = e.target.value;
        renderChampionDetail();
        const inp = document.getElementById("itemSearchInput");
        if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
      };
    }
    const iSort = document.getElementById("itemSortSelect");
    if (iSort) iSort.onchange = (e) => { state.itemSort = e.target.value; renderChampionDetail(); };
  }

  // =========================================================================
  // VIEW 3: AUGMENT ENCYCLOPEDIA
  // =========================================================================
  function renderAugmentEncyclopedia() {
    const view = document.getElementById("view-augments");
    const q = state.encSearch.trim().toLowerCase();
    const allAugs = Object.values(DATA.augments).filter(a => {
      if (state.encRarity !== "ALL" && String(a.rarity) !== state.encRarity) return false;
      if (state.encCat !== "ALL") { const r = SYN.RULES[a.id]; if (!r || r.cat !== state.encCat) return false; }
      if (q && !(a.name.toLowerCase().includes(q) || (a.desc || "").toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => (Number(ENG.isAugRetired(a)) - Number(ENG.isAugRetired(b))) || (a.gTier - b.gTier) || (b.gPerf - a.gPerf));

    const firstActive = allAugs.find(a => !ENG.isAugRetired(a)) || allAugs[0] || Object.values(DATA.augments).find(a => !ENG.isAugRetired(a)) || Object.values(DATA.augments)[0];
    const reqAug = DATA.augments[String(state.encSelectedAugId)];
    const selAug = (reqAug && !ENG.isAugRetired(reqAug)) ? reqAug : firstActive;
    const rule = selAug ? SYN.RULES[selAug.id] : null;
    const revList = selAug ? (augToChamps[selAug.id] || []).slice(0, 36) : [];

    let detailHtml = "";
    if (selAug) {
      const catMeta = rule ? SYN.CAT_META[rule.cat] : null;
      const routesHtml = rule ? rule.routes.map(r => `
        <div class="route-box">
          <div class="route-title">${esc(r.name)}</div>
          <div class="route-items">${r.items.map(iid => itemHtml(iid)).join("")}</div>
          <div class="route-note">${esc(r.note)}</div>
        </div>
      `).join("") : `<div class="muted" style="font-size:13px">此海克斯主要為純屬性/機制增益，無須刻意更換特化裝備，按英雄標準核心出裝即可。</div>`;

      detailHtml = `
        <div class="panel" style="border-color:var(--border-gold)">
          <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;margin-bottom:14px">
            <img src="${esc(selAug.img)}" alt="" style="width:62px;height:62px;border-radius:10px;background:#000;border:2px solid var(--gold)" />
            <div style="flex:1;min-width:220px">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <h2 style="margin:0;color:var(--gold-bright)">${esc(selAug.name)}</h2>
                <span class="t-badge t-${selAug.gTier}">${TIER_LABEL[selAug.gTier]}</span>
                <span class="t-badge rar-tag-${selAug.rarity}">${RARITY_ZH[selAug.rarity] || ""}</span>
                ${ENG.isEarlyOnlyAug(selAug.id) ? `<span class="chip" style="border-color:rgba(245,158,11,.5);color:var(--gold-bright)">⏳ 限前兩輪 (Lv 1 / Lv 7)，後兩輪正常抽不到</span>` : ""}
                ${catMeta ? `<span class="chip" style="border-color:${catMeta.color};color:${catMeta.color}">${catMeta.icon} ${esc(catMeta.label)}</span>` : ""}
              </div>
              <p style="margin:6px 0;color:var(--text);font-size:13.5px">${esc(selAug.desc)}</p>
              <div class="muted mono" style="font-size:12px">OP.GG 全局表現：<b>${selAug.gPerf}</b> · 全局選率：<b>${selAug.gPop}%</b></div>
            </div>
          </div>
          ${rule ? `<div class="synergy-headline" style="margin-bottom:4px">💡 ${esc(rule.headline)}</div><div class="synergy-mechanic" style="margin-bottom:10px">${esc(rule.mechanic)}</div>` : ""}
          <h4 style="margin:10px 0 8px;color:var(--gold-bright)">🛠️ 對應特化裝備公式</h4>
          <div class="route-grid">${routesHtml}</div>
          <h4 style="margin:16px 0 8px;color:var(--gold-bright)">🦸 最適配此海克斯的英雄排行榜 <span class="muted" style="font-size:12px;font-weight:400">(點擊英雄直接載入並計算專屬 6 神裝)</span></h4>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:8px">
            ${revList.map(x => `
              <div class="combo-row" style="margin:0" data-open-champ-aug="${esc(x.champ.key)}:${selAug.id}">
                <div style="display:flex;align-items:center;gap:8px;min-width:0">
                  <img src="${esc(x.champ.img)}" alt="" style="width:32px;height:32px;border-radius:6px" />
                  <div style="min-width:0">
                    <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.champ.name)}</div>
                    <div class="mono" style="font-size:11px;color:var(--text-muted)">表現 ${x.perf} · ${x.pop}%</div>
                  </div>
                </div>
                <span class="t-badge t-${x.tier}">${TIER_LABEL[x.tier]}</span>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    }

    const catPills = [["ALL", "全部分類"], ...Object.entries(SYN.CAT_META).map(([k, v]) => [k, `${v.icon} ${v.label}`])];
    view.innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <h3>✨ 海克斯反查圖鑑 <span class="muted-count">(${allAugs.length} / ${Object.keys(DATA.augments).length})</span></h3>
          <input id="encSearchInput" type="search" class="input-sm" placeholder="搜尋海克斯 (如: 幻影武器、發明家、心鋼)..." value="${esc(state.encSearch)}" style="width:260px" />
        </div>
        <div class="aug-filter-bar">
          <div class="pill-group">${[["ALL","全稀有度"],["8","稜鏡"],["4","黃金"],["1","白銀"]].map(([v,l]) => `<button class="pill ${state.encRarity===v?"active":""}" data-er="${v}">${l}</button>`).join("")}</div>
          <div class="pill-group">${catPills.map(([v,l]) => `<button class="pill ${state.encCat===v?"active":""}" data-ec="${v}">${l}</button>`).join("")}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;max-height:175px;overflow-y:auto;padding:4px 0">
          ${allAugs.map(a => {
            const retired = ENG.isAugRetired(a);
            return `
            <button class="pill ${selAug && a.id===selAug.id ? "active" : ""} ${retired ? "aug-retired" : ""}" ${retired ? "disabled title=\"非本賽季可選海克斯\"" : `data-sel-aug="${a.id}"`} style="display:inline-flex;align-items:center;gap:6px">
              <img src="${esc(a.img)}" style="width:18px;height:18px;border-radius:4px;background:#000" />
              <span>${esc(a.name)}</span>
              ${retired ? `<span style="font-size:10px;color:var(--muted)">非本季</span>` : (SYN.RULES[a.id] ? `<span style="color:var(--teal)">⚡</span>` : "")}
            </button>
          `;
          }).join("")}
        </div>
      </div>
      ${detailHtml}
    `;

    const es = document.getElementById("encSearchInput");
    es.oninput = (e) => {
      const pos = e.target.selectionStart; state.encSearch = e.target.value; renderAugmentEncyclopedia();
      const inp = document.getElementById("encSearchInput"); if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
    };
    view.querySelectorAll("[data-er]").forEach(b => b.onclick = () => { state.encRarity = b.dataset.er; renderAugmentEncyclopedia(); });
    view.querySelectorAll("[data-ec]").forEach(b => b.onclick = () => { state.encCat = b.dataset.ec; renderAugmentEncyclopedia(); });
    view.querySelectorAll("[data-sel-aug]").forEach(b => b.onclick = () => { state.encSelectedAugId = Number(b.dataset.selAug); renderAugmentEncyclopedia(); });
    view.querySelectorAll("[data-open-champ-aug]").forEach(b => b.onclick = () => {
      const [ck, aid] = b.dataset.openChampAug.split(":"); selectChampion(ck, Number(aid)); state.champSubTab = "build"; switchView("champion");
    });
  }

  // =========================================================================
  // VIEW 4: MECHANICS CHEAT SHEET
  // =========================================================================
  function renderCheatSheet() {
    const view = document.getElementById("view-cheatsheet");
    const uniqueRuleIds = Object.keys(SYN.RULES).map(Number).map(aid => ({ aid, aug: DATA.augments[String(aid)], r: SYN.RULES[aid] })).filter(x => x.aug && !ENG.isAugRetired(x.aug));
    uniqueRuleIds.sort((a, b) => (a.aug.gTier - b.aug.gTier) || (b.aug.gPerf - a.aug.gPerf));

    const cards = uniqueRuleIds.map(({ aid, aug, r }) => {
      const cm = SYN.CAT_META[r.cat];
      const tops = (augToChamps[aid] || []).slice(0, 5);
      const primaryItems = (r.routes[0] ? r.routes[0].items : []).slice(0, 5);
      return `
        <div class="panel" style="margin:0;display:flex;flex-direction:column;gap:8px;border-color:var(--border)">
          <div style="display:flex;align-items:center;gap:10px">
            <img src="${esc(aug.img)}" style="width:42px;height:42px;border-radius:8px;background:#000" />
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <b style="font-size:15px;color:var(--gold-bright)">${esc(aug.name)}</b>
                <span class="t-badge t-${aug.gTier}">${TIER_LABEL[aug.gTier]}</span>
                <span class="t-badge rar-tag-${aug.rarity}">${RARITY_ZH[aug.rarity] || ""}</span>
                <span class="chip" style="border-color:${cm.color};color:${cm.color}">${cm.icon} ${esc(cm.label)}</span>
              </div>
              <div style="font-size:12.5px;color:var(--teal);font-weight:600;margin-top:2px">${esc(r.headline)}</div>
            </div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:5px">${primaryItems.map(iid => itemHtml(iid)).join("")}</div>
          ${r.routes.length > 1 ? `<div class="muted" style="font-size:11.5px">含 ${r.routes.length} 條不同定位路線（AP / AD / 坦克 / 輔助）</div>` : ""}
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:6px;border-top:1px solid rgba(38,53,84,0.6)">
            <span class="muted" style="font-size:11px">最適配英雄：</span>
            ${tops.map(t => `<button class="pill" data-open-champ-aug="${esc(t.champ.key)}:${aid}" style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px"><img src="${esc(t.champ.img)}" style="width:16px;height:16px;border-radius:3px" />${esc(t.champ.name)}</button>`).join("")}
            <button class="btn-ghost" data-goto-enc="${aid}" style="margin-left:auto;font-size:11px">詳情 →</button>
          </div>
        </div>
      `;
    }).join("");

    view.innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <h3>📜 海克斯「抽到必轉裝備」機制速查表 <span class="muted-count">(${uniqueRuleIds.length} 個特化海克斯)</span></h3>
          <span class="muted" style="font-size:12px">開局/選牌看到這些海克斯時，立即對照應該轉出的核心特化裝備</span>
        </div>
      </div>
      <div class="cheat-grid">${cards}</div>
    `;
    view.querySelectorAll("[data-open-champ-aug]").forEach(b => b.onclick = () => {
      const [ck, aid] = b.dataset.openChampAug.split(":"); selectChampion(ck, Number(aid)); state.champSubTab = "build"; switchView("champion");
    });
    view.querySelectorAll("[data-goto-enc]").forEach(b => b.onclick = () => {
      state.encSelectedAugId = Number(b.dataset.gotoEnc); switchView("augments");
    });
  }

  // =========================================================================
  // VIEW 5: TIER LIST
  // =========================================================================
  function renderTierList() {
    const view = document.getElementById("view-tierlist");
    const q = state.tierSearch.trim().toLowerCase();
    let list = DATA.champions.filter(c =>
      !q || c.name.toLowerCase().includes(q) || c.key.toLowerCase().includes(q) || (c.title || "").toLowerCase().includes(q)
    );
    const col = state.tierSortCol;
    const dir = state.tierSortAsc ? 1 : -1;
    list.sort((a, b) => {
      if (col === "rank") return (a.rank - b.rank) * dir;
      if (col === "wr") return (a.wr - b.wr) * dir;
      if (col === "pr") return (a.pr - b.pr) * dir;
      if (col === "tier") return (a.tier - b.tier) * dir;
      return a.rank - b.rank;
    });

    view.innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <h3>🏆 全 173 位英雄 ARAM: Mayhem 強度排行榜 (Patch ${esc(DATA.patch)})</h3>
          <input id="tierSearchInput" type="search" class="input-sm" placeholder="搜尋英雄..." value="${esc(state.tierSearch)}" style="width:220px" />
        </div>
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead>
              <tr>
                <th data-tsort="rank">排名 ↕</th><th>英雄</th><th>定位</th>
                <th data-tsort="tier">OP.GG 梯隊 ↕</th><th data-tsort="wr">勝率 ↕</th><th data-tsort="pr">選取率 ↕</th>
                <th>OP.GG 核心三件套</th><th>Top 3 適用海克斯</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(c => {
                const top3Augs = (c.augs || []).slice(0, 3).map(a => DATA.augments[String(a[0])]).filter(Boolean);
                const topCore = c.core && c.core[0] ? c.core[0].ids : [];
                return `
                  <tr style="cursor:pointer" data-tl-champ="${esc(c.key)}">
                    <td class="mono muted">#${c.rank}</td>
                    <td><div style="display:flex;align-items:center;gap:8px"><img src="${esc(c.img)}" style="width:30px;height:30px;border-radius:6px" loading="lazy" /><div><b>${esc(c.name)}</b> <span class="muted" style="font-size:11px">${esc(c.title)}</span></div></div></td>
                    <td class="muted">${esc((c.roles || []).map(r => ROLE_ZH[r] || r).join("/"))}</td>
                    <td><span class="t-badge t-${c.tier}">${TIER_LABEL[c.tier]}</span></td>
                    <td class="mono" style="font-weight:700;color:${c.wr>=52?"var(--green)":(c.wr<48?"var(--red)":"var(--text)")}">${c.wr.toFixed(2)}%</td>
                    <td class="mono">${c.pr.toFixed(2)}%</td>
                    <td><div class="build-icons">${topCore.map(iid => { const it = DATA.items[String(iid)]; return it ? `<img src="${esc(it.img)}" alt="${esc(it.name)}" data-item-id="${iid}" />` : ""; }).join("")}</div></td>
                    <td><div style="display:flex;gap:4px;flex-wrap:wrap">${top3Augs.map(a => `<span class="chip">${esc(a.name)}</span>`).join("")}</div></td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const ts = document.getElementById("tierSearchInput");
    ts.oninput = (e) => {
      const pos = e.target.selectionStart; state.tierSearch = e.target.value; renderTierList();
      const inp = document.getElementById("tierSearchInput"); if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
    };
    view.querySelectorAll("[data-tsort]").forEach(th => th.onclick = () => {
      const c = th.dataset.tsort;
      if (state.tierSortCol === c) state.tierSortAsc = !state.tierSortAsc;
      else { state.tierSortCol = c; state.tierSortAsc = (c === "rank" || c === "tier"); }
      renderTierList();
    });
    view.querySelectorAll("[data-tl-champ]").forEach(tr => tr.onclick = () => {
      selectChampion(tr.dataset.tlChamp, null); switchView("champion");
    });
  }

  // ---------- AUTO-SYNC ON STARTUP & HOT RELOAD ----------
  function reloadDataBundle() {
    return new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = "./data.js?v=" + Date.now();
      sc.onload = () => {
        if (window.HEX_DATA) {
          rebuildDataIndexes(window.HEX_DATA);
          renderCurrentView();
          resolve(true);
        } else {
          reject(new Error("HEX_DATA missing"));
        }
      };
      sc.onerror = () => reject(new Error("Failed to reload data.js"));
      document.body.appendChild(sc);
    });
  }

  function initAutoSync() {
    const btn = document.getElementById("syncStatusBtn");
    if (!btn) return;
    let pollTimer = null;
    let loadedGenAt = DATA.generatedAt || "";
    let hasLocalBackend = false;

    function setPill(cls, text, title) {
      btn.className = "sync-pill " + (cls || "");
      btn.textContent = text;
      if (title) btn.title = title;
    }

    async function checkLiveRiotPatch() {
      try {
        const res = await fetch("https://ddragon.leagueoflegends.com/api/versions.json", { cache: "no-store" });
        if (!res.ok) return null;
        const vers = await res.json();
        return vers && vers[0] ? String(vers[0]) : null;
      } catch { return null; }
    }

    async function pollLocalSync() {
      try {
        const res = await fetch("./api/sync-status?t=" + Date.now(), { cache: "no-store" });
        if (!res.ok) throw new Error("no backend");
        hasLocalBackend = true;
        const st = await res.json();
        if (st.state === "running") {
          setPill("syncing", `🔄 同步中 ${st.progress || ""}`, st.message || "正在同步最新資料...");
          if (!pollTimer) pollTimer = setInterval(pollLocalSync, 1800);
          return true;
        }
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (st.state === "error") {
          setPill("warn", "⚠️ 同步部分失敗 (點此重試)", st.message || "");
          return true;
        }
        const targetGen = st.generatedAt || loadedGenAt;
        if (st.state === "done" && st.generatedAt && st.generatedAt !== loadedGenAt) {
          loadedGenAt = st.generatedAt;
          await reloadDataBundle();
        }
        const shortTime = targetGen ? targetGen.slice(5, 16) : (DATA.generatedAt || "");
        setPill("synced", `✅ 已同步 Patch ${DATA.patch} (${shortTime})`, `資料時間：${targetGen} · 點擊立即重新同步`);
        return true;
      } catch {
        hasLocalBackend = false;
        return false;
      }
    }

    (async () => {
      const ok = window.location.protocol.startsWith("http") ? await pollLocalSync() : false;
      if (!ok) {
        const liveDdVer = await checkLiveRiotPatch();
        const livePatch = liveDdVer ? liveDdVer.split(".").slice(0, 2).join(".") : null;
        if (livePatch && DATA.patch && livePatch !== DATA.patch) {
          setPill("warn", `🟡 新版 ${livePatch} 可更新`, `目前資料為 ${DATA.patch} (${DATA.generatedAt})，請透過 start_guide.bat 或 serve.ps1 啟動以自動同步最新資料`);
        } else {
          const ts = DATA.generatedAt ? DATA.generatedAt.slice(5, 16) : "";
          setPill("synced", `🟢 Patch ${DATA.patch}${ts ? " · " + ts : ""}`, `資料時間：${DATA.generatedAt || ""}（透過 serve.ps1 / start_guide.bat 啟動時將自動同步最新資料）`);
        }
      }
    })();

    btn.onclick = async () => {
      if (hasLocalBackend) {
        setPill("syncing", "🔄 觸發同步中...", "正在向 OP.GG / ARAMGG / Riot 同步最新資料");
        try {
          await fetch("./api/sync", { method: "POST", cache: "no-store" });
          await pollLocalSync();
        } catch {}
      } else {
        setPill("syncing", "🔄 檢查線上版本...", "");
        const liveDdVer = await checkLiveRiotPatch();
        const livePatch = liveDdVer ? liveDdVer.split(".").slice(0, 2).join(".") : DATA.patch;
        setPill(
          livePatch !== DATA.patch ? "warn" : "synced",
          livePatch !== DATA.patch ? `🟡 新版 ${livePatch}（需以本機腳本同步）` : `🟢 已為最新 Patch ${DATA.patch}`,
          "靜態模式僅能檢查版本；使用 start_guide.bat 或 serve.ps1 啟動會自動抓取最新 OP.GG / ARAMGG 資料"
        );
      }
    };
  }

  // Initial render (Unified Pick Decision & Champion Build Workspace!)
  renderChampionGrid();
  renderChampionDetail();
  initAutoSync();
})();

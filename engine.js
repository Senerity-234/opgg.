// Quick In-Game Pick Decision Engine & Hero Growth/Damage Simulator (Patch 16.22)
window.HEX_ENGINE = (function () {
  // ---------- SEASON & CHAMPION ELIGIBILITY HELPERS ----------
  // Past-season / retired augments in Patch 16.22 have gTier === 5 && gPop <= 0.02
  function isAugRetired(augMeta) {
    if (!augMeta) return true;
    return augMeta.gTier === 5 && (augMeta.gPop || 0) <= 0.02;
  }

  // Per-champion eligibility in ARAM: Mayhem
  function getChampAugEntry(champ, augId) {
    return (champ.augs || []).find(a => a[0] === augId) || null;
  }

  function isAugEligibleForChamp(champ, augMeta) {
    if (!augMeta || isAugRetired(augMeta)) return false;
    return !!getChampAugEntry(champ, augMeta.id);
  }

  // Augments that target a specific skill "?" and allow user selection in Damage Simulator
  const SKILL_TARGET_AUGS = {
    3123: { name: "寶石手鍊", allowed: ["Q", "W", "E"], defaultSkill: "Q", desc: "指定技能可觸發暴擊 (+25% 暴擊率)" },
    1103: { name: "土司和奶油", allowed: ["Q", "W", "E"], defaultSkill: "Q", desc: "指定技能獲得 +100 技能加速" },
    1151: { name: "土司和起司", allowed: ["Q", "W", "E"], defaultSkill: "W", desc: "指定技能獲得 +100 技能加速" },
    1150: { name: "土司和果醬", allowed: ["Q", "W", "E"], defaultSkill: "E", desc: "指定技能獲得 +100 技能加速" },
    2100: { name: "疾速追擊", allowed: ["Q", "W", "E"], defaultSkill: "Q", hasLevelSlider: true, maxVal: 160, defaultVal: 120, sliderLabel: "任務加速", desc: "任務完成後指定技能獲得最多 160 技能加速" },
    2116: { name: "追求力量", allowed: ["Q", "W", "E"], defaultSkill: "Q", hasLevelSlider: true, maxVal: 30, defaultVal: 20, sliderLabel: "增傷%", desc: "任務完成後永久提升指定技能傷害 %" },
    3060: { name: "一片歌手", allowed: ["Q", "W", "E", "R"], defaultSkill: "Q", desc: "每 100 技能加速提升該技能 75% 傷害（不再減該技能CD）" },
    3088: { name: "血色鈷石", allowed: ["Q", "W", "E"], defaultSkill: "Q", desc: "指定技能標記敵人，普攻觸發額外魔傷並縮短冷卻" },
    3159: { name: "崛起", allowed: ["Q", "W", "E", "R"], defaultSkill: "Q", hasLevelSlider: true, maxVal: 3, defaultVal: 1, sliderLabel: "重施次數", desc: "指定技能擊殺後可重施並每次增傷" },
    3176: { name: "強化！", allowed: ["Q", "W", "E", "R"], defaultSkill: "Q", desc: "強化指定技能：+20 技能加速、+10% 傷害/治護" }
  };

  // ---------- PART 1: QUICK PICK DECISION ENGINE ----------
  const STACK_QUEST_IDS = new Set([
    1390, 1353, 1375, 1152, 1156, 2141, 1361, 3081, 1384, 1320, 1319, 1204, 1337, 2102, 2100, 2116, 2103
  ]);
  const CAPSTONE_MULT_IDS = new Set([
    1048, 1030, 1041, 1325, 1129, 1134, 1084, 1007, 1389, 1349, 1088, 1002, 1238, 1205, 1206, 1054, 3018, 1047, 1077, 1068, 1388, 1195, 1115, 1336
  ]);

  const AUG_SYNERGIES = [
    [1029, 1129, 3.8, "幻影武器 + 射手法師：技能與平A雙向吃滿 AP 特效與雙修增傷"],
    [1029, 3078, 3.4, "幻影武器 + 轟鳴低音：技能觸發命中特效同時強化下次普攻"],
    [1029, 1058, 4.2, "幻影武器 + 祕術拳擊：技能也能觸發命中特效來狂減技能冷卻！"],
    [1029, 1225, 3.2, "幻影武器 + 雙刀流：共享全套攻擊特效裝備（殞落/納什/海妖）"],
    [1029, 3086, 3.2, "幻影武器 + 蜜蜂來襲：技能與蜜蜂同步觸發全套命中特效裝"],
    [1029, 1087, 3.0, "幻影武器 + 颱風：技能與分裂箭矢共享攻擊特效放大"],
    [1029, 2010, 3.0, "幻影武器 + 雙重命中：暴擊與技能雙軌觸發特效"],
    [1029, 1152, 3.5, "幻影武器 + 心鋼起來：遠程技能就能幫雄心之鋼安全疊層！"],

    [1048, 1077, 4.0, "寶石手套 + 靈魂虹吸：技能暴擊直接觸發 12% 高額吸血！"],
    [1048, 1047, 3.6, "寶石手套 + 痛恨一擊：直接補滿 75%+ 技能暴擊率！"],
    [1048, 1336, 4.2, "寶石手套 + 升級無盡之刃：技能暴擊傷害獲得超額無盡暴傷倍率！"],
    [1048, 3018, 3.8, "寶石手套 + 狂暴一擊：+35% 暴傷與攻速轉暴傷讓技能核彈翻倍"],
    [1048, 1092, 3.5, "寶石手套 + 見縫插針：技能、道具與持續傷害全部暴擊！"],
    [1048, 1134, 3.8, "寶石手套 + 拔劍吧：拔劍巨額物攻 × 技能暴擊讓大招/技能毀天滅地！"],
    [1048, 1328, 2.5, "寶石手套 + 暴擊節奏：提供 25% 額外暴擊率撐高技能暴擊期望"],
    [3123, 1077, 3.2, "寶石手鍊 + 靈魂虹吸：指定技能暴擊直接觸發 12% 吸血！"],
    [3123, 1134, 3.2, "寶石手鍊 + 拔劍吧：高額 AD 搭配指定技能暴擊爆發極強"],
    [3123, 1336, 3.4, "寶石手鍊 + 升級無盡之刃：大幅放大該技能的暴擊倍率"],

    [1030, 1390, 4.2, "靈光一閃 + 極度邪惡：無限疊 AP 直接轉成海量技能加速！"],
    [1030, 1097, 2.6, "靈光一閃 + 女巫思維：額外 AP 轉化為更多技能加速"],
    [1030, 1156, 3.8, "靈光一閃 + 烏莉特的法帽：超高法強 × 法帽倍率讓技能無冷卻！"],
    [1030, 3059, 3.6, "靈光一閃 + 沒有魔力也沒問題：魔力轉高 AP 再轉技能加速"],
    [1030, 1098, 3.4, "靈光一閃 + 腳程加速：AP → 技能加速 → 70% 轉為飆車跑速！"],
    [1030, 1180, 3.2, "靈光一閃 + 超強大腦：高 AP 同時獲得高技能加速與巨額護盾"],

    [1098, 1068, 3.2, "腳程加速 + 循環利用：60 技能加速直接免費送 +42 跑速"],
    [1098, 1388, 3.8, "腳程加速 + 無限循環：無限疊加速讓跑速一直飆升"],
    [1098, 1026, 3.8, "腳程加速 + 別眨眼：加速轉跑速再轉為高額百分比全增傷！"],
    [1098, 1373, 2.8, "腳程加速 + 縮小引擎：雙重技能加速與跑速疊加"],

    [1041, 1353, 3.6, "巨人 + 坦克引擎：最大生命乘區互相疊乘，血量破萬"],
    [1041, 1181, 4.0, "巨人 + 重型打手：+35% 生命讓普攻 3.5% 最大生命真拳痛到炸！"],
    [1041, 2102, 3.4, "巨人 + 壓力鍋：超大生命值放大周圍生命灼燒傷害"],
    [1041, 1152, 4.2, "巨人 + 心鋼起來：3 倍心鋼層數再吃 +35% 最大生命倍率！"],
    [1041, 1001, 3.0, "巨人 + 泰坦的決意：前排雙倍坦度與適性之力"],

    [1353, 1181, 3.4, "坦克引擎 + 重型打手：擊殺疊血直接轉成普攻重擊傷害"],
    [1353, 1152, 3.6, "坦克引擎 + 心鋼起來：疊層血牛流核心雙引擎"],
    [1002, 1152, 4.2, "頂尖發明家 + 心鋼起來：道具冷卻減半讓心鋼光速疊滿 300 層！"],
    [1002, 1361, 3.6, "頂尖發明家 + 伊卡西亞殞落：坦克觸發裝與護盾冷卻減半"],
    [1002, 1318, 3.0, "頂尖發明家 + 升級中婭沙漏：金人冷卻極短頻繁無敵拉扯"],

    [1045, 1133, 3.4, "煉獄使者 + 魔法導彈：遠程技能持續觸發燃燒減 CD 與飛彈真傷"],
    [1045, 1390, 3.0, "煉獄使者 + 極度邪惡：減基礎冷卻加快疊法強速度"],

    [1037, 1015, 4.0, "急救箱 + 死亡循環：+20% 治護量直接放大死亡循環奶傷核彈！"],
    [1037, 1141, 3.2, "急救箱 + 全部都給你：奶量與護盾倍率乘算提升"],
    [1037, 1095, 2.8, "急救箱 + 風語者的祝福：雙輔增幅極限保排"],
    [1037, 1076, 2.8, "急救箱 + 餘音震盪：治護連動範圍傷害與緩速"],
    [1015, 1141, 3.5, "死亡循環 + 全部都給你：高額治療全部轉成對敵傷害"],
    [1015, 3163, 3.0, "死亡循環 + 迷人蝶影：治療同時觸發蝴蝶與死亡循環雙重魔傷"],

    [1134, 1077, 3.4, "拔劍吧 + 靈魂虹吸：近戰暴擊吸血配超高額 AD 站嚕不死"],
    [1134, 1181, 3.2, "拔劍吧 + 重型打手：拔劍送大量生命直接轉成重擊傷害"],
    [1134, 2132, 3.0, "拔劍吧 + 術士果汁盒：高額物理傷害配全能吸血極難打死"],
    [1134, 1138, 2.8, "拔劍吧 + 飲血：近戰化後靠全能吸血貼臉硬剛"],
    [1134, 1225, 3.0, "拔劍吧 + 雙刀流：拔劍高額攻速與AD完美配雙刀流"],

    [1311, 3059, 4.0, "溢流 + 沒有魔力也沒問題：魔力同時加 AP 又加技能倍率！"],
    [1311, 3051, 3.2, "溢流 + 藍色屏障：雙倍耗魔直接轉換成雙倍巨額護盾"],
    [1311, 1056, 3.2, "溢流 + 因心成體：堆魔力同時獲得高傷與巨量最大生命"],

    [1349, 1088, 3.8, "大絕覺醒 + 終極革新：雙大絕連發同時重置兩輪基礎技能！"],
    [1349, 3055, 3.0, "大絕覺醒 + 大絕循環：加速大絕轉好頻繁觸發 300 技能加速"],
    [1349, 1344, 3.2, "大絕覺醒 + 最終型態：開大重置小技能同時開盾吸血衝陣"]
  ];

  const AUG_CONFLICTS = [
    [1004, 1349, -15.0, "⚠️ 嚴重衝突：基本功夫禁用大絕，與大絕覺醒完全失效！"],
    [1004, 1088, -15.0, "⚠️ 嚴重衝突：基本功夫禁用大絕，終極革新完全失效！"],
    [1004, 3055, -12.0, "⚠️ 嚴重衝突：基本功夫禁用大絕，大絕循環無效！"],
    [1004, 1344, -15.0, "⚠️ 嚴重衝突：基本功夫禁用大絕，最終型態無法觸發！"],
    [1004, 1211, -15.0, "⚠️ 嚴重衝突：基本功夫禁用大絕，殺戮時間無法觸發！"],
    [1004, 1194, -15.0, "⚠️ 嚴重衝突：基本功夫禁用大絕，妖精魔法無法觸發！"],
    [1134, 1071, -4.5, "⚠️ 路線衝突：拔劍吧變近戰後，射程加成的性價比大幅下滑"],
    [1134, 1115, -5.0, "⚠️ 路線衝突：拔劍吧與頂狙武器定位互斥（近戰無法發揮遠距離風箏）"],
    [2018, 1225, -3.5, "⚠️ 路線衝突：純粹-法師會將攻速轉為技能加速，削弱雙刀流平A頻率"],
    [2018, 1081, -4.0, "⚠️ 路線衝突：純粹-法師將攻速轉技能加速，與平A走速流方向不符"]
  ];

  function getBaseAugWinRate(champ, aid) {
    const wrArr = champ.augWr && champ.augWr[String(aid)];
    const opggEntry = (champ.augs || []).find(a => a[0] === aid);
    const tier = opggEntry ? opggEntry[1] : 3;
    const perf = opggEntry ? opggEntry[2] : 50;
    const pop = opggEntry ? opggEntry[3] : 0.5;

    const tierDelta = { 0: 4.8, 1: 2.6, 2: 0.8, 3: -0.6, 4: -2.0, 5: -3.5 }[tier] ?? 0;
    const perfDelta = (perf - 55) * 0.08;
    const estimatedWr = Math.max(41, Math.min(68, (champ.wr || 50) + tierDelta + perfDelta));

    if (wrArr && wrArr[0]) {
      const realWr = wrArr[0];
      return {
        baseWr: realWr * 0.85 + estimatedWr * 0.15,
        realWr,
        realPr: wrArr[1],
        tier,
        perf,
        pop,
        hasRealSample: true
      };
    }
    return {
      baseWr: estimatedWr,
      realWr: null,
      realPr: null,
      tier,
      perf,
      pop,
      hasRealSample: false
    };
  }

  function evaluateQuickChoices(champ, levelStage, prevAugIds, optionAugIds, data) {
    const prevSet = new Set(prevAugIds.filter(Boolean).map(Number));
    const results = [];

    for (const rawId of optionAugIds) {
      const aid = Number(rawId);
      if (!aid || !data.augments[String(aid)]) continue;
      const augMeta = data.augments[String(aid)];
      const base = getBaseAugWinRate(champ, aid);

      let stageAdj = 0;
      const stageNotes = [];
      const isQuest = STACK_QUEST_IDS.has(aid);
      const isCap = CAPSTONE_MULT_IDS.has(aid);

      if (levelStage === 1) {
        if (isQuest) {
          stageAdj += 2.2;
          stageNotes.push("Lv 1 開局選取：有整場時間疊層／解任務，成長收益最大 (+2.2%)");
        } else if (aid === 1030 || aid === 1048) {
          stageAdj -= 0.3;
          stageNotes.push("Lv 1 提示：前期尚無裝備時偏弱，但中後期極強 (-0.3%)");
        } else {
          stageNotes.push("Lv 1 即戰力穩定");
        }
      } else if (levelStage === 7) {
        if (isQuest) {
          stageAdj += 0.8;
          stageNotes.push("Lv 7 第二輪：仍有充足時間完成疊層與任務 (+0.8%)");
        } else if (isCap) {
          stageAdj += 0.7;
          stageNotes.push("Lv 7 第二輪：開始成型第一件大裝，倍率放大啟動 (+0.7%)");
        } else {
          stageNotes.push("Lv 7 穩健發揮");
        }
      } else if (levelStage === 11) {
        if (isQuest) {
          if (aid === 1152 || aid === 2141 || aid === 1361) {
            stageAdj -= 1.8;
            stageNotes.push("Lv 11 節奏提醒：此時才開啟高門檻裝備任務較拖節奏 (-1.8%)");
          } else if (aid === 1384) {
            stageAdj += 0.3;
            stageNotes.push("Lv 11 斗內：可直接補出關鍵第三件大裝 (+0.3%)");
          } else {
            stageAdj -= 0.9;
            stageNotes.push("Lv 11 成長折減：疊層時間少於前期 (-0.9%)");
          }
        } else if (isCap) {
          stageAdj += 1.6;
          stageNotes.push("Lv 11 核心放大期：身上已有 2~3 件裝，倍率收益顯著 (+1.6%)");
        } else {
          stageNotes.push("Lv 11 即戰力達標");
        }
      } else if (levelStage === 15) {
        if (isQuest) {
          if (aid === 1152 || aid === 2141 || aid === 1361 || aid === 1390 || aid === 1353 || aid === 1375) {
            stageAdj -= 3.8;
            stageNotes.push("⚠️ Lv 15 終局警告：剩餘回合極少，慢熱疊層／重頭做任務幾乎無法疊滿 (-3.8%)");
          } else if (aid === 1384) {
            stageAdj -= 1.2;
            stageNotes.push("Lv 15 經濟溢出提醒：滿裝後 1750 金錢收益下降 (-1.2%)");
          } else if (aid === 3081) {
            stageAdj -= 2.2;
            stageNotes.push("⚠️ Lv 15 提醒：命定武器疊層時間偏短 (-2.2%)");
          } else {
            stageAdj -= 1.8;
            stageNotes.push("Lv 15 成長時間有限 (-1.8%)");
          }
        } else if (isCap) {
          stageAdj += 2.6;
          stageNotes.push("🔥 Lv 15 終局神牌：滿裝高屬性下直接吃滿乘區倍率，即戰力封頂 (+2.6%)");
        } else if (aid === 1238 || aid === 1243) {
          stageAdj += 1.4;
          stageNotes.push("Lv 15 質變賭上限：有機會直接抽到頂級戰力稜鏡 (+1.4%)");
        } else {
          stageAdj += 0.2;
          stageNotes.push("Lv 15 即時戰力加成 (+0.2%)");
        }
      }

      let synAdj = 0;
      const synReasons = [];

      if (prevSet.has(aid)) {
        synAdj -= 20;
        synReasons.push("⚠️ 與已選海克斯重複");
      }

      for (const cb of (champ.combos || [])) {
        if (!cb.augs.includes(aid)) continue;
        const matchedPrev = cb.augs.filter(x => x !== aid && prevSet.has(x));
        if (matchedPrev.length >= 1) {
          const boost = matchedPrev.length >= 2 ? 4.8 : Math.max(1.8, (cb.wr - champ.wr) * 0.16);
          synAdj += boost;
          const names = matchedPrev.map(x => data.augments[String(x)]?.name || x).join(" + ");
          synReasons.push(`🏆 實戰黃金組合聯動（搭配「${names}」歷史組合勝率高達 ${cb.wr.toFixed(1)}% / ${cb.games}場）`);
          break;
        }
      }

      for (const [a, b, bonus, reason] of AUG_SYNERGIES) {
        if ((a === aid && prevSet.has(b)) || (b === aid && prevSet.has(a))) {
          synAdj += bonus;
          synReasons.push(`⚡ ${reason} (+${bonus.toFixed(1)}%)`);
        }
      }

      for (const [a, b, pen, reason] of AUG_CONFLICTS) {
        if ((a === aid && prevSet.has(b)) || (b === aid && prevSet.has(a))) {
          synAdj += pen;
          synReasons.push(`${reason} (${pen.toFixed(1)}%)`);
        }
      }

      const finalScore = Math.max(30, Math.min(82, base.baseWr + stageAdj + synAdj));

      results.push({
        id: aid,
        meta: augMeta,
        base,
        stageAdj: Math.round(stageAdj * 10) / 10,
        synAdj: Math.round(synAdj * 10) / 10,
        finalScore: Math.round(finalScore * 100) / 100,
        stageNotes,
        synReasons
      });
    }

    results.sort((a, b) => b.finalScore - a.finalScore);
    return results;
  }

  // ---------- PART 2: HERO GROWTH & DAMAGE SIMULATOR ----------
  function statAtLevel(base, growth, lvl) {
    if (lvl <= 1) return base;
    return base + growth * (lvl - 1) * (0.7025 + 0.0175 * (lvl - 1));
  }

  function defaultSkillRanks(lvl, skillOrderStr) {
    const order = (skillOrderStr || "Q > E > W").split(">").map(s => s.trim()).filter(Boolean);
    const first = order[0] || "Q";
    const second = order[1] || "E";
    const third = order[2] || "W";
    const ranks = { Q: 0, W: 0, E: 0, R: 0 };
    const seq = [first, second, third, first, first, "R", first, second, first, second, "R", second, second, third, third, "R", third, third];
    for (let i = 0; i < Math.min(lvl, 18); i++) {
      const k = seq[i];
      if (k === "R" && ranks.R < 3) ranks.R++;
      else if (ranks[k] < 5) ranks[k]++;
    }
    if (ranks.Q === 0) ranks.Q = 1;
    if (ranks.W === 0 && lvl >= 2) ranks.W = 1;
    if (ranks.E === 0 && lvl >= 3) ranks.E = 1;
    return ranks;
  }

  function simulateBuild(champ, lvl, skillRanksInput, itemIds, augIds, targetCfg, stackCfg, augCfg, data) {
    const bs = champ.baseStats || {};
    const ranks = skillRanksInput || defaultSkillRanks(lvl, champ.skillOrder);
    const augSet = new Set((augIds || []).map(Number));
    const itemSet = new Set((itemIds || []).map(Number));
    const stacks = stackCfg || { evil: 80, heartsteel: 400, tankEngine: 5, infRec: 5, destiny: 12, duality: 6 };
    const tgt = targetCfg || { hp: 3000, curHpPct: 100, armor: 110, mr: 80, giantDiffPct: 20 };
    const ac = augCfg || {};

    function getSkillOpt(aid) {
      const def = SKILL_TARGET_AUGS[aid];
      const cur = ac[aid] || {};
      return {
        skill: cur.skill || (def ? def.defaultSkill : "Q"),
        val: cur.val !== undefined ? cur.val : (def && def.defaultVal !== undefined ? def.defaultVal : 0)
      };
    }

    // 1. Base stats at level
    const baseHP = statAtLevel(bs.hp || 600, bs.hppl || 95, lvl);
    const baseMP = statAtLevel(bs.mp || 350, bs.mppl || 40, lvl);
    const baseAD = statAtLevel(bs.ad || 60, bs.adpl || 3.2, lvl);
    const baseAR = statAtLevel(bs.ar || 30, bs.arpl || 4.2, lvl);
    const baseMR = statAtLevel(bs.mr || 30, bs.mrpl || 1.3, lvl);
    const baseAS = bs.as || 0.65;
    const asRatio = bs.asRatio || baseAS;
    const asGrowthPct = lvl > 1 ? (bs.aspl || 2.5) * (lvl - 1) * (0.7025 + 0.0175 * (lvl - 1)) : 0;
    let range = bs.range || 550;
    let baseMS = bs.ms || 335;

    // 2. Aggregate item stats
    let itemAD = 0, itemAP = 0, itemHP = 0, itemMP = 0, itemAS = 0, itemCrit = 0, itemCritDmg = 0;
    let itemAH = 0, itemLeth = 0, itemArPenMult = 1.0, itemMrPenFlat = 0, itemMrPenMult = 1.0;
    let itemAR = 0, itemMR = 0, itemMS = 0, itemMSPct = 0, itemHSP = 0, itemLS = 0, itemOV = 0;

    for (const iid of (itemIds || [])) {
      const it = data.items[String(iid)];
      if (!it || !it.stats) continue;
      const st = it.stats;
      itemAD += st.ad || 0;
      itemAP += st.ap || 0;
      itemHP += st.hp || 0;
      itemMP += st.mp || 0;
      itemAS += st.as || 0;
      itemCrit += st.crit || 0;
      itemCritDmg += (st.critDmg || 0) / 100.0;
      itemAH += st.ah || 0;
      itemLeth += st.leth || 0;
      if (st.arPen) itemArPenMult *= (1 - st.arPen / 100.0);
      itemMrPenFlat += st.mrPen || 0;
      if (st.mrPenPct) itemMrPenMult *= (1 - st.mrPenPct / 100.0);
      itemAR += st.ar || 0;
      itemMR += st.mr || 0;
      itemMS += st.ms || 0;
      itemMSPct += st.msPct || 0;
      itemHSP += st.hsp || 0;
      itemLS += st.ls || 0;
      itemOV += st.ov || 0;
    }

    // 2b. Weapon of Destiny (3081 命定武器): upgrade selected legendary item with takedown stacks!
    let destinySummary = null;
    if (augSet.has(3081)) {
      const dStacks = stacks.destiny ?? 12;
      const validLeg = (itemIds || []).filter(id => {
        const m = data.items[String(id)];
        return m && (m.gold || 0) >= 2000 && !(m.tags || []).includes("Boots");
      });
      const chosenId = (ac.destinyItemId && validLeg.includes(Number(ac.destinyItemId)))
        ? Number(ac.destinyItemId)
        : (validLeg[0] || 0);
      if (chosenId) {
        const dm = data.items[String(chosenId)];
        const ds = dm.stats || {};
        // Weapon of Destiny scales stats based on the item's profile per takedown stack
        const addAD = (ds.ad || (!ds.ap && !ds.hp)) ? dStacks * 2.5 : 0;
        const addAP = ds.ap ? dStacks * 4.0 : 0;
        const addHP = ds.hp ? dStacks * 22 : 0;
        const addAS = ds.as ? dStacks * 1.5 : 0;
        const addAH = dStacks * 1.2;
        itemAD += addAD;
        itemAP += addAP;
        itemHP += addHP;
        itemAS += addAS;
        itemAH += addAH;
        destinySummary = {
          itemId: chosenId,
          itemName: dm.name,
          stacks: dStacks,
          bonusText: [
            addAD ? `+${Math.round(addAD)} AD` : "",
            addAP ? `+${Math.round(addAP)} AP` : "",
            addHP ? `+${Math.round(addHP)} HP` : "",
            addAS ? `+${Math.round(addAS)}% 攻速` : "",
            `+${Math.round(addAH)} 加速`
          ].filter(Boolean).join(" / ")
        };
      }
    }

    // 3. Item & Quest HP/MP conversions
    let heartsteelHP = itemSet.has(3084) ? (stacks.heartsteel || 0) : 0;
    if (augSet.has(1152) && itemSet.has(3084) && heartsteelHP >= 300) {
      heartsteelHP *= 3; // 心鋼起來 300層以上乘3倍
    }
    let bonusHP = itemHP + heartsteelHP;
    let bonusMP = itemMP;
    if (augSet.has(1056)) bonusHP += (baseMP + bonusMP) * 0.5;
    if (augSet.has(1013)) bonusHP += 1500;

    let bonusAD = itemAD;
    let bonusAP = itemAP;

    if (augSet.has(1156)) { // 烏莉特的法帽
      bonusAP += 140;
      itemAH += 25;
    }

    if (itemSet.has(2501)) bonusAD += bonusHP * 0.025;
    if (itemSet.has(4633)) bonusAP += bonusHP * 0.02;
    if (itemSet.has(3040) || itemSet.has(3003)) bonusAP += bonusMP * 0.02;
    if (itemSet.has(3042) || itemSet.has(3004)) bonusAD += (baseMP + bonusMP) * 0.025;
    if (itemSet.has(2517)) itemAH += bonusAD * 0.25;

    // 4. Augment flat/conversion stats
    if (augSet.has(1097)) bonusAP += 20 + (60 * (lvl - 1) / 17);
    if (augSet.has(1390)) bonusAP += (stacks.evil || 80);
    if (augSet.has(3094)) bonusAP += 55;
    if (augSet.has(1054)) { // 雙修大師
      const ds = stacks.duality ?? 6;
      bonusAP += ds * 12;
      bonusAD += ds * 8;
    }
    if (augSet.has(1022)) itemAS += 60;
    if (augSet.has(2009)) itemAS += 40; // 狂戰士
    if (augSet.has(1068)) itemAH += 60;
    if (augSet.has(1388)) itemAH += 60 + 3 * (stacks.infRec || 5);
    if (augSet.has(1373)) { itemAH += 30; itemMSPct += 12; }

    // Anvil augments (能力值!)
    if (augSet.has(1404) || augSet.has(1403) || augSet.has(1402)) {
      const mult = augSet.has(1402) ? 2.2 : (augSet.has(1403) ? 1.6 : 1.0);
      if (bonusAP > bonusAD * 1.2) bonusAP += Math.round(36 * mult);
      else bonusAD += Math.round(22 * mult);
      itemAH += Math.round(14 * mult);
    }

    if (augSet.has(1047)) itemCrit += 50;
    for (const cid of [1048, 3123, 1077, 1328, 1080, 2010, 1415, 2009, 1092]) {
      if (augSet.has(cid)) itemCrit += 25;
    }
    if (augSet.has(1084)) {
      itemArPenMult *= (1 - 0.18);
      itemMrPenMult *= (1 - 0.18);
    }
    if (augSet.has(1071)) range += 150;
    if (augSet.has(1115)) range += 250;
    if (augSet.has(1170)) range += 100;

    if (augSet.has(3059)) bonusAP += itemMP * 0.10;

    if (augSet.has(1205)) {
      bonusAP += bonusAD * 1.667;
      bonusAD = 0;
    } else if (augSet.has(1206)) {
      bonusAD += bonusAP * 0.6;
      bonusAP = 0;
    }

    let totalAD = baseAD + bonusAD;
    let totalAP = bonusAP;
    let totalHP = baseHP + bonusHP;

    // 5. Percentage Multipliers
    if (itemSet.has(3089) || augSet.has(1156)) totalAP *= 1.30;
    if (augSet.has(1205)) totalAP *= 1.15;
    if (augSet.has(1206)) totalAD *= 1.15;
    if (augSet.has(3059)) totalAP *= 1.15;

    // Jeweled Gauntlet (1048) AP -> bonus Crit% (~4% per 100 AP)
    if (augSet.has(1048) && totalAP > 0) {
      itemCrit += Math.min(25, Math.floor(totalAP * 0.04));
    }

    let drawSwordRatio = 0;
    if (augSet.has(1134)) {
      drawSwordRatio = Math.max(0.35, Math.min(1.0, (range - 150) / 500));
      range = 175;
      totalAD *= (1 + 0.35 * drawSwordRatio);
      totalHP *= (1 + 0.35 * drawSwordRatio);
      itemAS += 25 * drawSwordRatio;
      itemMSPct += 25 * drawSwordRatio;
      itemLS += 25 * drawSwordRatio;
    }
    if (augSet.has(1041)) {
      totalHP *= 1.35;
      if (totalAP > bonusAD * 1.3) totalAP *= 1.15;
      else totalAD *= 1.15;
    }
    if (augSet.has(1353)) totalHP *= (1 + 0.10 * (stacks.tankEngine || 5));
    if (augSet.has(1007)) totalAD *= 1.20;
    if (augSet.has(1389)) {
      if (totalAP > bonusAD * 1.3) totalAP *= 1.25;
      else totalAD *= 1.25;
    }
    if (augSet.has(3018)) totalAD = baseAD + (totalAD - baseAD) * 1.25;
    if (augSet.has(1325)) totalHP *= 0.70;

    bonusAD = Math.max(0, totalAD - baseAD);
    bonusHP = Math.max(0, totalHP - baseHP);

    // Crit & Crit Damage
    const critChance = Math.min(100, itemCrit);
    const critP = critChance / 100.0;
    let upgradeIEBonus = (augSet.has(1336) && itemSet.has(3031)) ? 0.25 : 0;
    let aaCritMult = (bs.critDmg || 1.75) + itemCritDmg + upgradeIEBonus;
    if (augSet.has(3018)) aaCritMult += 0.35 + (itemAS / 100.0) * 0.75;

    const canAllSkillCrit = augSet.has(1048);
    const hasBracelet = augSet.has(3123);
    const braceletSkill = hasBracelet ? getSkillOpt(3123).skill : null;
    const spellCritMult = 1.45 + itemCritDmg + upgradeIEBonus + (augSet.has(3018) ? 0.35 : 0);

    // Ability Haste & Ultimate Haste
    if (augSet.has(1030)) itemAH += totalAP * 0.30;
    if (augSet.has(2018)) { itemAH += itemAS * 0.75; itemAS = 0; }
    if (augSet.has(1004)) itemAH += 70;
    let ultAH = itemAH;
    if (itemSet.has(3118)) ultAH += 25;
    if (itemSet.has(2512)) ultAH += 30;
    if (itemSet.has(3073)) ultAH += 30;
    if (augSet.has(3055)) ultAH += 50;
    if (augSet.has(1349)) ultAH += 30;
    if (augSet.has(3173)) ultAH += 20;

    if (augSet.has(1098)) itemMS += itemAH * 0.70;
    const totalMS = (baseMS + itemMS) * (1 + itemMSPct / 100.0);
    const totalAS = Math.min(3.5, baseAS + asRatio * ((asGrowthPct + itemAS) / 100.0));
    const totalAR = baseAR + itemAR;
    const totalMR = baseMR + itemMR;

    // 6. Target Mitigation & Global Damage Multipliers
    const armorPenPct = (1 - itemArPenMult) * 100.0;
    const magicPenPct = (1 - itemMrPenMult) * 100.0;
    const effArmor = Math.max(0, tgt.armor * itemArPenMult - itemLeth);
    const effMR = Math.max(0, tgt.mr * itemMrPenMult - itemMrPenFlat);
    const physMit = 100.0 / (100.0 + effArmor);
    const magMit = 100.0 / (100.0 + effMR);

    let globalDmgMult = bs.aramDealt || 1.0;
    const dmgFactors = [];
    if (bs.aramDealt && bs.aramDealt !== 1.0) dmgFactors.push(`模式平衡 ×${bs.aramDealt.toFixed(2)}`);
    if (augSet.has(1195)) {
      const gsMult = 1 + ((tgt.giantDiffPct || 20) / 100.0);
      globalDmgMult *= gsMult;
      dmgFactors.push(`巨人殺手 ×${gsMult.toFixed(2)}`);
    }
    if (augSet.has(1013)) { globalDmgMult *= 0.90; dmgFactors.push("天界之身 ×0.90"); }
    if (augSet.has(1026)) { globalDmgMult *= 1.12; dmgFactors.push("別眨眼 ×1.12"); }
    if (augSet.has(1038)) { globalDmgMult *= 1.07; dmgFactors.push("先發制人 ×1.07"); }
    if (itemSet.has(2523)) { globalDmgMult *= 1.10; dmgFactors.push("C44遠距 ×1.10"); }
    const glassTrueRatio = augSet.has(1325) ? 0.12 : 0;

    // On-Hit package
    let onHitPhys = 0, onHitMag = 0;
    if (itemSet.has(3115)) onHitMag += 15 + totalAP * 0.15;
    if (itemSet.has(3153)) onHitPhys += (tgt.hp * (tgt.curHpPct / 100)) * (range <= 200 ? 0.08 : 0.05);
    if (itemSet.has(3091)) onHitMag += 45;
    if (itemSet.has(6672)) onHitPhys += 50;
    if (itemSet.has(3100)) onHitMag += baseAD * 0.75 + totalAP * 0.40;
    if (itemSet.has(2510)) onHitMag += baseAD * 1.0 + totalAP * 0.10;
    if (itemSet.has(3078)) onHitPhys += baseAD * 2.0;
    if (augSet.has(1129)) onHitPhys += totalAP * 0.75;
    if (augSet.has(1181)) onHitPhys += totalHP * 0.035;
    if (augSet.has(2016)) onHitMag += 45 + bonusAD * 0.15 + totalAP * 0.10;

    const aaRawExp = totalAD * ((1 - critP) + critP * aaCritMult);
    const aaCritRaw = totalAD * aaCritMult;
    const aaOnHitMit = (onHitPhys * physMit + onHitMag * magMit);
    const aaNormalMit = (totalAD * physMit + aaOnHitMit) * globalDmgMult * (1 + glassTrueRatio);
    const aaCritMit = (aaCritRaw * physMit + aaOnHitMit) * globalDmgMult * (1 + glassTrueRatio);
    const aaExpMit = (aaRawExp * physMit + aaOnHitMit) * globalDmgMult * (1 + glassTrueRatio);
    const aaDps = aaExpMit * totalAS;

    const overflowMult = augSet.has(1311) ? 1.18 : 1.0;

    // Skill-specific bonus trackers from "?" augments & Pentakill Metal augments
    const perSkillHaste = { Q: 0, W: 0, E: 0, R: 0 };
    const perSkillDmgMult = { Q: 1.0, W: 1.0, E: 1.0, R: 1.0 };
    const perSkillNotes = { Q: [], W: [], E: [], R: [] };
    const ignoreHasteSkill = { Q: false, W: false, E: false, R: false };

    for (const [aidStr, cfg] of Object.entries(SKILL_TARGET_AUGS)) {
      const aid = Number(aidStr);
      if (!augSet.has(aid)) continue;
      const opt = getSkillOpt(aid);
      const sk = opt.skill;
      if (aid === 1103 || aid === 1151 || aid === 1150) {
        perSkillHaste[sk] += 100;
        perSkillNotes[sk].push(`${cfg.name} +100 加速`);
      } else if (aid === 2100) {
        perSkillHaste[sk] += opt.val;
        perSkillNotes[sk].push(`疾速追擊 +${opt.val} 加速`);
      } else if (aid === 2116) {
        perSkillDmgMult[sk] *= (1 + opt.val / 100.0);
        perSkillNotes[sk].push(`追求力量 +${opt.val}% 傷害`);
      } else if (aid === 3123) {
        perSkillNotes[sk].push(`寶石手鍊：可暴擊`);
      } else if (aid === 3060) {
        const bonusPct = 0.75 * (itemAH / 100.0);
        perSkillDmgMult[sk] *= (1 + bonusPct);
        ignoreHasteSkill[sk] = true;
        perSkillNotes[sk].push(`一片歌手 +${Math.round(bonusPct * 100)}% 傷害 (不吃加速減CD)`);
      } else if (aid === 3088) {
        perSkillNotes[sk].push(`血色鈷石標記`);
      } else if (aid === 3159) {
        perSkillDmgMult[sk] *= (1 + opt.val * 0.15);
        perSkillNotes[sk].push(`崛起 ×${opt.val}重施`);
      } else if (aid === 3176) {
        perSkillHaste[sk] += 20;
        perSkillDmgMult[sk] *= 1.10;
        perSkillNotes[sk].push(`強化！+20加速/+10%傷`);
      }
    }
    if (augSet.has(3170)) { perSkillHaste.Q += 20; perSkillDmgMult.Q *= 1.10; perSkillNotes.Q.push("重金屬 +20加速/+10%傷"); }
    if (augSet.has(3171)) { perSkillHaste.W += 20; perSkillDmgMult.W *= 1.10; perSkillNotes.W.push("力量金屬 +20加速/+10%傷"); }
    if (augSet.has(3172)) { perSkillHaste.E += 20; perSkillDmgMult.E *= 1.10; perSkillNotes.E.push("鞭擊金屬 +20加速/+10%傷"); }
    if (augSet.has(3173)) { perSkillDmgMult.R *= 1.10; perSkillNotes.R.push("末日金屬 +20加速/+10%傷"); }

    // 7. Compute Q / W / E / R Skill Damages
    const skillResults = [];
    const formulas = champ.formulas || {};
    const skillsMeta = (champ.skills && champ.skills.q) ? champ.skills.q : [];

    for (const sk of ["Q", "W", "E", "R"]) {
      const rank = ranks[sk] || 1;
      const meta = skillsMeta.find(s => s.key === sk) || {};
      const rawEntries = formulas[sk];
      const entries = rawEntries ? (Array.isArray(rawEntries) ? rawEntries : [rawEntries]) : [];

      if (entries.length === 0) {
        skillResults.push({
          key: sk, name: meta.name || sk, img: meta.img || "", rank,
          hasFormula: false, notes: perSkillNotes[sk]
        });
        continue;
      }

      const mainEntry = entries.find(e => /Total/i.test(e.label)) || entries[0];
      const maxR = sk === "R" ? 3 : 5;
      const rIdx = Math.max(0, Math.min(rank - 1, maxR - 1));

      let rawBase = 0;
      const termParts = [];
      for (const term of mainEntry.terms) {
        const val = term.v[Math.min(rIdx, term.v.length - 1)] || 0;
        if (term.u === "flat") {
          rawBase += val;
          termParts.push(`${val}`);
        } else if (term.u === "ad") {
          const add = totalAD * (val / 100.0);
          rawBase += add;
          termParts.push(`${val}%總AD(${Math.round(add)})`);
        } else if (term.u === "bad") {
          const add = bonusAD * (val / 100.0);
          rawBase += add;
          termParts.push(`${val}%額外AD(${Math.round(add)})`);
        } else if (term.u === "ap") {
          const add = totalAP * (val / 100.0);
          rawBase += add;
          termParts.push(`${val}%AP(${Math.round(add)})`);
        } else if (term.u === "hp" || term.u === "bhp") {
          const src = term.u === "bhp" ? bonusHP : totalHP;
          const add = src * (val / 100.0);
          rawBase += add;
          termParts.push(`${val}%生命(${Math.round(add)})`);
        } else if (term.u === "tMaxHp") {
          const add = tgt.hp * (val / 100.0);
          rawBase += add;
          termParts.push(`${val}%目標最大生命(${Math.round(add)})`);
        } else if (term.u === "tCurHp") {
          const add = (tgt.hp * tgt.curHpPct / 100.0) * (val / 100.0);
          rawBase += add;
          termParts.push(`${val}%目標現生命(${Math.round(add)})`);
        } else if (term.u === "tMissHp") {
          const add = (tgt.hp * (100 - tgt.curHpPct) / 100.0) * (val / 100.0);
          rawBase += add;
          termParts.push(`${val}%目標已損生命(${Math.round(add)})`);
        } else if (term.u === "mp") {
          const add = (baseMP + bonusMP) * (val / 100.0);
          rawBase += add;
          termParts.push(`${val}%魔力(${Math.round(add)})`);
        } else if (term.u === "ar" || term.u === "bar") {
          const src = term.u === "bar" ? itemAR : totalAR;
          const add = src * (val / 100.0);
          rawBase += add;
          termParts.push(`${val}%物防(${Math.round(add)})`);
        } else if (term.u === "mr" || term.u === "bmr") {
          const src = term.u === "bmr" ? itemMR : totalMR;
          const add = src * (val / 100.0);
          rawBase += add;
          termParts.push(`${val}%魔防(${Math.round(add)})`);
        }
      }

      let innateCritScale = 1.0;
      if (mainEntry.critScale && mainEntry.critScale > 0) {
        innateCritScale = 1 + mainEntry.critScale * critP;
        termParts.push(`暴擊率技能增傷×${innateCritScale.toFixed(2)}`);
      }

      let basicMasteryMult = 1.0;
      let disabledByBasic = false;
      if (augSet.has(1004)) {
        if (sk === "R") disabledByBasic = true;
        else basicMasteryMult = 1.25;
      }

      const dt = mainEntry.dt || "PHYSICAL_DAMAGE";
      const mit = dt === "TRUE_DAMAGE" ? 1.0
        : (dt === "MAGIC_DAMAGE" ? magMit
        : (dt === "OTHER_DAMAGE" ? (magMit + 1.0) / 2.0 : physMit));

      const rawTotal = disabledByBasic ? 0 : rawBase * innateCritScale * basicMasteryMult * overflowMult * perSkillDmgMult[sk];
      const nonCritMit = rawTotal * mit * globalDmgMult * (1 + glassTrueRatio);

      const shadowflameCrit = (itemSet.has(4645) && tgt.curHpPct <= 40 && (dt === "MAGIC_DAMAGE" || dt === "TRUE_DAMAGE")) ? 1.20 : 1.0;

      // Skill Crit: either Jeweled Gauntlet (1048) OR Jeweled Bracelet (3123) on selected skill!
      const skillCanCrit = !disabledByBasic && (canAllSkillCrit || (hasBracelet && braceletSkill === sk));
      const critMit = skillCanCrit ? (nonCritMit * spellCritMult) : (nonCritMit * shadowflameCrit);
      const expMit = skillCanCrit ? (nonCritMit * ((1 - critP) + critP * spellCritMult)) : (nonCritMit * shadowflameCrit);

      // Extra proc damages on skill hit (Twinfire 1415, Infernal Soul 1046, Magic Missile 1133)
      let procBonus = 0;
      if (!disabledByBasic) {
        if (augSet.has(1415)) procBonus += (65 + totalAP * 0.20) * magMit * globalDmgMult; // 雙響炮飛彈
        if (augSet.has(1046) || augSet.has(1062)) procBonus += (80 + bonusAD * 0.22 + totalAP * 0.15) * magMit * globalDmgMult;
        if (augSet.has(1133)) procBonus += tgt.hp * 0.045; // 魔法導彈最大生命真傷估算
      }

      // Ethereal Weapon (1029) skill On-Hit bonus
      let ethBonus = 0;
      if (!disabledByBasic && augSet.has(1029)) {
        let itemOnlyPhys = 0, itemOnlyMag = 0;
        if (itemSet.has(3115)) itemOnlyMag += 15 + totalAP * 0.15;
        if (itemSet.has(3153)) itemOnlyPhys += (tgt.hp * (tgt.curHpPct / 100)) * (range <= 200 ? 0.08 : 0.05);
        if (itemSet.has(3091)) itemOnlyMag += 45;
        if (itemSet.has(6672)) itemOnlyPhys += 50;
        if (itemSet.has(3100)) itemOnlyMag += baseAD * 0.75 + totalAP * 0.40;
        if (itemSet.has(2510)) itemOnlyMag += baseAD * 1.0 + totalAP * 0.10;
        if (itemSet.has(3078)) itemOnlyPhys += baseAD * 2.0;
        ethBonus = (itemOnlyPhys * physMit + itemOnlyMag * magMit) * globalDmgMult;
      }

      // Effective Cooldown
      let cdDisplay = "";
      if (meta.cd) {
        const cds = meta.cd.split("/").map(Number);
        const baseCd = cds[Math.min(rIdx, cds.length - 1)] || cds[0];
        if (baseCd) {
          const totalSkHaste = ignoreHasteSkill[sk] ? 0 : ((sk === "R" ? ultAH : itemAH) + perSkillHaste[sk]);
          const effCd = baseCd * (100.0 / (100.0 + totalSkHaste));
          cdDisplay = `${effCd.toFixed(1)}s (原 ${baseCd}s${perSkillHaste[sk] ? `, +${perSkillHaste[sk]}專精加速` : ""})`;
        }
      }

      skillResults.push({
        key: sk,
        name: meta.name || sk,
        img: meta.img || "",
        rank,
        hasFormula: true,
        disabledByBasic,
        dt,
        formulaText: termParts.join(" + "),
        cdDisplay,
        rawTotal: Math.round(rawTotal),
        nonCritMit: Math.round(nonCritMit + ethBonus + procBonus),
        critMit: Math.round(critMit + ethBonus + procBonus),
        expMit: Math.round(expMit + ethBonus + procBonus),
        ethBonus: Math.round(ethBonus),
        procBonus: Math.round(procBonus),
        skillCanCrit,
        spellCritMult,
        notes: perSkillNotes[sk]
      });
    }

    const comboBurst = Math.round(
      skillResults.reduce((acc, s) => acc + (s.hasFormula ? s.expMit : 0), 0) + aaExpMit * 2
    );

    const anySkillCanCrit = canAllSkillCrit || hasBracelet;
    const skillCritLabel = canAllSkillCrit
      ? `${spellCritMult.toFixed(2)}x (全技能)`
      : (hasBracelet ? `${spellCritMult.toFixed(2)}x (僅 ${braceletSkill})` : "不可");

    return {
      level: lvl,
      ranks,
      destinySummary,
      stats: {
        hp: Math.round(totalHP),
        mp: Math.round(baseMP + bonusMP),
        ad: Math.round(totalAD),
        baseAD: Math.round(baseAD),
        bonusAD: Math.round(bonusAD),
        ap: Math.round(totalAP),
        as: Number(totalAS.toFixed(2)),
        critChance: Math.round(critChance),
        aaCritMult: Number(aaCritMult.toFixed(2)),
        spellCritMult: Number(spellCritMult.toFixed(2)),
        canSkillCrit: anySkillCanCrit,
        skillCritLabel,
        armor: Math.round(totalAR),
        mr: Math.round(totalMR),
        ah: Math.round(itemAH),
        ultAh: Math.round(ultAH),
        leth: Math.round(itemLeth),
        armorPenPct: Math.round(armorPenPct),
        magicPenFlat: Math.round(itemMrPenFlat),
        magicPenPct: Math.round(magicPenPct),
        ms: Math.round(totalMS),
        range: Math.round(range),
        physMit: Number((physMit * 100).toFixed(1)),
        magMit: Number((magMit * 100).toFixed(1)),
        globalDmgMult: Number((globalDmgMult * (1 + glassTrueRatio)).toFixed(2)),
        dmgFactors
      },
      aa: {
        normal: Math.round(aaNormalMit),
        crit: Math.round(aaCritMit),
        expected: Math.round(aaExpMit),
        dps: Math.round(aaDps),
        onHit: Math.round(aaOnHitMit)
      },
      skills: skillResults,
      comboBurst
    };
  }

  function computeGrowthCurve(champ, itemIds, augIds, targetCfg, stackCfg, augCfg, data) {
    const levels = [1, 3, 5, 7, 9, 11, 13, 15, 18];
    return levels.map(lv => {
      const sim = simulateBuild(champ, lv, null, itemIds, augIds, targetCfg, stackCfg, augCfg, data);
      const baseSim = simulateBuild(champ, lv, null, [], [], targetCfg, stackCfg, {}, data);
      const rSkill = sim.skills.find(s => s.key === "R");
      const baseR = baseSim.skills.find(s => s.key === "R");
      return {
        level: lv,
        ad: sim.stats.ad,
        ap: sim.stats.ap,
        hp: sim.stats.hp,
        combo: sim.comboBurst,
        baseCombo: baseSim.comboBurst,
        rExp: rSkill && rSkill.hasFormula ? rSkill.expMit : 0,
        baseRExp: baseR && baseR.hasFormula ? baseR.expMit : 0,
        aaDps: sim.aa.dps
      };
    });
  }

  return {
    SKILL_TARGET_AUGS,
    isAugRetired,
    isAugEligibleForChamp,
    getChampAugEntry,
    evaluateQuickChoices,
    simulateBuild,
    computeGrowthCurve,
    defaultSkillRanks
  };
})();

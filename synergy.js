// Augment-to-Specialized-Item Synergy Engine for LoL ARAM: Mayhem (Patch 16.22)
window.HEX_SYNERGY = (function () {
  const CAT_META = {
    onhit:    { label: "命中特效聯動", color: "#f59e0b", icon: "⚡" },
    itemcd:   { label: "道具冷卻特化", color: "#0ac8b9", icon: "⏱️" },
    spellblade:{ label: "閃耀劍咒刃", color: "#38bdf8", icon: "🗡️" },
    ap_scale: { label: "法強/魔力轉換", color: "#a855f7", icon: "🔮" },
    hybrid:   { label: "雙修/屬性轉換", color: "#ec4899", icon: "⚖️" },
    crit:     { label: "暴擊機制特化", color: "#ef4444", icon: "💥" },
    burn:     { label: "灼燒/持續傷害", color: "#f97316", icon: "🔥" },
    tank:     { label: "生命/雙防疊層", color: "#22c55e", icon: "🛡️" },
    support:  { label: "治療/護盾連動", color: "#10b981", icon: "💚" },
    ult:      { label: "大絕循環/禁用", color: "#6366f1", icon: "👑" },
    quest:    { label: "專屬裝備任務", color: "#eab308", icon: "📜" },
    speed:    { label: "跑速/距離特化", color: "#14b8a6", icon: "💨" },
    cc:       { label: "控場觸發特化", color: "#8b5cf6", icon: "⛓️" }
  };

  // Helper to detect a champion's damage/playstyle profile from OP.GG items + DataDragon roles
  function detectChampProfile(champ, data) {
    const itemStats = champ.items || [];
    let apWeight = 0, adWeight = 0, critWeight = 0, onhitWeight = 0, tankWeight = 0, supWeight = 0;
    const itemMap = data.items || {};
    for (let i = 0; i < Math.min(12, itemStats.length); i++) {
      const it = itemStats[i];
      const meta = itemMap[String(it.id)];
      if (!meta || !meta.tags) continue;
      const w = Math.max(1, it.pr || 1);
      const tags = meta.tags;
      if (tags.includes("SpellDamage")) apWeight += w;
      if (tags.includes("Damage")) adWeight += w;
      if (tags.includes("CriticalStrike")) critWeight += w;
      if (tags.includes("OnHit")) onhitWeight += w;
      if (tags.includes("Health") || tags.includes("Armor") || tags.includes("SpellBlock")) tankWeight += w * 0.65;
      if (tags.includes("ManaRegen")) supWeight += w;
    }
    const roles = champ.roles || [];
    if (roles.includes("Mage")) apWeight += 15;
    if (roles.includes("Marksman")) { adWeight += 15; critWeight += 10; }
    if (roles.includes("Tank")) tankWeight += 25;
    if (roles.includes("Fighter")) adWeight += 12;
    if (roles.includes("Support")) supWeight += 15;

    const profiles = [];
    if (apWeight >= adWeight * 0.7 && apWeight > 15) profiles.push("AP");
    if (adWeight > apWeight * 0.65 && adWeight > 15) profiles.push("AD");
    if (critWeight >= 18 || roles.includes("Marksman")) profiles.push("CRIT");
    if (onhitWeight >= 12) profiles.push("ONHIT");
    if (tankWeight >= 30 || roles.includes("Tank")) profiles.push("TANK");
    if (supWeight >= 18 || (roles.includes("Support") && !roles.includes("Mage"))) profiles.push("SUPPORT");
    if (profiles.length === 0) profiles.push("AP");

    const primary = profiles[0];
    return { primary, profiles, apWeight, adWeight, critWeight, onhitWeight, tankWeight, supWeight };
  }

  // Known DoT/trap champions for Ethereal Weapon 1s ICD warning
  const DOT_ETH_WARN = new Set(["brand", "malzahar", "singed", "lillia", "karthus", "morgana", "cassiopeia", "zyra", "anivia", "swain"]);

  // Curated mechanic rules keyed by Augment ID
  // Each rule can specify:
  // - cat: category key from CAT_META
  // - headline: short tactical takeaway
  // - mechanic: explanation of the augment + item interaction
  // - routes: array of { name, matchProfiles, items: [id...], note }
  // - avoid: [itemIds] to avoid (e.g. Back to Basics -> avoid Malignance)
  // - warn: optional caveat
  const RULES = {
    // 1029 幻影武器
    1029: {
      cat: "onhit",
      headline: "技能施加命中效果（單目標 1 秒冷卻）→ 必轉特效/咒刃流！",
      mechanic: "傷害型技能命中英雄時會額外觸發裝備「命中效果(On-Hit)」，但注意：它不會把技能變成普攻，且對每個目標有 1 秒冷卻，裝備自身冷卻（如閃耀劍 1.5s、心鋼充能）仍照常計算。",
      routes: [
        {
          name: "AP 法師/刺客特效流",
          matchProfiles: ["AP"],
          items: [2510, 3100, 3115, 3087, 4645],
          note: "「暮夜與黎明」兼顧閃耀劍與雙重命中特效；「巫妖之禍 + 納什之牙」讓 Q/W/E 技能直接打出高爆發魔法附加傷害；「史提克彈簧刀」能透過技能連鎖觸發閃電命中特效。"
        },
        {
          name: "物理戰士/刺客特效流",
          matchProfiles: ["AD", "ONHIT"],
          items: [3078, 3153, 3748, 3302, 3091, 6672],
          note: "「三相之力 + 殞落王者之劍」讓技能自帶 8% 當前生命物理傷；「泰坦九頭蛇」與「臨界點」提供雙穿透與混合命中爆發。"
        },
        {
          name: "射手/攻速混傷特效流",
          matchProfiles: ["CRIT", "ONHIT"],
          items: [3153, 3124, 6672, 3115, 3302, 3091],
          note: "凱莎、法洛士、伊澤瑞爾等可透過技能遠距離穩定觸發「殞落王者之劍」「海妖殺手」「納什之牙」與「鬼索」被動。"
        },
        {
          name: "坦克/鬥士心鋼疊層流",
          matchProfiles: ["TANK"],
          items: [3084, 6662, 3748, 3153, 4633],
          note: "貪啃奇、蒙多等前排可用中遠距離技能直接觸發「雄心之鋼」疊層與「寒冰霸拳」範圍緩速，不必硬貼臉普攻也能穩定疊血！"
        }
      ],
      specialNoteFn: (champ) => DOT_ETH_WARN.has(champ.key)
        ? "⚠️ 持續傷害提醒：幻影武器對每個目標有 1 秒冷卻，毒霧/灼燒/召喚物不會每一跳都觸發！若身上沒有出納什之牙、巫妖之禍或雄心之鋼等「可觸發特效的成裝」，單拿此符文收益極低，切忌為此硬改純攻速。"
        : "💡 小技巧：沒出命中特效裝前幻影武器只是白板！抽到後請立刻檢查商店將核心裝轉向閃耀劍系或納什/殞落/心鋼。"
    },

    // 3086 蜜蜂來襲！！！
    3086: {
      cat: "onhit",
      headline: "蜜蜂爆炸附加「命中效果」→ 遠程法師也能觸發特效裝！",
      mechanic: "技能命中丟出蜂巢，小蜜蜂的持續攻擊會附帶 On-Hit 命中效果，特別適合技能頻率高或混傷英雄。",
      routes: [
        { name: "AP/混傷蜜蜂特效流", matchProfiles: ["AP"], items: [3115, 2510, 3100, 3087, 6653], note: "納什之牙與暮夜與黎明可讓每波蜜蜂都打出額外魔傷，搭配黎安卓持續磨血極強。" },
        { name: "AD/攻速蜜蜂特效流", matchProfiles: ["AD", "CRIT", "ONHIT"], items: [3153, 6672, 3124, 3302, 3091], note: "蜜蜂可觸發殞落王者之劍百分比扣血與海妖/智慧末刃特效，壓低前排血線極快。" },
        { name: "坦克蜜蜂黏人流", matchProfiles: ["TANK"], items: [3084, 6662, 3748], note: "前排開戰黏住敵人時，蜜蜂可協助觸發寒冰霸拳與九頭蛇特效。" }
      ]
    },

    // 1002 頂尖發明家
    1002: {
      cat: "itemcd",
      headline: "道具加速 +100（道具冷卻減半！）→ 狂出冷卻觸發型神裝！",
      mechanic: "所有裝備的主動與被動冷卻時間直接縮短 50%！心鋼充能、無盡絕望脈衝、星蝕護盾、盧登/惡意、原質馭帶、金人與復活甲全部變成超短 CD！",
      routes: [
        { name: "坦克不死神裝流（極度超模）", matchProfiles: ["TANK"], items: [3084, 2502, 2525, 3121, 6662, 2504], note: "「無盡絕望」約每 2 秒吸一次血、「雄心之鋼」光速疊層、「芬布爾之冬」每 4 秒刷一次護盾、「原質馭帶」救命脈衝 CD 大幅縮短，坦度直接翻倍！" },
        { name: "AP 主動/觸發爆發流", matchProfiles: ["AP"], items: [6655, 3157, 4646, 3102, 3152, 2522], note: "盧登充能、雷霆風暴、中婭沙漏、女妖面紗、火箭腰帶、時現者(2522) 冷卻全面減半，輸出與保命同時拉滿。" },
        { name: "戰士/刺客護盾與續戰流", matchProfiles: ["AD", "CRIT"], items: [6692, 6610, 3053, 6333, 3156, 3814], note: "星蝕(3秒一次護盾百分比傷)、突破天際(超短CD爆擊回血)、血手、死亡之舞、魔提斯與夜色緣界都能頻繁觸發！" },
        { name: "輔助團戰主動神裝流", matchProfiles: ["SUPPORT"], items: [3107, 3190, 3222, 2065, 3102], note: "贖罪神石、日輪的加冕、米凱的祝福、蘇瑞亞戰歌每波小團都有得開！" }
      ]
    },

    // 2127 大師鑄造
    2127: {
      cat: "itemcd",
      headline: "道具與增幅裝置傷害 +45% → 依賴裝備打傷害的極致放大器！",
      mechanic: "提升所有裝備被動/主動造成的傷害 45%，建議多出具有直接傷害特效的裝備。",
      routes: [
        { name: "AP 裝備直傷流", matchProfiles: ["AP"], items: [6655, 4646, 6653, 2503, 3118, 3100], note: "盧登、雷霆風暴、大面具、黑焰火炬、惡意、巫妖之禍的裝備傷害全部吃滿 45% 增幅！" },
        { name: "AD/特效裝備傷害流", matchProfiles: ["AD", "CRIT", "ONHIT"], items: [6672, 3153, 3087, 6692, 6698, 3748], note: "海妖殺手、彈簧刀、九頭蛇、星蝕與殞落特效傷害大幅提升。" },
        { name: "坦克灼燒反甲流", matchProfiles: ["TANK"], items: [3084, 3068, 6664, 2502, 3075], note: "日炎、虛偽光彩、無盡絕望、心鋼與反甲傷害全面提升 45%。" }
      ]
    },

    // 1129 射手法師
    1129: {
      cat: "ap_scale",
      headline: "普攻附加 75% 魔攻物理傷害 → 高 AP + 攻速/穿透混傷爆發！",
      mechanic: "每次普攻都會附帶高達 75% AP 的額外物理傷害，純 AP 裝就能讓你的普攻痛到像滿裝射手！",
      routes: [
        { name: "高 AP 攻速平A流", matchProfiles: ["AP", "ONHIT"], items: [3089, 3115, 2510, 3100, 3124, 3087], note: "「死亡之帽」大幅拉高基礎 75% AP 附加傷；「納什之牙 + 暮夜與黎明 + 巫妖之禍」補齊攻速與普攻節奏；物理射手/法師甚至可補「鬼索」或物穿！" },
        { name: "混傷射手轉 AP 流", matchProfiles: ["AD", "CRIT"], items: [3115, 3089, 3124, 3302, 3087], note: "凱莎、法洛士、庫奇、提摩、凱爾拿此符文可轉出納什+死帽+鬼索，物理+魔法+75%AP混傷極難針對！" }
      ]
    },

    // 1030 靈光一閃
    1030: {
      cat: "ap_scale",
      headline: "魔攻 30% 轉為技能加速 → 堆越高 AP 技能冷卻越短！",
      mechanic: "每 100 AP 額外送 30 技能加速。只要出高 AP 裝備就能同時獲得超高爆發與無限技能連發，完全不需要額外硬湊純冷卻裝。",
      routes: [
        { name: "極限高法強堆疊流", matchProfiles: ["AP", "SUPPORT"], items: [3089, 3040, 3157, 3102, 4645, 2503], note: "「死亡之帽」是核心中的核心（AP 乘區直接轉為巨量技能加速）；「熾天使 + 中婭 + 女妖 + 黑焰」給你大量法強與容錯，輕鬆突破 250+ 技能加速！" }
      ]
    },

    // 1390 極度邪惡 / 1097 女巫思維 / 3094 巫妖思維
    1390: {
      cat: "ap_scale",
      headline: "技能命中永久疊魔攻 → 搭配多段/低CD技能與死帽滾雪球！",
      mechanic: "每次技能命中敵人永久加 1 AP，配合死帽 30%+ AP 增幅與持續技能可疊到上千法強。",
      routes: [
        { name: "高頻/高法強放大流", matchProfiles: ["AP", "SUPPORT"], items: [3089, 2503, 6653, 4629, 3135], note: "先出冷卻/藍量裝（黑焰火炬、星河馳騁）快速刷層數，中期必補「死亡之帽」把疊起來的 AP 放大！" }
      ]
    },

    // 1311 溢流
    1311: {
      cat: "ap_scale",
      headline: "耗魔翻倍但傷害/治療/護盾隨「最大魔力」大幅提升！",
      mechanic: "最大魔力越高，技能傷害、護盾與治療量越恐怖！但耗魔翻倍，必須同時解決續航與撐高最大魔力上限。",
      routes: [
        { name: "AP 大魔力爆發流", matchProfiles: ["AP"], items: [3040, 3118, 2503, 6655, 6657, 2522], note: "「熾天使的擁抱」必出！搭配「惡意 / 黑焰火炬 / 盧登 / 時現者(2522)」同時撐高魔力上限與回魔，傷害與護盾同步暴漲。" },
        { name: "AD 魔劍技能流", matchProfiles: ["AD", "CRIT"], items: [3042, 3110, 3508], note: "魔劍正宗(終極魔劍)提供高額魔力轉 AD 與特效傷害；奪魄之鐮幫助回魔維持高耗魔施法。" },
        { name: "輔助大魔力雙歌流", matchProfiles: ["SUPPORT"], items: [2530, 3040, 6617, 6621], note: "2526 低語之環進化「歌謠之冠(2530)」直接給 +1000 魔力與高額治療護盾強度，與溢流是天作之合！" },
        { name: "坦克魔力雙盾流", matchProfiles: ["TANK"], items: [3121, 3110, 6657], note: "「凜冬將至/芬布爾之冬」+「冰霜之心」堆出巨量魔力，讓坦克技能傷害與護盾大幅增強。" }
      ]
    },

    // 3059 沒有魔力也沒問題 / 3051 藍色屏障 / 1056 因心成體
    3059: {
      cat: "ap_scale",
      headline: "道具魔力直接轉化為 AP（且總 AP +15%）→ 出魔力裝收益翻倍！",
      mechanic: "所有帶魔力的裝備不只提供法力，還會額外轉換成魔攻並放大總 AP 15%！",
      routes: [
        { name: "魔力轉法強大法師流", matchProfiles: ["AP", "SUPPORT"], items: [3040, 2530, 2503, 6655, 3118, 3089], note: "「熾天使(1000魔力)」「歌謠之冠(1000魔力)」「黑焰火炬(600)」「盧登(600)」「惡意(600)」全部直接轉成海量 AP，最後補死帽雙倍放大！" },
        { name: "坦克/鬥士魔力混傷流", matchProfiles: ["TANK", "AD"], items: [3121, 3110, 6657, 3040], note: "冰霜之心與芬布爾之冬的魔力也會幫你轉成額外 AP！" }
      ]
    },
    3051: {
      cat: "ap_scale",
      headline: "消耗魔力轉為護盾 → 高耗魔與高魔力裝讓你打不死！",
      mechanic: "每次施法消耗魔力就生成 200%~450% 魔力值的護盾，極度適合連招法師與撐藍量的前排。",
      routes: [
        { name: "高魔力護盾循環流", matchProfiles: ["AP", "TANK", "SUPPORT"], items: [3040, 2522, 6657, 3121, 3110], note: "「時現者(2522)」主動期間耗魔增加且冷卻更快，配合「熾天使 / 芬布爾之冬」護盾疊到對面絕望。" }
      ]
    },
    1056: {
      cat: "tank",
      headline: "獲得等同魔力一半的最大生命 → 藍裝同時變血裝！",
      mechanic: "每 1000 魔力免費送 500 最大生命！法師出雙女神淚/時光能肉成法坦，坦克出冰心/芬布爾血量直接破萬。",
      routes: [
        { name: "大魔力血牛法坦流", matchProfiles: ["AP", "TANK"], items: [3040, 6657, 3121, 3110, 2530, 4633], note: "「熾天使 + 時光之杖 + 芬布爾之冬/冰霜之心」讓你又硬又有超高輸出，搭峽谷製造者更能把額外生命轉回 AP！" }
      ]
    },

    // 1205 靈活轉換 (AD -> AP)
    1205: {
      cat: "hybrid",
      headline: "額外物攻轉為魔攻 (+15% AP) → AD 功能/特效神裝免費變 AP 裝！",
      mechanic: "所有裝備上的額外 AD 會自動轉換成 AP（1 AD → 1.667 AP 左右比例 + 15% 總 AP），讓 AP 英雄也能享受最強物理功能裝（如終極魔劍、死舞、血手、守護天使）！",
      routes: [
        { name: "AD 轉 AP 黑科技流", matchProfiles: ["AP", "HYBRID"], items: [3042, 3146, 3153, 2517, 6676, 3089], note: "「終極魔劍」高額 AD 轉成爆量 AP 還附帶技能命中物理特效；「海克斯科技槍刃(3146)」雙攻全轉為極高 AP 並帶 10% 全能吸血；「無盡飢渴(2517)」「蒐集者(處決)」也都是神級功能裝！" },
        { name: "物攻射手/戰士轉純 AP 流", matchProfiles: ["AD", "CRIT"], items: [3089, 3115, 4645, 3042, 3146], note: "若你本來想玩 AP 流派（如 AP 凱莎、AP 伊澤、AP 提摩、AP 法洛士、AP 崔絲塔娜），起手買 AD 裝備或魔劍都會直接轉成 AP 並觸發死帽放大！" }
      ]
    },

    // 1206 轉換惡作劇 (AP -> AD)
    1206: {
      cat: "hybrid",
      headline: "魔攻轉為額外物攻 (+15% AD) → 出中婭/女妖/死帽照樣疊超高物攻！",
      mechanic: "所有 AP 屬性會轉換成額外物攻並提升 15% AD！物理英雄可以直接享受 AP 頂級防禦/功能神裝。",
      routes: [
        { name: "AD 混出 AP 保命神裝流", matchProfiles: ["AD", "CRIT"], items: [3157, 3102, 3146, 3089, 6676], note: "「中婭沙漏」直接給大量 AD + 金人無敵；「女妖面紗」給大量 AD + 法術護盾；「海克斯科技槍刃」雙攻全吃！" }
      ]
    },

    // 1054 雙修大師
    1054: {
      cat: "hybrid",
      headline: "普攻疊 AP、技能疊 AD → 穿插平A與技能的混傷大魔王！",
      mechanic: "普攻越打 AP 越高，技能越放 AD 越高！必須選擇攻速快或能頻繁穿插技能與普攻的出裝。",
      routes: [
        { name: "攻速+技能穿插雙修流", matchProfiles: ["AP", "AD", "ONHIT", "CRIT"], items: [3124, 3115, 2510, 3146, 3078, 3302], note: "「鬼索的狂暴之刃」「納什之牙」「暮夜與黎明」「海克斯科技槍刃」「臨界點」完美同時吃滿 AD 與 AP 雙重成長！" }
      ]
    },

    // 1048 寶石手套 & 3123 寶石手鍊 & 1092 見縫插針
    1048: {
      cat: "crit",
      headline: "技能可以暴擊（送 25% 暴擊率）→ 出無盡之刃與暴擊裝直接毀天滅地！",
      mechanic: "所有技能都能觸發暴擊！搭配「無盡之刃」能把技能暴擊傷害推到 215%+，搭配「蒐集者」與「黯影之炎」更是殘血秒殺。",
      routes: [
        { name: "法師轉暴擊核彈流", matchProfiles: ["AP", "SUPPORT"], items: [3031, 4645, 6676, 3036, 3089, 3508], note: "核心必補「無盡之刃」直接放大技能暴擊倍率！「蒐集者」提供 25% 暴擊+物理穿透+5% 處決；「黯影之炎」對殘血敵人讓魔法/真傷也暴擊，與寶石手套疊加爆發極恐怖！" },
        { name: "AD/刺客技能暴擊流", matchProfiles: ["AD", "CRIT"], items: [3031, 6676, 3036, 3508, 2523, 6675], note: "配合「無盡之刃」「蒐集者」「多明尼克問候」「海克斯光學 C44(2523)」，技能隨便一發就能打出破千暴擊！" }
      ]
    },
    3123: {
      cat: "crit",
      headline: "指定技能可以暴擊 → 補無盡之刃放大技能爆發！",
      mechanic: "與寶石手套同理，讓特定主力技能能暴擊並送 25% 暴擊率。",
      routes: [
        { name: "無盡暴擊放大流", matchProfiles: ["AP", "AD", "CRIT"], items: [3031, 6676, 4645, 3036], note: "即使本身是法師，補一件「無盡之刃」就能讓主力技能暴擊傷害大躍進。" }
      ]
    },
    1092: {
      cat: "crit",
      headline: "道具與持續傷害(DoT)可以暴擊 → 灼燒裝 + 無盡之刃！",
      mechanic: "持續傷害技能（如火男、馬爾札哈、提摩、提莫毒、提伯斯、提）與裝備傷害（黎安卓、黑焰、盧登、日炎、無盡絕望）全部都會暴擊！",
      routes: [
        { name: "法師 DoT 暴擊毀滅流", matchProfiles: ["AP"], items: [6653, 2503, 3031, 4645, 6676, 4646], note: "「黎安卓的折磨 + 黑焰火炬」每一跳灼燒都能暴擊！再補「無盡之刃」大幅提升灼燒暴擊傷害，搭「黯影之炎」秒殺一切！" },
        { name: "AD/暴擊裝備流", matchProfiles: ["AD", "CRIT"], items: [3031, 6676, 3087, 6672], note: "彈簧刀與流血/持續裝備皆可暴擊。" },
        { name: "坦克獻祭暴擊流", matchProfiles: ["TANK"], items: [3068, 6664, 2502, 3031], note: "日炎聖盾、虛偽光彩、無盡絕望的持續傷害全部都能暴擊！" }
      ]
    },

    // 1077 靈魂虹吸 / 1118 暴擊治療 / 1328 暴擊節奏 / 1047 痛恨一擊 / 3018 狂暴一擊 / 2010 雙重命中 / 1356 暴擊沖天炮 / 1080 毫髮無傷
    1077: {
      cat: "crit",
      headline: "暴擊造成傷害 12% 回血（+25% 暴擊率）→ 高暴擊 + 高傷害 = 站嚕吸血怪！",
      mechanic: "注意：不只普攻暴擊，如果你同時拿到寶石手套/見縫插針，技能與持續傷害暴擊也會觸發 12% 治療！",
      routes: [
        { name: "100% 暴擊高爆發吸血流", matchProfiles: ["AD", "CRIT"], items: [3031, 6676, 3036, 3046, 3032, 6673], note: "「無盡之刃 + 雲陶/幻影之舞 + 多明尼克」堆滿 100% 暴擊率，每一槍都回巨量血，搭「振奮盔甲」更難死！" },
        { name: "法師(配合寶石/見縫)暴擊吸血", matchProfiles: ["AP"], items: [4645, 3031, 6653, 3089], note: "「黯影之炎」的殘血法術暴擊與技能暴擊都能觸發回血。" }
      ]
    },
    1118: {
      cat: "support",
      headline: "治療與護盾可以暴擊(+40%量，+25%暴擊率) → 暴擊輔助裝拉滿！",
      mechanic: "本身送 25% 暴擊率，建議搭配其他增加治療護盾量或暴擊率的裝備。",
      routes: [
        { name: "軟輔暴擊大奶流", matchProfiles: ["SUPPORT", "AP"], items: [6617, 6621, 3107, 2530, 3504, 6616], note: "月石再生器連鎖的治療與破曉之核都會跟著暴擊；若需要撐高暴擊機率甚至可偶爾補「奪魄之鐮 / 那歐閃刃」刷技能！" }
      ]
    },
    3018: {
      cat: "crit",
      headline: "75% 攻速轉為暴擊傷害（+35% 暴傷）→ 堆越多攻速暴擊越痛！",
      mechanic: "大量攻速裝備（幻影之舞、颶風箭、海妖、納什、獵魔弩箭）不再溢出，直接轉為誇張的暴擊傷害倍率！",
      routes: [
        { name: "超高攻速轉暴傷秒殺流", matchProfiles: ["AD", "CRIT", "ONHIT"], items: [3046, 3085, 3032, 6672, 2512, 3031], note: "「幻影之舞(65%AS)」「芮蘭颶風箭」「雲陶狂箭」「獵魔弩箭(2512)」「無盡之刃」一刀暴擊可打出平常 3 倍以上傷害！" }
      ]
    },
    1328: {
      cat: "crit",
      headline: "暴擊疊加攻速（+25% 暴擊率）→ 暴擊裝快速起動！",
      mechanic: "每次暴擊加速攻速，容易衝破攻速上限，搭配暴擊特效裝收益最高。",
      routes: [
        { name: "高暴擊攻速走A流", matchProfiles: ["AD", "CRIT"], items: [3032, 3031, 3085, 3036, 6675], note: "「雲陶狂箭 + 無盡 + 颶風 + 那歐閃刃」攻速越打越快、技能越刷越快。" }
      ]
    },
    2010: {
      cat: "onhit",
      headline: "暴擊額外多觸發一次命中效果（+25% 暴擊率）→ 暴擊 × 特效雙修！",
      mechanic: "普攻暴擊會把所有 On-Hit 效果打兩次！極度適合同時堆暴擊率與命中特效裝的射手/近戰。",
      routes: [
        { name: "暴擊雙重特效流", matchProfiles: ["AD", "CRIT", "ONHIT"], items: [3153, 6672, 3085, 3046, 3032, 3124], note: "「海妖殺手 + 殞落王者之劍 + 雲陶/颶風 + 鬼索」一次暴擊同時噴出雙倍海妖與雙倍殞落傷害！" }
      ]
    },

    // 1225 雙刀流 / 1087 颱風 / 1058 祕術拳擊 / 1036 煽風點火 / 1074 縮小光線
    1225: {
      cat: "onhit",
      headline: "每次普攻多射一發命中箭矢 → 攻擊特效裝收益直接翻倍！",
      mechanic: "雖然箭矢單發傷害較低，但能完整觸發「命中效果(On-Hit)」！搭配高基礎特效裝傷害極為誇張。",
      routes: [
        { name: "極限特效射擊流", matchProfiles: ["AD", "CRIT", "ONHIT", "AP"], items: [3153, 3124, 6672, 3302, 3091, 3115], note: "「殞落 + 鬼索 + 海妖 + 臨界點 + 智慧末刃」（AP 攻速流則必出「納什之牙 + 鬼索」），箭箭雙重觸發特效！" }
      ]
    },
    1087: {
      cat: "onhit",
      headline: "普攻額外朝附近目標發射命中飛彈 → 團戰 AOEs 特效狂潮！",
      mechanic: "相當於免費獲得小型颶風箭且附帶命中效果，和「芮蘭颶風箭」及各種特效裝疊加極強。",
      routes: [
        { name: "團戰多重特效流", matchProfiles: ["AD", "CRIT", "ONHIT", "AP"], items: [3085, 3153, 3124, 3302, 3748, 3115], note: "「芮蘭颶風箭 + 殞落 + 鬼索 + 臨界點」（近戰推「泰坦九頭蛇」）一次平A打多人的特效！" }
      ]
    },
    1058: {
      cat: "onhit",
      headline: "命中效果縮短技能冷卻 1.25 秒 → 高攻速/特效 = 無限技能！",
      mechanic: "每次觸發命中效果就能把技能 CD 砍掉 1.25 秒！搭配能額外觸發命中次數的裝備（鬼索、暮夜與黎明、納什、雙刀流、幻影武器），直接達成無限 QWE！",
      routes: [
        { name: "AP/刺客無限技能特效流", matchProfiles: ["AP"], items: [3115, 2510, 3124, 3100, 3087], note: "「暮夜與黎明(額外觸發一次命中!) + 納什之牙 + 鬼索的狂暴之刃」讓每一刀或技能直接刷爆基礎技能 CD！" },
        { name: "物理戰士/射手無限技能流", matchProfiles: ["AD", "CRIT", "ONHIT"], items: [3124, 3153, 3078, 6675, 3091, 3302], note: "「鬼索 + 那歐閃刃 + 殞落 + 三相之力」攻速一拉起來，位移與控場技能完全沒空窗！" }
      ]
    },
    1036: {
      cat: "onhit",
      headline: "普攻命中無限疊加灼燒 → 攻速與多重觸發越疊越痛！",
      mechanic: "每一次普攻都在目標身上無限疊燒傷層數，攻速越快疊越快。",
      routes: [
        { name: "高攻速疊火流", matchProfiles: ["AD", "CRIT", "ONHIT", "AP"], items: [3085, 3124, 3046, 3153, 3115, 3091], note: "「鬼索 + 颶風箭 + 幻影之舞」（AP 出納什+鬼索）用極限攻速把燃燒疊到每秒破千！" }
      ]
    },

    // 3078 轟鳴低音 / 3049 裝甲衝擊 / 1996 升級閃耀劍 / 3129 魔法樹液
    3078: {
      cat: "spellblade",
      headline: "施放技能後強化普攻（魔法傷+攻速+跑速）→ 耀光/咒刃系完美同步！",
      mechanic: "完美契合技能穿插普攻的節奏，出任何「閃耀劍」升級裝備都能在同一次強化普攻打出雙重爆發！",
      routes: [
        { name: "AP 咒刃爆發流", matchProfiles: ["AP"], items: [3100, 2510, 4645, 3089], note: "「巫妖之禍」與「暮夜與黎明」和轟鳴低音節奏完全同步，一發強化 A 直接蒸發脆皮！" },
        { name: "AD 咒刃戰士/射手流", matchProfiles: ["AD", "CRIT", "ONHIT"], items: [3078, 3508, 3042, 6610], note: "「三相之力 / 奪魄之鐮 / 突破天際」打出一套技能+強化普攻的高額爆發。" },
        { name: "坦克咒刃黏人流", matchProfiles: ["TANK"], items: [6662, 3084, 3748], note: "「寒冰霸拳」同時觸發範圍緩速與額外傷。" }
      ]
    },
    3049: {
      cat: "spellblade",
      headline: "施放技能後下一次普攻造成範圍額外物理傷 → 搭配耀光與開戰裝！",
      mechanic: "近戰或技能型英雄施放技能後補一刀普攻即可觸發物理範圍震波。",
      routes: [
        { name: "物理/坦克咒刃清場流", matchProfiles: ["AD", "TANK"], items: [3078, 6662, 3748, 6610, 3053], note: "「三相之力 / 寒冰霸拳 + 突破天際 + 泰坦九頭蛇」強化普攻範圍傷害極高。" },
        { name: "AP 混傷咒刃流", matchProfiles: ["AP"], items: [2510, 3100], note: "「暮夜與黎明 / 巫妖之禍」同步強化施放技能後的這關鍵一刀。" }
      ]
    },
    1996: {
      cat: "quest",
      headline: "升級「魔法彎刀(閃耀劍)」額外傷害+吸血 → 必出閃耀劍系成裝！",
      mechanic: "沒有買閃耀劍升級裝的話，這個海克斯幾乎沒效果！一定要出巫妖/三相/冰拳/暮夜與黎明/奪魄之鐮之一。",
      routes: [
        { name: "AP 升級咒刃吸血流", matchProfiles: ["AP"], items: [3100, 2510, 4645], note: "首選「巫妖之禍」或「暮夜與黎明」（暮夜與黎明還會觸發兩次命中效果，與升級閃耀劍超搭！）。" },
        { name: "AD 升級咒刃吸血流", matchProfiles: ["AD", "CRIT"], items: [3078, 3508], note: "首選「三相之力」或「奪魄之鐮」。" },
        { name: "坦克升級咒刃回血流", matchProfiles: ["TANK"], items: [6662, 3065], note: "首選「寒冰霸拳」搭配「振奮盔甲」放大治療量！" }
      ]
    },

    // 1045 煉獄使者 / 1133 魔法導彈 / 2128 燃燒利息 / 1406 阿嬤的辣油
    1045: {
      cat: "burn",
      headline: "技能附加無限疊加燃燒，每次灼燒跳傷縮短基礎技能 CD！",
      mechanic: "燃燒與 DOT 的每一跳都在幫你減 QWE 冷卻！只要再出「黎安卓的折磨」和「黑焰火炬」，雙倍灼燒來源讓技能 CD 轉得跟鬼一樣快！",
      routes: [
        { name: "雙面具無限火燒循環流（必出！）", matchProfiles: ["AP", "SUPPORT"], items: [6653, 2503, 3116, 4629, 4633], note: "「黎安卓的折磨 + 黑焰火炬」是絕對必出核心！再補「瑞萊冰杖」拖慢敵人吃滿每一跳灼燒與減 CD！" },
        { name: "坦克火甲減 CD 流", matchProfiles: ["TANK"], items: [3068, 6664, 2502, 6653], note: "「日炎聖盾 + 虛偽光彩」的範圍持續燃燒一樣可以連動刷基礎技能 CD！" }
      ]
    },
    1133: {
      cat: "burn",
      headline: "遠程技能命中發射 3 枚最大生命真實傷害飛彈 → 冰杖/雙面具超遠消耗！",
      mechanic: "飛行距離越遠，百分比最大生命真傷越高；配合「瑞萊冰杖」與灼燒裝能遠距離持續觸發大量飛彈。",
      routes: [
        { name: "POKE 法師雙面具冰杖流", matchProfiles: ["AP", "SUPPORT"], items: [6653, 2503, 3116, 4628, 6655], note: "「瑞萊的冰晶節杖 + 黎安卓的折磨 + 黑焰火炬」大幅增加飛彈壓制與拉打能力。" }
      ]
    },
    2128: {
      cat: "burn",
      headline: "燃燒與持續傷害生錢 → 早出雙面具/日炎瘋狂印鈔！",
      mechanic: "越早出持續灼燒裝備，整場經濟滾雪球越多！",
      routes: [
        { name: "法師印鈔雙面具流", matchProfiles: ["AP"], items: [2503, 6653, 3116], note: "第一件直衝「黑焰火炬」或「黎安卓」，快速刷出經濟差距。" },
        { name: "坦克日炎印鈔流", matchProfiles: ["TANK"], items: [3068, 6664, 2502], note: "「日炎聖盾 + 虛偽光彩」貼人燒就能一直拿錢！" }
      ]
    },

    // 1041 巨人 / 1353 坦克引擎 / 1013 天界之身 / 1181 重型打手 / 2102 壓力鍋 / 1001 泰坦的決意 / 1375 食魂者 / 1401 急遽成長 / 1324 蛋白飲
    1041: {
      cat: "tank",
      headline: "+35% 最大生命 & +15% 適性之力 → 出血量裝備收益直接乘以 1.35 倍！",
      mechanic: "所有增加生命值的裝備都會額外放大 35%，且高生命直接轉換為超高輸出（狂霸血甲/泰坦/峽谷製造者/心鋼）。",
      routes: [
        { name: "巨無霸血牛戰坦流", matchProfiles: ["TANK", "AD"], items: [3084, 3083, 2501, 3748, 2525, 2502], note: "「雄心之鋼 + 狂霸血甲(2501) + 泰坦九頭蛇 + 好戰者」把上萬生命直接變成破百額外物攻與秒人平A！" },
        { name: "AP 血量法坦流", matchProfiles: ["AP"], items: [6657, 4633, 6653, 3116, 3084], note: "「峽谷製造者」能把巨人給的巨額額外生命轉成大量 AP，又肉又痛！" }
      ]
    },
    1353: {
      cat: "tank",
      headline: "參與擊殺疊體型與最大生命 → 心鋼/好戰/血甲滾出兩萬血神獸！",
      mechanic: "只要保住命參與擊殺就能無限疊加最大生命（注意：死亡會失去層數，因此保命裝比純輸出更重要！）。",
      routes: [
        { name: "不死疊血神獸流", matchProfiles: ["TANK", "AD", "AP"], items: [3083, 3084, 2525, 2501, 3748, 4633], note: "「好戰者鎧甲」脫戰秒回滿避免死亡掉層！「原質馭帶(2525)」防止被秒殺；AP 出「峽谷製造者」、AD 出「狂霸血甲 + 泰坦」把高血量轉傷害。" }
      ]
    },
    1181: {
      cat: "tank",
      headline: "普攻額外造成 3.5% 自身最大生命物理傷害 → 生命裝 = 攻擊裝！",
      mechanic: "血越多一拳越痛，搭配攻速或高血量裝備效果驚人。",
      routes: [
        { name: "高血量平A重拳流", matchProfiles: ["TANK", "AD"], items: [3084, 3748, 3083, 2501, 3078, 3071], note: "「雄心之鋼 + 泰坦九頭蛇 + 狂霸血甲 + 三相之力」每下普攻都帶雙重生命百分比重擊。" }
      ]
    },
    2102: {
      cat: "tank",
      headline: "周圍灼燒隨自身最大生命成長 → 堆血 + 冰杖/面具/火甲！",
      mechanic: "靠近敵人自動疊燒傷且隨生命成長，非常適合衝排黏人英雄。",
      routes: [
        { name: "貼臉生命灼燒流", matchProfiles: ["TANK"], items: [3084, 3083, 3068, 6664, 2502, 2525], note: "「雄心之鋼 + 無盡絕望 + 日炎/虛偽光彩 + 原質馭帶」站著不動就能燒融敵方前排。" }
      ]
    },
    1324: {
      cat: "tank",
      headline: "根據額外雙防大幅提升治療與護盾量 → 雙防裝讓奶量/護盾暴增！",
      mechanic: "物防與魔防越高，回血與護盾越誇張！完美結合抗性與回復/護盾裝備。",
      routes: [
        { name: "雙防吸血護盾不死流", matchProfiles: ["TANK", "SUPPORT"], items: [6665, 2502, 3065, 3121, 3190, 2524], note: "「千變萬化之賈克修 + 無盡絕望 + 振奮盔甲 + 芬布爾之冬」，賈克修疊滿雙防後，無盡絕望吸一口和芬布爾刷盾幾乎打不穿！" }
      ]
    },

    // 1037 急救箱 / 1141 全部都給你 / 1076 餘音震盪 / 1095 風語者 / 1015 死亡循環 / 3163 迷人蝶影 / 2004 因信得力 / 3025 音障 / 1314 巨大盾牌 / 1180 超強大腦 / 2104 靈魂炸彈
    1037: {
      cat: "support",
      headline: "+20% 治療與護盾強度 → 拉高全套輔助神裝 + 破曉綻放攻速轉換！",
      mechanic: "治療護盾強度直接連動「破曉之核(6621)」「月石再生器」以及新裝備「破曉綻放之劍(4011)」（每1%治護給1.2%攻速）。",
      routes: [
        { name: "頂級軟輔治癒護盾流", matchProfiles: ["SUPPORT", "AP"], items: [6617, 6621, 2530, 3107, 3504, 6616], note: "「月石再生器 + 破曉之核 + 歌謠之冠(2530) + 贖罪神石」團戰奶量與盾量直接破萬。" }
      ]
    },
    1015: {
      cat: "support",
      headline: "所有治療與生命回復都會對最近敵軍造成魔法傷害 → 補血變砲台！",
      mechanic: "不只是給隊友補血，包括「自己吸血、好戰者回血、無盡絕望、破曉綻放之劍、全能吸血」全部都會轉成對敵人的高額魔法傷害！",
      routes: [
        { name: "軟輔/魔鬥奶傷一體流", matchProfiles: ["SUPPORT", "AP"], items: [6617, 2530, 3107, 4633, 6621, 4011], note: "「月石再生器 + 歌謠之冠 + 贖罪神石 + 峽谷製造者」每補一口血就像丟一顆小核彈！" },
        { name: "戰坦吸血反彈核彈流", matchProfiles: ["TANK", "AD"], items: [2502, 3065, 3083, 2525, 3153], note: "「振奮盔甲 + 無盡絕望 + 原質馭帶(2525) + 好戰者」回血量越大，敵人被炸得越慘！" }
      ]
    },
    1180: {
      cat: "support",
      headline: "每 1 AP 轉換為 3 點巨額護盾 → 高 AP 裝備直接變成超厚護盾！",
      mechanic: "1000 AP = 3000 額外護盾！出高 AP 裝配合保護型或傷害型法師都非常無解。",
      routes: [
        { name: "高法強厚盾法師流", matchProfiles: ["AP", "SUPPORT"], items: [3089, 3040, 3157, 3102, 4645], note: "「死亡之帽 + 熾天使的擁抱」撐出破千 AP，護盾直接讓你吃下一整套刺客招還無傷。" }
      ]
    },
    1314: {
      cat: "support",
      headline: "獲得護盾時增加 40~100 適性之力 → 出自帶護盾的裝備常駐觸發！",
      mechanic: "如果英雄本身沒盾，只要出帶護盾的裝備（芬布爾之冬、熾天使、星蝕、血手、盾弓、日輪）就能穩定觸發 40~100 適性之力！",
      routes: [
        { name: "法師熾天使觸發流", matchProfiles: ["AP", "SUPPORT"], items: [3040, 3089, 6617], note: "熾天使救命盾一跳出就加高達 100 AP。" },
        { name: "戰士/坦克星蝕芬布爾流", matchProfiles: ["TANK", "AD"], items: [6692, 3121, 3053, 6673], note: "「星蝕」每 6 秒（頂尖發明家 3 秒）刷一次護盾，等於常駐送海量物攻；坦克出「芬布爾之冬」每次控場刷盾就變戰神！" }
      ]
    },
    1076: { cat: "support", headline: "強化/治療/護盾友軍會在周圍引爆傷害與緩速 → 月石/舒瑞亞/歌謠！", mechanic: "需要高頻率施放治療、護盾或增益給隊友。", routes: [{ name: "高頻增益爆發流", matchProfiles: ["SUPPORT", "AP"], items: [6617, 2530, 3504, 6616, 2065], note: "「月石再生器 + 歌謠之冠 + 香爐/流水之杖」每次技能或被動治療都能持續炸傷周圍敵軍。" }] },
    1095: { cat: "support", headline: "治療與護盾同時賦予目標雙防 → 連鎖月石全隊加防！", mechanic: "群體治療或護盾裝備可以一口氣幫多名隊友套上雙防。", routes: [{ name: "群體保護神輔流", matchProfiles: ["SUPPORT", "AP"], items: [6617, 3190, 3107, 2530, 6621], note: "「月石 + 日輪的加冕 + 贖罪神石 + 歌謠之冠」讓全隊硬度直接提升一個檔次。" }] },
    1141: { cat: "support", headline: "對友軍治療和護盾大幅提升 → 全套輔助增益裝！", mechanic: "專注於給友方單位的奶盾倍率。", routes: [{ name: "純血軟輔強化流", matchProfiles: ["SUPPORT", "AP"], items: [6617, 6621, 3107, 2530, 3504], note: "月石 + 破曉之核 + 歌謠之冠 + 贖罪神石最大化單體與群體奶量。" }] },
    3163: { cat: "support", headline: "治療/護盾收集 7 隻蝴蝶後放出去炸魔法傷害 → 高頻奶盾裝！", mechanic: "月石與歌謠之冠持續治療能飛速收集蝴蝶。", routes: [{ name: "蝴蝶連環轟炸流", matchProfiles: ["SUPPORT", "AP"], items: [6617, 2530, 6620, 3107, 4645], note: "「月石 + 歌謠之冠 + 希利亞的迴響」配合收集蝴蝶打雙重魔法傷害。" }] },
    2004: { cat: "support", headline: "奶/盾祝福友軍疊信仰，滿層處決低血敵軍 → 群體奶盾裝！", mechanic: "群體上盾與回血越快疊越快。", routes: [{ name: "信仰處決輔助流", matchProfiles: ["SUPPORT", "AP"], items: [6617, 2530, 3190, 3107, 6620], note: "「月石 + 歌謠之冠 + 日輪」一口氣祝福多名隊友同時疊信仰。" }] },
    3025: { cat: "support", headline: "賦予友軍護盾時給予加速與鬼步 → 群盾裝備全員衝鋒！", mechanic: "群體護盾裝讓整個團隊瞬間變成衝鋒陣容。", routes: [{ name: "團戰加速開戰輔流", matchProfiles: ["SUPPORT", "TANK"], items: [3190, 6617, 2065, 6616], note: "「日輪的加冕 + 月石 + 蘇瑞亞的戰歌」全隊集體加速拉扯。" }] },
    2104: { cat: "support", headline: "治療與護盾累積靈魂炸彈 → 低冷卻奶盾循環流！", mechanic: "快速累積層數在殘血隊友身上引爆大奶大盾。", routes: [{ name: "高頻循環大奶流", matchProfiles: ["SUPPORT", "AP"], items: [6617, 2530, 6621, 3107, 4011], note: "「月石 + 歌謠之冠 + 破曉之核 + 破曉綻放之劍」持續觸發快速炸出靈魂炸彈。" }] },

    // 1098 腳程加速 / 1026 別眨眼 / 1081 輕舞飛揚 / 1073 飛影跑法
    1098: {
      cat: "speed",
      headline: "獲得等同技能加速 70% 的跑速 → 技能加速裝同時送飆車跑速！",
      mechanic: "100 技能加速 = +70 跑速！堆技能加速同時讓走位跟鬼一樣快（配合別眨眼增傷更是神級聯動）。",
      routes: [
        { name: "AP 極速飆車流", matchProfiles: ["AP", "SUPPORT"], items: [4629, 2503, 3100, 3158, 3040], note: "「星河馳騁(給技能加速+命中再加速!) + 黑焰火炬 + 巫妖之禍 + CD鞋」，跑速輕鬆破 550+！" },
        { name: "AD/戰士極速拉扯流", matchProfiles: ["AD", "TANK"], items: [3161, 3071, 3078, 3158, 2517], note: "「精進之矛 + 黑色切割者 + 三相之力 + 無盡飢渴(2517)」滿屏加速同時飆車！" }
      ]
    },
    1026: {
      cat: "speed",
      headline: "跑速比目標每高 10 點增傷 1% → 出跑速裝直接當百分比增傷裝！",
      mechanic: "只要比對面快 150~200 跑速，就是常駐 15%~20% 全傷害（包含真傷/裝備傷）增幅！",
      routes: [
        { name: "AP 跑速增傷流", matchProfiles: ["AP"], items: [4629, 3100, 4646, 3009], note: "「星河馳騁 + 巫妖之禍 + 雷霆風暴 + 輕靈之靴」同時給法強與海量跑速！" },
        { name: "AD 跑速拉打流", matchProfiles: ["AD", "CRIT"], items: [3046, 3095, 3142, 3009], note: "「幻影之舞 + 狂暴利刃(3095充能+45%跑速!) + 妖夢鬼刀 + 輕靈鞋」跑越快射越痛！" },
        { name: "坦克衝鋒跑速流", matchProfiles: ["TANK"], items: [3742, 4401, 2524, 3009], note: "「死者肩甲 + 自然之力 + 班德爾笛子 + 輕靈鞋」黏著後排打！" }
      ]
    },
    1081: {
      cat: "speed",
      headline: "普攻疊跑速，並依跑速轉成攻速 → 攻速/跑速裝無限互踩油門！",
      mechanic: "跑速裝會直接給你額外攻速，攻速快又疊更多跑速！",
      routes: [
        { name: "飆車無限攻速流", matchProfiles: ["AD", "CRIT", "ONHIT", "AP"], items: [3046, 3095, 6672, 3085, 3009, 3142], note: "「幻影之舞 + 狂暴利刃 + 海妖殺手 + 輕靈之靴」（AP 可配「巫妖之禍 + 星河馳騁 + 納什」）跑起來攻速直接突破 4.0+！" }
      ]
    },

    // 大絕強化系列 & 基本功夫
    1349: {
      cat: "ult",
      headline: "開大絕重置 QWE 並 +300 基礎技能加速 → 惡意/海克斯板甲/獵魔弩箭必備！",
      mechanic: "大絕冷卻越快，你能重置一整套小技能的頻率就越高！",
      routes: [
        { name: "AP 大絕無限連招流", matchProfiles: ["AP"], items: [3118, 2503, 3089, 3157], note: "「惡意(3118)」提供 +25 大絕加速與大絕命中減抗灼燒，必出第一件！" },
        { name: "AD/射手大絕加速流", matchProfiles: ["AD", "CRIT"], items: [2512, 3073, 6696], note: "「獵魔弩箭(2512, +30大絕加速+開大爆傷真傷)」「實驗型海克斯板甲(3073)」「公理弧刃(6696)」完美配合連續開大！" }
      ]
    },
    1088: {
      cat: "ult",
      headline: "大絕施放後立即重置冷卻（雙重施放大絕！）→ 惡意 / 板甲 / 公理！",
      mechanic: "連續放兩次大絕的破壞力，需要大絕加速與大絕觸發特效來最大化。",
      routes: [
        { name: "AP 雙大絕毀滅流", matchProfiles: ["AP"], items: [3118, 4645, 3089, 3157], note: "「惡意」讓兩次大絕都在敵方腳下炸出雙重灼燒減魔防！" },
        { name: "AD 雙大絕爆發流", matchProfiles: ["AD", "CRIT"], items: [2512, 3073, 6696, 6676], note: "「公理弧刃 + 實驗型海克斯板甲 + 獵魔弩箭」開完兩次大後直接靠攻速跑速收割！" }
      ]
    },
    1344: {
      cat: "ult",
      headline: "開大絕獲得最大生命護盾、全能吸血與跑速 → 主動開戰 R 裝！",
      mechanic: "開大變戰神，出減少 R CD 並隨最大生命/輸出成長的裝備收益最高。",
      routes: [
        { name: "AP/戰坦開大戰神流", matchProfiles: ["AP", "TANK", "AD"], items: [3118, 3073, 2512, 3065, 4633], note: "法師搭「惡意 + 峽谷製造者」、戰士搭「實驗型海克斯板甲 + 振奮盔甲」、射手搭「獵魔弩箭(2512)」把開大後的護盾與吸血放到最大！" }
      ]
    },
    3055: {
      cat: "ult",
      headline: "+50 大絕技能加速 → 搭配大絕特效神裝把大絕當小技能丟！",
      mechanic: "配合惡意/公理弧刃/實驗型海克斯板甲/獵魔弩箭，大絕冷卻十幾秒一次。",
      routes: [
        { name: "大絕循環連發流", matchProfiles: ["AP", "AD", "CRIT"], items: [3118, 6696, 3073, 2512], note: "AP 出「惡意」、刺客出「公理弧刃」、戰士出「海克斯板甲」、射手出「獵魔弩箭」。" }
      ]
    },
    1004: {
      cat: "ult",
      headline: "禁用大絕，但大幅強化小技能傷害/治護/技能加速 → 嚴禁出 R 綁定裝！",
      mechanic: "拿了基本功夫就完全沒有 R 技能！千萬別出惡意、實驗型海克斯板甲、公理弧刃、獵魔弩箭、錫柯等吃大絕的裝備！",
      avoid: [3118, 3073, 6696, 2512, 3050],
      routes: [
        { name: "純小技能極限循環流", matchProfiles: ["AP", "AD", "CRIT", "TANK", "SUPPORT"], items: [6653, 2503, 3100, 3078, 3161, 6617], note: "法師轉「黑焰 + 黎安卓 + 巫妖/死帽」；戰士轉「精進之矛 + 三相之力」；輔助轉「月石 + 歌謠之冠」，避開一切大絕觸發裝！" }
      ]
    },

    // 專屬裝備任務 / 升級類海克斯
    1152: {
      cat: "quest",
      headline: "【任務】雄心之鋼 300 層後層數 ×3 → 第一件無腦裸出雄心之鋼！",
      mechanic: "獎勵是心鋼層數直接乘以 3 倍，會讓你多出上千生命！出裝必須圍繞盡快疊滿 300 層＋將巨量生命轉為傷害與續戰。",
      routes: [
        { name: "心鋼三倍神裝公式（必出！）", matchProfiles: ["TANK", "AD", "AP", "SUPPORT"], items: [3084, 3083, 2501, 3748, 4633, 2502], note: "第一件必出「雄心之鋼(3084)」！疊滿 300 層觸發 ×3 後，AD/戰坦出「狂霸血甲 + 泰坦九頭蛇」、AP 出「峽谷製造者」把上萬血轉成破百攻擊力/AP，搭「無盡絕望」打不死！" }
      ]
    },
    1156: {
      cat: "quest",
      headline: "【任務】持有「死亡之帽 + 中婭沙漏」→ 合成超模神器「烏莉特的法帽」！",
      mechanic: "直接送一把巨型魔棒(1200元)，只要補出死帽(3089) + 中婭(3157)就能免費融合並騰出一個格子獲得超高 AP 與減 CD 神器！",
      routes: [
        { name: "法帽任務標準路徑（必出！）", matchProfiles: ["AP", "SUPPORT", "AD"], items: [3089, 3157, 4645, 3135, 3040], note: "前兩或前三件務必補齊「死亡之帽(3089) + 中婭沙漏(3157)」完成任務，解鎖法帽後再補「黯影之炎 / 虛空之杖」毀滅全場！" }
      ]
    },
    2141: {
      cat: "quest",
      headline: "【任務】集齊三把九頭蛇 → 融合終極神器「究極九頭蛇」！",
      mechanic: "立即送海神之斧(1200元)，集齊「狂怒九頭蛇(3074) + 瀆神九頭蛇(6698) + 泰坦九頭蛇(3748)」合成究極九頭蛇，騰出兩格裝備欄！",
      routes: [
        { name: "究極九頭蛇任務路徑（必出！）", matchProfiles: ["AD", "TANK"], items: [3074, 6698, 3748, 3161, 3053], note: "直接湊齊三九頭蛇「狂怒 + 瀆神 + 泰坦」，完成任務後騰出的格子補「血手 / 死舞 / 精進之矛 / 振奮」。" }
      ]
    },
    1361: {
      cat: "quest",
      headline: "【任務】持有「日炎聖盾 + 虛偽光彩」→ 融合雙抗高傷神器「虛空獻祭」！",
      mechanic: "開局送巴米灰燼(900元)，出齊日炎 + 虛偽光彩立刻融合並獲得高額雙防與爆發燃燒。",
      routes: [
        { name: "虛空獻祭任務路徑（必出！）", matchProfiles: ["TANK"], items: [3068, 6664, 3084, 2502, 3065], note: "前兩件必出「日炎聖盾(3068) + 虛偽光彩(6664)」，合出虛空獻祭後補「雄心之鋼 / 無盡絕望 / 振奮」。" }
      ]
    },
    3150: {
      cat: "quest",
      headline: "【專屬升級】雷霆風暴範圍必炸 + 附加標記（送 500 金）→ 必出雷霆風暴！",
      mechanic: "雷霆風暴變成團戰範圍核彈，搭配魔穿裝與死帽一進場就能引爆全場。",
      routes: [
        { name: "升級雷霆風暴核彈流", matchProfiles: ["AP"], items: [4646, 4645, 3089, 3135, 6655], note: "第一件直衝「雷霆風暴(4646)」，搭「黯影之炎 + 法師之靴 + 死亡之帽」最大化魔穿與引爆斬殺。" }
      ]
    },
    1336: {
      cat: "quest",
      headline: "【專屬升級】持有「無盡之刃」暴擊造成隨機額外暴傷 → 必湊 100% 暴擊！",
      mechanic: "無盡之刃的暴擊傷害大幅突破上限，暴擊率越接近 100% 收益越高。",
      routes: [
        { name: "100% 暴擊無盡秒殺流", matchProfiles: ["AD", "CRIT"], items: [3031, 6676, 3032, 3036, 3046, 2523], note: "必出「無盡之刃(3031)」，再湊齊 3 件暴擊裝（蒐集者/雲陶/多明尼克/幻影之舞/C44）達成 100% 暴擊！" }
      ]
    },
    1320: {
      cat: "quest",
      headline: "【專屬升級】「蒐集者」處決疊高處決線並印鈔 → 第一件直衝蒐集者！",
      mechanic: "越早買出蒐集者，處決門檻疊得越高、多賺越多金錢！",
      routes: [
        { name: "第一件衝蒐集者滾雪球流", matchProfiles: ["AD", "CRIT", "AP"], items: [6676, 3031, 3036, 6692], note: "第一件直接裸出「蒐集者(6676)」，後面視定位補暴擊或穿甲收割。" }
      ]
    },
    1318: {
      cat: "quest",
      headline: "【專屬升級】「中婭沙漏」CD 縮短至 45 秒且金人期間可移動加速 → 必出中婭！",
      mechanic: "開金人可以高速移動調整位置甚至追擊/逃生，45 秒超短冷卻讓刺客與法師容錯率封頂。",
      routes: [
        { name: "移動金人流", matchProfiles: ["AP", "AD"], items: [3157, 3089, 4645], note: "務必在前三件補出「中婭沙漏(3157)」（若同時有法帽任務則烏莉特法帽也能觸發移動金人！）。" }
      ]
    },
    2157: {
      cat: "quest",
      headline: "【專屬升級】「死亡之舞」延遲傷大幅強化且擊殺大回血 → 必出死舞！",
      mechanic: "送 250 金並把死亡之舞變成戰士最強不死神裝。",
      routes: [
        { name: "戰士不死死舞流", matchProfiles: ["AD", "TANK"], items: [6333, 3053, 3065, 6610, 3161], note: "必出「死亡之舞(6333)」，搭「振奮盔甲 / 血手 / 突破天際」擊殺瞬間幾乎回滿血！" }
      ]
    },
    1319: {
      cat: "quest",
      headline: "【專屬升級】「日炎/虛偽光彩」燒人就印鈔 → 第一件直衝火甲！",
      mechanic: "每燒到一個英雄給 12 金，團戰貼臉每波多賺幾百塊。",
      routes: [
        { name: "獻祭印鈔坦流", matchProfiles: ["TANK"], items: [3068, 6664, 3084, 2502], note: "依對面傷型第一件直出「日炎聖盾(3068)」或「虛偽光彩(6664)」。" }
      ]
    },
    2140: {
      cat: "quest",
      headline: "【專屬升級】技能命中觸發「狂怒九頭蛇」劈砍 +20% 吸血 → 必出狂怒！",
      mechanic: "所有技能命中敵人都能直接引爆狂怒九頭蛇 AOEs 與高額吸血！",
      routes: [
        { name: "技能觸發狂怒吸血流", matchProfiles: ["AD"], items: [3074, 3161, 6692, 6333, 3065], note: "必出「狂怒九頭蛇(3074)」，搭「精進之矛 / 星蝕 / 振奮盔甲」一個 AOEs 技能就能吸血半條命！" }
      ]
    },
    2143: {
      cat: "quest",
      headline: "【專屬升級】「突破天際」CD 縮至 5 秒且回 9% 已損失生命 → 必出突破天際！",
      mechanic: "每 5 秒對每個敵人都能敲出必暴擊+大回血，近戰鬥士神中神！",
      routes: [
        { name: "5秒無限敲血戰士流", matchProfiles: ["AD", "TANK"], items: [6610, 3078, 3065, 6333, 3053], note: "必出「突破天際(6610)」，搭「振奮盔甲 + 三相之力」每 5 秒敲一次就回一口巨血！" }
      ]
    },
    1379: {
      cat: "quest",
      headline: "【專屬升級】+100% 攻速，普攻觸發「破曉綻放之劍」治療量 250% → 必出破曉綻放之劍！",
      mechanic: "直接送 100% 攻速，只要出破曉綻放之劍(4011)，每平A一下就能幫隊友狂補海量血！",
      routes: [
        { name: "高攻速奶媽神裝流（必出！）", matchProfiles: ["SUPPORT", "AP", "CRIT", "ONHIT"], items: [4011, 3115, 6617, 6621, 3124, 3085], note: "核心必出「破曉綻放之劍(4011)」！搭配「納什之牙 / 鬼索 / 颶風箭 / 月石 / 破曉之核」，直接化身每秒狂補隊友的移動泉水！" }
      ]
    },
    3081: {
      cat: "quest",
      headline: "首件傳說裝升級「命定武器」（參與擊殺無限成長）→ 第一件慎重挑核心！",
      mechanic: "你買的第一件完整傳說裝會成為可疊層的稜鏡級「命定武器」！千萬別第一件出純過渡裝或輔助小件，要選能貫穿全場的核心大裝。",
      routes: [
        { name: "AP 首件命定推薦", matchProfiles: ["AP"], items: [6655, 2503, 2510, 4645, 6653], note: "法師首件直衝「盧登 / 黑焰火炬 / 暮夜與黎明 / 黎安卓」作為命定武器。" },
        { name: "AD/射手首件命定推薦", matchProfiles: ["AD", "CRIT"], items: [6676, 3032, 6672, 3153, 3078], note: "射手首件直衝「蒐集者 / 雲陶 / 海妖 / 殞落 / 三相」越殺越強！" },
        { name: "坦克首件命定推薦", matchProfiles: ["TANK"], items: [3084, 3068, 2502], note: "坦克首件直衝「雄心之鋼 / 日炎 / 無盡絕望」。" }
      ]
    },

    // 控制 / 射程 / 其他高頻特化
    1018: { cat: "cc", headline: "硬控場後獲得高額護盾 → 開戰裝與減 CD 連控！", mechanic: "控制越多護盾越多，搭配芬布爾之冬雙重刷盾極硬。", routes: [{ name: "雙盾開戰坦克流", matchProfiles: ["TANK", "SUPPORT"], items: [3121, 6662, 6664, 2524, 3065], note: "「芬布爾之冬 + 虛偽光彩 + 振奮盔甲」每次控場都疊出雙層巨盾！" }] },
    1323: { cat: "cc", headline: "硬控場或禁錮召喚彗星轟炸 → 冰杖/永霜類或減 CD 多控！", mechanic: "需要頻繁硬控敵軍，出技能加速裝或冰杖/虛偽光彩提升命中率。", routes: [{ name: "控場彗星轟炸流", matchProfiles: ["TANK", "AP", "SUPPORT"], items: [6664, 6662, 4628, 3116, 4629], note: "坦克出「虛偽光彩 + 寒冰霸拳」、法師出「視界專注(4628硬控落雷!) + 星河馳騁」打連環控場爆發！" }] },
    1136: { cat: "cc", headline: "硬控場敵軍獲得 10 適性之力 → 出視界專注/技能加速狂打連控！", mechanic: "越控屬性越高，技能加速讓控制不斷檔。", routes: [{ name: "連控疊屬性流", matchProfiles: ["TANK", "AP", "AD"], items: [4628, 4629, 3161, 6662], note: "「視界專注(4628) + 星河馳騁 / 精進之矛」增加控場頻率與硬控回報。" }] },
    1071: { cat: "speed", headline: "大幅增加攻擊距離 → 超遠距離打擊安全觸發！", mechanic: "攻擊距離變長後，可安全疊出遠距離普攻與充能特效裝。", routes: [{ name: "超遠射程充能/特效流", matchProfiles: ["AD", "CRIT", "ONHIT"], items: [3094, 2523, 3087, 6672, 3153], note: "「衝擊火炮 + 海克斯光學 C44(2523, 距離500↑最大增傷+擊殺再加100射程!) + 史提克彈簧刀」一槍打半條街！" }] },
    1115: { cat: "speed", headline: "稜鏡級超大攻擊距離加成 → 必配 C44 與衝擊火炮！", mechanic: "射程遙遙領先全場敵人，C44 與衝擊火炮能把安全距離發揮到極限。", routes: [{ name: "狙擊之王流", matchProfiles: ["AD", "CRIT"], items: [2523, 3094, 3031, 3036, 3095], note: "「海克斯光學 C44(2523) + 衝擊火炮 + 無盡之刃」在敵人摸不到的距離直接秒殺！" }] },
    1134: { cat: "tank", headline: "遠程轉近戰並換取巨額物攻、生命、攻速、吸血與跑速 → 必出近戰專屬神裝！", mechanic: "變為近戰後，所有「僅近戰高收益 / 近戰數值翻倍」的裝備（殞落、血手、泰坦、死亡之舞、突破天際、狂怒九頭蛇）全部滿額生效！", routes: [{ name: "射手轉近戰戰神流（極強！）", matchProfiles: ["AD", "CRIT", "ONHIT", "TANK"], items: [3153, 6610, 6333, 3053, 3748, 3078], note: "拿了拔劍吧直接變近戰！「殞落王者之劍(近戰百分比翻倍) + 突破天際 + 死亡之舞 + 史特拉克手套 + 三相之力」近戰數值直接把刺客當菜切！" }] },
    2018: { cat: "ap_scale", headline: "冷卻減免並將所有攻速轉換為技能加速 → 出帶攻速的裝變超強減CD！", mechanic: "包含納什之牙、暮夜與黎明、智慧末刃、狂戰士鞋等攻速屬性全部自動轉為技能加速！", routes: [
      { name: "AP 法師高速連招流", matchProfiles: ["AP"], items: [3115, 2510, 2503, 4629, 3089], note: "「納什之牙(+50%攻速轉大量技能加速) + 暮夜與黎明 + 星河馳騁」讓你技能跟機槍一樣連發！" },
      { name: "AD 技能型極速流", matchProfiles: ["AD", "CRIT"], items: [3078, 3042, 3161, 3006], note: "連「狂戰士護脛 / 三相之力」給的攻速都能轉成技能加速。" }
    ] },
    1028: { cat: "burn", headline: "造成傷害削弱敵方雙防（最多多層）→ 多段/持續裝備快速疊滿破甲！", mechanic: "持續性傷害或高攻速能一秒幫全隊疊滿雙防削弱。", routes: [{ name: "快速疊破防裝", matchProfiles: ["AP", "AD"], items: [6653, 2503, 3085, 3153], note: "法師配「黎安卓/黑焰」、射手配「颶風/殞落」，一瞬間幫隊伍剝光前排雙防。" }] },
    1084: { cat: "hybrid", headline: "+18% 雙穿透 → 可延後法穿/物穿裝，先衝純傷害核心！", mechanic: "免費送雙穿，混傷英雄收益極高，讓你前三件可以先直衝純高傷害裝。", routes: [{ name: "混傷直衝高傷裝", matchProfiles: ["AP", "AD", "ONHIT"], items: [3089, 3124, 3302, 4645, 3031], note: "可延後出虛空之杖/多明尼克，優先直衝「死帽 / 無盡 / 鬼索 / 黯影之炎」最大化爆發。" }] },
    2132: { cat: "tank", headline: "高額全能吸血 → 搭配振奮盔甲與高持續輸出變成打不死！", mechanic: "所有技能和裝備造成的傷害都能吸血。", routes: [{ name: "全能吸血不死流", matchProfiles: ["AP", "AD", "TANK"], items: [3065, 4633, 3146, 2517, 6333], note: "「振奮盔甲」放大 25% 全能吸血；AP 配「峽谷製造者 + 槍刃」、AD 配「無盡飢渴(2517) + 死亡之舞」。" }] },
    1138: { cat: "tank", headline: "+15% 全能吸血 → 搭配振奮盔甲與持續傷害裝站嚕到底！", mechanic: "白銀級神級續戰，配持續 AOEs 傷害吸得超誇張。", routes: [{ name: "全能吸血續戰流", matchProfiles: ["AP", "AD", "TANK"], items: [3065, 4633, 6653, 3146, 2517], note: "「振奮盔甲 + 峽谷製造者 / 無盡飢渴」越打血越多。" }] },
    1068: { cat: "ap_scale", headline: "+60 技能加速 → 前期不用硬出 CD 鞋，直衝傷害核心！", mechanic: "直接解決冷卻問題，裝備優先度可以往穿透/法強/爆發靠攏。", routes: [{ name: "高爆發傷害流", matchProfiles: ["AP", "AD"], items: [3020, 4645, 3089, 6676, 3031], note: "鞋子可優先選「法師之靴 / 輕靈鞋」搶傷害，裝備直衝最高輸出大件。" }] },
    1388: { cat: "ap_scale", headline: "+60 技能加速且擊殺繼續無限疊 → 搭大魔力裝放招放到魔乾！", mechanic: "冷卻極短後唯一的限制是魔力，一定要確保有回魔/魔力裝。", routes: [{ name: "無限放招續航流", matchProfiles: ["AP", "AD"], items: [2503, 3040, 6655, 3508, 3042], note: "法師補「熾天使 / 黑焰火炬 / 盧登」、AD 補「奪魄之鐮 / 魔劍」防止技能刷太快缺魔。" }] }
  };

  // Alias rules for similar augments
  RULES[1051] = {
    cat: "onhit",
    headline: "每第4次普攻發射4枚命中飛彈 → 高攻速 + 鬼索雙倍觸發！",
    mechanic: "高攻速搭配鬼索幻影打擊可以飛速觸發第 4 下飛彈並附帶命中特效。",
    routes: RULES[1225].routes
  };
  RULES[3016] = {
    cat: "onhit",
    headline: "每連續第 3 次普攻造成真傷並永久成長 → 高攻速 + 鬼索/颶風！",
    mechanic: "攻速越快疊真傷越快，配合鬼索的狂暴之刃更快觸發三環。",
    routes: [{ name: "極限攻速疊三環流", matchProfiles: ["AD", "CRIT", "ONHIT", "AP"], items: [3124, 3046, 6672, 3153, 3115], note: "「鬼索 + 幻影之舞 + 海妖/殞落」（AP 出納什+鬼索）快速疊出極限真傷！" }]
  };
  RULES[3129] = RULES[3049];
  RULES[1074] = {
    cat: "onhit",
    headline: "普攻命中使敵人傷害降低 15% → 高攻速與多重命中降傷全場！",
    mechanic: "用颶風箭或高攻速可同時掛給多名敵方輸出，大幅降低團戰承傷。",
    routes: [{ name: "高攻速團隊減傷流", matchProfiles: ["AD", "CRIT", "ONHIT", "TANK"], items: [3085, 3153, 3124, 3091, 3115], note: "「芮蘭颶風箭 + 鬼索 + 殞落/智慧末刃」一箭降傷多名敵人。" }]
  };
  RULES[1047] = RULES[1328];
  RULES[1356] = {
    cat: "crit",
    headline: "暴擊發射魔法飛彈（+25% 暴擊率）→ 高暴擊 + 法穿/混傷！",
    mechanic: "每次暴擊額外射出魔法飛彈，暴擊率與攻速越高飛彈越多。",
    routes: [{ name: "高攻速暴擊飛彈流", matchProfiles: ["AD", "CRIT"], items: [3032, 3046, 3085, 3031, 3302], note: "「雲陶 + 幻影之舞 + 颶風 + 無盡 + 臨界點(補雙穿)」讓暴擊飛彈也吃滿穿透。" }]
  };
  RULES[2083] = {
    cat: "crit",
    headline: "暴擊掉落牙齒，撿取永久加物穿與法穿 → 高暴擊快速刷雙穿！",
    mechanic: "需要穩定暴擊率與前中期打架收集牙齒。",
    routes: [{ name: "暴擊疊雙穿流", matchProfiles: ["AD", "CRIT", "AP"], items: [6676, 3032, 3046, 3031, 4645], note: "早出暴擊裝（蒐集者/雲陶/幻影之舞）加速掉牙，中後期雙穿直接溢出！" }]
  };
  RULES[1080] = {
    cat: "crit",
    headline: "依暴擊率機率完美防禦減傷（+25% 暴擊率）→ 堆暴擊率順便變超硬！",
    mechanic: "暴擊率達到 50% 以上就等於常駐一半機率大幅減傷，出暴擊裝同時加坦度。",
    routes: [{ name: "半肉暴擊減傷流", matchProfiles: ["AD", "CRIT", "TANK"], items: [6673, 3046, 3031, 6333, 3036], note: "「不朽盾弓 + 幻影之舞 + 無盡」輕鬆達到 50%+ 格擋機率，搭配「死亡之舞」站嚕極難死！" }]
  };
  RULES[1406] = RULES[1045];
  RULES[1013] = {
    cat: "tank",
    headline: "+1500 基礎生命（傷害-10%）→ 直接吃生命轉傷害裝補回輸出！",
    mechanic: "開局白拿 1500 血，直接把「狂霸血甲 / 泰坦 / 峽谷製造者 / 無盡絕望 / 心鋼」收益提前拉滿！",
    routes: RULES[1041].routes
  };
  RULES[1001] = RULES[1041];
  RULES[1375] = RULES[1353];
  RULES[1401] = RULES[1041];
  RULES[1073] = RULES[1026];
  RULES[1211] = RULES[3055];
  RULES[1194] = RULES[3055];
  RULES[1007] = {
    cat: "hybrid",
    headline: "+20% 物理攻擊 → 堆高 AD 裝備放大乘區（搭無盡飢渴轉技能加速）！",
    mechanic: "總 AD 直接乘以 1.2 倍，高基礎物攻裝備如無盡、蒐集者、無盡飢渴、血甲收益暴增。",
    routes: [{ name: "高基礎 AD 放大流", matchProfiles: ["AD", "CRIT"], items: [2517, 3031, 6676, 6692, 6698], note: "「無盡飢渴(2517) + 蒐集者 + 無盡之刃 + 星蝕」物攻輕鬆破 500+！" }]
  };

  function getItemStatMap(champ) {
    const m = {};
    for (const it of (champ.items || [])) {
      m[it.id] = it;
    }
    return m;
  }

  // Returns structured specialized item guide for (champ, augId)
  function getAugmentGuide(champ, augId, data) {
    const rule = RULES[augId];
    if (!rule) return null;
    const prof = detectChampProfile(champ, data);
    const champItemMap = getItemStatMap(champ);

    // Score and sort routes so best-matching route for this champion is first
    const scoredRoutes = rule.routes.map((r, idx) => {
      let score = 0;
      if (r.matchProfiles.includes(prof.primary)) score += 100;
      for (const p of r.matchProfiles) {
        if (prof.profiles.includes(p)) score += 30;
      }
      // Also boost if champion has OP.GG items in this route
      let opggHits = 0;
      for (const iid of r.items) {
        if (champItemMap[iid]) opggHits++;
      }
      score += opggHits * 8;
      return {
        name: r.name,
        note: r.note,
        isPrimary: false,
        score: score - idx * 0.1,
        items: r.items.map(iid => {
          const meta = data.items[String(iid)];
          const stat = champItemMap[iid];
          return {
            id: iid,
            name: meta ? meta.name : ("Item " + iid),
            img: meta ? meta.img : "",
            gold: meta ? meta.gold : 0,
            wr: stat ? stat.wr : null,
            pr: stat ? stat.pr : null,
            play: stat ? stat.play : null
          };
        })
      };
    }).sort((a, b) => b.score - a.score);

    if (scoredRoutes.length > 0) scoredRoutes[0].isPrimary = true;

    const avoidItems = (rule.avoid || []).map(iid => {
      const meta = data.items[String(iid)];
      return { id: iid, name: meta ? meta.name : ("Item " + iid), img: meta ? meta.img : "" };
    });

    const specialNote = rule.specialNoteFn ? rule.specialNoteFn(champ) : null;

    return {
      augId,
      cat: rule.cat,
      catMeta: CAT_META[rule.cat],
      headline: rule.headline,
      mechanic: rule.mechanic,
      routes: scoredRoutes,
      avoid: avoidItems,
      specialNote,
      champProfile: prof
    };
  }

  // Synthesize a complete 6-item build combining champion's OP.GG core + up to 4 pinned augments
  function synthesizeBuild(champ, pinnedAugIds, data) {
    const prof = detectChampProfile(champ, data);
    const champItemMap = getItemStatMap(champ);
    const avoidSet = new Set();
    const itemScores = {};
    const itemReasons = {};

    function addScore(iid, pts, reason) {
      if (!iid || avoidSet.has(iid)) return;
      itemScores[iid] = (itemScores[iid] || 0) + pts;
      if (reason) {
        if (!itemReasons[iid]) itemReasons[iid] = [];
        if (!itemReasons[iid].includes(reason)) itemReasons[iid].push(reason);
      }
    }

    // Collect avoids first
    for (const aid of pinnedAugIds) {
      const rule = RULES[aid];
      if (rule && rule.avoid) {
        for (const av of rule.avoid) avoidSet.add(av);
      }
    }

    // Add specialized items from each pinned augment
    for (const aid of pinnedAugIds) {
      const guide = getAugmentGuide(champ, aid, data);
      if (!guide) continue;
      const augName = data.augments[String(aid)] ? data.augments[String(aid)].name : ("#" + aid);
      const bestRoute = guide.routes[0];
      if (bestRoute) {
        bestRoute.items.forEach((it, idx) => {
          const pts = 120 - idx * 14 + (it.wr ? (it.wr - 50) * 1.5 : 0);
          addScore(it.id, pts, `${augName} 特化核心`);
        });
      }
    }

    // Add baseline OP.GG core + high-WR champion items (scaled lower so specialized items lead)
    if (champ.core && champ.core[0]) {
      champ.core[0].ids.forEach((iid, idx) => {
        if (iid === 3020 || iid === 3111 || iid === 3047 || iid === 3006 || iid === 3009 || iid === 3158 || iid === 3008) return;
        addScore(iid, 55 - idx * 6, "OP.GG 常規核心");
      });
    }
    for (const it of (champ.items || []).slice(0, 15)) {
      const meta = data.items[String(it.id)];
      if (!meta) continue;
      if (meta.tags && meta.tags.includes("Boots")) continue;
      if (meta.gold && meta.gold < 2000) continue; // skip components like tear/oblivion orb
      const wrBonus = (it.wr - 50) * 1.2;
      const prBonus = Math.min(20, it.pr * 0.4);
      addScore(it.id, 30 + wrBonus + prBonus, null);
    }

    // Pick best boots (respecting avoidSet and speed/AP/AS synergies)
    let bestBoot = null;
    if (champ.boots && champ.boots.length > 0) {
      let bChoice = champ.boots[0];
      // If Basic Mastery / Recursion / Eureka / Apex, swifties or sorcs often shine; keep highest WR valid boot or #1 pick
      const highPrBoots = champ.boots.filter(b => b.pr >= 10).sort((a, b) => b.wr - a.wr);
      bChoice = highPrBoots[0] || champ.boots[0];
      const bMeta = data.items[String(bChoice.id)];
      bestBoot = {
        id: bChoice.id,
        name: bMeta ? bMeta.name : ("Boot " + bChoice.id),
        img: bMeta ? bMeta.img : "",
        wr: bChoice.wr,
        pr: bChoice.pr,
        reason: "推薦鞋子"
      };
    }

    // Rank top 5 non-boot legendary items
    const ranked = Object.keys(itemScores)
      .map(Number)
      .filter(iid => !avoidSet.has(iid))
      .sort((a, b) => itemScores[b] - itemScores[a])
      .slice(0, 5)
      .map(iid => {
        const meta = data.items[String(iid)];
        const stat = champItemMap[iid];
        return {
          id: iid,
          name: meta ? meta.name : ("Item " + iid),
          img: meta ? meta.img : "",
          gold: meta ? meta.gold : 0,
          wr: stat ? stat.wr : null,
          pr: stat ? stat.pr : null,
          reasons: itemReasons[iid] || ["高勝率常規配裝"]
        };
      });

    return {
      boots: bestBoot,
      items: ranked,
      avoid: Array.from(avoidSet).map(iid => {
        const meta = data.items[String(iid)];
        return { id: iid, name: meta ? meta.name : ("Item " + iid), img: meta ? meta.img : "" };
      }),
      profile: prof
    };
  }

  return {
    CAT_META,
    RULES,
    detectChampProfile,
    getAugmentGuide,
    synthesizeBuild
  };
})();

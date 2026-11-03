/* Флаги стран, нарисованные CSS-градиентами (эмодзи-флаги в Windows не отображаются) */
(function () {
  const DR = (window.DR = window.DR || {});

  const h3 = (a, b, c) => `linear-gradient(${a} 33.4%, ${b} 0 66.7%, ${c} 0)`;
  const v3 = (a, b, c) => `linear-gradient(90deg, ${a} 33.4%, ${b} 0 66.7%, ${c} 0)`;
  const h2 = (a, b) => `linear-gradient(${a} 50%, ${b} 0)`;
  const dot = (rx, ry, x, y, c) => `radial-gradient(${rx}% ${ry}% at ${x}% ${y}%, ${c} 96%, transparent 100%)`;
  const nordic = (bg, cross, inner) => {
    const layers = [];
    if (inner) {
      layers.push(`linear-gradient(90deg, transparent 33%, ${inner} 0 39%, transparent 0)`);
      layers.push(`linear-gradient(transparent 45%, ${inner} 0 55%, transparent 0)`);
    }
    layers.push(`linear-gradient(90deg, transparent 28%, ${cross} 0 44%, transparent 0)`);
    layers.push(`linear-gradient(transparent 36%, ${cross} 0 64%, transparent 0)`);
    return `${layers.join(', ')}, ${bg}`;
  };
  const canton = (c, w = 40, hgt = 54) => `linear-gradient(${c}, ${c}) 0 0 / ${w}% ${hgt}% no-repeat`;
  const hoistTriangle = (c, w) => `linear-gradient(to bottom right, ${c} 50%, transparent 50.5%) 0 0 / ${w}% 50.5% no-repeat, linear-gradient(to top right, ${c} 50%, transparent 50.5%) 0 100% / ${w}% 50.5% no-repeat`;
  const ukJack = `linear-gradient(transparent 40%, #c8102e 0 60%, transparent 0), linear-gradient(90deg, transparent 45%, #c8102e 0 55%, transparent 0), linear-gradient(transparent 33%, #fff 0 67%, transparent 0), linear-gradient(90deg, transparent 41%, #fff 0 59%, transparent 0), linear-gradient(34deg, transparent 47.5%, #c8102e 0 52.5%, transparent 0), linear-gradient(-34deg, transparent 47.5%, #c8102e 0 52.5%, transparent 0), linear-gradient(34deg, transparent 43%, #fff 0 57%, transparent 0), linear-gradient(-34deg, transparent 43%, #fff 0 57%, transparent 0), #012169`;
  const ukCanton = ['transparent 40%, #c8102e 0 60%, transparent 0', '90deg, transparent 44%, #c8102e 0 56%, transparent 0', 'transparent 32%, #fff 0 68%, transparent 0', '90deg, transparent 38%, #fff 0 62%, transparent 0']
    .map((g) => `linear-gradient(${g}) 0 0 / 50% 50% no-repeat`)
    .join(', ');

  const FLAGS = {
    ru: h3('#fff', '#0039a6', '#d52b1e'),
    nl: h3('#ae1c28', '#fff', '#21468b'),
    de: h3('#000', '#dd0000', '#ffce00'),
    fr: v3('#0055a4', '#fff', '#ef4135'),
    it: v3('#009246', '#fff', '#ce2b37'),
    be: v3('#000', '#fdda24', '#ef3340'),
    ie: v3('#169b62', '#fff', '#ff883e'),
    ro: v3('#002b7f', '#fcd116', '#ce1126'),
    md: `${dot(8, 14, 50, 50, '#b07e3a')}, ${v3('#0046ae', '#ffd200', '#cc092f')}`,
    mx: `${dot(9, 14, 50, 50, '#8c6a3f')}, ${v3('#006847', '#fff', '#ce1126')}`,
    pe: v3('#d91023', '#fff', '#d91023'),
    ng: v3('#008751', '#fff', '#008751'),
    at: h3('#c8102e', '#fff', '#c8102e'),
    hu: h3('#ce2939', '#fff', '#477050'),
    bg: h3('#fff', '#00966e', '#d62612'),
    lt: h3('#fdb913', '#006a44', '#c1272d'),
    ee: h3('#0072ce', '#000', '#fff'),
    lu: h3('#ed2939', '#fff', '#00a1de'),
    rs: h3('#c6363c', '#0c4076', '#fff'),
    si: h3('#fff', '#005da4', '#ed1c24'),
    sk: `${dot(8, 14, 34, 50, '#ee1c25')}, ${h3('#fff', '#0b4ea2', '#ee1c25')}`,
    hr: `${dot(8, 14, 50, 50, '#ff0000')}, ${h3('#ff0000', '#fff', '#171796')}`,
    am: h3('#d90012', '#0033a0', '#f2a800'),
    az: `${dot(7, 10.5, 50, 50, '#fff')}, ${h3('#00b5e2', '#ef3340', '#509e2f')}`,
    ga: h3('#009e60', '#fcd116', '#3a75c4'),
    ir: h3('#239f40', '#fff', '#da0000'),
    eg: `${dot(6, 9, 50, 50, '#c09300')}, ${h3('#ce1126', '#fff', '#000')}`,
    iq: h3('#ce1126', '#fff', '#000'),
    sy: h3('#ce1126', '#fff', '#000'),
    ye: h3('#ce1126', '#fff', '#000'),
    tj: h3('#cc0000', '#fff', '#006600'),
    ua: h2('#0057b7', '#ffd700'),
    pl: h2('#fff', '#dc143c'),
    id: h2('#ff0000', '#fff'),
    mc: h2('#ce1126', '#fff'),
    sg: `${dot(9, 13.5, 25, 25, '#fff')}, ${dot(8, 12, 29, 25, '#ef3340')}, ${h2('#ef3340', '#fff')}`,
    lv: `linear-gradient(#9e3039 40%, #fff 0 60%, #9e3039 0)`,
    es: `linear-gradient(#aa151b 25%, #f1bf00 0 75%, #aa151b 0)`,
    co: `linear-gradient(#fcd116 50%, #003893 0 75%, #ce1126 0)`,
    th: `linear-gradient(#a51931 16.6%, #f4f5f8 0 33.3%, #2d2a4a 0 66.6%, #f4f5f8 0 83.3%, #a51931 0)`,
    ar: `${dot(7, 10.5, 50, 50, '#f6b40e')}, linear-gradient(#74acdf 33.4%, #fff 0 66.7%, #74acdf 0)`,
    in: `${dot(7, 10.5, 50, 50, '#06038d')}, ${h3('#ff9933', '#fff', '#138808')}`,
    pt: `${dot(12, 18, 40, 50, '#ffe900')}, linear-gradient(90deg, #006600 40%, #ff0000 0)`,
    fi: nordic('#fff', '#002f6c'),
    se: nordic('#006aa7', '#fecc02'),
    dk: nordic('#c8102e', '#fff'),
    no: nordic('#ba0c2f', '#fff', '#00205b'),
    is: nordic('#02529c', '#fff', '#dc1e35'),
    ch: `linear-gradient(#fff, #fff) 50% 50% / 46% 18% no-repeat, linear-gradient(#fff, #fff) 50% 50% / 13% 62% no-repeat, #d52b1e`,
    ge: `linear-gradient(#ff0000, #ff0000) 50% 50% / 100% 20% no-repeat, linear-gradient(#ff0000, #ff0000) 50% 50% / 14% 100% no-repeat, #fff`,
    gb: ukJack,
    uk: ukJack,
    us: `${canton('#3c3b6e')}, repeating-linear-gradient(#b22234 0 7.69%, #fff 0 15.38%)`,
    lr: `${canton('#002868', 30, 46)}, repeating-linear-gradient(#bf0a30 0 9.1%, #fff 0 18.2%)`,
    my: `${dot(8, 12, 22, 26, '#fc0')}, ${canton('#010066', 50, 57)}, repeating-linear-gradient(#cc0001 0 7.14%, #fff 0 14.28%)`,
    gr: `linear-gradient(transparent 22%, #fff 0 33%, transparent 0) 0 0 / 37% 55.5% no-repeat, linear-gradient(90deg, transparent 40%, #fff 0 60%, transparent 0) 0 0 / 37% 55.5% no-repeat, ${canton('#0d5eaf', 37, 55.5)}, repeating-linear-gradient(#0d5eaf 0 11.1%, #fff 0 22.2%)`,
    au: `${dot(5, 7.5, 75, 70, '#fff')}, ${dot(4, 6, 83, 32, '#fff')}, ${dot(4, 6, 68, 40, '#fff')}, ${dot(6, 9, 25, 75, '#fff')}, ${ukCanton}, #012169`,
    nz: `${dot(4, 6, 75, 70, '#c8102e')}, ${dot(4, 6, 82, 35, '#c8102e')}, ${dot(4, 6, 68, 45, '#c8102e')}, ${ukCanton}, #012169`,
    ca: `${dot(10, 18, 50, 50, '#d52b1e')}, linear-gradient(90deg, #d52b1e 25%, #fff 0 75%, #d52b1e 0)`,
    jp: `${dot(20, 30, 50, 50, '#bc002d')}, #fff`,
    kr: `radial-gradient(15% 22.5% at 50% 50%, transparent 96%, #fff 100%), linear-gradient(#cd2e3a 50%, #0047a0 0)`,
    cn: `${dot(8, 12, 20, 28, '#ffde00')}, ${dot(3, 4.5, 35, 14, '#ffde00')}, ${dot(3, 4.5, 38, 38, '#ffde00')}, #de2910`,
    hk: `${dot(14, 21, 50, 50, '#fff')}, #de2910`,
    tw: `${dot(9, 13.5, 25, 25, '#fff')}, ${canton('#000095', 50, 50)}, #fe0000`,
    vn: `${dot(14, 21, 50, 50, '#ffff00')}, #da251d`,
    tr: `${dot(4, 6, 60, 50, '#fff')}, ${dot(13, 19.5, 45, 50, '#e30a17')}, ${dot(16, 24, 39, 50, '#fff')}, #e30a17`,
    kz: `${dot(14, 21, 50, 45, '#fec50c')}, #00afca`,
    kg: `${dot(15, 22.5, 50, 50, '#ffef00')}, #e8112d`,
    uz: `linear-gradient(#0099b5 32%, #ce1126 0 34%, #fff 0 66%, #ce1126 0 68%, #1eb53a 0)`,
    tm: `linear-gradient(90deg, transparent 15%, #c8102e 0 30%, transparent 0), #00843d`,
    mn: v3('#c4272f', '#015197', '#c4272f'),
    by: `linear-gradient(90deg, #fff 0 4%, #c8313e 0 7%, #fff 0 11%, transparent 0), linear-gradient(#c8313e 66.6%, #4aa657 0)`,
    cz: `${hoistTriangle('#11457e', 50)}, ${h2('#fff', '#d7141a')}`,
    ph: `${hoistTriangle('#fff', 43)}, ${h2('#0038a8', '#ce1126')}`,
    za: `${hoistTriangle('#000', 33)}, linear-gradient(#e03c31 32%, #fff 0 39%, #007749 0 61%, #fff 0 68%, #001489 0)`,
    cl: `${dot(6, 9, 17, 25, '#fff')}, ${canton('#0039a6', 33, 50)}, ${h2('#fff', '#d52b1e')}`,
    br: `${dot(14, 21, 50, 50, '#002776')}, ${dot(40, 40, 50, 50, '#ffdf00')}, #009c3b`,
    il: `radial-gradient(10% 15% at 50% 50%, transparent 55%, #0038b8 60% 88%, transparent 92%), linear-gradient(#fff 12%, #0038b8 0 22%, #fff 0 78%, #0038b8 0 88%, #fff 0)`,
    ae: `linear-gradient(90deg, #ff0000 25%, transparent 0), ${h3('#00732f', '#fff', '#000')}`,
    sa: `linear-gradient(transparent 62%, #fff 0 66%, transparent 0) 50% 0 / 60% 100% no-repeat, #006c35`,
    qa: `linear-gradient(90deg, #fff 30%, #8a1538 0)`,
    cy: `${dot(24, 16, 50, 46, '#d57800')}, #fff`,
    mt: `linear-gradient(90deg, #fff 50%, #cf142b 0)`,
    al: `${dot(16, 24, 50, 50, '#000')}, #e41e20`,
    mk: `${dot(14, 21, 50, 50, '#ffe600')}, #ce2028`,
    ba: `${hoistTriangle('#fecb00', 60)}, #002395`,
    me: `${dot(14, 21, 50, 50, '#d3ae3b')}, linear-gradient(#d3ae3b 0 6%, #c40308 0 94%, #d3ae3b 0)`,
    eu: `radial-gradient(22% 33% at 50% 50%, transparent 68%, #ffdd00 72% 84%, transparent 88%), #003399`,
  };

  const NAMES = {
    ru: ['россия', 'russia', 'москва', 'moscow', 'санкт', 'питер', 'petersburg', 'russian'],
    nl: ['нидерланд', 'голланд', 'netherlands', 'holland', 'amsterdam', 'амстердам', 'dutch'],
    de: ['герман', 'germany', 'deutschland', 'frankfurt', 'франкфурт', 'berlin', 'берлин', 'nuremberg', 'нюрнберг', 'falkenstein', 'фалькенштейн', 'munich', 'мюнхен'],
    fi: ['финлянд', 'finland', 'helsinki', 'хельсинки'],
    se: ['швеци', 'sweden', 'stockholm', 'стокгольм'],
    no: ['норвеги', 'norway', 'oslo', 'осло'],
    dk: ['дания', 'дании', 'denmark', 'copenhagen', 'копенгаген'],
    is: ['исланди', 'iceland', 'reykjavik'],
    fr: ['франци', 'france', 'paris', 'париж', 'gravelines', 'roubaix'],
    gb: ['великобритан', 'британи', 'англи', 'united kingdom', 'england', 'britain', 'london', 'лондон'],
    us: ['сша', 'америк', 'united states', 'usa', 'america', 'new york', 'нью-йорк', 'los angeles', 'лос-андж', 'miami', 'майами', 'dallas', 'даллас', 'chicago', 'seattle', 'сиэтл', 'virginia', 'калифорни', 'california'],
    ca: ['канад', 'canada', 'toronto', 'торонто', 'montreal', 'монреаль', 'vancouver'],
    jp: ['япони', 'japan', 'tokyo', 'токио', 'osaka', 'осака'],
    kr: ['корея', 'кореи', 'корее', 'korea', 'seoul', 'сеул'],
    cn: ['китай', 'china', 'beijing', 'пекин', 'shanghai', 'шанхай'],
    hk: ['гонконг', 'hong kong', 'hongkong'],
    tw: ['тайвань', 'taiwan', 'taipei'],
    sg: ['сингапур', 'singapore'],
    tr: ['турци', 'turkey', 'türkiye', 'turkiye', 'istanbul', 'стамбул', 'анкара', 'ankara'],
    kz: ['казахстан', 'kazakhstan', 'алматы', 'almaty', 'астана', 'astana'],
    kg: ['кыргыз', 'киргиз', 'kyrgyz', 'бишкек', 'bishkek'],
    uz: ['узбекистан', 'uzbekistan', 'ташкент', 'tashkent'],
    tj: ['таджикистан', 'tajikistan', 'душанбе'],
    tm: ['туркменистан', 'turkmenistan'],
    ua: ['украин', 'ukraine', 'kyiv', 'киев', 'kiev'],
    by: ['беларус', 'белорус', 'belarus', 'минск', 'minsk'],
    pl: ['польш', 'poland', 'warsaw', 'варшав'],
    lt: ['литв', 'lithuania', 'vilnius', 'вильнюс'],
    lv: ['латви', 'latvia', 'riga', 'рига'],
    ee: ['эстони', 'estonia', 'tallinn', 'таллин'],
    cz: ['чехия', 'чехии', 'czech', 'prague', 'прага'],
    sk: ['словаки', 'slovakia', 'bratislava'],
    at: ['австри', 'austria', 'vienna', 'вена'],
    ch: ['швейцари', 'switzerland', 'zurich', 'цюрих', 'geneva', 'женев'],
    it: ['итали', 'italy', 'milan', 'милан', 'rome', 'рим'],
    es: ['испани', 'spain', 'madrid', 'мадрид', 'barcelona', 'барселон'],
    pt: ['португали', 'portugal', 'lisbon', 'лиссабон'],
    be: ['бельги', 'belgium', 'brussels', 'брюссел'],
    lu: ['люксембург', 'luxembourg'],
    ie: ['ирланди', 'ireland', 'dublin', 'дублин'],
    hu: ['венгри', 'hungary', 'budapest', 'будапешт'],
    ro: ['румыни', 'romania', 'bucharest', 'бухарест'],
    bg: ['болгари', 'bulgaria', 'sofia', 'софия'],
    md: ['молдов', 'moldova', 'chisinau', 'кишин'],
    rs: ['серби', 'serbia', 'belgrade', 'белград'],
    hr: ['хорвати', 'croatia', 'zagreb'],
    si: ['словени', 'slovenia', 'ljubljana'],
    gr: ['греци', 'greece', 'athens', 'афин'],
    cy: ['кипр', 'cyprus', 'limassol', 'лимассол', 'nicosia'],
    mt: ['мальт', 'malta'],
    al: ['албани', 'albania', 'tirana'],
    mk: ['македони', 'macedonia'],
    ba: ['босни', 'bosnia'],
    me: ['черногори', 'montenegro'],
    ge: ['грузия', 'грузии', 'georgia', 'tbilisi', 'тбилиси', 'batumi', 'батуми'],
    am: ['армени', 'armenia', 'yerevan', 'ереван'],
    az: ['азербайджан', 'azerbaijan', 'baku', 'баку'],
    il: ['израил', 'israel', 'tel aviv', 'тель-авив'],
    ae: ['оаэ', 'эмират', 'emirates', 'uae', 'dubai', 'дубай', 'abu dhabi'],
    sa: ['саудов', 'saudi'],
    qa: ['катар', 'qatar', 'doha'],
    ir: ['иран', 'iran', 'tehran'],
    eg: ['египет', 'egypt', 'cairo', 'каир'],
    in: ['индия', 'индии', 'india', 'mumbai', 'мумбаи', 'delhi', 'дели', 'bangalore'],
    th: ['таиланд', 'тайланд', 'thailand', 'bangkok', 'бангкок'],
    vn: ['вьетнам', 'vietnam', 'hanoi', 'ханой'],
    my: ['малайзи', 'malaysia', 'kuala'],
    id: ['индонези', 'indonesia', 'jakarta', 'джакарт'],
    ph: ['филиппин', 'philippines', 'manila'],
    mn: ['монголи', 'mongolia'],
    au: ['австрали', 'australia', 'sydney', 'сидней', 'melbourne'],
    nz: ['новая зеланд', 'new zealand'],
    br: ['бразили', 'brazil', 'são paulo', 'sao paulo', 'сан-паулу'],
    ar: ['аргентин', 'argentina', 'buenos'],
    cl: ['чили', 'chile'],
    mx: ['мексик', 'mexico'],
    co: ['колумби', 'colombia', 'bogota'],
    pe: ['peru'],
    za: ['юар', 'южная африка', 'south africa', 'johannesburg'],
    ng: ['нигери', 'nigeria', 'lagos'],
    eu: ['евросоюз', 'европа', 'europe'],
  };
  const CODE_ALIAS = { uk: 'gb' };

  function fromRegional(name) {
    const cps = Array.from(String(name || ''), (c) => c.codePointAt(0));
    for (let i = 0; i < cps.length - 1; i++) {
      const a = cps[i];
      const b = cps[i + 1];
      if (a >= 0x1f1e6 && a <= 0x1f1ff && b >= 0x1f1e6 && b <= 0x1f1ff) {
        return String.fromCharCode(a - 0x1f1e6 + 97, b - 0x1f1e6 + 97);
      }
    }
    return null;
  }

  const reCache = new Map();
  function wordRe(w) {
    if (!reCache.has(w)) {
      const body = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      reCache.set(w, new RegExp('[^a-zа-яё0-9]' + body + (w.length <= 4 ? '(?![a-zа-яё])' : ''), 'u'));
    }
    return reCache.get(w);
  }

  const cache = new Map();
  function detect(name) {
    if (cache.has(name)) return cache.get(name);
    let code = fromRegional(name);
    if (!code) {
      const low = ' ' + String(name || '').toLowerCase();
      for (const [c, words] of Object.entries(NAMES)) {
        if (words.some((w) => wordRe(w).test(low))) {
          code = c;
          break;
        }
      }
    }
    if (!code) {
      const m = /(?:^|[\s[(|_\-\/.,:])([A-Z]{2})(?=$|[\s\])|_\-\/.,:\d])/.exec(String(name || ''));
      if (m && FLAGS[m[1].toLowerCase()]) code = m[1].toLowerCase();
    }
    if (code && CODE_ALIAS[code]) code = CODE_ALIAS[code];
    cache.set(name, code);
    return code;
  }

  /** Убирает эмодзи-флаги и разделители в начале имени (флаг рисуем сами). */
  function cleanName(name) {
    const s = String(name || '')
      .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, '')
      .replace(/[\u{1F3F4}\u{E0060}-\u{E007F}]/gu, '')
      .replace(/^[\s|·•:—–-]+/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return s || String(name || '');
  }

  function flagEl(name, large) {
    const code = detect(name);
    const el = document.createElement('span');
    el.className = 'flag' + (large ? ' lg' : '');
    if (code && FLAGS[code]) {
      el.style.background = FLAGS[code];
      el.title = code.toUpperCase();
    } else {
      el.classList.add('unknown');
      el.append(DR.iconEl('globe', large ? 16 : 12));
    }
    return el;
  }

  DR.flags = { detect, cleanName, flagEl, FLAGS };
})();

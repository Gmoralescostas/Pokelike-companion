/* Pokelike Companion v0.11.2 — solo lectura.
   Lee el estado del juego y usa sus propias funciones de cálculo.
   No hace clics ni modifica la partida. La semilla aleatoria del juego se
   guarda y se restaura alrededor de cada cálculo para no alterar los combates. */
(() => {
  'use strict';
  if (window.__PLC_LOADED) return;
  window.__PLC_LOADED = true;

  const TYPES = ['Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'];
  const TEAM_CAP = 6;
  // Visible en pantalla (también para capas fijas, donde offsetParent es null).
  const shown = e => !!e && (e.getClientRects().length > 0 || e.offsetParent !== null) && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
  const tg = (f, d) => { try { const v = f(); return v === undefined ? d : v; } catch (e) { return d; } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const chip = t => `<span class="plc-t plc-t-${esc(String(t).toLowerCase())}">${esc(t)}</span>`;
  const chips = ts => (ts || []).map(chip).join('');
  const clamp = x => Math.max(0, Math.min(1, x));
  const nm = p => p.nickname || p.name;
  const sum = a => a.reduce((x, y) => x + y, 0);
  const bst = b => sum(Object.values(b || {}).filter(v => typeof v === 'number'));

  /* ---------- acceso al juego ---------- */
  const getState = () => tg(() => state, null);
  const eff = (t, types) => tg(() => getTypeEffectiveness(t, types), 1);
  const tierFnName = Object.getOwnPropertyNames(window).find(k => /^getMove.ierForMap$/.test(k) && typeof window[k] === 'function');
  const tierForMap = i => tierFnName ? tg(() => window[tierFnName](i), null) : null;
  const dex = id => tg(() => getStaticPokedexEntry(id), null);
  const stat = (p, k) => tg(() => getEffectiveStat(p, k), null);
  const seedOK = () => tg(() => typeof _rngSeed === 'number', false);
  // Ejecuta fn con una semilla propia y restaura la del juego al terminar.
  function withSeed(fn) {
    if (!seedOK()) return fn();
    const saved = _rngSeed;
    try { _rngSeed = (Math.random() * 4294967296) >>> 0; return fn(); }
    finally { _rngSeed = saved; }
  }
  const moveOf = p => withSeed(() => tg(() => getMoveForPokemon(p), null));
  const itemName = it => it ? (it.name || it.id || String(it)) : null;

  let memoSig = '', memoMap = new Map();
  // Caché que sobrevive a los cambios de pantalla: solo se invalida si cambia el mapa o el equipo.
  const persist = new Map();
  const stableKey = s => JSON.stringify([s.runSeed, s.currentMap, s.eliteIndex,
    Object.values((s.map && s.map.nodes) || {}).filter(n => n.visited || n.accessible).map(n => n.id + (n.visited ? 'v' : 'a')).join(),
    (s.team || []).map(p => [p._uid, p.speciesId, p.level, p.currentHp, p.maxHp, p.moveTier, p.heldItem && (p.heldItem.id || p.heldItem)]),
    (s.items || []).map(i => i && (i.id || i)), (s.passives || []).map(x => x && x.id)]);
  function pmemo(name, s, fn) {
    const k = name + '|' + stableKey(s);
    if (persist.has(k)) return persist.get(k);
    const v = fn();
    if (persist.size > 40) persist.clear();
    persist.set(k, v); return v;
  }
  let last = null, lastSig = '';
  function memo(key, fn) {
    if (memoMap.has(key)) return memoMap.get(key);
    const v = fn(); memoMap.set(key, v); return v;
  }


  /* ---------- simulador: usa el motor de combate del propio juego ---------- */
  // Se ejecuta sobre copias, con semilla propia, y restaura semilla y variables de combate al terminar.
  const dclone = v => Array.isArray(v) ? v.map(dclone) : (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dclone(x)])) : v;
  const saveG = () => [tg(() => _abilitiesLive), tg(() => _mirrorHerbLive), tg(() => _fairyGemLive), tg(() => _whiteHerbLive), tg(() => _lumLive), tg(() => _splashPlateLive), tg(() => _roomServiceLive), tg(() => _icicleLive), tg(() => _zGrassLive), tg(() => _absorbBulbLive), tg(() => _battlePassives), tg(() => _battleTeams), tg(() => _megaWeather), tg(() => _battleRunOnHit)];
  const restG = a => { tg(() => { _abilitiesLive = a[0]; }); tg(() => { _mirrorHerbLive = a[1]; }); tg(() => { _fairyGemLive = a[2]; }); tg(() => { _whiteHerbLive = a[3]; }); tg(() => { _lumLive = a[4]; }); tg(() => { _splashPlateLive = a[5]; }); tg(() => { _roomServiceLive = a[6]; }); tg(() => { _icicleLive = a[7]; }); tg(() => { _zGrassLive = a[8]; }); tg(() => { _absorbBulbLive = a[9]; }); tg(() => { _battlePassives = a[10]; }); tg(() => { _battleTeams = a[11]; }); tg(() => { _megaWeather = a[12]; }); tg(() => { _battleRunOnHit = a[13]; }); };
  const origRB = () => window.__PLC_ORIG_RB || tg(() => runBattle, null);
  function freshCfg(s, pas) {
    if (s.isEndlessMode) return undefined;
    if (!(s.gen3Mode || s.gen4Mode || s.gen5Mode || s.gen6Mode)) return null;
    let c = buildGen3AbilityConfig();
    if (typeof buildTraitsConfig === 'function') c = mergeBattleConfigs(c, buildTraitsConfig({}, {}, pas || s.passives || []));
    return c;
  }
  let uidc = 9000000;
  function simRun(s, pTeam, eTeam, n, prepared, extra) {
    const pas = (extra && extra.passives) || s.passives || [], its = (extra && extra.items) || s.items || [];
    const rb = origRB();
    if (typeof rb !== 'function' || !seedOK() || !pTeam.length || !eTeam.length) return null;
    const seed = _rngSeed, gs = saveG(), down0 = pTeam.filter(p => p.currentHp <= 0).length;
    let w = 0, ok = 0, faint = 0;
    try {
      for (let i = 0; i < n; i++) {
        _rngSeed = (extra && extra.seed != null ? (extra.seed + i * 2654435761) : Math.random() * 4294967296) >>> 0;
        const cfg = freshCfg(s, pas);
        if (cfg === undefined) break;
        const P = dclone(pTeam);
        if (!prepared) tg(() => P.forEach(applyMegaEvolution));
        const E = dclone(eTeam); E.forEach(e => { if (e._uid == null) e._uid = uidc++; });
        const r = rb(P, E, its.slice(), [], null, cfg, pas.slice());
        ok++; if (r.playerWon) w++;
        faint += Math.max(0, (r.pTeam || []).filter(p => p.currentHp <= 0).length - down0);
      }
    } catch (e) { /* si el motor cambia, se cae a los duelos */ } finally { _rngSeed = seed; restG(gs); }
    return ok ? { pct: Math.round(w / ok * 100), n: ok, faint: faint / ok } : null;
  }
  // Probabilidad de ganar con el orden actual y con cada miembro como líder.
  const PAIR = 91733;
  function simFight(s, team, foe) {
    return memo('sim|' + foe.name, () => {
      const base = simRun(s, team, foe.mons, 100, false, { seed: PAIR });
      if (!base) return null;
      const alive = team.filter(p => p.currentHp > 0);
      const rows = alive.map((p, i) => i === 0 ? { p, pct: base.pct } : { p, pct: (simRun(s, [p].concat(team.filter(o => o !== p)), foe.mons, 100, false, { seed: PAIR }) || base).pct });
      return { base, rows, cur: rows[0], best: rows.slice().sort((a, b) => b.pct - a.pct)[0] };
    });
  }
  const simCls = p => p >= 80 ? 'plc-good' : p >= 50 ? 'plc-mid' : 'plc-bad';
  function simLine(sf, name) {
    return `<div class="${simCls(sf.base.pct)} plc-big">Ganas a ${esc(name)} el ${sf.base.pct}% de las veces</div><div class="plc-sub">${sf.base.n} combates simulados con el motor del juego · caen de media ${sf.base.faint.toFixed(1)} de los tuyos${sf.best.p !== sf.cur.p && sf.best.pct - sf.cur.pct >= 10 ? ` · con ${esc(nm(sf.best.p))} primero: ${sf.best.pct}%` : ''}</div>`;
  }

  /* ---------- registro de aciertos ---------- */
  const LOGK = 'plc_log';
  const readLog = () => tg(() => JSON.parse(localStorage.getItem(LOGK) || '[]'), []) || [];
  function logBattle(s, pred, r) {
    const log = readLog(), foe = String(s._trackFoe || '');
    log.push({ t: Date.now(), map: s.currentMap || 0, foe, pred: pred ? pred.pct : null, panel: last && last.sfBoss && (foe === 'boss' || foe === last.bossName) ? last.sfBoss.base.pct : null, won: !!r.playerWon });
    tg(() => localStorage.setItem(LOGK, JSON.stringify(log.slice(-400))));
    lastSig = '';
  }
  function hookBattle() {
    if (window.__PLC_ORIG_RB || tg(() => typeof runBattle, '') !== 'function') return;
    const orig = runBattle;
    window.__PLC_ORIG_RB = orig;
    window.runBattle = function (pT, eT) {
      const s = getState(), track = s && !s.isEndlessMode && Array.isArray(pT) && Array.isArray(eT);
      let pred = null;
      if (track) { try { pred = simRun(s, pT, eT, 100, true); } catch (e) { } }
      const r = orig.apply(this, arguments);
      if (track) { try { if (r && typeof r.playerWon === 'boolean') logBattle(s, pred, r); } catch (e) { } }
      return r;
    };
  }
  function htmlLog() {
    const log = readLog().filter(x => x.pred != null);
    if (!log.length) return '<div class="plc-sub">Aún no hay combates registrados. Se apunta cada combate de Story: lo que predijo el simulador y si ganaste.</div>';
    const bk = [[90, 101, '90–100%'], [70, 90, '70–89%'], [50, 70, '50–69%'], [0, 50, 'menos del 50%']];
    let h = `<div>${log.length} combates · predicción media ${Math.round(sum(log.map(x => x.pred)) / log.length)}% · ganados ${Math.round(log.filter(x => x.won).length / log.length * 100)}%</div><table><tr class="plc-sub"><td>Predicción</td><td class="plc-num">Combates</td><td class="plc-num">Ganados</td></tr>`;
    bk.forEach(([a, b, l]) => { const g = log.filter(x => x.pred >= a && x.pred < b); if (g.length) h += `<tr><td>${l}</td><td class="plc-num">${g.length}</td><td class="plc-num">${Math.round(g.filter(x => x.won).length / g.length * 100)}%</td></tr>`; });
    h += '</table>';
    const bs = log.filter(x => x.panel != null);
    if (bs.length) h += `<div class="plc-sub">Jefes: la estimación previa del panel se desvió de media ${Math.round(sum(bs.map(x => Math.abs(x.panel - x.pred))) / bs.length)} puntos respecto al combate real (${bs.length}).</div>`;
    return h + '<div class="plc-sub">Si la columna "Ganados" se parece a la de "Predicción", el simulador es fiable.</div>';
  }

  /* ---------- auras de Kalos (un uso por run cada una) ---------- */
  const AURA = { life: ['Xerneas', 'Aura de Vida'], death: ['Yveltal', 'Aura de Muerte'], order: ['Zygarde', 'Aura de Orden'] };
  const aurasReady = () => ['life', 'death', 'order'].filter(k => tg(() => kalosPowerReady(k), false));
  function auraAdvice(s, team, foe) {
    return memo('aura|' + foe.name, () => {
      const ready = aurasReady();
      if (!ready.length) return null;
      const base = simRun(s, team, foe.mons, 100, false, { seed: PAIR });
      if (!base) return null;
      const alive = team.filter(p => p.currentHp > 0), out = [];
      if (ready.includes('life')) {
        const r = alive.map(p => ({ p, pct: (simRun(s, team.map(o => o === p ? Object.assign({}, o, { _kalosReviveArmed: true }) : o), foe.mons, 60) || base).pct })).sort((a, b) => b.pct - a.pct)[0];
        if (r) out.push({ k: 'life', pct: r.pct, how: 'revive a ' + nm(r.p) });
      }
      if (ready.includes('death') && foe.mons.length > 1) {
        const r = foe.mons.map(e => ({ e, pct: (simRun(s, team, foe.mons.filter(o => o !== e), 60) || base).pct })).sort((a, b) => b.pct - a.pct)[0];
        if (r) out.push({ k: 'death', pct: r.pct, how: 'elimina a ' + r.e.name });
      }
      if (ready.includes('order')) {
        let best = null;
        alive.forEach(p => foe.mons.forEach(e => {
          const r = simRun(s, [p].concat(team.filter(o => o !== p)), [e].concat(foe.mons.filter(o => o !== e)), 30);
          if (r && (!best || r.pct > best.pct)) best = { pct: r.pct, how: `pon primero a ${nm(p)} y, en el rival, a ${e.name}` };
        }));
        if (best) out.push(Object.assign({ k: 'order' }, best));
      }
      out.sort((a, b) => b.pct - a.pct);
      return { base: base.pct, out, best: out[0] || null };
    });
  }
  function htmlAura(a, name) {
    if (!a || !a.out.length) return '';
    const save = a.base >= 85;
    return `<div class="plc-enemy"><div><b>Auras disponibles</b> <span class="plc-sub">un solo uso por run · sin aura ganas ${a.base}%</span></div>
      ${a.out.map(x => `<div>${esc(AURA[x.k][1])} (${esc(AURA[x.k][0])}): ${esc(x.how)} → <b class="${simCls(x.pct)}">${x.pct}%</b></div>`).join('')}
      <div class="${save ? 'plc-good' : 'plc-warn'}">${save ? 'No te hace falta aquí: guárdalas para un boss más duro.' : a.best.pct - a.base >= 15 ? `Aquí merece la pena: ${esc(AURA[a.best.k][1])} sube tus opciones ${a.best.pct - a.base} puntos contra ${esc(name)}.` : 'Ayudan poco en este combate.'}</div></div>`;
  }

  function compat() {
    const need = {
      state: () => typeof state === 'object', calcDamage: () => typeof calcDamage === 'function',
      getMoveForPokemon: () => typeof getMoveForPokemon === 'function', getTypeEffectiveness: () => typeof getTypeEffectiveness === 'function',
      calcHp: () => typeof calcHp === 'function', GYM_LEADERS: () => Array.isArray(GYM_LEADERS),
      getStaticPokedexEntry: () => typeof getStaticPokedexEntry === 'function'
    };
    return Object.keys(need).filter(k => !tg(need[k], false));
  }

  function region(s) {
    const defs = [
      ['gen6Mode', 'Kalos', () => KALOS_GYM_LEADERS, () => KALOS_ELITE_4, () => gen6EncounterPool, [() => GEN6_MAP_NAMES, () => KALOS_MAP_NAMES], ['gen6Pool']],
      ['gen5Mode', 'Unova', () => UNOVA_GYM_LEADERS, () => UNOVA_ELITE_4, () => gen5EncounterPool, [() => GEN5_MAP_NAMES], ['gen5Pool']],
      ['gen4Mode', 'Sinnoh', () => SINNOH_GYM_LEADERS, () => SINNOH_ELITE_4, () => gen4EncounterPool, [() => GEN4_MAP_NAMES], ['gen4Pool']],
      ['gen3Mode', 'Hoenn', () => HOENN_GYM_LEADERS, () => HOENN_ELITE_4, () => gen3EncounterPool, [() => GEN3_MAP_NAMES], ['gen3Pool']],
      ['gen2Mode', 'Johto', () => JOHTO_GYM_LEADERS, () => GEN2_ELITE_4, () => gen2EncounterPool, [() => GEN2_MAP_NAMES, () => JOHTO_MAP_NAMES], ['gen2Pool', 'pool']],
      [null, 'Kanto', () => GYM_LEADERS, () => ELITE_4, () => gen1EncounterPool, [() => MAP_NAMES], ['pool']]
    ];
    const d = defs.find(x => x[0] === null || s[x[0]]);
    let maps = null;
    for (const f of d[5]) { maps = tg(f, null); if (maps) break; }
    return { key: d[0], name: d[1], leaders: tg(d[2], []) || [], elite: tg(d[3], []) || [], pool: tg(d[4], null), maps: maps || [], poolFields: d[6] };
  }

  function mkEnemy(t0, tier) {
    // Rivales con megapiedra: se usan los stats y tipos de la megaevolución.
    const st = t0.mega ? tg(() => MEGA_STONE_BY_ID[t0.mega], null) : null;
    const t = st && st.megaStats ? Object.assign({}, t0, { name: st.megaName || t0.name, types: st.megaTypes || t0.types, baseStats: st.megaStats, megaStone: st, isMega: true }) : t0;
    const hp = tg(() => calcHp(t.baseStats.hp, t.level), 1);
    return Object.assign({}, t, {
      currentHp: hp, maxHp: hp, moveTier: t.moveTier != null ? t.moveTier : (tier || 0),
      heldItem: t.heldItem || null, megaStone: t.megaStone || null, isShiny: false, nickname: null,
      spriteUrl: t.spriteUrl || ('img/sprites/pokemon/' + t.speciesId + '.png')
    });
  }
  // El juego evoluciona a los rivales según el nivel del combate (resolveEvoForLevel).
  const evoAt = (id, lv) => { const v = tg(() => resolveEvoForLevel(id, lv), id); return typeof v === 'number' && dex(v) ? v : id; };
  const mkFoe = (id, level, tier) => mkMon(evoAt(id, level), level, tier);
  function mkMon(id, level, tier) {
    const d = dex(id);
    if (!d || !d.baseStats) return null;
    return mkEnemy({ speciesId: id, name: d.name, types: d.types, baseStats: d.baseStats, level, spriteUrl: d.spriteUrl }, tier);
  }

  function remainingBosses(R, s) {
    const out = [], cur = s.currentMap || 0;
    for (let i = cur; i < R.leaders.length; i++) {
      let L = R.leaders[i];
      if (R.key === 'gen5Mode') L = tg(() => unovaGymLeader(i), L) || L;
      if (!L || !L.team) continue;
      const tier = L.moveTier != null ? L.moveTier : tierForMap(i);
      out.push({ label: 'Gimnasio ' + (i + 1), name: L.name, type: L.type, tier, map: i, mons: L.team.map(t => mkEnemy(t, tier)) });
    }
    const eStart = cur >= R.leaders.length ? (s.eliteIndex || 0) : 0, eTier = tierForMap(R.leaders.length);
    for (let j = eStart; j < R.elite.length; j++) {
      const E = R.elite[j];
      if (!E || !E.team) continue;
      const tier = E.moveTier != null ? E.moveTier : eTier;
      out.push({ label: E.title || 'Alto Mando', name: E.name, type: E.type, tier, map: R.leaders.length, mons: E.team.map(t => mkEnemy(t, tier)) });
    }
    return out;
  }

  /* ---------- cálculo de daño ---------- */
  function sample(att, def, items, n) {
    const mv = tg(() => getMoveForPokemon(att), null);
    if (!mv) return null;
    let lo = Infinity, hi = 0, e = 1, any = false;
    for (let i = 0; i < (n || 12); i++) {
      const r = tg(() => calcDamage(Object.assign({}, att), Object.assign({}, def), mv, items), null);
      if (!r || r.damage == null) continue;
      e = r.typeEff; any = true;
      if (r.crit) continue;
      lo = Math.min(lo, r.damage); hi = Math.max(hi, r.damage);
    }
    if (!any) return null;
    if (lo === Infinity) { lo = 0; hi = 0; }
    const hp = Math.max(1, def.maxHp || 1);
    return { mv, eff: e, pLo: Math.round(lo / hp * 100), pHi: Math.round(hi / hp * 100), avg: (lo + hi) / 2 / hp * 100 };
  }
  // Duelo 1 contra 1: ¿quién cae antes?
  function duel(p, e, items, n) {
    const deal = sample(p, e, items, n), take = sample(e, p, [], n);
    const d = deal ? deal.avg : 0, t = take ? take.avg : 0;
    const ttk = d > 0 ? Math.ceil(100 / d) : 99, ttd = t > 0 ? Math.ceil(100 / t) : 99;
    const sp = stat(p, 'speed'), se = stat(e, 'speed');
    const first = sp != null && se != null ? sp >= se : null;
    return { deal, take, d, t, ttk, ttd, first, win: ttk < ttd || (ttk === ttd && first !== false) };
  }
  function bossMatchup(team, boss, items) {
    return memo('boss|' + boss.name, () => withSeed(() => boss.mons.map(e => ({
      e, move: tg(() => getMoveForPokemon(e), null), rows: team.map(p => ({ p, r: duel(p, e, items, 12) }))
    }))));
  }

  /* ---------- puntuación de un Pokémon para el equipo ---------- */
  function scoreMon(c, others, bosses, avgLvl) {
    const mv = moveOf(c), mt = mv ? mv.type : c.types[0];
    let bu = 0, w = 0; const good = [];
    bosses.forEach((b, i) => {
      const wt = 1 / (1 + i * 0.5); let s = 0;
      b.mons.forEach(m => {
        const off = eff(mt, m.types), def = Math.max(...m.types.map(t => eff(t, c.types)));
        s += (off > 1 ? 1 : off === 1 ? 0.5 : off === 0 ? 0 : 0.2) * 0.6 + (def < 1 ? 1 : def === 1 ? 0.5 : 0) * 0.4;
      });
      s /= Math.max(1, b.mons.length);
      if (s >= 0.7) good.push(b.name);
      bu += wt * s; w += wt;
    });
    bu = w ? bu / w : 0.5;
    let B = bst(c.baseStats);
    const ev = tg(() => EVOLUTIONS[c.speciesId], null);
    if (ev && ev.into) { const d2 = dex(ev.into); if (d2) B = Math.max(B, (B + bst(d2.baseStats)) / 2); }
    const pw = clamp((B - 250) / 300) * 0.65 + clamp((mv ? mv.power : 40) / 100) * 0.35;
    const teamMoves = others.map(p => (moveOf(p) || {}).type).filter(Boolean);
    const newSE = TYPES.filter(t => eff(mt, [t]) > 1 && !teamMoves.some(m => eff(m, [t]) > 1));
    const shared = TYPES.filter(t => eff(t, c.types) > 1 && others.filter(p => eff(t, p.types) > 1).length >= 2);
    const cov = clamp(clamp(newSE.length / 4) - 0.25 * shared.length);
    const lv = clamp((c.level - avgLvl + 6) / 12);
    const total = Math.round(100 * (0.40 * bu + 0.25 * pw + 0.20 * cov + 0.15 * lv));
    const why = [];
    if (good.length) why.push('bueno contra ' + good.slice(0, 3).join(', '));
    if (newSE.length) why.push('añade golpe súper eficaz a ' + newSE.slice(0, 4).join(', '));
    else if (others.length) why.push('no añade cobertura nueva');
    if (shared.length) why.push('repite debilidad a ' + shared.join(', '));
    if (ev && ev.level) why.push('evoluciona al nv ' + ev.level);
    if (c.level < avgLvl - 4) why.push('nivel bajo');
    if (pw < 0.3) why.push('stats flojos');
    return { total, why, mv };
  }

  /* ---------- lectura de pantallas de elección ---------- */
  function parseCard(c) {
    const img = c.querySelector('img.poke-sprite') || c.querySelector('img');
    const m = img && /pokemon\/(?:[a-z-]+\/)*(\d+)/i.exec(img.getAttribute('src') || '');
    if (!m) return null;
    const lv = /(\d+)/.exec((c.querySelector('.poke-level') || {}).textContent || '');
    return { id: +m[1], level: lv ? +lv[1] : null, el: c };
  }
  function visibleCards() {
    const ids = ['catch-choices', 'trade-choices', 'swap-incoming', 'starter-screen'];
    const els = window.__PLC_TEST_EL ? [window.__PLC_TEST_EL] : ids.map(i => document.getElementById(i)).filter(e => e && (window.__PLC_TEST_EL || shown(e)));
    for (const el of els) {
      const cards = [...el.querySelectorAll('.poke-card')].map(parseCard).filter(Boolean);
      if (cards.length) return { where: el.id || 'test', cards };
    }
    return null;
  }
  function visibleItems() {
    const el = document.getElementById('item-choices');
    if (!el || !shown(el)) return null;
    const pool = tg(() => ITEM_POOL, []) || [];
    const found = [];
    [...el.children].forEach(ch => {
      const txt = ch.textContent || '';
      const it = pool.filter(i => i.name && txt.includes(i.name)).sort((a, b) => b.name.length - a.name.length)[0];
      if (it && !found.some(f => f.it === it)) found.push({ it, el: ch });
    });
    return found.length ? found : null;
  }

  /* ---------- objetos ---------- */
  // Ganancia de dar el objeto a p: puntos de % de daño ganados más daño evitado contra el próximo boss.
  function itemGain(p, item, boss, bag) {
    return memo('ig|' + p._uid + '|' + (item.id || item.name) + '|' + boss.name, () => withSeed(() => {
      const base = Object.assign({}, p, { heldItem: null }), withI = Object.assign({}, p, { heldItem: item });
      let g = 0;
      boss.mons.forEach(e => {
        const a = duel(base, e, bag, 8), b = duel(withI, e, bag, 8);
        g += (b.d - a.d) + (a.t - b.t);
      });
      return g / Math.max(1, boss.mons.length);
    }));
  }
  const itemType = item => { const tmap = tg(() => TYPE_ITEM_MAP, {}) || {}; return item ? Object.keys(tmap).find(t => tmap[t] === item.id) || null : null; };
  // Objetos de tipo: solo sirven a quien ataca con ese tipo.
  const itemUsers = (item, list) => { const ty = itemType(item); return ty ? list.filter(p => (moveOf(p) || {}).type === ty) : list; };
  function bestHolder(item, team, boss, bag) {
    let alive = team.filter(p => p.currentHp > 0);
    if (!alive.length) return null;
    const ty0 = itemType(item);
    alive = itemUsers(item, alive);
    if (!alive.length) return { p: null, g: 0, note: 'nadie de tu equipo ataca con tipo ' + ty0 };
    let rows = boss && seedOK() ? alive.map(p => ({ p, g: itemGain(p, item, boss, bag) })).sort((a, b) => b.g - a.g) : [];
    if (rows.length && rows[0].g >= 1.5) return { p: rows[0].p, g: rows[0].g, rows };
    const tmap = tg(() => TYPE_ITEM_MAP, {}) || {};
    const ty = Object.keys(tmap).find(t => tmap[t] === item.id);
    if (ty) { const p = alive.find(x => (moveOf(x) || {}).type === ty); return p ? { p, g: 0, note: 'potencia ataques de tipo ' + ty } : { p: null, g: 0, note: 'nadie usa ataques de tipo ' + ty }; }
    return { p: null, g: 0, note: 'efecto no medible en daño (utilidad)' };
  }

  /* ---------- interfaz ---------- */
  const mk = (tag, id) => { const e = document.createElement(tag); e.id = id; return e; };
  const L = mk('div', 'plc-left'), Rp = mk('div', 'plc-right'); L.className = Rp.className = 'plc-p'; const _x = 0, tL = mk('button', 'plc-tl'), tR = mk('button', 'plc-tr');
  const toast = mk('div', 'plc-toast'), tip = mk('div', 'plc-tip'), alertEl = mk('div', 'plc-alert'), nodeBox = mk('div', 'plc-nodes');
  tL.textContent = 'MI EQUIPO'; tR.textContent = 'LO QUE VIENE';
  document.body.append(nodeBox, L, Rp, tL, tR, toast, tip, alertEl);
  const open = { L: tg(() => localStorage.getItem('plc_L') !== '0', true), R: tg(() => localStorage.getItem('plc_R') !== '0', true) };
  const applyOpen = () => { L.classList.toggle('plc-open', open.L); tL.classList.toggle('plc-open', open.L); Rp.classList.toggle('plc-open', open.R); tR.classList.toggle('plc-open', open.R); };
  const flip = k => () => { open[k] = !open[k]; tg(() => localStorage.setItem('plc_' + k, open[k] ? '1' : '0')); applyOpen(); lastSig = ''; render(); };
  tL.addEventListener('click', flip('L')); tR.addEventListener('click', flip('R')); applyOpen();

  let reminders = [], toastTimer = null;
  function remind(msg) {
    reminders.unshift({ id: String(Date.now() + Math.random()), msg });
    reminders.length = Math.min(reminders.length, 5);
    toast.textContent = msg; toast.style.display = 'block';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 7000);
    lastSig = '';
  }
  Rp.addEventListener('click', ev => {
    if (!ev.target.closest('[data-plc-route]')) return;
    routeMode = (routeMode + 1) % 3; tg(() => localStorage.setItem('plc_route', String(routeMode)));
    lastSig = ''; render();
  });
  L.addEventListener('click', ev => {
    const b = ev.target.closest('[data-plc-rem]');
    if (!b) return;
    reminders = reminders.filter(r => r.id !== b.getAttribute('data-plc-rem'));
    lastSig = ''; render();
  });

  const monImg = p => `<img src="${esc(p.spriteUrl || ('img/sprites/pokemon/' + p.speciesId + '.png'))}" alt="">`;
  const pc = (p, good) => p >= 50 ? (good ? 'plc-good' : 'plc-bad') : p >= 25 ? 'plc-mid' : (good ? 'plc-bad' : 'plc-good');
  const dmg = d => d ? `${d.pLo}–${d.pHi}%${d.eff === 1 ? '' : ' ×' + d.eff}` : '—';

  function htmlTeam(team, mapTier) {
    return team.map(p => {
      const mv = moveOf(p), low = mapTier != null && p.moveTier != null && p.moveTier < mapTier;
      const nx = p.moveTier != null ? moveOf(Object.assign({}, p, { moveTier: p.moveTier + 1 })) : null;
      const ab = tg(() => { const id = abilityIdOf(p); return id ? tAbility(id) : null; }, null);
      const ev = tg(() => EVOLUTIONS[p.speciesId], null);
      const st = ['atk', 'def', 'special', 'spdef', 'speed'].map(k => [k, stat(p, k)]).filter(x => x[1] != null);
      const lbl = { atk: 'Atq', def: 'Def', special: 'AtqE', spdef: 'DefE', speed: 'Vel' };
      return `<div class="plc-row">${monImg(p)}<div class="plc-grow">
        <div><span class="plc-name">${esc(nm(p))}</span> <span class="plc-sub">Nv ${p.level} · ${p.currentHp}/${p.maxHp} PS</span> ${chips(p.types)}</div>
        <div>${mv ? `${chip(mv.type)} ${esc(mv.name)} <span class="plc-sub">${mv.power} pot · ${mv.isSpecial ? 'especial' : 'físico'}</span>` : ''} <span class="${low ? 'plc-warn' : 'plc-sub'}">tier ${p.moveTier != null ? p.moveTier : '?'}${low ? ' (por debajo del mapa)' : ''}</span></div>
        ${nx && mv && nx.name !== mv.name ? `<div class="plc-sub">Al subir de tier: ${esc(nx.name)} (${nx.power} pot)</div>` : ''}
        <div class="plc-sub">${st.map(x => lbl[x[0]] + ' ' + x[1]).join(' · ')}</div>
        <div class="plc-sub">${ev && ev.level ? (ev.level > p.level ? `Evoluciona a ${esc(ev.name)} al nv ${ev.level} (faltan ${ev.level - p.level})` : `Evoluciona a ${esc(ev.name)}`) + ' · ' : ''}${ab ? 'Hab: ' + esc(ab) + ' · ' : ''}Objeto: ${esc(itemName(p.heldItem) || 'ninguno')}${p.megaStone ? ' · Megapiedra: ' + esc(itemName(p.megaStone)) : ''}</div>
      </div></div>`;
    }).join('');
  }

  function htmlStatus(s, team, bosses, R) {
    if (!bosses.length) return '<div class="plc-sub">No quedan jefes.</div>';
    const alive = team.filter(p => p.currentHp > 0), boss = bosses[0];
    const avg = sum(team.map(p => p.level)) / team.length, bmax = Math.max(...boss.mons.map(m => m.level));
    const diff = Math.round(avg - bmax);
    let h = `<div>Nivel medio <b>${avg.toFixed(1)}</b> · ${esc(boss.name)} llega a nv <b>${bmax}</b>: <span class="${diff >= 0 ? 'plc-good' : diff >= -4 ? 'plc-mid' : 'plc-bad'}">${diff >= 2 ? 'vas por encima' : diff >= -2 ? 'vas en línea' : 'te faltan ' + (-diff) + ' niveles'}</span></div>`;
    const sf = tg(() => simFight(s, team, boss), null);
    if (sf) h += simLine(sf, boss.name);
    else if (seedOK() && alive.length) {
      const data = bossMatchup(alive, boss, s.items || []);
      const un = data.filter(x => !x.rows.some(r => r.r.win)).map(x => x.e.name);
      h += un.length === 0 ? `<div class="plc-good"><b>Si pelearas ahora: ganas.</b> Tienes respuesta para todo el equipo de ${esc(boss.name)}.</div>`
        : un.length < data.length ? `<div class="plc-mid"><b>Si pelearas ahora: vas justo.</b> Sin respuesta para ${esc(un.join(', '))}.</div>`
          : `<div class="plc-bad"><b>Si pelearas ahora: pierdes.</b> Nadie gana un duelo contra el equipo de ${esc(boss.name)}.</div>`;
    }
    const moveTypes = alive.map(p => (moveOf(p) || {}).type).filter(Boolean);
    const noSE = bosses.filter(b => b.mons.filter(m => moveTypes.some(t => eff(t, m.types) > 1)).length < b.mons.length / 2).map(b => b.name);
    const free = TEAM_CAP - team.length, mapTier = tierForMap(s.currentMap || 0);
    const lag = team.filter(p => mapTier != null && p.moveTier != null && p.moveTier < mapTier).map(nm);
    const todo = [];
    if (free > 0) todo.push(`${free} hueco${free > 1 ? 's' : ''} libre${free > 1 ? 's' : ''} en el equipo`);
    if (noSE.length) todo.push('sin golpe súper eficaz para la mayoría del equipo de: ' + noSE.join(', '));
    if (lag.length) todo.push('tier de ataque atrasado: ' + lag.join(', '));
    h += `<div><b>Para el resto del run:</b> ${todo.length ? '</div><ul class="plc-ul">' + todo.map(t => `<li>${esc(t)}</li>`).join('') + '</ul>' : '<span class="plc-good">nada pendiente por tipos.</span></div>'}`;
    return h;
  }

  function htmlCoverage(team) {
    const def = TYPES.map(t => ({ t, weak: team.filter(p => eff(t, p.types) > 1).length, res: team.filter(p => eff(t, p.types) < 1).length }));
    const weak = def.filter(d => d.weak > 0).sort((a, b) => b.weak - a.weak), shared = weak.filter(d => d.weak >= 2 && d.res === 0);
    const mts = [...new Set(team.map(p => (moveOf(p) || {}).type).filter(Boolean))], noSE = TYPES.filter(d => !mts.some(m => eff(m, [d]) > 1));
    return `<div><b>Débil a:</b> ${weak.length ? weak.map(d => chip(d.t) + `<span class="plc-sub">×${d.weak}</span> `).join('') : '<span class="plc-sub">nada</span>'}</div>
      ${shared.length ? `<div class="plc-bad">Debilidad compartida sin resistencia: ${shared.map(d => chip(d.t)).join('')}</div>` : ''}
      <div><b>Tus ataques:</b> ${chips(mts) || '—'}</div>
      <div><b>Sin golpe súper eficaz contra:</b> ${noSE.length ? chips(noSE) : '<span class="plc-good">cubres todo</span>'}</div>`;
  }

  // Objetos mal colocados o sin equipar, medidos contra el próximo boss.
  function itemIssues(s, team, boss) {
    return memo('issues', () => {
      const out = [];
      if (!boss || !seedOK()) return out;
      const bag = s.items || [];
      team.filter(p => p.heldItem && typeof p.heldItem === 'object' && p.currentHp > 0).forEach(p => {
        const mine = itemGain(p, p.heldItem, boss, bag);
        if (itemType(p.heldItem) && (moveOf(p) || {}).type !== itemType(p.heldItem)) { const u = itemUsers(p.heldItem, team.filter(o => o !== p && o.currentHp > 0))[0]; out.push(u ? { kind: 'swap', p, o: u, item: p.heldItem, gain: 0, wrongType: true } : { kind: 'useless', p, item: p.heldItem }); return; }
        const alt = itemUsers(p.heldItem, team.filter(o => o !== p && !o.heldItem && o.currentHp > 0)).map(o => ({ o, g: itemGain(o, p.heldItem, boss, bag) })).sort((a, b) => b.g - a.g)[0];
        if (alt && alt.g > mine * 1.3 + 3) out.push({ kind: 'swap', p, o: alt.o, item: p.heldItem, gain: alt.g - mine });
      });
      bag.filter(i => i && typeof i === 'object' && !i.usable).forEach(it => {
        const b = bestHolder(it, team.filter(p => !p.heldItem), boss, bag);
        if (b && b.p && (b.g >= 3 || b.note)) out.push({ kind: 'bag', o: b.p, item: it, gain: b.g });
      });
      return out;
    });
  }
  function htmlItems(s, team, boss) {
    const issues = itemIssues(s, team, boss);
    if (!(s.items || []).some(i => i && typeof i === 'object' && !i.usable) && !team.some(p => p.heldItem)) return '<div class="plc-sub">Sin objetos todavía.</div>';
    if (!issues.length) return '<div class="plc-good">Objetos bien repartidos para el próximo boss.</div>';
    return issues.map(x => x.kind === 'useless' ? `<div class="plc-warn">${esc(itemName(x.item))} en ${esc(nm(x.p))} no sirve: nadie de tu equipo ataca con tipo ${esc(itemType(x.item))}.</div>`
      : x.kind === 'swap' && x.wrongType ? `<div class="plc-warn">${esc(itemName(x.item))} solo potencia ataques de tipo ${esc(itemType(x.item))}: pásalo de ${esc(nm(x.p))} a <b>${esc(nm(x.o))}</b>.</div>`
      : x.kind === 'swap'
      ? `<div class="plc-warn">${esc(itemName(x.item))}: mejor en <b>${esc(nm(x.o))}</b> que en ${esc(nm(x.p))} (+${x.gain.toFixed(0)} pts)</div>`
      : `<div class="plc-warn">${esc(itemName(x.item))} sin equipar: dáselo a <b>${esc(nm(x.o))}</b>${x.gain >= 3 ? ' (+' + x.gain.toFixed(0) + ' pts)' : ''}</div>`).join('');
  }

  const det = (k, summary, body) => `<details data-k="${esc(k)}"><summary>${summary}</summary>${body}</details>`;

  function htmlBoss(team, boss, items) {
    const alive = team.filter(p => p.currentHp > 0);
    let h = `<div><span class="plc-name">${esc(boss.name)}</span> <span class="plc-sub">${esc(boss.label)}</span> ${boss.type ? chip(boss.type) : ''} <span class="plc-sub">tier ${boss.tier != null ? boss.tier : '?'}</span></div>`;
    if (!seedOK() || !alive.length) return h + boss.mons.map(e => `<div class="plc-row">${monImg(e)}<div class="plc-grow"><span class="plc-name">${esc(e.name)}</span> <span class="plc-sub">Nv ${e.level}</span> ${chips(e.types)}</div></div>`).join('');
    bossMatchup(alive, boss, items).forEach(({ e, move, rows }) => {
      const best = rows.slice().sort((a, b) => (b.r.d - b.r.t) - (a.r.d - a.r.t))[0];
      const wins = rows.filter(x => x.r.win).length;
      h += `<div class="plc-enemy"><div class="plc-row">${monImg(e)}<div class="plc-grow">
        <div><span class="plc-name">${esc(e.name)}</span> <span class="plc-sub">Nv ${e.level}</span> ${chips(e.types)}</div>
        <div class="${wins ? 'plc-good' : 'plc-bad'}">${wins ? '✓ Le gana' : '✗ Nadie le gana; el mejor es'} <b>${esc(nm(best.p))}</b>${wins > 1 ? ' y ' + (wins - 1) + ' más' : ''}</div>
      </div></div>${det('boss|' + e.name, 'Ver daños', `<div class="plc-sub">${move ? esc(move.name) + ' (' + esc(move.type) + ', ' + move.power + ' pot)' : ''}${e.heldItem ? ' · ' + esc(itemName(e.heldItem)) : ''} · ${e.maxHp} PS</div><table><tr class="plc-sub"><td>Tu Pokémon</td><td class="plc-num">Haces</td><td class="plc-num">Recibes</td><td class="plc-num">1º</td></tr>
      ${rows.map(({ p, r }) => `<tr><td>${esc(nm(p))}</td><td class="plc-num ${r.deal ? pc(r.deal.pHi, true) : ''}">${dmg(r.deal)}</td><td class="plc-num ${r.take ? pc(r.take.pHi, false) : ''}">${dmg(r.take)}</td><td class="plc-num">${r.first == null ? '' : r.first ? '✓' : '✗'}</td></tr>`).join('')}
      </table>`)}</div>`;
    });
    return h;
  }

  /* ---------- encuentros especiales (Kalos y otros nodos) ---------- */
  const NODE_LABEL = { catch: 'Captura', item: 'Objeto', question: 'Evento ?', pokecenter: 'Centro Pokémon', move_tutor: 'Tutor de ataques', trade: 'Intercambio', legendary: 'Legendario', pokemart: 'Tienda', mutation: 'Mutación', evilteam: 'Equipo villano', silver: 'Rival', moonstone: 'Piedra Lunar', levelup: 'Subida de nivel', magma: 'Equipo Magma', aqua: 'Equipo Aqua', rival_n: 'Rival N', masterball: 'Master Ball (legendario)', underground: 'Subsuelo', sycamore: 'Profesor Ciprés', korrina: 'Korrina', lysandre: 'Lysson' };
  function specialFights(s) {
    return memo('special', () => {
      const nodes = Object.values((s.map && s.map.nodes) || {}).filter(n => !n.visited), cur = s.currentMap || 0;
      const tier = tg(() => _kMoveTier(cur), tierForMap(cur)), out = [], first = t => nodes.find(n => n.type === t);
      const byId = (id, level, mega) => { const d = dex(id); return d && d.baseStats ? mkEnemy({ speciesId: id, name: d.name, types: d.types, baseStats: d.baseStats, level, mega, spriteUrl: d.spriteUrl }, tier) : null; };
      if (first('sycamore')) out.push({ node: first('sycamore'), name: 'Profesor Ciprés', label: 'encuentro especial', tier, safe: true, note: 'Sin muerte permanente en este combate. Al ganar te regala uno de sus tres iniciales.', mons: (tg(() => SYCAMORE_TEAM, []) || []).map(t => mkEnemy(t, tier)) });
      if (first('korrina')) out.push({ node: first('korrina'), name: 'Korrina', label: 'encuentro especial', tier, note: 'Lleva megaevolución: los números usan los stats de la mega y son aproximados.', mons: (tg(() => KORRINA_LUCARIO_TEAM, []) || []).map(t => mkEnemy(t, tier)) });
      if (first('lysandre')) {
        const base = withSeed(() => tg(() => kalosLysandreLevel(), null));
        if (base) out.push({ node: first('lysandre'), name: 'Lysson', label: 'encuentro especial', tier, note: 'Su último Pokémon megaevoluciona: números aproximados.', mons: (tg(() => LYSANDRE_TEAM, []) || []).map(t => byId(t.id, Math.max(1, base + (t.off || 0)), t.mega)).filter(Boolean) });
      }
      const hordes = withSeed(() => nodes.filter(n => n.type === 'battle' && tg(() => kalosIsHorde(n), false)).map(n => tg(() => kalosHordeLevel(n), null)));
      const counts = {};
      nodes.forEach(n => { if (!/^(start|battle|trainer|boss)$/.test(n.type)) counts[n.type] = (counts[n.type] || 0) + 1; });
      return { fights: out.filter(f => f.mons.length), hordes, counts };
    });
  }
  function fightLead(alive, f, items, s, team) {
    const sf = s ? tg(() => simFight(s, team, f), null) : null;
    if (sf) return { rows: sf.rows, best: sf.best, cur: sf.cur, sf };
    const data = bossMatchup(alive, f, items);
    const rows = alive.map((p, i) => ({ p, pct: Math.round(data.filter(x => x.rows[i].r.win).length / data.length * 100) }));
    return { rows, best: rows.slice().sort((a, b) => b.pct - a.pct)[0], cur: rows[0] };
  }
  function htmlSpecial(s, team) {
    const sp = specialFights(s), alive = team.filter(p => p.currentHp > 0);
    let h = '';
    sp.fights.forEach(f => {
      const fl0 = seedOK() && alive.length ? fightLead(alive, f, s.items || [], s, team) : null;
      h += `<div class="plc-enemy">${fl0 && fl0.sf ? simLine(fl0.sf, f.name) : ''}${htmlBoss(team, f, s.items || [])}`;
      if (fl0 && !fl0.sf) { const fl = fl0; h += `<div>Lidera con <b>${esc(nm(fl.best.p))}</b> <span class="${fl.best.pct >= 70 ? 'plc-good' : fl.best.pct >= 40 ? 'plc-mid' : 'plc-bad'}">gana ${fl.best.pct}% de los duelos</span></div>`; }
      h += `<div class="plc-sub">${esc(f.note)}${f.node.accessible ? ' · <b>accesible ahora</b>' : ''}</div></div>`;
    });
    if (sp.hordes.length) h += `<div class="plc-warn">${sp.hordes.length} combate${sp.hordes.length > 1 ? 's' : ''} salvaje${sp.hordes.length > 1 ? 's' : ''} de este mapa ${sp.hordes.length > 1 ? 'son hordas' : 'es una horda'}${sp.hordes.filter(Boolean).length ? ' (nv ' + [...new Set(sp.hordes.filter(Boolean))].join(', ') + ')' : ''}: varios rivales seguidos.</div>`;
    const cl = Object.entries(sp.counts).map(([t, c]) => `${NODE_LABEL[t] || t}${c > 1 ? ' ×' + c : ''}`);
    if (cl.length) h += `<div class="plc-sub">Quedan en el mapa: ${esc(cl.join(' · '))}</div>`;
    return h;
  }

  /* ---------- combates por nodo y simulación encadenada (desgaste y niveles) ---------- */
  // Para cada nodo de combate sin visitar: cómo generar su rival y cuántos niveles da.
  function fightSpecs(s, R, team, bosses) {
    return pmemo('specs', s, () => {
      const cur = s.currentMap || 0, tier = tierForMap(cur), size = cur === 0 ? 1 : cur <= 2 ? 2 : 3, out = new Map();
      const td = tg(() => trainerData(s, R, team), null), sp = tg(() => specialFights(s), null), w = tg(() => wildData(s, R, team), null);
      const pick = a => a[Math.floor(Math.random() * a.length)];
      Object.values((s.map && s.map.nodes) || {}).filter(n => !n.visited).forEach(n => {
        if (n.type === 'battle' && w && w.mons.length) {
          const lv = withSeed(() => tg(() => getLevelForNode(n), null)) || w.lvl;
          let ids = w.mons.map(m => m.speciesId).filter(id => tg(() => minLevelForSpecies(id), 1) <= lv); if (!ids.length) ids = w.mons.map(m => m.speciesId);
          const horde = tg(() => kalosIsHorde(n), false), hl = horde ? (withSeed(() => tg(() => kalosHordeLevel(n), null)) || lv) : lv;
          out.set(n.id, { gain: 1, horde, enemies: () => horde ? [0, 1, 2].map(() => mkFoe(pick(ids), hl, tier)).filter(Boolean) : [mkFoe(pick(ids), lv, tier)].filter(Boolean) });
        } else if (n.type === 'move_tutor') {
          out.set(n.id, { tutor: true });
        } else if (n.type === 'trainer' && td) {
          const g = td.list.find(x => x.ns.includes(n));
          if (!g || !g.mons.length) return;
          const lv = withSeed(() => tg(() => trainerFightLevel(n), null)) || g.lvl, ids = g.mons.map(m => m.speciesId);
          out.set(n.id, { gain: 2, enemies: () => { const t = []; for (let j = 0; j < size; j++) { const m = mkFoe(pick(ids), lv, tier); if (m) t.push(m); } return t; } });
        } else if (n.type === 'catch' && w && w.mons.length) {
          const lv = withSeed(() => tg(() => getLevelForNode(n), null)) || w.lvl;
          let ids = w.mons.map(m => m.speciesId).filter(id => tg(() => minLevelForSpecies(id), 1) <= lv); if (!ids.length) ids = w.mons.map(m => m.speciesId);
          out.set(n.id, { gain: 0, catchMon: () => [0, 1, 2].map(() => mkFoe(pick(ids), lv, tier)).filter(Boolean).sort((a, b) => bst(b.baseStats) - bst(a.baseStats))[0] });
        } else if (n.type === 'boss' && bosses[0]) {
          out.set(n.id, { gain: 0, boss: true, enemies: () => bosses[0].mons });
        } else if (sp) {
          const f = sp.fights.find(x => x.node === n);
          if (f) out.set(n.id, { gain: 2, safe: !!f.safe, enemies: () => f.mons });
        }
      });
      return out;
    });
  }
  // % de victoria de cada nodo de combate con el equipo tal como está ahora.
  function nodeWins(s, R, team, bosses) {
    return pmemo('nodewin', s, () => {
      const specs = fightSpecs(s, R, team, bosses), out = new Map();
      specs.forEach((sp, id) => {
        if (sp.catchMon || sp.tutor) return;
        let w = 0, k = 0;
        for (let i = 0; i < (sp.boss ? 30 : 10); i++) { const r = simRun(s, team, sp.enemies(), 1); if (r) { k++; w += r.pct / 100; } }
        if (k) out.set(id, Math.round(w / k * 100));
      });
      return out;
    });
  }
  // Recorre un camino entero n veces arrastrando PS y niveles de un combate al siguiente.
  function chainSim(s, team, path, specs, n) {
    const rb = origRB();
    if (typeof rb !== 'function' || !seedOK() || !team.length) return null;
    const seed = _rngSeed, gs = saveG(), deaths = {};
    let reach = 0, win = 0, ok = 0, hp = 0, tsz = 0;
    try {
      for (let i = 0; i < n; i++) {
        _rngSeed = (Math.random() * 4294967296) >>> 0;
        const T = dclone(team); let dead = false, wonBoss = false;
        for (const node of path) {
          if (node.type === 'pokecenter') { T.forEach(p => { p.currentHp = p.maxHp; }); continue; }
          const sp = specs.get(node.id);
          if (!sp) continue;
          if (sp.catchMon) { if (T.length < TEAM_CAP) { const m = sp.catchMon(); if (m) T.push(m); } continue; }
          if (sp.tutor) { const q = T.filter(p => (p.moveTier ?? 1) < MAX_TIER).sort((a, b) => b.level - a.level)[0]; if (q) q.moveTier = (q.moveTier ?? 1) + 1; continue; }
          if (sp.boss) { hp += sum(T.map(p => Math.max(0, p.currentHp) / Math.max(1, p.maxHp))) / T.length; tsz += T.length; }
          const cfg = freshCfg(s);
          if (cfg === undefined) throw new Error('modo no soportado');
          const P = dclone(T); tg(() => P.forEach(applyMegaEvolution));
          const E = dclone(sp.enemies()); E.forEach(e => { if (e._uid == null) e._uid = uidc++; });
          if (!E.length) continue;
          const r = rb(P, E, (s.items || []).slice(), [], null, cfg, (s.passives || []).slice());
          (r.pTeam || []).forEach((q, k) => {
            const p = T[k]; if (!p) return;
            const frac = q.maxHp > 0 ? Math.max(0, q.currentHp) / q.maxHp : 0;
            if (r.playerWon && frac > 0 && sp.gain) {
              const a = calcHp(p.baseStats.hp, p.level); p.level += sp.gain;
              const ev = tg(() => EVOLUTIONS[p.speciesId], null), d2 = ev && ev.into && ev.level && ev.level <= p.level ? dex(ev.into) : null;
              if (d2 && d2.baseStats) Object.assign(p, { speciesId: ev.into, name: d2.name, types: d2.types, baseStats: d2.baseStats });
              p.maxHp = Math.round(p.maxHp * calcHp(p.baseStats.hp, p.level) / Math.max(1, a));
            }
            p.currentHp = frac <= 0 ? 0 : Math.max(1, Math.round(p.maxHp * frac));
          });
          if (sp.boss) { wonBoss = !!r.playerWon; break; }
          if (!r.playerWon && !sp.safe) { dead = true; deaths[node.id] = (deaths[node.id] || 0) + 1; break; }
        }
        ok++; if (!dead) reach++; if (wonBoss) win++;
      }
    } catch (e) { return null; } finally { _rngSeed = seed; restG(gs); }
    if (!ok) return null;
    const worst = Object.entries(deaths).sort((a, b) => b[1] - a[1])[0];
    return { reach: reach / ok, win: win / ok, n: ok, hp: reach ? hp / reach : 0, size: reach ? tsz / reach : team.length, worst: worst ? { id: worst[0], pct: Math.round(worst[1] / ok * 100) } : null };
  }

  /* ---------- ruta por el mapa ---------- */
  const ROUTE_MODES = ['equilibrada', 'segura', 'subir nivel'];
  let routeMode = tg(() => (+localStorage.getItem('plc_route') || 0) % 3, 0);
  function nodeName(n) {
    if (n.type === 'battle') return 'Combate salvaje';
    if (n.type === 'boss') return 'Boss';
    if (n.type === 'trainer') { const c = trainerCfg(n.trainerSprite || 'aceTrainer'); return tg(() => tTrainerClass(n.trainerSprite, c), null) || c.name || 'Entrenador'; }
    return NODE_LABEL[n.type] || n.type;
  }
  function nodeSide(n, nodes) {
    const row = Object.values(nodes).filter(o => o.layer === n.layer).sort((a, b) => a.col - b.col), i = row.indexOf(n);
    if (row.length < 2) return '';
    if (row.length === 2) return i === 0 ? 'izquierda' : 'derecha';
    if (row.length === 3) return ['izquierda', 'centro', 'derecha'][i];
    return 'nº ' + (i + 1) + ' de ' + row.length;
  }
  function routePlan(s, R, team, bosses) {
    return pmemo('route' + routeMode, s, () => {
      const map = s.map;
      if (!map || !map.nodes || !Array.isArray(map.edges) || !team.length) return null;
      const nodes = map.nodes, next = {};
      map.edges.forEach(e => { (next[e.from] = next[e.from] || []).push(e.to); });
      const starts = Object.values(nodes).filter(n => n.accessible && !n.visited);
      if (!starts.length) return null;
      const td = tg(() => trainerData(s, R, team), null), sp = tg(() => specialFights(s), null), w = tg(() => wildData(s, R, team), null);
      const avg = sum(team.map(p => p.level)) / team.length, boss = bosses[0];
      const need = boss ? clamp((Math.max(...boss.mons.map(m => m.level)) - avg) / 6) : 0;
      const free = TEAM_CAP - team.length, mapTier = tierForMap(s.currentMap || 0);
      const hurt = 1 - sum(team.map(p => Math.max(0, p.currentHp) / Math.max(1, p.maxHp))) / team.length;
      const lag = team.some(p => mapTier != null && p.moveTier != null && p.moveTier < mapTier);
      let wildWin = 0.95;
      if (w && w.mons.length) { let a = 0, k = 0; for (let i = 0; i < 16; i++) { const r = simRun(s, team, [w.mons[Math.floor(Math.random() * w.mons.length)]], 1); if (r) { k++; a += r.pct / 100; } } if (k) wildWin = a / k; }
      const xp = routeMode === 2 ? 1.7 : 1, penalty = routeMode === 1 ? 220 : 90, BOSSW = 200;
      const cache = new Map();
      const info = n => {
        if (cache.has(n.id)) return cache.get(n.id);
        let v = 4, p = 1, fight = false;
        switch (n.type) {
          case 'battle': v = (4 + 8 * need) * xp * (tg(() => kalosIsHorde(n), false) ? 1.5 : 1); p = wildWin; fight = true; break;
          case 'trainer': { const g = td && td.list.find(x => x.ns.includes(n)); v = (6 + 10 * need) * xp; p = g && g.win != null ? g.win / 100 : 0.9; fight = true; break; }
          case 'catch': v = free > 0 ? 12 + 4 * Math.min(3, free) : 4; break;
          case 'item': v = 8; break;
          case 'pokecenter': v = 2 + 14 * hurt; break;
          case 'move_tutor': v = team.some(p => (p.moveTier ?? 1) < MAX_TIER) ? (lag ? 12 : 9) : 1; break;
          case 'sycamore': v = 15; break;
          case 'korrina': case 'lysandre': { const f = sp && sp.fights.find(x => x.node === n), sf = f ? tg(() => simFight(s, team, f), null) : null; v = 10; p = sf ? sf.base.pct / 100 : 0.7; fight = true; break; }
          case 'legendary': case 'masterball': v = 10; p = 0.8; fight = true; break;
          case 'question': v = 5; break;
          case 'trade': v = 3; break;
          case 'boss': v = 0; break;
        }
        const r = { v, p, fight }; cache.set(n.id, r); return r;
      };
      const paths = [];
      const walk = (id, acc) => {
        if (paths.length > 4000) return;
        const n = nodes[id]; if (!n) return;
        const a2 = acc.concat(n), nx = (next[id] || []).filter(x => nodes[x] && !nodes[x].visited);
        if (!nx.length) { paths.push(a2); return; }
        nx.forEach(x => walk(x, a2));
      };
      starts.forEach(n => walk(n.id, []));
      const scored = paths.map(path => {
        let v = 0, surv = 1, fights = 0;
        path.forEach(n => { const i = info(n); v += i.v; surv *= i.p; if (i.fight) fights++; });
        return { path, surv, fights, v, score: v - penalty * (1 - surv) };
      }).sort((a, b) => b.score - a.score);
      if (!scored.length) return null;
      // Segunda pasada: los mejores caminos se recorren enteros con desgaste y subida de niveles.
      const specs = tg(() => fightSpecs(s, R, team, bosses), null);
      let ranked = scored;
      if (specs && specs.size) {
        // Caminos distintos (por tipos de nodo de combate, captura, centro y tutor) para no simular repetidos.
        const key = c => c.path.map(n => /battle|trainer|catch|pokecenter|move_tutor|sycamore|korrina|lysandre/.test(n.type) ? n.id : '').join(',');
        const uniq = new Map(); scored.forEach(c => { const k = key(c); if (!uniq.has(k)) uniq.set(k, c); });
        let pool = [...uniq.values()];
        const big = pool.length > 90;
        if (big) pool = pool.slice(0, 60);
        let any = false;
        const run = (c, n) => { const r = chainSim(s, team, c.path, specs, n); if (!r) return; any = true; const k = c.chain ? c.chain.n : 0; c.chain = k ? { reach: (c.chain.reach * k + r.reach * r.n) / (k + r.n), win: (c.chain.win * k + r.win * r.n) / (k + r.n), hp: (c.chain.hp * k + r.hp * r.n) / (k + r.n), size: (c.chain.size * k + r.size * r.n) / (k + r.n), n: k + r.n, worst: r.worst || c.chain.worst } : r; c.surv = c.chain.reach; c.score = c.v - penalty * (1 - c.chain.reach) + BOSSW * c.chain.win; };
        // Pasada amplia: todos los caminos con pocas simulaciones; luego se afinan los mejores.
        pool.forEach(c => run(c, 5));
        pool.filter(c => c.chain).sort((a, b) => b.score - a.score).slice(0, 5).forEach(c => run(c, 25));
        if (any) ranked = pool.filter(c => c.chain).sort((a, b) => b.score - a.score);
      }
      const nwm = tg(() => nodeWins(s, R, team, bosses), null);
      const options = starts.map(n => { const b = ranked.find(x => x.path[0] === n); return b ? { node: n, score: b.score, surv: b.surv, bossWin: b.chain ? b.chain.win : null, win: nwm && nwm.has(n.id) ? nwm.get(n.id) / 100 : info(n).p, fight: info(n).fight } : null; }).filter(Boolean).sort((a, b) => b.score - a.score);
      return { best: ranked[0], options, nodes, need, hurt, free, count: paths.length };
    });
  }
  function htmlRoute(rp) {
    const b = rp.best, first = b.path[0], side = nodeSide(first, rp.nodes), risk = Math.round((1 - b.surv) * 100);
    const why = [];
    if (rp.need > 0.3) why.push('vas bajo de nivel: prioriza combates');
    if (rp.free > 0) why.push('tienes huecos: prioriza capturas');
    if (rp.hurt > 0.3) why.push('equipo tocado: valora el Centro Pokémon');
    let h = `<div class="plc-good plc-big">Ve a: ${esc(nodeName(first))}${side ? ' (' + side + ')' : ''}</div>
      <div class="plc-sub">Después: ${b.path.slice(1).map(n => esc(nodeName(n))).join(' → ') || '—'}</div>
      <div>${b.fights} combate${b.fights === 1 ? "" : "s"} antes del boss · <span class="${risk <= 10 ? 'plc-good' : risk <= 30 ? 'plc-mid' : 'plc-bad'}">riesgo de caer por el camino ${risk}%</span></div>
      ${b.chain ? `<div>Llegas al boss con ${Math.round(b.chain.size)} Pokémon, el ${Math.round(b.chain.hp * 100)}% de los PS, y <b class="${simCls(Math.round(b.chain.win * 100))}">le ganas el ${Math.round(b.chain.win * 100)}%</b> <span class="plc-sub">(${b.chain.n} recorridos completos, con desgaste, niveles y capturas)</span></div>${b.chain.worst && rp.nodes[b.chain.worst.id] ? `<div class="plc-warn">Punto débil: ${esc(nodeName(rp.nodes[b.chain.worst.id]))}, donde caes el ${b.chain.worst.pct}% de las veces</div>` : ''}` : ''}
      ${why.length ? `<div class="plc-sub">${esc(why.join(' · '))}</div>` : ''}
      ${b.chain && b.chain.win < 0.5 ? `<div class="plc-bad">Ningún camino te deja listo para el boss. Coge las capturas más fuertes que te ofrezcan y valora el Centro Pokémon antes de entrar.</div>` : ''}`;
    if (rp.options.length > 1) h += `<table><tr class="plc-sub"><td>Opción ahora</td><td class="plc-num">Riesgo camino</td><td class="plc-num">Boss</td></tr>${rp.options.map((o, i) => `<tr><td>${i === 0 ? '<b>' : ''}${esc(nodeName(o.node))}${nodeSide(o.node, rp.nodes) ? ' (' + nodeSide(o.node, rp.nodes) + ')' : ''}${i === 0 ? '</b>' : ''}${o.fight ? ` <span class="${simCls(Math.round(o.win * 100))}">ganas ${Math.round(o.win * 100)}%</span>` : ''}</td><td class="plc-num">${Math.round((1 - o.surv) * 100)}%</td><td class="plc-num ${o.bossWin != null ? simCls(Math.round(o.bossWin * 100)) : ''}">${o.bossWin != null ? Math.round(o.bossWin * 100) + '%' : '—'}</td></tr>`).join('')}</table>`;
    return h + `<div><button class="plc-btn" data-plc-route="1">Modo: ${ROUTE_MODES[routeMode]}</button> <span class="plc-sub">${rp.count} caminos comparados</span></div>`;
  }

  function trainerCfg(key) {
    return tg(() => TRAINER_BATTLE_CONFIG[key], null) || tg(() => KALOS_TRAINER_CONFIG[key], null) || tg(() => TRAINER_BATTLE_CONFIG.aceTrainer, null) || {};
  }
  function trainerData(s, R, team) {
    return pmemo('trData', s, () => {
      const nodes = Object.values((s.map && s.map.nodes) || {}).filter(n => n.type === 'trainer' && !n.visited);
      const cur = s.currentMap || 0, tier = tierForMap(cur), size = cur === 0 ? 1 : cur <= 2 ? 2 : 3;
      const groups = {};
      nodes.forEach(n => { const k = n.trainerSprite || 'aceTrainer'; (groups[k] = groups[k] || []).push(n); });
      const alive = team.filter(p => p.currentHp > 0), tally = new Map();
      const poolIds = R.pool ? withSeed(() => tg(() => R.pool(cur), [])) || [] : [];
      const list = Object.entries(groups).sort((a, b) => b[1].length - a[1].length).map(([k, ns]) => {
        const cfg = trainerCfg(k), name = tg(() => tTrainerClass(k, cfg), null) || cfg.name || k;
        const lvls = withSeed(() => ns.map(n => tg(() => trainerFightLevel(n), null))).filter(x => x != null);
        const lvl = lvls.length ? Math.max(...lvls) : null, lvlLo = lvls.length ? Math.min(...lvls) : null;
        let ids = null;
        for (const f of R.poolFields) if (Array.isArray(cfg[f]) && cfg[f].length) { ids = cfg[f]; break; }
        const spec = tg(() => trainerSpecialtyTypes(k), null);
        let src = 'lista fija';
        if (!ids && Array.isArray(spec) && spec.length) { ids = poolIds.filter(id => { const d = dex(id); return d && d.types.some(t => spec.includes(t)); }); src = 'del pool del mapa por tipo'; }
        if (!ids || !ids.length) { ids = poolIds; src = 'cualquiera del pool del mapa'; }
        if (lvl) { const ok = ids.filter(id => tg(() => minLevelForSpecies(id), 1) <= lvl); if (ok.length) ids = ok; }
        const mons = lvl ? [...new Set(ids.map(id => evoAt(id, lvl)))].map(id => mkMon(id, lvl, tier)).filter(Boolean) : [];
        const tcount = {}; mons.forEach(m => m.types.forEach(t => { tcount[t] = (tcount[t] || 0) + 1; }));
        let sc = null;
        if (seedOK() && mons.length && alive.length) {
          sc = withSeed(() => alive.map(p => ({ p, wins: mons.filter(m => duel(p, m, s.items || [], 6).win).length })).sort((a, b) => b.wins - a.wins));
          sc.forEach(x => { const t = tally.get(x.p) || { w: 0, n: 0 }; t.w += x.wins * ns.length; t.n += mons.length * ns.length; tally.set(x.p, t); });
        }
        let win = null;
        if (mons.length && alive.length) {
          let w = 0, n = 0;
          for (let i = 0; i < 16; i++) {
            const picks = []; for (let j = 0; j < size; j++) picks.push(mons[Math.floor(Math.random() * mons.length)]);
            const r = simRun(s, team, picks, 1); if (r) { n++; w += r.pct / 100; }
          }
          if (n) win = Math.round(w / n * 100);
        }
        return { k, ns, name, lvl, lvlLo, mons, src, tcount, sc, cfg, win };
      });
      const lead = [...tally.entries()].map(([p, t]) => ({ p, pct: t.n ? Math.round(t.w / t.n * 100) : 0 })).sort((a, b) => b.pct - a.pct);
      return { nodes, size, tier, list, lead };
    });
  }
  function htmlTrainers(s, R, team) {
    const td = trainerData(s, R, team);
    if (!td.nodes.length) return '<div class="plc-sub">No quedan entrenadores en este mapa.</div>';
    let h = `<div class="plc-sub">${td.nodes.length} por delante · equipos de ${td.size} · tier ${td.tier != null ? td.tier : '?'}</div>`;
    if (td.lead.length) h += `<div>Lidera con <b>${esc(nm(td.lead[0].p))}</b> <span class="${td.lead[0].pct >= 70 ? 'plc-good' : td.lead[0].pct >= 40 ? 'plc-mid' : 'plc-bad'}">gana ${td.lead[0].pct}% de los duelos</span></div>`;
    td.list.forEach(g => {
      const n = g.mons.length;
      const tl = Object.entries(g.tcount).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, c]) => chip(t) + `<span class="plc-sub">${Math.round(c / n * 100)}%</span>`).join(' ');
      const top = g.sc && g.sc[0];
      h += `<div class="plc-enemy"><div><span class="plc-name">${esc(g.name)}</span> <span class="plc-sub">${Math.round(g.ns.length / td.nodes.length * 100)}% de los entrenadores${g.lvl ? ' · nv ' + (g.lvlLo < g.lvl ? g.lvlLo + '–' + g.lvl : g.lvl) : ''}</span></div>
        <div>${tl}${top ? ` <span class="plc-sub">mejor:</span> <b>${esc(nm(top.p))}</b> <span class="${top.wins === n ? 'plc-good' : top.wins ? 'plc-mid' : 'plc-bad'}">${top.wins}/${n}</span>` : ''}${g.win != null ? ` · <b class="${simCls(g.win)}">ganas ${g.win}%</b>` : ''}</div>
        ${n ? det('tr|' + g.k, `Ver los ${n} Pokémon posibles`, `<div class="plc-sub">${Math.round(100 / n)}% cada uno (${g.src}): ${g.mons.map(m => esc(m.name)).join(', ')}</div>`) : ''}</div>`;
    });
    return h;
  }

  function wildData(s, R, team) {
    return pmemo('wild', s, () => {
      if (!R.pool) return null;
      const cur = s.currentMap || 0, ids = withSeed(() => tg(() => R.pool(cur), null));
      if (!Array.isArray(ids) || !ids.length) return null;
      const wn = Object.values((s.map && s.map.nodes) || {}).filter(n => (n.type === 'battle' || n.type === 'catch') && !n.visited);
      const wl = withSeed(() => wn.map(n => tg(() => getLevelForNode(n), null))).filter(x => x != null);
      const lvl = wl.length ? Math.max(...wl) : Math.max(...team.map(p => p.level), 5), lvlLo = wl.length ? Math.min(...wl) : lvl;
      const mons = [...new Set(ids.map(id => evoAt(id, lvl)))].map(id => mkMon(id, lvl, tierForMap(cur))).filter(Boolean);
      const tc = {}; mons.forEach(m => m.types.forEach(t => { tc[t] = (tc[t] || 0) + 1; }));
      const alive = team.filter(p => p.currentHp > 0);
      let lead = [];
      if (seedOK() && alive.length && mons.length) lead = withSeed(() => alive.map(p => ({ p, pct: Math.round(mons.filter(m => duel(p, m, s.items || [], 4).win).length / mons.length * 100) }))).sort((a, b) => b.pct - a.pct);
      return { mons, lvl, lvlLo, tc, lead, left: wn.length };
    });
  }

  // Líder por cada combate salvaje: según las especies que pueden salir en ese nodo y a su nivel.
  function nodeLeads(s, R, team, bosses) {
    return pmemo('nodelead', s, () => {
      const specs = tg(() => fightSpecs(s, R, team, bosses), null), out = new Map();
      const alive = team.filter(p => p.currentHp > 0);
      if (!specs || alive.length < 2) return out;
      Object.values((s.map && s.map.nodes) || {}).filter(n => n.accessible && !n.visited && (n.type === 'battle' || n.type === 'trainer')).forEach(n => {
        const sp = specs.get(n.id);
        if (!sp || !sp.enemies) return;
        const foes = []; for (let i = 0; i < 10; i++) foes.push(sp.enemies());
        const rows = alive.map(p => {
          const order = [p].concat(team.filter(o => o !== p));
          let w = 0, k = 0, hp = 0;
          foes.forEach((E, i) => { const r = simRun(s, order, E, 1, false, { seed: PAIR + i * 17 }); if (r) { k++; w += r.pct / 100; } });
          return { p, pct: k ? Math.round(w / k * 100) : 0 };
        }).sort((a, b) => b.pct - a.pct);
        const cur = rows.find(r => r.p === alive[0]) || rows[0];
        out.set(n.id, { best: rows[0], cur, rows });
      });
      return out;
    });
  }
  function htmlGrass(s, R, team) {
    const w = wildData(s, R, team);
    if (!w) return '<div class="plc-sub">No disponible para este mapa.</div>';
    const n = w.mons.length;
    return `<div class="plc-sub">nv ${w.lvlLo < w.lvl ? w.lvlLo + '–' + w.lvl : w.lvl} · ${n} especies, ${(100 / n).toFixed(1)}% cada una</div>
      ${(() => { const nl = last && last.nodeLead; const acc = nl && nl.forEach ? [...nl.entries()].filter(([id]) => s.map.nodes[id] && s.map.nodes[id].type === 'battle') : []; return acc.length ? acc.map(([id, x]) => `<div>${esc(nodeName(s.map.nodes[id]))}${nodeSide(s.map.nodes[id], s.map.nodes) ? ' (' + nodeSide(s.map.nodes[id], s.map.nodes) + ')' : ''}: lidera con <b>${esc(nm(x.best.p))}</b> <span class="${simCls(x.best.pct)}">${x.best.pct}%</span>${x.best.p !== x.cur.p ? ` <span class="plc-sub">(con ${esc(nm(x.cur.p))}: ${x.cur.pct}%)</span>` : ''}</div>`).join('') : (w.lead.length ? `<div>Lidera con <b>${esc(nm(w.lead[0].p))}</b> <span class="${w.lead[0].pct >= 70 ? 'plc-good' : w.lead[0].pct >= 40 ? 'plc-mid' : 'plc-bad'}">gana ${w.lead[0].pct}% de los duelos</span></div>` : ''); })()}
      <div>${Object.entries(w.tc).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, c]) => chip(t) + `<span class="plc-sub">${Math.round(c / n * 100)}%</span> `).join('')}</div>
      ${det('grass', 'Ver especies', `<div class="plc-sub">${w.mons.map(m => esc(m.name)).join(', ')}</div>`)}`;
  }

  // ¿Es buen líder el primero del equipo para lo que viene?
  function leadAdvice(s, R, team, bosses) {
    const alive = team.filter(p => p.currentHp > 0);
    if (alive.length < 1 || !seedOK()) return null;
    const bossNow = Object.values((s.map && s.map.nodes) || {}).some(n => n.type === 'boss' && n.accessible && !n.visited);
    let rows = [], ctx = '';
    let sim = false;
    if (bossNow && bosses[0]) {
      const sf = tg(() => simFight(s, team, bosses[0]), null);
      if (sf) { rows = sf.rows; sim = true; }
      else { const data = bossMatchup(alive, bosses[0], s.items || []); rows = alive.map((p, i) => ({ p, pct: Math.round(data.filter(x => x.rows[i].r.win).length / data.length * 100) })); }
      ctx = bosses[0].name;
    } else {
      const td = trainerData(s, R, team);
      if (td.lead.length) { rows = td.lead; ctx = 'los entrenadores de este mapa'; }
      else { const w = wildData(s, R, team); rows = (w && w.lead) || []; ctx = 'los salvajes de este mapa'; }
    }
    if (!rows.length) return null;
    const best = rows.slice().sort((a, b) => b.pct - a.pct)[0], cur = rows.find(r => r.p === alive[0]) || best;
    return { ctx, boss: bossNow, sim, rows, cur, best, bad: best.p !== cur.p && best.pct - cur.pct >= (sim ? 15 : 20) };
  }

  /* ---------- puntuación de capturas por simulación ---------- */
  // Copia de un Pokémon subida a otro nivel, evolucionando si le toca.
  function grownTo(p, lv, tier) {
    let id = p.speciesId, d = null, guard = 0, ev;
    while (guard++ < 3 && (ev = tg(() => EVOLUTIONS[id], null)) && ev.into && ev.level && ev.level <= lv && dex(ev.into)) id = ev.into;
    d = id !== p.speciesId ? dex(id) : null;
    const base = d ? { speciesId: id, name: d.name, types: d.types, baseStats: d.baseStats } : {};
    const q = Object.assign({}, p, base, { level: Math.max(p.level, lv), moveTier: Math.max(p.moveTier || 0, tier || 0) });
    q.maxHp = q.currentHp = tg(() => calcHp(q.baseStats.hp, q.level), p.maxHp);
    return q;
  }
  // % de victoria del equipo contra el próximo boss (tal como estás) y contra los dos siguientes (a su nivel, con evoluciones).
  function teamOutlook(s, team, bosses, n, extra) {
    extra = Object.assign({ seed: PAIR }, extra || {});
    // Próximo boss: al nivel con el que sueles llegar (3 por debajo de su máximo, o el tuyo si ya vas por encima).
    const b0 = bosses[0], lv0 = b0 ? Math.max(...b0.mons.map(m => m.level)) - 3 : 0;
    const r0 = b0 ? simRun(s, team.map(p => p.level >= lv0 ? p : grownTo(p, lv0, 0)), b0.mons, n, false, extra) : null;
    const fut = bosses.slice(1, 3).map(b => {
      const lv = Math.max(...b.mons.map(m => m.level)) - 2;
      const r = simRun(s, team.map(p => grownTo(p, lv, b.tier)), b.mons, Math.ceil(n / 2), false, extra);
      return r ? r.pct : null;
    }).filter(x => x != null);
    return { next: r0 ? r0.pct : null, fut: fut.length ? Math.round(sum(fut) / fut.length) : null };
  }
  const gainOf = (o, b) => 0.6 * ((o.next ?? 0) - (b.next ?? 0)) + 0.4 * ((o.fut ?? 0) - (b.fut ?? 0));
  function simChoice(s, team, bosses, cands) {
    if (!seedOK() || !bosses.length || !team.length || typeof origRB() !== 'function') return null;
    const base = teamOutlook(s, team, bosses, 80);
    if (base.next == null) return null;
    const full = team.length >= TEAM_CAP;
    cands.forEach(x => {
      if (!full) { x.sim = teamOutlook(s, team.concat(x.m), bosses, 60); x.out = null; }
      else {
        let best = null;
        team.forEach(p => { const o = teamOutlook(s, team.map(q => q === p ? x.m : q), bosses, 40); if (!best || gainOf(o, base) > gainOf(best.o, base)) best = { o, p }; });
        x.sim = best.o; x.out = best.p;
      }
      x.gain = Math.round(gainOf(x.sim, base));
    });
    return base;
  }


  /* ---------- tutor de ataques, pasivas, objetos y megas (por simulación) ---------- */
  const MAX_TIER = 2;
  const canSim = (s, team, bosses) => seedOK() && bosses.length && team.length && typeof origRB() === 'function';
  const baseOutlook = (s, team, bosses) => memo('baseOutlook', () => teamOutlook(s, team, bosses, 80));
  const sgn = v => v > 0 ? '+' + v : v < 0 ? String(v) : '±0';
  // Tutor: a quién subir un tier de ataque.
  function tutorData(s, team, bosses) {
    return memo('tutor', () => {
      if (!canSim(s, team, bosses)) return null;
      const base = baseOutlook(s, team, bosses);
      const rows = team.map(p => {
        const t = p.moveTier != null ? p.moveTier : 1;
        if (t >= MAX_TIER) return { p, maxed: true };
        const up = Object.assign({}, p, { moveTier: t + 1 }), o = teamOutlook(s, team.map(q => q === p ? up : q), bosses, 50);
        const m0 = moveOf(p), m1 = moveOf(up);
        return { p, o, gain: Math.round(gainOf(o, base)), from: m0, to: m1 };
      });
      const cand = rows.filter(r => !r.maxed).sort((a, b) => b.gain - a.gain);
      return { base, rows, best: cand[0] || null };
    });
  }
  function visibleTutor() {
    const m = document.getElementById('item-equip-modal');
    return m && shown(m) && m.querySelector('#btn-skip-tutor') ? m : null;
  }
  function htmlTutor(td) {
    if (!td) return '';
    let h = td.best ? `<div class="plc-good plc-big">Enséñaselo a ${esc(nm(td.best.p))} (${sgn(td.best.gain)} pts)</div>` : '<div class="plc-sub">Todo tu equipo tiene ya el ataque al máximo.</div>';
    h += `<table>${td.rows.map(r => r.maxed ? `<tr><td>${esc(nm(r.p))}</td><td class="plc-sub">ya al máximo</td><td></td></tr>` : `<tr><td><b>${esc(nm(r.p))}</b></td><td class="plc-sub">${r.from ? esc(r.from.name) + ' ' + r.from.power : ''} → ${r.to ? esc(r.to.name) + ' ' + r.to.power : ''}<br>Boss ${r.o.next ?? '—'}%${r.o.fut != null ? ' · siguientes ' + r.o.fut + '%' : ''}</td><td class="plc-num"><b class="${r.gain >= 4 ? 'plc-good' : ''}">${sgn(r.gain)}</b></td></tr>`).join('')}</table>`;
    return h + '<div class="plc-sub">Puntos: cuánto sube tu % de victoria (60% próximo boss, 40% los dos siguientes), simulado con el motor del juego.</div>';
  }
  // Pasivas ofrecidas en pantalla.
  function visiblePassives() {
    const el = document.getElementById('passive-choices'), sc = document.getElementById('passive-screen');
    if (!el || !sc || !shown(sc)) return null;
    const pool = tg(() => PASSIVE_ITEM_POOL, []) || [], found = [];
    [...el.children].forEach(ch => {
      const txt = ch.textContent || '';
      const it = pool.filter(i => i.name && txt.includes(i.name)).sort((a, b) => b.name.length - a.name.length)[0];
      if (it && !found.some(f => f.it === it)) found.push({ it, el: ch });
    });
    return found.length ? found : null;
  }
  function passiveData(s, team, bosses, vp) {
    return memo('passives', () => {
      if (!canSim(s, team, bosses)) return null;
      const base = baseOutlook(s, team, bosses);
      const rows = vp.map(({ it }) => { const o = teamOutlook(s, team, bosses, 50, { passives: (s.passives || []).concat(Object.assign({}, it)) }); return { it, o, gain: Math.round(gainOf(o, base)) }; }).sort((a, b) => b.gain - a.gain);
      return { base, rows, best: rows[0] };
    });
  }
  function htmlPassives(pd) {
    if (!pd) return '';
    const b = pd.best;
    let h = b.gain >= 2 ? `<div class="plc-good plc-big">Coge ${esc(b.it.name)} (${sgn(b.gain)} pts)</div>` : '<div class="plc-mid plc-big">Ninguna cambia tus combates de forma medible</div><div class="plc-sub">Elige por lo que quieras construir: puede que su efecto no sea de combate.</div>';
    h += `<table>${pd.rows.map(r => `<tr><td><b>${esc(r.it.name)}</b><div class="plc-sub">${esc(r.it.desc || '')}</div></td><td class="plc-num"><b class="${r.gain >= 2 ? 'plc-good' : ''}">${sgn(r.gain)}</b></td></tr>`).join('')}</table>`;
    return h;
  }
  // Objetos equipables en pantalla: mejor portador por simulación.
  function itemSimData(s, team, bosses, vi) {
    return memo('itemsim', () => {
      if (!canSim(s, team, bosses)) return null;
      const base = baseOutlook(s, team, bosses), alive = team.filter(p => p.currentHp > 0);
      return vi.map(({ it }) => {
        const users = itemUsers(it, alive), ty = itemType(it);
        if (!users.length) return { it, b: { p: null, g: 0, sim: true, note: 'nadie de tu equipo ataca con tipo ' + ty }, rows: [] };
        const rows = users.map(p => { const o = teamOutlook(s, team.map(q => q === p ? Object.assign({}, q, { heldItem: it }) : q), bosses, 36); return { p, gain: Math.round(gainOf(o, base)), lose: p.heldItem }; }).sort((a, b) => b.gain - a.gain);
        return { it, b: rows[0] ? { p: rows[0].p, g: rows[0].gain, sim: true, lose: rows[0].lose, note: ty ? 'potencia los ataques de tipo ' + ty : '' } : null, rows };
      });
    });
  }
  // Megas: piedras que tienes desbloqueadas para la línea de cada miembro.
  function megaData(s, team, bosses) {
    return memo('mega', () => {
      const out = [];
      team.forEach(p => {
        const st = tg(() => getOwnedMegaStoneForLine(p.speciesId), null);
        if (!st) return;
        const held = p.heldItem && p.heldItem.isMegaStone && p.heldItem.id === st.id;
        const wrongHolder = !held && team.some(q => q !== p && q.heldItem && q.heldItem.isMegaStone && q.heldItem.id === st.id);
        const item = tg(() => makeMegaStoneItem(st), null);
        const ready = item && item.megaSpecies === p.speciesId;
        let gain = null;
        if (ready && !held && canSim(s, team, bosses)) gain = Math.round(gainOf(teamOutlook(s, team.map(q => q === p ? Object.assign({}, q, { heldItem: item }) : q), bosses, 50), baseOutlook(s, team, bosses)));
        const need = !ready ? tg(() => dex(st.species).name, null) : null;
        out.push({ p, st, held, ready, gain, need, wrongHolder });
      });
      return out;
    });
  }
  function htmlMegas(md) {
    if (!md || !md.length) return '<div class="plc-sub">No tienes megapiedras desbloqueadas para tu equipo.</div>';
    return md.map(m => m.held ? `<div class="plc-good">${esc(nm(m.p))} lleva ${esc(m.st.name)}: megaevoluciona en combate.</div>`
      : !m.ready ? `<div class="plc-sub">${esc(m.st.name)} para ${esc(nm(m.p))}: sirve cuando evolucione a ${esc(m.need || 'su forma final')}.</div>`
        : `<div class="${m.gain != null && m.gain >= 4 ? 'plc-warn' : 'plc-sub'}">${esc(m.st.name)} disponible para ${esc(nm(m.p))}${m.gain != null ? ': ' + sgn(m.gain) + ' pts' : ''}${m.p.heldItem ? ' (dejaría ' + esc(itemName(m.p.heldItem)) + ')' : ''}.</div>`).join('');
  }

  /* ---------- intercambios ---------- */
  // El juego oculta qué Pokémon hay en cada oferta: solo enseña un tipo y el nivel.
  // La recomendación usa solo eso (no lee la especie oculta).
  const TRADE_PLUS = () => tg(() => ENDLESS2_TRADE_LEVELS, 3) || 3;
  function tradeStage() {
    const sc = document.getElementById('trade-screen');
    if (!sc || !shown(sc)) return null;
    const list = document.getElementById('trade-team-list'), ch = document.getElementById('trade-choices');
    if (ch && ch.style.display !== 'none' && ch.children.length) return { stage: 'offers', el: ch };
    if (list && list.style.display !== 'none' && list.children.length) return { stage: 'pick', el: list };
    return null;
  }
  function poolIds(s, R) { return (withSeed(() => tg(() => R.pool(s.currentMap || 0), [])) || []).filter(id => dex(id)); }
  const sampleN = (a, n) => { const c = a.slice(), o = []; while (c.length && o.length < n) o.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]); return o; };
  // Paso 1: a quién mandar. Valor esperado de cambiarlo por lo que suele salir en este mapa (su nivel + 3).
  function tradePickData(s, R, team, bosses) {
    return pmemo('tradepick', s, () => {
      if (!canSim(s, team, bosses)) return null;
      const base = baseOutlook(s, team, bosses), ids = poolIds(s, R), tier = tierForMap(s.currentMap || 0);
      if (!ids.length) return null;
      const rows = team.map((p, i) => {
        const lv = Math.min(100, p.level + TRADE_PLUS());
        let ok = ids.filter(id => tg(() => minLevelForSpecies(id), 1) <= lv); if (!ok.length) ok = ids;
        const g = sampleN(ok, 4).map(id => { const m = mkFoe(id, lv, tier); return m ? Math.round(gainOf(teamOutlook(s, team.map((q, j) => j === i ? m : q), bosses, 30), base)) : null; }).filter(x => x != null).sort((a, b) => b - a);
        const exp = g.length ? Math.round((g[0] + (g[1] ?? g[0])) / 2) : 0;
        return { p, i, exp, lv };
      }).sort((a, b) => b.exp - a.exp);
      return { rows, best: rows[0] };
    });
  }
  // Paso 2: qué oferta coger, sabiendo solo su tipo y nivel.
  function tradeOfferData(s, R, team, bosses) {
    return pmemo('tradeoffers', s, () => {
      const st = s.savedTrade;
      if (!st || !Array.isArray(st.offers) || !team[st.idx] || !canSim(s, team, bosses)) return null;
      const base = baseOutlook(s, team, bosses), ids = poolIds(s, R), tier = tierForMap(s.currentMap || 0), out = team[st.idx];
      const rows = st.offers.map((o, k) => {
        const T = o._revealType || (o.types || ['Normal'])[0], lv = o.level;
        const ev = [...new Set(ids.filter(id => tg(() => minLevelForSpecies(id), 1) <= lv).map(id => evoAt(id, lv)))];
        let c = ev.filter(id => (dex(id).types || []).includes(T));
        if (!c.length) c = ids.filter(id => (dex(id).types || []).includes(T));
        const g = sampleN(c, 5).map(id => { const m = mkMon(id, lv, tier); return m ? Math.round(gainOf(teamOutlook(s, team.map((q, j) => j === st.idx ? m : q), bosses, 30), base)) : null; }).filter(x => x != null);
        const avg = g.length ? Math.round(sum(g) / g.length) : 0, good = g.length ? Math.round(g.filter(x => x > 0).length / g.length * 100) : 0;
        return { k, T, lv, avg, good, n: c.length };
      });
      const best = rows.slice().sort((a, b) => b.avg - a.avg)[0];
      return { out, rows, best, take: best && best.avg > 0 };
    });
  }
  function htmlTrade(ts, pick, off) {
    if (ts.stage === 'pick' && pick) {
      const b = pick.best;
      return `<div class="${b.exp > 0 ? 'plc-good' : 'plc-mid'} plc-big">${b.exp > 0 ? 'Manda a ' + esc(nm(b.p)) : 'Intercambiar no compensa ahora'}</div>
        <table>${pick.rows.map(r => `<tr><td><b>${esc(nm(r.p))}</b> <span class="plc-sub">Nv ${r.p.level} · tier ${r.p.moveTier ?? 1}</span><div class="plc-sub">recibirías nv ${r.lv}</div></td><td class="plc-num"><b class="${r.exp > 0 ? 'plc-good' : r.exp < 0 ? 'plc-bad' : ''}">${sgn(r.exp)}</b></td></tr>`).join('')}</table>
        <div class="plc-sub">Puntos esperados si mandas a ese Pokémon: media de las mejores ofertas que suelen salir en este mapa a su nivel + ${TRADE_PLUS()}. Si todo sale negativo, sáltate el intercambio.</div>`;
    }
    if (ts.stage === 'offers' && off) {
      return `<div class="${off.take ? 'plc-good' : 'plc-mid'} plc-big">${off.take ? 'Coge la oferta ' + (off.best.k + 1) + ' (' + esc(off.best.T) + ')' : 'Ninguna oferta compensa: pulsa saltar y te quedas a ' + esc(nm(off.out))}</div>
        <table>${off.rows.map(r => `<tr><td><b>Oferta ${r.k + 1}</b> ${chip(r.T)} <span class="plc-sub">Nv ${r.lv}</span><div class="plc-sub">mejora tu equipo en el ${r.good}% de los casos (${r.n} especies posibles)</div></td><td class="plc-num"><b class="${r.avg > 0 ? 'plc-good' : r.avg < 0 ? 'plc-bad' : ''}">${sgn(r.avg)}</b></td></tr>`).join('')}</table>
        <div class="plc-sub">El juego oculta qué Pokémon es: la nota es la media de las especies del mapa con ese tipo, en lugar de ${esc(nm(off.out))}.</div>`;
    }
    return '<div class="plc-sub">Calculando el intercambio…</div>';
  }

  function choiceData(s, team, bosses, vc) {
    return memo('choice', () => {
      const tier = tierForMap(s.currentMap || 0), avg = team.length ? sum(team.map(p => p.level)) / team.length : 5;
      const cands = vc.cards.map(c => { const m = mkMon(c.id, c.level || Math.round(avg), tier); return m ? { m, c, sc: scoreMon(m, team, bosses, avg) } : null; }).filter(Boolean).sort((a, b) => b.sc.total - a.sc.total);
      const mine = team.map(p => ({ p, sc: scoreMon(p, team.filter(o => o !== p), bosses, avg) })).sort((a, b) => a.sc.total - b.sc.total);
      const full = team.length >= TEAM_CAP;
      const base = tg(() => simChoice(s, team, bosses, cands), null);
      if (base && cands.every(x => x.sim)) {
        cands.sort((a, b) => b.gain - a.gain || b.sc.total - a.sc.total);
        const best = cands[0], verdict = !team.length || (!full && best.gain >= -2) ? 'take' : full && best.gain >= 4 ? 'swap' : 'skip';
        return { cands, mine, full, best, worst: best.out ? { p: best.out, sc: (mine.find(x => x.p === best.out) || {}).sc || { total: 0 } } : mine[0], verdict, base, sim: true };
      }
      const best = cands[0], worst = mine[0];
      const verdict = !best ? null : (!team.length || !full) ? 'take' : best.sc.total > worst.sc.total + 5 ? 'swap' : 'skip';
      return { cands, mine, full, best, worst, verdict };
    });
  }
  function htmlChoice(cd, viAdv, bosses) {
    let h = '';
    if (cd && cd.best && cd.sim) {
      const b = cd.best, bs = cd.base, sg = v => (v > 0 ? '+' : '') + v;
      h += cd.verdict === 'take' ? `<div class="plc-good plc-big">Coge a ${esc(b.m.name)}</div>`
        : cd.verdict === 'swap' ? `<div class="plc-good plc-big">Coge a ${esc(b.m.name)} y quita a ${esc(nm(b.out))}</div>`
          : `<div class="plc-mid plc-big">Ninguno mejora tu equipo</div>`;
      h += `<div class="plc-sub">Sin capturar: próximo boss ${bs.next}%${bs.fut != null ? ' · jefes siguientes ' + bs.fut + '%' : ''} (a nivel de llegada)</div>`;
      h += `<table>${cd.cands.map((x, i) => `<tr><td>${monImg(x.m)}</td><td><b>${esc(x.m.name)}</b> <span class="plc-sub">Nv ${x.m.level}</span> ${chips(x.m.types)}
        <div>Boss: <b class="${simCls(x.sim.next)}">${x.sim.next}%</b>${x.sim.fut != null ? ` · siguientes: <b class="${simCls(x.sim.fut)}">${x.sim.fut}%</b>` : ''}${x.out ? ` <span class="plc-sub">(en lugar de ${esc(nm(x.out))})</span>` : ''}</div>
        <div class="plc-sub">${esc(x.sc.why.slice(0, 2).join(' · '))}</div></td>
        <td class="plc-num"><b class="${x.gain >= 4 ? 'plc-good' : x.gain <= -4 ? 'plc-bad' : ''}">${sg(x.gain)}</b></td></tr>`).join('')}</table>`;
      h += '<div class="plc-sub">+N: puntos de % de victoria que ganas: 60% próximo boss, 40% los dos siguientes. Todo a nivel de llegada y con evoluciones, simulado con el motor del juego.</div>';
    } else if (cd && cd.best) {
      const b = cd.best, w = cd.worst;
      h += cd.verdict === 'take' ? `<div class="plc-good plc-big">Coge a ${esc(b.m.name)} (${b.sc.total})</div>`
        : cd.verdict === 'swap' ? `<div class="plc-good plc-big">Coge a ${esc(b.m.name)} (${b.sc.total}) y quita a ${esc(nm(w.p))} (${w.sc.total})</div>`
          : `<div class="plc-mid plc-big">Ninguno mejora tu equipo</div><div class="plc-sub">Tu más flojo es ${esc(nm(w.p))} (${w.sc.total}); la mejor opción da ${b.sc.total}.</div>`;
      h += `<table>${cd.cands.map((x, i) => `<tr><td>${monImg(x.m)}</td><td><b>${esc(x.m.name)}</b> <span class="plc-sub">Nv ${x.m.level}</span> ${chips(x.m.types)}<div class="plc-sub">${esc(x.sc.why.slice(0, 3).join(' · '))}</div></td><td class="plc-num"><b class="${i === 0 && cd.verdict !== 'skip' ? 'plc-good' : ''}">${x.sc.total}</b></td></tr>`).join('')}</table>`;
      if (cd.mine.length) h += det('mine', 'Puntos de tu equipo', `<div class="plc-sub">${cd.mine.map(x => `${esc(nm(x.p))} ${x.sc.total}`).join(' · ')}<br>0–100, orientativo: 40% jefes que quedan, 25% stats y potencia, 20% cobertura, 15% nivel.</div>`);
    }
    (viAdv || []).forEach(({ it, b }) => {
      if (b && b.sim) { h += `<div class="plc-enemy"><b>${esc(it.name)}</b> → ${b.p && b.g >= 3 ? `<b class="plc-good">${esc(nm(b.p))}</b> <span class="plc-sub">${sgn(b.g)} pts${b.lose ? ', deja ' + esc(itemName(b.lose)) : ''}</span>` : b.p ? `<b>${esc(nm(b.p))}</b> <span class="plc-sub">si lo coges (apenas cambia tus combates)</span>` : `<span class="plc-sub">${esc(b.note || 'no cambia tus combates de forma medible')}</span>`}<div class="plc-sub">${esc(it.desc || '')}</div></div>`; return; }
      h += `<div class="plc-enemy"><b>${esc(it.name)}</b> → ${b && b.p ? `<b class="plc-good">${esc(nm(b.p))}</b>` : '<span class="plc-sub">sin portador claro</span>'} <span class="plc-sub">${b && b.g >= 1.5 ? '+' + b.g.toFixed(0) + ' pts vs ' + esc(bosses[0] ? bosses[0].name : 'boss') : esc((b && b.note) || '')}</span></div>`;
    });
    return h;
  }

  function htmlTiers(R, s) {
    const n = R.leaders.length + 1, cur = s.currentMap || 0, tiers = [];
    for (let i = 0; i < n; i++) tiers.push(tierForMap(i));
    if (tiers[cur] == null) return '<div class="plc-sub">No disponible.</div>';
    let next = -1; for (let i = cur + 1; i < n; i++) if (tiers[i] > tiers[cur]) { next = i; break; }
    return `<div>Este mapa: <b>tier ${tiers[cur]}</b>. ${next >= 0 ? `Sube a tier ${tiers[next]} en el mapa ${next + 1}${R.maps[next] ? ' (' + esc(R.maps[next]) + ')' : ''}.` : 'Ya no sube más.'}</div>`;
  }

  function recommend(bosses) {
    const score = Object.fromEntries(TYPES.map(t => [t, 0]));
    bosses.forEach((b, idx) => {
      const w = 1 / (1 + idx * 0.5);
      b.mons.forEach(m => TYPES.forEach(t => {
        const off = eff(t, m.types);
        score[t] += w * (off > 1 ? 1 : off === 0 ? -1 : off < 1 ? -0.5 : 0);
        m.types.forEach(et => { const d = eff(et, [t]); score[t] += w * (d === 0 ? 0.75 : d < 1 ? 0.5 : d > 1 ? -0.5 : 0); });
      }));
    });
    return TYPES.map(t => ({ t, s: score[t] })).sort((a, b) => b.s - a.s);
  }

  function signature(s, vc, vi) {
    return JSON.stringify([s.runSeed, s.currentMap, s.eliteIndex, (s.items || []).map(i => i && (i.id || i)),
      (s.team || []).map(p => [p._uid, p.level, p.currentHp, p.maxHp, p.moveTier, p.heldItem && (p.heldItem.id || p.heldItem), p.speciesId]),
      Object.values((s.map && s.map.nodes) || {}).filter(n => n.visited || n.accessible).map(n => n.id + (n.visited ? 'v' : 'a')).join(),
      vc && vc.cards.map(c => [c.id, c.level]), vi && vi.map(x => x.it.id), !!tg(visibleTutor, null), (tg(tradeStage, null) || {}).stage, s.savedTrade && s.savedTrade.idx, (tg(visiblePassives, null) || []).map(x => x.it.id), (s.passives || []).map(x => x && x.id)]);
  }

  /* ---------- alertas, checklist y marcas sobre el juego ---------- */
  function buildChecks(s, team, bosses, adv, issues, fights, nw, nl) {
    const mapTier = tierForMap(s.currentMap || 0), lag = team.filter(p => mapTier != null && p.moveTier != null && p.moveTier < mapTier).map(nm);
    const c = [];
    if (adv) c.push(adv.bad ? { lv: 'bad', msg: `Orden: lidera ${nm(adv.cur.p)} (${adv.cur.pct}%). Pon primero a ${nm(adv.best.p)} (${adv.best.pct}%)` } : { lv: 'ok', msg: `Orden: ${nm(adv.cur.p)} es buen líder (${adv.cur.pct}%)` });
    issues.forEach(x => c.push({ lv: 'warn', msg: x.kind === 'useless' ? `${itemName(x.item)} en ${nm(x.p)} no sirve (nadie ataca con tipo ${itemType(x.item)})` : x.kind === 'swap' ? `${itemName(x.item)}: pásalo de ${nm(x.p)} a ${nm(x.o)}` : `${itemName(x.item)} sin equipar: dáselo a ${nm(x.o)}` }));
    tg(() => megaData(s, team, bosses), []).forEach(m => { if (m.ready && !m.held) c.push({ lv: 'warn', msg: `Megapiedra sin equipar: ${m.st.name} para ${nm(m.p)}${m.gain != null ? ' (' + sgn(m.gain) + ' pts)' : ''}` }); else if (m.wrongHolder) c.push({ lv: 'warn', msg: `${m.st.name} la lleva quien no puede usarla: dásela a ${nm(m.p)}` }); });
    (s.items || []).filter(i => i && i.isMegaStone).forEach(i => c.push({ lv: 'warn', msg: `Tienes ${i.name} en la bolsa sin equipar` }));
    if (!issues.length && (team.some(p => p.heldItem) || (s.items || []).length)) c.push({ lv: 'ok', msg: 'Objetos bien repartidos' });
    if (bosses[0]) {
      const diff = Math.round(sum(team.map(p => p.level)) / team.length - Math.max(...bosses[0].mons.map(m => m.level)));
      if (adv && adv.boss) c.push(diff >= -2 ? { lv: 'ok', msg: `Nivel: en línea con ${bosses[0].name}` } : { lv: diff >= -5 ? 'warn' : 'bad', msg: `Nivel: ${-diff} por debajo de ${bosses[0].name}` });
    }
    c.push(lag.length ? { lv: 'warn', msg: 'Tier de ataque atrasado: ' + lag.join(', ') } : { lv: 'ok', msg: 'Tier de ataques al día' });
    if (adv && adv.boss && bosses[0]) { const sf = tg(() => simFight(s, team, bosses[0]), null); if (sf) c.unshift({ lv: sf.base.pct >= 80 ? 'ok' : sf.base.pct >= 50 ? 'warn' : 'bad', msg: `${bosses[0].name}: ganas el ${sf.base.pct}% de las simulaciones` }); }
    if (nw) Object.values((s.map && s.map.nodes) || {}).filter(n => n.accessible && !n.visited && n.type !== 'boss' && nw.has(n.id) && nw.get(n.id) < 70).forEach(n => {
      const pct = nw.get(n.id), side = nodeSide(n, s.map.nodes), safe = n.type === 'sycamore';
      c.push({ lv: pct < 50 && !safe ? 'bad' : 'warn', msg: `${pct < 50 && !safe ? 'No entres en' : 'Cuidado con'} ${nodeName(n)}${side ? ' (' + side + ')' : ''}: ganas el ${pct}%${safe ? ' (sin muerte permanente)' : ''}` });
    });
    if (nl) nl.forEach((x, id) => {
      const n = s.map.nodes[id]; if (!n) return;
      const side = nodeSide(n, s.map.nodes);
      if (x.best.p !== x.cur.p && x.best.pct - x.cur.pct >= 15) c.push({ lv: x.cur.pct < 50 ? 'bad' : 'warn', msg: `Si vas a ${nodeName(n)}${side ? ' (' + side + ')' : ''}: lidera con ${nm(x.best.p)} (${x.best.pct}% frente a ${x.cur.pct}% con ${nm(x.cur.p)})` });
    });
    if (adv && adv.boss && bosses[0]) { const a = tg(() => auraAdvice(s, team, bosses[0]), null); if (a && a.best && a.base < 85 && a.best.pct - a.base >= 15) c.push({ lv: 'warn', msg: `Tienes ${AURA[a.best.k][1]}: ${a.best.how} y pasas de ${a.base}% a ${a.best.pct}%` }); }
    const alive = team.filter(p => p.currentHp > 0);
    if (seedOK() && alive.length) (fights || []).filter(f => f.node.accessible).forEach(f => {
      const fl = fightLead(alive, f, s.items || [], s, team);
      if (fl.best.pct === 0) c.push({ lv: f.safe ? 'warn' : 'bad', msg: `${f.name}: no ganas con ningún líder${f.safe ? ' (no hay muerte permanente)' : ''}` });
      else if (fl.best.p !== fl.cur.p && fl.best.pct - fl.cur.pct >= 20) c.push({ lv: 'warn', msg: `Si entras a ${f.name}: pon primero a ${nm(fl.best.p)} (${fl.best.pct}% frente a ${fl.cur.pct}%)` });
    });
    if (adv && adv.boss && adv.best.pct === 0) c.unshift({ lv: 'bad', msg: `Nadie de tu equipo gana un duelo contra ${adv.ctx}` });
    return c;
  }
  const ICON = { ok: '✓', warn: '!', bad: '✗' };
  function htmlChecks(c) {
    return c.map(x => `<div class="plc-ck plc-ck-${x.lv}"><span>${ICON[x.lv]}</span>${esc(x.msg)}</div>`).join('');
  }

  function clearMarks() {
    document.querySelectorAll('.plc-route-next,.plc-route-path').forEach(e => e.classList.remove('plc-route-next', 'plc-route-path'));
    document.querySelectorAll('.plc-mk').forEach(e => { e.classList.remove('plc-mk', 'plc-mk-bad', 'plc-mk-good', 'plc-mk-warn', 'plc-mk-info'); e.removeAttribute('data-plc'); });
  }
  function mark(el, kind, txt) {
    if (!el || el.classList.contains('plc-mk-bad') || (el.classList.contains('plc-mk') && kind === 'info')) return;
    el.classList.remove('plc-mk-good', 'plc-mk-warn', 'plc-mk-info');
    el.classList.add('plc-mk', 'plc-mk-' + kind); el.setAttribute('data-plc', txt);
  }
  function drawNodeLabels() {
    const s = getState(), ms = document.getElementById('map-screen');
    const over = [...document.querySelectorAll('#item-equip-modal,.item-equip-overlay')].some(e => !e.closest('.plc-p') && shown(e) && e.getBoundingClientRect().width > 200);
    if (over || !last || !last.nodeWin || !s || !s.map || !ms || !shown(ms)) { nodeBox.innerHTML = ''; return; }
    let h = '';
    last.nodeWin.forEach((pct, id) => {
      const n = s.map.nodes[id], el = document.querySelector('[data-node-id="' + id + '"]');
      if (!n || n.visited || !el) return;
      const r = el.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > innerHeight) return;
      const ld = last.nodeLead && last.nodeLead.get ? last.nodeLead.get(id) : null;
      const lead = ld && n.accessible ? `<br><span class="plc-nl-lead">${ld.best.p === ld.cur.p ? '✓ ' : '1º '}${esc(nm(ld.best.p))}</span>` : '';
      h += `<span class="plc-nl ${pct >= 80 ? 'plc-nl-g' : pct >= 50 ? 'plc-nl-m' : 'plc-nl-b'}${n.accessible ? ' plc-nl-acc' : ''}" style="left:${Math.round(r.left + r.width / 2)}px;top:${Math.round(r.bottom - 6)}px">${pct}%${lead}</span>`;
    });
    nodeBox.innerHTML = h;
  }
  function applyMarks() {
    clearMarks();
    const s = getState();
    if (!last || !s || !Array.isArray(s.team)) return;
    if (last.route) last.route.best.path.forEach((n, i) => {
      if (n.type === 'boss') return;
      const el = document.querySelector('[data-node-id="' + n.id + '"]');
      if (el) el.classList.add(i === 0 ? 'plc-route-next' : 'plc-route-path');
    });
    const team = s.team, bars = new Map();
    document.querySelectorAll('.team-slot').forEach(e => {
      if (e.offsetParent === null) return;
      const k = e.parentElement; if (!bars.has(k)) bars.set(k, []); bars.get(k).push(e);
    });
    bars.forEach(slots => {
      if (slots.length !== team.length) return;
      const slot = p => slots[team.indexOf(p)];
      const cd = last.cd, adv = last.adv;
      if (cd && cd.verdict === 'swap') mark(slot(cd.worst.p), 'bad', 'quitar · ' + cd.worst.sc.total);
      if (adv && adv.bad) { mark(slot(adv.cur.p), 'bad', 'líder · ' + adv.cur.pct + '%'); mark(slot(adv.best.p), 'good', 'ponlo 1º · ' + adv.best.pct + '%'); }
      (last.issues || []).forEach(x => { if (x.kind === 'swap') mark(slot(x.p), 'warn', 'objeto → ' + nm(x.o)); else if (x.kind === 'useless') mark(slot(x.p), 'warn', 'objeto inútil'); else mark(slot(x.o), 'warn', 'dale ' + itemName(x.item)); });
      (last.megas || []).forEach(m => { if (m.ready && !m.held) mark(slot(m.p), 'warn', 'equipa ' + m.st.name); });
    });
    if (last.cd) {
      const vc = tg(visibleCards, null);
      if (vc) vc.cards.forEach(c => {
        const x = last.cd.cands.find(k => k.m.speciesId === c.id && (c.level == null || k.m.level === c.level));
        if (!x) return;
        const top = x === last.cd.best && last.cd.verdict !== 'skip';
        const lbl = last.cd.sim ? (x.gain > 0 ? '+' + x.gain : x.gain < 0 ? String(x.gain) : '±0') + ' pts' : String(x.sc.total);
        mark(c.el, top ? 'good' : 'info', top ? lbl + ' · coger' : lbl);
      });
    }
    if (last.tdat && last.tdat.best) {
      const vt = tg(visibleTutor, null), rows = vt ? [...vt.querySelectorAll('.equip-pokemon-row')] : [];
      if (rows.length === last.tdat.rows.length) last.tdat.rows.forEach((r, i) => { if (!r.maxed) mark(rows[i], r === last.tdat.best ? 'good' : 'info', (r === last.tdat.best ? 'enseñar · ' : '') + sgn(r.gain) + ' pts'); });
    }
    if (last.ts) {
      const ts = tg(tradeStage, null);
      if (ts && ts.stage === 'pick' && last.tpick) { const kids = [...ts.el.children]; last.tpick.rows.forEach(r => { const el = kids[r.i]; if (el) mark(el, r === last.tpick.best && r.exp > 0 ? 'good' : r.exp < 0 ? 'bad' : 'info', (r === last.tpick.best && r.exp > 0 ? 'mandar · ' : '') + sgn(r.exp) + ' pts'); }); }
      if (ts && ts.stage === 'offers' && last.toff) { const kids = [...ts.el.children]; last.toff.rows.forEach(r => { const el = kids[r.k]; if (el) mark(el, r === last.toff.best && last.toff.take ? 'good' : 'info', (r === last.toff.best && last.toff.take ? 'coger · ' : '') + sgn(r.avg) + ' pts'); }); }
    }
    if (last.pdat) {
      const vp = tg(visiblePassives, null);
      if (vp) vp.forEach(v => { const r = last.pdat.rows.find(k => k.it === v.it); if (r) mark(v.el, r === last.pdat.best && r.gain >= 2 ? 'good' : 'info', sgn(r.gain) + ' pts'); });
    }
    if (last.viAdv) {
      const vi = tg(visibleItems, null);
      if (vi) vi.forEach(v => { const a = last.viAdv.find(k => k.it === v.it); if (!a || !a.b) return; if (!a.b.p) { mark(v.el, 'info', 'nadie lo usa'); return; } mark(v.el, a.b.g >= 3 ? 'good' : 'info', a.b.sim ? (a.b.g >= 3 ? '→ ' + nm(a.b.p) + ' ' + sgn(a.b.g) : '→ ' + nm(a.b.p) + ' ±0') : '→ ' + nm(a.b.p) + (a.b.g >= 1.5 ? ' +' + a.b.g.toFixed(0) : '')); });
    }
  }

  let missing = null, lastSeed, dismissed = '';
  alertEl.addEventListener('click', () => { dismissed = alertEl.textContent; alertEl.style.display = 'none'; });
  function setAlert(list) {
    const show = list.filter(x => x.lv !== 'ok').sort((a, b) => (a.lv === 'bad' ? 0 : 1) - (b.lv === 'bad' ? 0 : 1)).slice(0, 3);
    alertEl.innerHTML = show.map(x => `<div class="plc-al plc-al-${x.lv}"><span>${ICON[x.lv]}</span>${esc(x.msg)}</div>`).join('');
    alertEl.style.display = show.length && alertEl.textContent !== dismissed ? 'block' : 'none';
  }
  function put(el, html, top) {
    const openK = new Set([...el.querySelectorAll('details[open]')].map(d => d.getAttribute('data-k'))), sc = el.scrollTop;
    el.innerHTML = html;
    el.querySelectorAll('details').forEach(d => { if (openK.has(d.getAttribute('data-k'))) d.open = true; });
    el.scrollTop = top ? 0 : sc;
  }

  function render() {
    const s = getState();
    if (!missing) missing = compat();
    if (!s || !Array.isArray(s.team)) { L.innerHTML = '<h2>Pokelike Companion</h2><div class="plc-warn">No encuentro el estado del juego. Puede que una actualización haya cambiado su estructura.</div>'; Rp.innerHTML = ''; last = null; setAlert([]); return; }
    if (s.runSeed !== lastSeed) { lastSeed = s.runSeed; reminders = []; prev = null; memoMap.clear(); lastSig = ''; dismissed = ''; }
    const vc = tg(visibleCards, null), vi = tg(visibleItems, null);
    const sig = signature(s, vc, vi);
    if (sig === lastSig) return;
    lastSig = sig;
    if (sig !== memoSig) { memoSig = sig; memoMap.clear(); }
    let hl = `<h2>Pokelike Companion <span class="plc-sub">v0.11.2${window.__PLC_SOURCE === 'github' ? ' · auto' : ''}</span></h2>`;
    if (missing.length) hl += `<div class="plc-warn">Compatibilidad parcial con esta versión. Falta: ${esc(missing.join(', '))}</div>`;
    if (!seedOK()) hl += '<div class="plc-warn">Cálculo de daño desactivado: no puedo proteger la semilla del juego en esta versión.</div>';
    hl += reminders.map(r => `<div class="plc-rem">${esc(r.msg)}<button data-plc-rem="${r.id}" title="Descartar">×</button></div>`).join('');
    const R = region(s), cur = s.currentMap || 0, bosses = remainingBosses(R, s), team = s.team;
    const cd = vc ? tg(() => choiceData(s, team, bosses, vc), null) : null;
    const viSim = vi ? tg(() => itemSimData(s, team, bosses, vi), null) : null;
    const viAdv = vi ? (viSim || vi.map(x => ({ it: x.it, b: tg(() => bestHolder(x.it, team, bosses[0], s.items || []), null) }))) : null;
    const vt = tg(visibleTutor, null), tdat = vt ? tg(() => tutorData(s, team, bosses), null) : null;
    const vp = tg(visiblePassives, null), pdat = vp ? tg(() => passiveData(s, team, bosses, vp), null) : null;
    const ts = tg(tradeStage, null);
    const tpick = ts && ts.stage === 'pick' ? tg(() => tradePickData(s, R, team, bosses), null) : null;
    const toff = ts && ts.stage === 'offers' ? tg(() => tradeOfferData(s, R, team, bosses), null) : null;
    let hr = '<h2>Lo que viene</h2>';
    const choosing = !!(cd || viAdv || tdat || pdat || ts);
    if (cd || viAdv) hr += '<h3>Elección en pantalla</h3>' + tg(() => htmlChoice(cd, viAdv, bosses), '');
    if (tdat) hr += '<h3>Tutor de ataques</h3>' + tg(() => htmlTutor(tdat), '');
    if (pdat) hr += '<h3>Pasiva en pantalla</h3>' + tg(() => htmlPassives(pdat), '');
    if (ts) hr += '<h3>Intercambio</h3>' + tg(() => htmlTrade(ts, tpick, toff), '');
    if (!team.length) {
      last = { cd, viAdv, issues: [], adv: null }; setAlert([]); nodeBox.innerHTML = '';
      put(L, hl + '<div class="plc-sub">Empieza o reanuda un run de Story. Battle Tower llegará en una fase posterior.</div>'); put(Rp, hr, true); return;
    }
    const adv = tg(() => leadAdvice(s, R, team, bosses), null);
    const issues = tg(() => itemIssues(s, team, bosses[0]), []) || [];
    const sp = tg(() => specialFights(s), null);
    const nw = tg(() => nodeWins(s, R, team, bosses), null);
    const nl = choosing ? null : tg(() => nodeLeads(s, R, team, bosses), null);
    const checks = tg(() => buildChecks(s, team, bosses, adv, issues, sp && sp.fights, nw, nl), []) || [];
    const prevRoute = last && last.route;
    last = { cd, viAdv, tdat, pdat, vp, ts, tpick, toff, issues, adv, sfBoss: bosses[0] ? tg(() => simFight(s, team, bosses[0]), null) : null, bossName: bosses[0] ? bosses[0].name : null };
    setAlert(choosing ? [] : checks);
    const fresh = Object.values((s.map && s.map.nodes) || {}).filter(n => n.visited).length <= 1;
    hl += `<div class="plc-sub">${esc(R.name)}${s.nuzlockeMode ? ' · Nuzlocke' : ' · Classic'} · Mapa ${cur + 1}/${R.leaders.length + 1}${R.maps[cur] ? ' · ' + esc(R.maps[cur]) : ''}</div>`;
    hl += `<h3>${adv && adv.boss ? 'Antes del boss' : fresh ? 'Nuevo mapa: revisa' : 'Revisión'}</h3>` + htmlChecks(checks);
    hl += '<h3>¿Voy bien?</h3>' + tg(() => htmlStatus(s, team, bosses, R), '');
    hl += '<h3>Tu equipo</h3>' + htmlTeam(team, tierForMap(cur));
    hl += '<h3>Objetos</h3>' + tg(() => htmlItems(s, team, bosses[0]), '<div class="plc-sub">No disponible.</div>');
    const mdat = tg(() => megaData(s, team, bosses), null);
    if (mdat && mdat.length) hl += '<h3>Megas</h3>' + tg(() => htmlMegas(mdat), '');
    hl += det('cov', 'Cobertura de tipos y tier', htmlCoverage(team) + htmlTiers(R, s));
    hl += det('log', `Registro de aciertos (${readLog().length} combates)`, tg(htmlLog, ''));
    const rp = choosing ? prevRoute || null : tg(() => routePlan(s, R, team, bosses), null);
    last.route = rp; last.nodeWin = nw; last.nodeLead = nl; last.megas = tg(() => megaData(s, team, bosses), []);
    if (rp && !choosing) hr += '<h3>Ruta recomendada</h3>' + tg(() => htmlRoute(rp), '');
    const aura = bosses[0] ? tg(() => auraAdvice(s, team, bosses[0]), null) : null;
    hr += '<h3>Próximo boss</h3>' + (last.sfBoss ? simLine(last.sfBoss, bosses[0].name) : '') + (aura ? tg(() => htmlAura(aura, bosses[0].name), '') : '') + (bosses.length ? tg(() => htmlBoss(team, bosses[0], s.items || []), '') : '<div class="plc-sub">No quedan jefes.</div>');
    const hsp = tg(() => htmlSpecial(s, team), '');
    if (hsp) hr += '<h3>Encuentros especiales</h3>' + hsp;
    hr += '<h3>Entrenadores de este mapa</h3>' + tg(() => htmlTrainers(s, R, team), '<div class="plc-sub">No disponible.</div>');
    hr += '<h3>Hierba de este mapa</h3>' + tg(() => htmlGrass(s, R, team), '<div class="plc-sub">No disponible.</div>');
    if (bosses.length) {
      const rn = recommend(bosses.slice(0, 1)), ra = recommend(bosses);
      hr += det('types', 'Tipos que te convienen y jefes siguientes', `<div><b>Contra ${esc(bosses[0].name)}:</b> ${rn.slice(0, 4).map(x => chip(x.t)).join('')}</div><div><b>Resto del run:</b> ${ra.slice(0, 5).map(x => chip(x.t)).join('')} <span class="plc-sub">evita</span> ${ra.slice(-2).map(x => chip(x.t)).join('')}</div>` +
        bosses.slice(1).map(b => `<div>${esc(b.name)} ${b.type ? chip(b.type) : ''} <span class="plc-sub">nv máx ${Math.max(...b.mons.map(m => m.level))} · tier ${b.tier != null ? b.tier : '?'}</span></div>`).join(''));
    }
    put(L, hl); put(Rp, hr, choosing);
  }

  /* ---------- recordatorios ---------- */
  let prev = null;
  function watch() {
    const s = getState();
    if (!s || !Array.isArray(s.team)) return;
    const snap = {
      seed: s.runSeed, map: s.currentMap, n: s.team.length,
      mons: Object.fromEntries(s.team.map(p => [p._uid, { name: nm(p), hp: p.currentHp, item: itemName(p.heldItem) }])),
      boss: Object.values((s.map && s.map.nodes) || {}).some(n => n.type === 'boss' && n.accessible && !n.visited)
    };
    if (prev && prev.seed === snap.seed && prev.n > 0 && snap.n > 0) {
      if (snap.map !== prev.map) {
        const R = region(s), t = tierForMap(snap.map);
        remind(`Nuevo mapa${R.maps[snap.map] ? ': ' + R.maps[snap.map] : ''}. Revisa el orden del equipo${t != null ? ' · tier de ataques ' + t : ''}.`);
      }
      Object.entries(prev.mons).forEach(([uid, m]) => {
        const now = snap.mons[uid];
        if (((!now && snap.map === prev.map) || (now && now.hp <= 0 && m.hp > 0)) && m.item) remind(`${m.name} ha caído llevando ${m.item}. Reasigna el objeto.`);
      });
      if (snap.boss && !prev.boss) {
        const b = remainingBosses(region(s), s)[0];
        remind(`Boss disponible${b ? ': ' + b.name : ''}. Revisa orden, objetos y habilidades antes de entrar.`);
      }
    }
    prev = snap;
  }

  /* ---------- tooltip ---------- */
  function tipFor(img) {
    const src = img.getAttribute('src') || '', m = /sprites\/pokemon\/(?:[a-z-]+\/)*(\d+)/i.exec(src);
    if (!m) return null;
    const id = +m[1], s = getState(), d = dex(id);
    const mine = s && (s.team || []).find(p => p.speciesId === id);
    const types = (mine && mine.types) || (d && d.types);
    if (!Array.isArray(types) || !types.length) return null;
    const groups = {};
    TYPES.forEach(t => { const e = eff(t, types); if (e !== 1) (groups[e] = groups[e] || []).push(t); });
    let h = `<b>${esc(mine ? nm(mine) : d.name)}</b>${mine ? ` Nv ${mine.level}` : ''}<br>${chips(types)}`;
    Object.keys(groups).map(Number).sort((a, b) => b - a).forEach(e => { h += `<br>×${e}: ${chips(groups[e])}`; });
    if (d && d.baseStats) h += `<br>Stats base: ${bst(d.baseStats)} · Vel ${d.baseStats.speed}`;
    const ev = tg(() => EVOLUTIONS[id], null);
    if (ev && ev.name) h += `<br>Evoluciona a ${esc(ev.name)}${ev.level ? ' al nv ' + ev.level : ''}`;
    if (mine) { const mv = moveOf(mine); if (mv) h += `<br>• ${esc(mv.name)} (${esc(mv.type)}, ${mv.power}) · tier ${mine.moveTier}`; }
    else if (s && s.team && s.team.length) {
      const hits = s.team.filter(p => p.currentHp > 0).map(p => { const mv = moveOf(p); return mv ? { n: nm(p), e: eff(mv.type, types) } : null; }).filter(Boolean).sort((a, b) => b.e - a.e);
      if (hits.length) h += '<br>Tus ataques: ' + hits.slice(0, 3).map(x => `${esc(x.n)} ×${x.e}`).join(', ');
    }
    return h;
  }
  document.addEventListener('mouseover', ev => {
    const img = ev.target && ev.target.tagName === 'IMG' ? ev.target : null, h = img && tg(() => tipFor(img), null);
    if (!h) { tip.style.display = 'none'; return; }
    tip.innerHTML = h; tip.style.display = 'block';
  }, true);
  document.addEventListener('mousemove', ev => {
    if (tip.style.display !== 'block') return;
    tip.style.left = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 6) + 'px';
    tip.style.top = Math.min(ev.clientY + 14, innerHeight - tip.offsetHeight - 6) + 'px';
  }, true);

  window.__PLC = { render: () => { lastSig = ''; render(); }, last: () => last };
  tg(hookBattle);
  setInterval(() => { tg(hookBattle); tg(watch); tg(render); tg(applyMarks); tg(drawNodeLabels); }, 1000);
  tg(render);
})();

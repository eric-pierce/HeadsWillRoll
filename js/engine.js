// Turns raw Sleeper data into chops, weekly awards, season awards and the ledger.
(function () {
  const G = (window.G = window.G || {});

  const SLOT_ELIG = {
    QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
    DL: ['DL'], LB: ['LB'], DB: ['DB'],
    FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'],
    SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], IDP_FLEX: ['DL', 'LB', 'DB'],
  };
  const NON_STARTING = new Set(['BN', 'IR', 'TAXI']);

  const round = (x) => Math.round(x * 100) / 100;
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : 0);
  const stdev = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
  // Seeded so the odds don't jitter between refreshes when nothing has changed.
  const seeded = (seed) => () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  function compute(raw) {
    const { league, users, rosters, matchups, transactions, players = {}, completed, live } = raw;
    const slots = (league.roster_positions || []).filter((s) => !NON_STARTING.has(s));

    const pos = (id) => (players[id] && players[id].p) || (/^[A-Z]{2,3}$/.test(id) ? 'DEF' : null);
    const pname = (id) => (players[id] && players[id].n) || (/^[A-Z]{2,3}$/.test(id) ? `${id} D/ST` : `Player ${id}`);
    const pteam = (id) => (players[id] && players[id].t) || '';

    // ── Teams ───────────────────────────────────────────────
    const userById = Object.fromEntries((users || []).map((u) => [u.user_id, u]));
    const teams = {};
    for (const r of rosters) {
      const u = userById[r.owner_id] || {};
      teams[r.roster_id] = {
        rid: r.roster_id,
        name: (u.metadata && u.metadata.team_name) || u.display_name || `Team ${r.roster_id}`,
        manager: u.display_name || 'Unclaimed',
        // Prefer the custom team logo; fall back to the manager's profile picture.
        avatar: (u.metadata && /^https?:\/\//.test(u.metadata.avatar || '') && u.metadata.avatar)
          || (u.avatar ? `https://sleepercdn.com/avatars/${u.avatar}` : null),
        currentPlayers: r.players || [],
        faabUsed: (r.settings && r.settings.waiver_budget_used) || 0,
      };
    }
    const allRids = rosters.map((r) => r.roster_id);
    const drafted = rosters.some((r) => r.players && r.players.length);
    // In a chopped league the eliminated roster is emptied, so an empty roster confirms a chop.
    const emptySet = new Set(drafted ? rosters.filter((r) => !r.players || !r.players.length).map((r) => r.roster_id) : []);

    // ── Per-week rows ───────────────────────────────────────
    function optimal(ids, pp) {
      const pool = ids.map((id) => ({ id, pts: +(pp[id] || 0), pos: pos(id) })).filter((x) => x.pos);
      if (!pool.length || !slots.length) return null;
      const ordered = slots.map((s) => SLOT_ELIG[s] || [s]).sort((a, b) => a.length - b.length);
      const used = new Set();
      let total = 0;
      for (const el of ordered) {
        let best = null;
        for (const p of pool) {
          if (!used.has(p.id) && el.includes(p.pos) && (!best || p.pts > best.pts)) best = p;
        }
        if (best) { used.add(best.id); total += best.pts; }
      }
      return total;
    }

    function buildRow(rid, m) {
      m = m || {};
      const pts = +(m.custom_points != null ? m.custom_points : m.points) || 0;
      const starters = m.starters || [];
      const sp = m.starters_points || [];
      const all = m.players || [];
      const pp = m.players_points || {};
      const starterSet = new Set(starters);
      const bench = sum(all.filter((id) => !starterSet.has(id)).map((id) => +(pp[id] || 0)));
      const opt = optimal(all, pp);
      let top = null;
      starters.forEach((id, i) => {
        if (id && id !== '0' && (!top || (sp[i] || 0) > top.pts)) top = { pid: id, pts: +(sp[i] || 0) };
      });
      const zeros = starters.filter((id, i) => !id || id === '0' || (+(sp[i] || 0)) <= 0).length;
      return {
        rid, pts: round(pts), bench: round(bench),
        opt: opt != null ? round(Math.max(opt, pts)) : null,
        eff: opt ? Math.min(1, pts / Math.max(opt, pts)) : null,
        zeros, top, starters, sp, players: all, pp,
      };
    }

    // Sleeper records each elimination as a "chopped" transaction: the roster, the week, and
    // every player released. When present, that record decides who was chopped.
    const official = {};
    for (const [leg, list] of Object.entries(transactions || {})) {
      for (const t of list || []) {
        if (t.type !== 'chopped' || t.status !== 'complete') continue;
        for (const rid of t.roster_ids || []) {
          (official[Number(leg)] = official[Number(leg)] || []).push({ rid, drops: Object.keys(t.drops || {}) });
        }
      }
    }
    const hasOfficial = Object.keys(official).length > 0;
    // Sleeper can chop before the NFL week rolls over; treat that week as finished.
    const liveWeek = live && official[live] ? null : live;
    const weeksToScore = live && !liveWeek ? [...completed, live] : completed;

    const alive = new Set(allRids);
    const weekly = {};
    const chops = [];
    for (const w of weeksToScore) {
      const byRid = Object.fromEntries((matchups[w] || []).map((m) => [m.roster_id, m]));
      const rows = [...alive].map((rid) => buildRow(rid, byRid[rid])).sort((a, b) => b.pts - a.pts);
      if (!rows.length || (rows.every((r) => r.pts === 0) && !official[w])) continue; // no scores for this week
      rows.forEach((r, i) => { r.rank = i + 1; });

      let victims;
      let unofficial = false;
      const rec = (official[w] || []).filter((o) => alive.has(o.rid));
      if (rec.length) {
        victims = rec.map((o) => { const r = rows.find((x) => x.rid === o.rid); r.drops = o.drops; return r; });
      } else {
        // No record (older leagues, or the chop hasn't processed yet): lowest scorer goes.
        // An emptied roster near the bottom settles ties and stat corrections.
        const asc = rows.slice().reverse();
        victims = [(!hasOfficial && emptySet.size && asc.slice(0, 3).find((r) => emptySet.has(r.rid))) || asc[0]];
        unofficial = hasOfficial;
      }
      const vset = new Set(victims.map((v) => v.rid));
      const others = rows.filter((r) => !vset.has(r.rid));
      const savior = others[others.length - 1];
      const line = Math.max(...victims.map((v) => v.pts));
      rows.forEach((r) => { r.cushion = round(r.pts - line); });

      // Closest victim first, so weekly awards talk about the narrowest miss.
      victims.sort((a, b) => b.pts - a.pts);
      for (const v of victims) {
        alive.delete(v.rid);
        v.chopped = true;
        chops.push({ rid: v.rid, week: w, pts: v.pts, margin: savior ? round(savior.pts - v.pts) : 0, savior: savior && savior.rid, row: v, drops: v.drops || v.players, unofficial });
      }
      weekly[w] = { week: w, rows, chopped: victims[0].rid, victims: [...vset], line, savior: savior && savior.rid, unofficial };
    }
    const scoredWeeks = Object.keys(weekly).map(Number).sort((a, b) => a - b);
    const lastScored = scoredWeeks[scoredWeeks.length - 1];

    // Without official records: rosters Sleeper has emptied that our arithmetic kept alive.
    if (!hasOfficial) {
      for (const rid of [...alive]) {
        if (emptySet.has(rid) && lastScored) {
          alive.delete(rid);
          const row = weekly[lastScored].rows.find((r) => r.rid === rid);
          chops.push({ rid, week: lastScored, pts: row ? row.pts : 0, margin: 0, savior: null, row, drops: row ? row.players : [], inferred: true });
        }
      }
    }

    chops.forEach((c, i) => {
      c.order = i + 1;
      c.fig = G.EXECUTION_ORDER[i % G.EXECUTION_ORDER.length];
      teams[c.rid].chop = c;
    });
    for (const rid of allRids) teams[rid].alive = alive.has(rid);

    // ── Live week ───────────────────────────────────────────
    let liveModel = null;
    if (liveWeek && matchups[liveWeek]) {
      const ctx = raw.liveCtx || {};
      const hasProj = !!(ctx.proj && Object.keys(ctx.proj).length);
      const scoring = league.scoring_settings || null;
      const projPts = (pid) => {
        const p = ctx.proj && ctx.proj[pid];
        if (!p) return 0;
        const st = p.stats;
        let v = 0;
        if (scoring) for (const k in scoring) if (st[k] != null) v += st[k] * scoring[k];
        // If none of the league's scoring keys matched, use Sleeper's preset totals.
        if (!v) v = scoring && scoring.rec === 0.5 ? st.pts_half_ppr : scoring && !scoring.rec ? st.pts_std : st.pts_ppr;
        return +v || 0;
      };
      const noSchedule = !ctx.games || !Object.keys(ctx.games).length;
      const OUT = new Set(['Out', 'IR', 'PUP', 'Sus', 'NA', 'DNR']);

      const byRid = Object.fromEntries(matchups[liveWeek].map((m) => [m.roster_id, m]));
      const rows = [...alive].map((rid) => {
        const row = buildRow(rid, byRid[rid]);
        let rem = 0, varSum = 0, toPlay = 0, playing = 0, done = 0;
        row.slots = row.starters.map((pid, i) => {
          const actual = +(row.sp[i] || 0);
          if (!pid || pid === '0') return { pid, actual, rem: 0, state: 'empty' };
          const p = ctx.proj && ctx.proj[pid];
          const team = (p && p.team) || pteam(pid);
          const g = ctx.games && ctx.games[team];
          const full = (p && OUT.has(p.inj)) ? 0 : projPts(pid);
          let state, r;
          if (noSchedule) { state = actual > 0 ? 'live' : 'pre'; r = Math.max(0, full - actual); if (actual > 0) playing++; else toPlay++; }
          else if (!g) { state = 'bye'; r = 0; }
          else if (g.state === 'post') { state = 'done'; r = 0; done++; }
          else if (g.state === 'in') { state = 'live'; r = Math.max(0, full * g.frac); playing++; }
          else { state = 'pre'; r = full; toPlay++; }
          rem += r;
          // Weekly fantasy scoring is noisy: roughly ±65% of what's left for each player.
          varSum += (0.65 * r) ** 2;
          return { pid, actual, rem: round(r), full: round(full), state };
        });
        row.proj = round(row.pts + rem);
        row.sd = Math.sqrt(varSum);
        row.toPlay = toPlay; row.playing = playing; row.done = done;
        return row;
      });

      const key = hasProj ? 'proj' : 'pts';
      rows.sort((a, b) => b[key] - a[key] || b.pts - a.pts);
      rows.forEach((r, i) => { r.rank = i + 1; });
      const low = rows[rows.length - 1];
      rows.forEach((r) => { r.cushion = low ? round(r[key] - low[key]) : 0; });

      // Chop odds: simulate the rest of the week and count how often each team finishes last.
      if (hasProj && rows.length > 1) {
        const SIMS = 10000;
        const rand = seeded(rows.reduce((s, r) => s + Math.round(r.pts * 100) + r.rid, 17));
        const gauss = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
        const last = new Array(rows.length).fill(0);
        for (let s = 0; s < SIMS; s++) {
          let lo = Infinity, loI = 0;
          for (let i = 0; i < rows.length; i++) {
            const v = rows[i].proj + rows[i].sd * gauss();
            if (v < lo) { lo = v; loI = i; }
          }
          last[loI]++;
        }
        rows.forEach((r, i) => { r.odds = last[i] / SIMS; });
      }

      const started = rows.some((r) => r.pts !== 0);
      const remaining = rows.reduce((n, r) => n + r.toPlay + r.playing, 0);
      liveModel = { week: liveWeek, rows, started, hasProj, remaining, fetched: ctx.fetched || null };
    }

    // ── Transactions ────────────────────────────────────────
    const lootable = {}; // player id -> chop that released them
    for (const c of chops) for (const pid of c.drops || (c.row && c.row.players) || []) lootable[pid] = c;
    // A chop in week N and the waiver run that follows it share leg N.
    const lootedFrom = (pid, rid, leg) => { const src = lootable[pid]; return src && src.rid !== rid && leg >= src.week ? src : null; };

    const moves = [];
    for (const [leg, list] of Object.entries(transactions || {})) {
      for (const t of list || []) {
        if (t.status !== 'complete' || !t.adds || (t.type !== 'waiver' && t.type !== 'free_agent')) continue;
        for (const [pid, rid] of Object.entries(t.adds)) {
          const looted = lootedFrom(pid, rid, Number(leg));
          moves.push({
            leg: Number(leg), type: t.type, rid, pid,
            bid: t.type === 'waiver' ? +((t.settings && t.settings.waiver_bid) || 0) : 0,
            drops: Object.entries(t.drops || {}).filter(([, r]) => r === rid).map(([p]) => p),
            looted, created: t.status_updated || t.created || 0,
          });
        }
      }
    }
    moves.sort((a, b) => b.leg - a.leg || b.created - a.created);

    // ── Waiver bids, winning and losing ─────────────────────
    // Sleeper keeps failed claims as waiver transactions with status "failed" and a note.
    const reasonOf = (t) => {
      if (t.status === 'complete') return 'won';
      const n = ((t.metadata && t.metadata.notes) || '').toLowerCase();
      if (n.includes('claimed by another')) return 'outbid';
      if (n.includes('too many players')) return 'roster';
      if (n.includes('budget') || n.includes('not enough')) return 'budget';
      return 'other';
    };
    const sheetMap = {};
    for (const [leg, list] of Object.entries(transactions || {})) {
      for (const t of list || []) {
        if (t.type !== 'waiver' || (t.status !== 'complete' && t.status !== 'failed') || !t.adds) continue;
        for (const [pid, rid] of Object.entries(t.adds)) {
          const key = `${leg}|${pid}`;
          const sh = sheetMap[key] || (sheetMap[key] = { leg: Number(leg), pid, bids: [] });
          sh.bids.push({
            rid, bid: +((t.settings && t.settings.waiver_bid) || 0), reason: reasonOf(t),
            note: (t.metadata && t.metadata.notes) || '', created: t.created || 0,
            drops: Object.entries(t.drops || {}).filter(([, r]) => r === rid).map(([p]) => p),
          });
        }
      }
    }
    const sheets = Object.values(sheetMap);
    for (const sh of sheets) {
      sh.bids.sort((a, b) => (b.reason === 'won') - (a.reason === 'won') || b.bid - a.bid || a.created - b.created);
      sh.winner = sh.bids.find((b) => b.reason === 'won') || null;
      sh.teams = new Set(sh.bids.map((b) => b.rid)).size;
      sh.looted = sh.winner ? lootedFrom(sh.pid, sh.winner.rid, sh.leg) : (lootable[sh.pid] && sh.leg >= lootable[sh.pid].week ? lootable[sh.pid] : null);
      // Best rival bid that actually competed (lost because someone else won).
      const rivals = sh.bids.filter((b) => b.reason === 'outbid' && (!sh.winner || b.rid !== sh.winner.rid));
      sh.runnerUp = rivals.sort((a, b) => b.bid - a.bid)[0] || null;
      if (sh.winner) {
        sh.overpay = sh.winner.bid - (sh.runnerUp ? sh.runnerUp.bid : 0);
        for (const b of rivals) b.short = sh.winner.bid - b.bid; // 0 = lost a tiebreak
      }
    }
    sheets.sort((a, b) => b.leg - a.leg || b.bids.length - a.bids.length || ((b.winner && b.winner.bid) || 0) - ((a.winner && a.winner.bid) || 0));

    // Per-team bid stats. Several bids by one team on one player count once, at their highest.
    const bidStats = Object.fromEntries(allRids.map((rid) => [rid, { placed: 0, won: 0, outbid: 0, roster: 0, lostDollars: 0, lostPlayers: 0 }]));
    for (const sh of sheets) {
      const best = {};
      for (const b of sh.bids) {
        const st = bidStats[b.rid];
        if (!st) continue;
        st.placed++;
        if (b.reason === 'won') st.won++;
        else if (b.reason === 'roster') st.roster++;
        else if (b.reason === 'outbid') st.outbid++;
        if (b.reason !== 'won' && (!best[b.rid] || b.bid > best[b.rid])) best[b.rid] = b.bid;
      }
      for (const [rid, amt] of Object.entries(best)) {
        if (sh.winner && String(sh.winner.rid) === rid) continue;
        bidStats[rid].lostDollars += amt;
        bidStats[rid].lostPlayers++;
      }
    }

    const T0 = (rid) => teams[rid].name;
    const bidAwardsFor = (list) => {
      const out = {};
      const won = list.filter((sh) => sh.winner && sh.winner.bid > 0);
      const over = won.slice().sort((a, b) => b.overpay - a.overpay || b.winner.bid - a.winner.bid)[0];
      if (over && over.overpay > 0) {
        out.necklace = {
          rid: over.winner.rid, value: `$${over.overpay}`, unit: 'over the next bid',
          detail: over.runnerUp
            ? `Paid $${over.winner.bid} for ${pname(over.pid)}. The next best bid was $${over.runnerUp.bid} from ${T0(over.runnerUp.rid)}.`
            : `Paid $${over.winner.bid} for ${pname(over.pid)}. Nobody else bid.`,
        };
      }
      const losses = [];
      for (const sh of list) for (const b of sh.bids) if (b.short != null && b.bid > 0) losses.push({ sh, b });
      losses.sort((x, y) => x.b.short - y.b.short || y.b.bid - x.b.bid);
      if (losses[0]) {
        const { sh, b } = losses[0];
        out.varennes = {
          rid: b.rid, value: b.short === 0 ? 'Tie' : `$${b.short}`, unit: b.short === 0 ? 'lost the tiebreak' : 'short',
          detail: `Bid $${b.bid} on ${pname(sh.pid)}. It went to ${T0(sh.winner.rid)} for $${sh.winner.bid}.`,
        };
      }
      const steals = list.filter((sh) => sh.winner && sh.teams >= 3).sort((a, b) => a.winner.bid - b.winner.bid || b.teams - a.teams);
      if (steals[0]) {
        const sh = steals[0];
        out.talleyrand = {
          rid: sh.winner.rid, value: `$${sh.winner.bid}`, unit: `vs ${sh.teams - 1} rivals`,
          detail: `Won ${pname(sh.pid)} with ${sh.teams} teams bidding${sh.runnerUp ? `. The next best bid was $${sh.runnerUp.bid}` : ''}.`,
        };
      }
      return out;
    };

    // ── Weekly awards ───────────────────────────────────────
    const weeklyAwards = {};
    scoredWeeks.forEach((w, idx) => {
      const wk = weekly[w];
      const rows = wk.rows;
      const byRid = Object.fromEntries(rows.map((r) => [r.rid, r]));
      const prev = idx > 0 ? weekly[scoredWeeks[idx - 1]] : null;
      const a = {};
      const T = (rid) => teams[rid].name;

      const top = rows[0];
      a.robespierre = { rid: top.rid, value: `${top.pts.toFixed(2)}`, unit: 'pts', detail: rows[1] ? `${(top.pts - rows[1].pts).toFixed(2)} clear of ${T(rows[1].rid)}.` : '' };

      const victim = byRid[wk.chopped];
      if (wk.savior != null) {
        const s = byRid[wk.savior];
        a.paine = { rid: s.rid, value: `+${(s.pts - victim.pts).toFixed(2)}`, unit: 'pts', detail: `Scored ${s.pts.toFixed(2)} and watched ${T(victim.rid)} ride the tumbril instead.` };
        a.dubarry = { rid: victim.rid, value: victim.pts.toFixed(2), unit: 'pts', detail: `${(s.pts - victim.pts).toFixed(2)} points short of ${T(s.rid)}.` };
      }
      if (victim && victim.top) {
        a.more = { rid: victim.rid, value: victim.top.pts.toFixed(2), unit: 'pts', detail: `${pname(victim.top.pid)} held up their end. The rest of the lineup did not.`, pid: victim.top.pid };
      }

      const bestStarter = rows.filter((r) => r.top).sort((x, y) => y.top.pts - x.top.pts)[0];
      if (bestStarter) a.anne = { rid: bestStarter.rid, value: bestStarter.top.pts.toFixed(2), unit: 'pts', detail: `${pname(bestStarter.top.pid)} (${pos(bestStarter.top.pid) || '?'}, ${pteam(bestStarter.top.pid)}).`, pid: bestStarter.top.pid };

      const withEff = rows.filter((r) => r.eff != null && r.opt > 0);
      if (withEff.length) {
        const best = withEff.slice().sort((x, y) => y.eff - x.eff)[0];
        const worst = withEff.slice().sort((x, y) => x.eff - y.eff)[0];
        a.guillotin = { rid: best.rid, value: `${Math.round(best.eff * 100)}%`, unit: 'efficient', detail: `${best.pts.toFixed(2)} of a possible ${best.opt.toFixed(2)}.` };
        a.louis = { rid: worst.rid, value: `${Math.round(worst.eff * 100)}%`, unit: 'efficient', detail: `Left ${(worst.opt - worst.pts).toFixed(2)} points on the table. Best possible was ${worst.opt.toFixed(2)}.` };
      }

      const benchiest = rows.slice().sort((x, y) => y.bench - x.bench)[0];
      if (benchiest && benchiest.bench > 0) a.mike = { rid: benchiest.rid, value: benchiest.bench.toFixed(2), unit: 'bench pts', detail: 'Alive, technically. Useful, no.' };

      const hollow = rows.slice().sort((x, y) => y.zeros - x.zeros)[0];
      if (hollow && hollow.zeros > 0) a.horseman = { rid: hollow.rid, value: String(hollow.zeros), unit: hollow.zeros === 1 ? 'zero' : 'zeros', detail: `${hollow.zeros} starting slot${hollow.zeros === 1 ? '' : 's'} scored nothing.` };

      if (prev) {
        const prevBy = Object.fromEntries(prev.rows.map((r) => [r.rid, r]));
        const jumps = rows.filter((r) => prevBy[r.rid]).map((r) => ({ r, d: r.pts - prevBy[r.rid].pts })).sort((x, y) => y.d - x.d);
        if (jumps[0] && jumps[0].d > 0) a.denis = { rid: jumps[0].r.rid, value: `+${jumps[0].d.toFixed(2)}`, unit: 'pts', detail: `From ${prevBy[jumps[0].r.rid].pts.toFixed(2)} to ${jumps[0].r.pts.toFixed(2)}.` };

        const queen = byRid[prev.rows[0].rid];
        if (queen && queen.rank > rows.length / 2) a.janegrey = { rid: queen.rid, value: `#${queen.rank}`, unit: `of ${rows.length}`, detail: `Top of the league in week ${prev.week}. Fell to ${queen.pts.toFixed(2)}.` };
      }
      // The waiver run after week N's chop shares leg N.
      Object.assign(a, bidAwardsFor(sheets.filter((sh) => sh.leg === w)));
      weeklyAwards[w] = a;
    });

    // ── Ledger (season stats per team) ──────────────────────
    const ledger = {};
    for (const rid of allRids) {
      const hist = scoredWeeks.map((w) => weekly[w].rows.find((r) => r.rid === rid)).filter(Boolean);
      const pts = hist.map((r) => r.pts);
      ledger[rid] = {
        rid, weeks: hist.length, total: round(sum(pts)), avg: round(mean(pts)),
        best: pts.length ? Math.max(...pts) : 0, worst: pts.length ? Math.min(...pts) : 0,
        stdev: round(stdev(pts)),
        // Finished in the bottom three of a week and survived it.
        bottom3: scoredWeeks.filter((w) => weekly[w].rows.slice(-3).some((r) => r.rid === rid && !r.chopped)).length,
        cushion: round(mean(hist.filter((r) => !r.chopped).map((r) => r.cushion))),
        bench: round(sum(hist.map((r) => r.bench))),
        escapes: scoredWeeks.filter((w) => weekly[w].savior === rid).length,
        faab: 0, bigBid: null, looted: 0, pickupPts: 0,
        ...bidStats[rid],
      };
    }
    // Transactions → spending, looting, pickups
    const acquired = {}; // rid -> { pid: firstLeg }
    for (const m of moves) {
      const L = ledger[m.rid];
      if (!L) continue;
      L.faab += m.bid;
      if (m.bid > 0 && (!L.bigBid || m.bid > L.bigBid.bid)) L.bigBid = m;
      if (m.looted) L.looted++;
      acquired[m.rid] = acquired[m.rid] || {};
      if (acquired[m.rid][m.pid] == null || m.leg < acquired[m.rid][m.pid]) acquired[m.rid][m.pid] = m.leg;
    }
    for (const rid of allRids) {
      if (!ledger[rid].faab && teams[rid].faabUsed) ledger[rid].faab = teams[rid].faabUsed;
      const acq = acquired[rid] || {};
      let total = 0;
      for (const w of scoredWeeks) {
        const r = weekly[w].rows.find((x) => x.rid === rid);
        if (!r) continue;
        r.starters.forEach((pid, i) => { if (acq[pid] != null && w >= acq[pid]) total += +(r.sp[i] || 0); });
      }
      ledger[rid].pickupPts = round(total);
    }

    // ── Season awards ───────────────────────────────────────
    const living = allRids.filter((rid) => alive.has(rid)).map((rid) => ledger[rid]);
    const everyone = allRids.map((rid) => ledger[rid]);
    const rank = (list, key, dir, filter) => list.filter(filter || (() => true)).slice().sort((a, b) => (dir === 'asc' ? a[key] - b[key] : b[key] - a[key]));
    const seasonAwards = {};
    const make = (id, list, fmt, unit) => {
      if (!list.length) return;
      seasonAwards[id] = { rid: list[0].rid, value: fmt(list[0]), unit, podium: list.slice(0, 3).map((l) => ({ rid: l.rid, value: fmt(l) })) };
    };
    if (scoredWeeks.length) {
      make('committee', rank(living, 'total'), (l) => l.total.toFixed(2), 'pts');
      if (scoredWeeks.length >= 2) make('charles', rank(living, 'stdev', 'asc', (l) => l.weeks >= 2), (l) => `±${l.stdev.toFixed(1)}`, 'pts / week');
      make('chalk', rank(everyone, 'escapes', 'desc', (l) => l.escapes > 0), (l) => String(l.escapes), 'escapes');
      make('mary', rank(living, 'bottom3', 'desc', (l) => l.bottom3 > 0), (l) => String(l.bottom3), 'bottom-3 finishes');
      make('mikeSeason', rank(everyone, 'bench'), (l) => l.bench.toFixed(2), 'bench pts');
    }
    make('sanson', rank(everyone, 'looted', 'desc', (l) => l.looted > 0), (l) => String(l.looted), 'players looted');
    make('lavoisier', rank(everyone, 'pickupPts', 'desc', (l) => l.pickupPts > 0), (l) => l.pickupPts.toFixed(2), 'pickup pts');
    make('marie', rank(everyone, 'faab', 'desc', (l) => l.faab > 0), (l) => `$${l.faab}`, 'FAAB spent');
    Object.assign(seasonAwards, bidAwardsFor(sheets));
    make('assignat', rank(everyone, 'lostDollars', 'desc', (l) => l.lostDollars > 0), (l) => `$${l.lostDollars}`, 'bid on players they lost');
    if (seasonAwards.assignat) {
      const l = ledger[seasonAwards.assignat.rid];
      seasonAwards.assignat.detail = `Across ${l.lostPlayers} player${l.lostPlayers === 1 ? '' : 's'}, with ${l.won} claim${l.won === 1 ? '' : 's'} won all season.`;
    }
    make('conciergerie', rank(everyone, 'roster', 'desc', (l) => l.roster > 0), (l) => String(l.roster), 'claims failed, roster full');
    const bids = everyone.filter((l) => l.bigBid).sort((a, b) => b.bigBid.bid - a.bigBid.bid);
    if (bids.length) {
      seasonAwards.raleigh = {
        rid: bids[0].rid, value: `$${bids[0].bigBid.bid}`, unit: pname(bids[0].bigBid.pid),
        podium: bids.slice(0, 3).map((l) => ({ rid: l.rid, value: `$${l.bigBid.bid} · ${pname(l.bigBid.pid)}` })),
      };
    }

    return {
      league, teams, allRids, alive, chops, weekly, scoredWeeks, live: liveModel,
      weeklyAwards, seasonAwards, ledger, moves, sheets, hasOfficial, pname, pos, pteam,
      budget: (league.settings && league.settings.waiver_budget) || 100,
      drafted,
    };
  }

  G.compute = compute;
})();

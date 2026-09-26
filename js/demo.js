// A fictional 18-team chopped league, generated in the same shape the Sleeper API returns,
// so the app has something to show before a real league is connected.
(function () {
  const G = (window.G = window.G || {});

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const TEAM_NAMES = [
    'Tennis Court Oath', 'Storming the Backfield', 'Let Them Eat Kicks', 'Jacobin Jackals',
    'Sans-Culottes FC', 'Tumbril Tailgaters', 'Thermidor Thunder', 'Marat’s Bathtub',
    'The Girondins', 'Estates General Mgr', 'Lunette Lovers', 'Madame Defarge Knits',
    'Committee of Public Safeties', 'Bastille Day Parade', 'Napoleon Complex', 'Liberté, Égalité, Fantasy',
    'The Headless Horsemen', 'Coup de Grâce',
  ];
  const MANAGERS = [
    'citizen_pierce', 'robespierre99', 'dantonfan', 'le_bourreau', 'lafayette_fc', 'couthon_wheels',
    'saintjust_ok', 'the_dauphin', 'mme_roland', 'brissot_bets', 'fouche_files', 'desmoulins',
    'carnot_counts', 'barras_bags', 'tallien_t', 'petion_p', 'hebert_h', 'sieyes_says',
  ];
  const FIRST = ['Jacques', 'Georges', 'Camille', 'Maxime', 'Honoré', 'Antoine', 'Pierre', 'Lazare', 'Joseph', 'Nicolas', 'Émile', 'Gaspard', 'Hugo', 'Baptiste', 'Olivier', 'Théo', 'Rémy', 'Luc', 'Marcel', 'Denis'];
  const LAST = ['Couthon', 'Desmoulins', 'Saint-Just', 'Hébert', 'Brissot', 'Barnave', 'Pétion', 'Carnot', 'Fouché', 'Barras', 'Tallien', 'Vergniaud', 'Condorcet', 'Mirabeau', 'Sieyès', 'Collot', 'Billaud', 'Chénier', 'Bailly', 'Hoche', 'Kléber', 'Murat', 'Ney', 'Davout', 'Lannes', 'Moreau', 'Marceau', 'Desaix', 'Augereau', 'Masséna'];
  const CLUBS = ['PAR', 'LYO', 'MAR', 'BOR', 'NAN', 'TOU', 'LIL', 'NIC', 'REN', 'DIJ', 'BRE', 'MET', 'CAE', 'AMI', 'ROU', 'TRS', 'ORL', 'AVI', 'CAL', 'REI', 'LEM', 'PAU', 'ANG', 'NIM', 'VAL', 'BAY', 'TOL', 'GRE', 'PER', 'CHA', 'VER', 'BLO'];

  const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
  const MEAN = { QB: 18, RB: 11, WR: 11, TE: 7, K: 8, DEF: 7 };
  const SPREAD = { QB: 8, RB: 8, WR: 9, TE: 6, K: 4, DEF: 6 };

  function build() {
    const r = rng(1793);
    const pick = (a) => a[Math.floor(r() * a.length)];
    const players = {};
    const quality = {};
    let nextId = 9000;
    const addPlayer = (p) => {
      const id = p === 'DEF' ? CLUBS[Object.values(players).filter((x) => x.p === 'DEF').length] : String(nextId++);
      players[id] = { n: p === 'DEF' ? `${id} Revolutionaries` : `${pick(FIRST)} ${pick(LAST)}`, p, t: pick(CLUBS) };
      quality[id] = 0.55 + r() * 0.9;
      return id;
    };
    const pool = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
    const counts = { QB: 32, RB: 70, WR: 90, TE: 34, K: 26, DEF: 26 };
    for (const [p, n] of Object.entries(counts)) for (let i = 0; i < n; i++) pool[p].push(addPlayer(p));
    for (const p of Object.keys(pool)) pool[p].sort((a, b) => quality[b] - quality[a]);

    // Snake-ish draft: each team takes a fixed shape of positions.
    const shape = ['QB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'TE', 'K', 'DEF', 'QB', 'RB', 'WR', 'TE'];
    const N = 18;
    const rosters = Array.from({ length: N }, (_, i) => ({ roster_id: i + 1, owner_id: `u${i + 1}`, players: [], settings: { waiver_budget_used: 0 } }));
    const taken = new Set();
    for (const p of shape) {
      const order = rosters.slice().sort(() => r() - 0.5);
      for (const ro of order) {
        const id = pool[p].find((x) => !taken.has(x));
        if (id) { taken.add(id); ro.players.push(id); }
      }
    }
    const free = new Set(Object.keys(players).filter((id) => !taken.has(id)));

    const score = (id) => {
      const p = players[id].p;
      if (r() < 0.04) return 0; // injured, benched, on a bye
      const v = MEAN[p] * quality[id] + (r() - 0.35) * SPREAD[p] * 1.6;
      return Math.round(Math.max(p === 'DEF' ? -4 : 0, v) * 100) / 100;
    };
    const lineup = (ids, pp, guess) => {
      // Managers set lineups on a noisy guess of quality, not on actual points.
      const g = Object.fromEntries(ids.map((id) => [id, quality[id] + (r() - 0.5) * 0.6]));
      const used = new Set();
      const elig = { FLEX: ['RB', 'WR', 'TE'] };
      return SLOTS.map((s) => {
        const ok = elig[s] || [s];
        const best = ids.filter((id) => !used.has(id) && ok.includes(players[id].p)).sort((a, b) => g[b] - g[a])[0];
        if (!best || (guess && r() < 0.015)) return '0';
        used.add(best);
        return best;
      });
    };

    const WEEK_NOW = 7;
    const matchups = {};
    const transactions = {};
    const alive = new Set(rosters.map((ro) => ro.roster_id));
    let released = []; // players dumped by the last chop

    for (let w = 1; w <= WEEK_NOW; w++) {
      // Waivers run at the start of each week, feasting on the last chopped roster.
      const tx = [];
      if (w > 1) {
        const bidders = [...alive].sort(() => r() - 0.5).slice(0, 5 + Math.floor(r() * 5));
        const targets = [...released, ...[...free].sort(() => r() - 0.5).slice(0, 6)].filter((id) => free.has(id));
        targets.sort((a, b) => quality[b] - quality[a]);
        for (const rid of bidders) {
          const id = targets.shift();
          if (!id) break;
          const ro = rosters[rid - 1];
          const spent = ro.settings.waiver_budget_used;
          const bid = Math.min(100 - spent, Math.max(0, Math.round((quality[id] - 0.5) * (released.includes(id) ? 22 : 6) * (0.4 + r()))));
          const dropId = ro.players.slice().sort((a, b) => quality[a] - quality[b])[0];
          ro.players = ro.players.filter((x) => x !== dropId).concat(id);
          free.delete(id); free.add(dropId);
          ro.settings.waiver_budget_used += bid;
          tx.push({ type: 'waiver', status: 'complete', adds: { [id]: rid }, drops: { [dropId]: rid }, settings: { waiver_bid: bid }, leg: w, created: w * 1e6 + tx.length, status_updated: w * 1e6 + tx.length });
        }
      }
      transactions[w] = tx;

      // Live week: some clubs have finished, some are mid-game, the rest haven't kicked off.
      const clubState = (club) => { const i = CLUBS.indexOf(club); return i < 14 ? 'post' : i < 20 ? 'in' : 'pre'; };
      const liveScore = (id) => { const st = clubState(players[id].t); return st === 'post' ? score(id) : st === 'in' ? Math.round(score(id) * 0.55 * 100) / 100 : 0; };
      const ms = rosters.map((ro) => {
        if (!alive.has(ro.roster_id)) return { roster_id: ro.roster_id, matchup_id: null, points: 0, players: [], starters: [], starters_points: [], players_points: {} };
        const pp = {};
        for (const id of ro.players) pp[id] = w === WEEK_NOW ? liveScore(id) : score(id);
        const starters = lineup(ro.players, pp, true);
        const sp = starters.map((id) => (id === '0' ? 0 : pp[id]));
        const pts = Math.round(sp.reduce((s, x) => s + x, 0) * 100) / 100;
        return { roster_id: ro.roster_id, matchup_id: null, points: pts, custom_points: null, players: ro.players.slice(), starters, starters_points: sp, players_points: pp };
      });
      matchups[w] = ms;

      if (w < WEEK_NOW) {
        const victim = ms.filter((m) => alive.has(m.roster_id)).sort((a, b) => a.points - b.points)[0];
        alive.delete(victim.roster_id);
        const ro = rosters[victim.roster_id - 1];
        released = ro.players.slice();
        released.forEach((id) => free.add(id));
        ro.players = [];
      }
    }

    const users = rosters.map((ro, i) => ({ user_id: `u${i + 1}`, display_name: MANAGERS[i], avatar: null, metadata: { team_name: TEAM_NAMES[i] } }));
    const league = {
      league_id: 'demo', name: 'Coup la Tête (Demo League)', season: '2026', status: 'in_season', total_rosters: N,
      settings: { start_week: 1, playoff_week_start: 0, waiver_budget: 100 },
      roster_positions: [...SLOTS, 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
    };
    const games = {};
    for (const c of CLUBS) {
      const i = CLUBS.indexOf(c);
      games[c] = i < 14 ? { state: 'post', frac: 0 } : i < 20 ? { state: 'in', frac: 0.45, label: '3rd 6:40' } : { state: 'pre', frac: 1 };
    }
    const proj = {};
    for (const [id, p] of Object.entries(players)) proj[id] = { team: p.t, inj: null, stats: { pts_ppr: Math.round(MEAN[p.p] * quality[id] * 100) / 100 } };
    const liveCtx = { proj, games, fetched: Date.now() };

    return {
      liveCtx,
      state: { week: WEEK_NOW, season: '2026', season_type: 'regular' },
      league, users, rosters, matchups, transactions, players,
      completed: [1, 2, 3, 4, 5, 6], live: WEEK_NOW, demo: true,
    };
  }

  G.demoData = build;
})();

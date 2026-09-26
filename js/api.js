// Sleeper API access. Public, read-only, no key required, CORS-enabled.
(function () {
  const G = (window.G = window.G || {});
  const BASE = 'https://api.sleeper.app/v1';
  const PLAYERS_KEY = 'gl_players_v1';
  const DAY = 24 * 60 * 60 * 1000;

  async function get(path) {
    const res = await fetch(BASE + path);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Sleeper returned ${res.status} for ${path}`);
    return res.json();
  }

  // The full player database is ~5MB, so trim it to what we need and cache for a day.
  async function players() {
    try {
      const cached = JSON.parse(localStorage.getItem(PLAYERS_KEY) || 'null');
      if (cached && Date.now() - cached.t < DAY) return cached.d;
    } catch (e) { /* storage unavailable */ }

    const raw = await get('/players/nfl');
    const d = {};
    for (const [id, p] of Object.entries(raw)) {
      if (!p || !p.position) continue;
      const name = p.position === 'DEF'
        ? `${p.first_name || id} ${p.last_name || ''}`.trim()
        : p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
      d[id] = { n: name, p: p.position, t: p.team || 'FA' };
    }
    try { localStorage.setItem(PLAYERS_KEY, JSON.stringify({ t: Date.now(), d })); } catch (e) { /* quota */ }
    return d;
  }

  // Work out which weeks are finished and which (if any) is live.
  function weekWindow(league, state) {
    const s = league.settings || {};
    const start = s.start_week || 1;
    const end = s.playoff_week_start > 1 ? s.playoff_week_start - 1 : 18;
    const range = (a, b) => { const out = []; for (let w = a; w <= b; w++) out.push(w); return out; };

    const pastSeason = Number(league.season) < Number(state.season);
    if (pastSeason || league.status === 'complete' || state.season_type === 'post' || state.season_type === 'off') {
      return { completed: range(start, end), live: null };
    }
    if (state.season_type !== 'regular' || league.status === 'pre_draft' || league.status === 'drafting') {
      return { completed: [], live: null };
    }
    const lastDone = Math.min(state.week - 1, end);
    return {
      completed: range(start, lastDone),
      live: state.week >= start && state.week <= end ? state.week : null,
    };
  }

  async function loadLeague(leagueId) {
    const [state, league] = await Promise.all([get('/state/nfl'), get(`/league/${leagueId}`)]);
    if (!league) throw new Error(`No league found with ID ${leagueId}. Check the number in your Sleeper league URL${(window.COUP_CONFIG || {}).leagueId ? ' and in config.js' : ''}.`);

    const [users, rosters, playerDb] = await Promise.all([
      get(`/league/${leagueId}/users`),
      get(`/league/${leagueId}/rosters`),
      players().catch(() => ({})),
    ]);

    const win = weekWindow(league, state);
    const weeks = win.live ? [...win.completed, win.live] : win.completed;
    const matchups = {};
    const transactions = {};
    await Promise.all(weeks.map(async (w) => {
      const [m, t] = await Promise.all([
        get(`/league/${leagueId}/matchups/${w}`).catch(() => []),
        get(`/league/${leagueId}/transactions/${w}`).catch(() => []),
      ]);
      matchups[w] = m || [];
      transactions[w] = t || [];
    }));

    const liveCtx = win.live ? await liveContext(league.season, win.live) : null;
    return { state, league, users, rosters, matchups, transactions, players: playerDb, completed: win.completed, live: win.live, liveCtx };
  }

  // Refresh just the live week's scores without refetching everything.
  async function loadLive(leagueId, week) {
    return (await get(`/league/${leagueId}/matchups/${week}`)) || [];
  }

  // ── Live-week context: projections, game status, game clock ──
  // Projections and schedule come from Sleeper's (undocumented) app endpoints on api.sleeper.com.
  // The game clock comes from ESPN's public scoreboard, since Sleeper doesn't expose it.
  const APP = 'https://api.sleeper.com';
  const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
  const ESPN_TO_SLEEPER = { WSH: 'WAS' };
  const projCache = {};

  async function projections(season, week) {
    const key = `${season}-${week}`;
    const hit = projCache[key];
    if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.d; // projections move on injury news
    const qs = POSITIONS.map((p) => `position%5B%5D=${p}`).join('&');
    const res = await fetch(`${APP}/projections/nfl/${season}/${week}?season_type=regular&${qs}`);
    if (!res.ok) throw new Error(`Projections unavailable (${res.status})`);
    const d = {};
    for (const p of await res.json()) {
      if (!p || !p.player_id) continue;
      d[p.player_id] = { stats: p.stats || {}, team: p.team || null, inj: (p.player && p.player.injury_status) || null };
    }
    projCache[key] = { t: Date.now(), d };
    return d;
  }

  async function sleeperGames(season, week) {
    const res = await fetch(`${APP}/schedule/nfl/regular/${season}`);
    if (!res.ok) return {};
    const map = { pre_game: 'pre', in_progress: 'in', complete: 'post' };
    const games = {};
    for (const g of await res.json()) {
      if (g.week !== week) continue;
      const state = map[g.status] || 'pre';
      games[g.home] = { state };
      games[g.away] = { state };
    }
    return games;
  }

  async function espnClock(season, week) {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`);
    if (!res.ok) return {};
    const out = {};
    for (const e of (await res.json()).events || []) {
      const st = e.status || {};
      const state = st.type && st.type.state; // pre | in | post
      const period = st.period || 0;
      const clock = +st.clock || 0;
      // Share of regulation left. Overtime counts as nearly over.
      const frac = state === 'post' ? 0 : state === 'pre' ? 1 : period > 4 ? 0.05 : Math.min(1, Math.max(0, ((4 - period) * 900 + clock) / 3600));
      for (const c of (e.competitions && e.competitions[0] && e.competitions[0].competitors) || []) {
        const abbr = c.team && c.team.abbreviation;
        if (abbr) out[ESPN_TO_SLEEPER[abbr] || abbr] = { state, frac, label: st.type && st.type.shortDetail };
      }
    }
    return out;
  }

  async function liveContext(season, week) {
    const [proj, sched, clock] = await Promise.all([
      projections(season, week).catch(() => null),
      sleeperGames(season, week).catch(() => ({})),
      espnClock(season, week).catch(() => ({})),
    ]);
    const games = {};
    for (const t of new Set([...Object.keys(sched), ...Object.keys(clock)])) {
      const s = sched[t], c = clock[t];
      const state = (c && c.state) || (s && s.state) || 'pre';
      const frac = c && c.state === state ? c.frac : state === 'post' ? 0 : state === 'pre' ? 1 : 0.5;
      games[t] = { state, frac, label: c && c.label };
    }
    return { proj, games, fetched: Date.now() };
  }

  async function findLeagues(username) {
    const user = await get(`/user/${encodeURIComponent(username.trim())}`);
    if (!user) throw new Error(`No Sleeper user named “${username}”.`);
    const state = await get('/state/nfl');
    const season = state.league_season || state.season;
    const leagues = (await get(`/user/${user.user_id}/leagues/nfl/${season}`)) || [];
    return { user, leagues };
  }

  G.api = { loadLeague, loadLive, liveContext, findLeagues };
})();

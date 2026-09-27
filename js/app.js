// Rendering and interaction.
(function () {
  const G = window.G;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  // A league ID in config.js pins the site to that league.
  const CONFIG = window.COUP_CONFIG || {};
  const PINNED = String(CONFIG.leagueId || '').trim().match(/\d{6,}/);
  const PINNED_ID = PINNED ? PINNED[0] : null;

  let raw = null;
  let M = null;
  let leagueId = null;
  let selectedWeek = null;
  let refreshTimer = null;

  // ── Pieces ─────────────────────────────────
  function guillotineSVG(id = 'g-main') {
    return `
    <svg class="guillotine" id="${id}" viewBox="0 0 200 330" role="img" aria-label="A guillotine">
      <defs>
        <linearGradient id="${id}-wood" x1="0" x2="1"><stop offset="0" stop-color="#5a3a2a"/><stop offset="0.5" stop-color="#76503a"/><stop offset="1" stop-color="#4a2f22"/></linearGradient>
        <linearGradient id="${id}-steel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e3e8ee"/><stop offset="0.55" stop-color="#b8c2cf"/><stop offset="1" stop-color="#7d8898"/></linearGradient>
      </defs>
      <rect x="44" y="18" width="12" height="284" fill="url(#${id}-wood)"/>
      <rect x="144" y="18" width="12" height="284" fill="url(#${id}-wood)"/>
      <rect x="34" y="8" width="132" height="16" rx="2" fill="#6a4532"/>
      <rect x="34" y="8" width="132" height="4" fill="#8a6048"/>
      <line x1="100" y1="24" x2="100" y2="34" stroke="#a8a393" stroke-width="2"/>
      <g class="blade">
        <rect x="58" y="30" width="84" height="12" fill="#3b2a22"/>
        <polygon points="58,42 142,42 142,66 58,98" fill="url(#${id}-steel)"/>
        <polygon points="58,92 142,60 142,66 58,98" fill="#f4f7fa"/>
      </g>
      <rect x="56" y="196" width="88" height="16" fill="#6a4532"/>
      <rect x="56" y="212" width="88" height="16" fill="#5a3a2a"/>
      <circle cx="100" cy="212" r="11" fill="#151a25"/>
      <rect x="20" y="300" width="160" height="12" rx="2" fill="#4a2f22"/>
      <rect x="10" y="312" width="180" height="10" rx="2" fill="#3a2419"/>
      <path d="M118 272 h54 l-6 28 h-42 z" fill="#6b5a3a"/>
      <path d="M118 272 h54" stroke="#8d7a50" stroke-width="3"/>
      <path d="M126 280 l4 18 M138 280 l2 18 M150 280 l0 18 M162 280 l-3 18" stroke="#4e4028" stroke-width="1.5"/>
    </svg>`;
  }

  const HUES = [8, 32, 48, 140, 170, 196, 214, 250, 280, 320, 350, 90];
  function avatar(rid, cls = '') {
    const t = M.teams[rid];
    const dead = t.alive ? '' : ' dead';
    const hue = HUES[rid % HUES.length];
    const initials = t.name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
    const fallback = (hidden) => `<span class="avatar${dead} ${cls}" style="background:hsl(${hue} 35% 68%)" aria-hidden="true"${hidden ? ' hidden' : ''}>${esc(initials)}</span>`;
    if (!t.avatar) return fallback(false);
    // If the image fails, swap in the initials disc.
    return `<span class="av"><img class="avatar${dead} ${cls}" src="${esc(t.avatar)}" alt="" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false">${fallback(true)}</span>`;
  }
  const tname = (rid) => esc(M.teams[rid].name);
  const fmt = (n) => (+n).toFixed(2);

  // ── The Scaffold ───────────────────────────
  const pct = (x) => (x == null ? '—' : x > 0.995 ? '>99%' : x >= 0.01 ? `${Math.round(x * 100)}%` : x > 0 ? '<1%' : '0%');
  const leftLabel = (r) => {
    const bits = [];
    if (r.playing) bits.push(`${r.playing} playing`);
    if (r.toPlay) bits.push(`${r.toPlay} yet to play`);
    return bits.length ? bits.join(' · ') : 'All done';
  };

  function renderScaffold() {
    const el = $('#scaffold');
    const total = M.allRids.length;
    const survivors = M.alive.size;
    const lastChop = M.chops[M.chops.length - 1];
    const live = M.live && (M.live.started || M.live.hasProj) && M.live.rows.length > 1 ? M.live : null;

    let hero;
    if (!M.drafted) {
      hero = heroBlock('Before the Revolution', 'The draft hasn’t happened yet.', 'Awaiting the draft', '', false);
    } else if (live) {
      const rows = live.rows;
      const low = rows[rows.length - 1];
      const next = rows[rows.length - 2];
      const k = live.hasProj ? 'proj' : 'pts';
      hero = heroBlock(
        `Week ${live.week} · ${live.started ? 'Games in progress' : 'Before kickoff'}`,
        live.hasProj ? 'Projected for the chop' : 'Kneeling at the lunette right now',
        M.teams[low.rid].name,
        (live.hasProj ? `<span>Projected <b class="num">${fmt(low.proj)}</b></span><span>Now <b class="num">${fmt(low.pts)}</b></span><span>Chop odds <b class="num">${pct(low.odds)}</b></span>` : `<span><b class="num">${fmt(low.pts)}</b> pts</span>`)
        + `<span><b class="num">${fmt(next[k] - low[k])}</b> ${live.hasProj ? 'projected ' : ''}behind ${tname(next.rid)}</span>`
        + (live.hasProj ? `<span>${esc(leftLabel(low))}</span>` : ''),
        true,
      );
    } else if (lastChop) {
      hero = heroBlock(
        `Week ${lastChop.week} · Executed`,
        'Most recently chopped',
        M.teams[lastChop.rid].name,
        `<span><b class="num">${fmt(lastChop.pts)}</b> pts</span>
         ${lastChop.savior != null ? `<span><b class="num">${fmt(lastChop.margin)}</b> short of ${tname(lastChop.savior)}</span>` : ''}`,
        false, true,
      );
    } else {
      hero = heroBlock(M.live ? `Week ${M.live.week}` : 'Preseason', 'The blade is sharpened and waiting.', 'No heads yet', '', false);
    }

    const treasury = M.allRids.filter((r) => M.alive.has(r)).reduce((s, r) => s + Math.max(0, M.budget - (M.ledger[r].faab || 0)), 0);
    const tally = `
      <div class="tally">
        <div><span class="eyebrow">Still breathing</span><span class="big">${survivors}<small> of ${total}</small></span></div>
        <div><span class="eyebrow">Heads rolled</span><span class="big">${M.chops.length}</span></div>
        <div><span class="eyebrow">Next chop</span><span class="big">${M.live ? `Wk ${M.live.week}` : '—'}<small>${M.live ? ' after MNF' : ''}</small></span></div>
        <div><span class="eyebrow">FAAB among the living</span><span class="big">$${treasury}</span></div>
      </div>`;

    let board = '';
    if (live && live.hasProj) board = liveBoard(live);
    else {
      const bw = live ? live : (M.scoredWeeks.length ? { week: M.scoredWeeks[M.scoredWeeks.length - 1], rows: M.weekly[M.scoredWeeks[M.scoredWeeks.length - 1]].rows } : null);
      if (bw) board = finalBoard(bw, !!live);
    }

    el.innerHTML = hero + tally + board;
    const drop = $('#drop-blade');
    if (drop) drop.addEventListener('click', () => {
      const g = $('#g-main');
      g.classList.toggle('dropped');
      drop.textContent = g.classList.contains('dropped') ? 'Raise the blade' : 'Release the blade';
    });
    const rf = $('#refresh');
    if (rf) rf.addEventListener('click', refreshLive);
  }

  function refreshTools() {
    if (!leagueId) return '';
    const t = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `<div class="board-tools"><span id="updated">Updated ${t}</span><button class="btn" type="button" id="refresh">Refresh scores</button></div>`;
  }

  // Live week with projections: ranked by projected final score.
  function liveBoard(live) {
    const rows = live.rows;
    const max = Math.max(...rows.map((r) => Math.max(r.proj, r.pts)), 1);
    const STATE = { done: 'Final', live: 'Playing', pre: 'Yet to play', bye: 'Bye', empty: 'Empty slot' };
    const items = rows.map((r, i) => {
      const doomed = i === rows.length - 1;
      const warm = !doomed && i >= rows.length - 3;
      const cush = doomed ? `−${fmt(rows[i - 1].proj - r.proj)}` : `+${fmt(r.cushion)}`;
      const line = doomed ? `<li class="blade-line" aria-hidden="true">the blade</li>` : '';
      const oddsTint = r.odds ? `background: color-mix(in oklab, var(--blood) ${Math.round(10 + r.odds * 80)}%, transparent)` : '';
      const slots = r.slots.map((sl) => `
        <tr class="st-${sl.state}">
          <td>${sl.pid && sl.pid !== '0' ? esc(M.pname(sl.pid)) : '<i>Empty</i>'} <span class="sub">${esc(M.pos(sl.pid) || '')} ${esc(M.pteam(sl.pid))}</span></td>
          <td>${STATE[sl.state]}</td>
          <td class="n">${fmt(sl.actual)}</td>
          <td class="n">${sl.state === 'pre' || sl.state === 'live' ? `+${fmt(sl.rem)}` : '—'}</td>
          <td class="n">${fmt(sl.actual + sl.rem)}</td>
        </tr>`).join('');
      return `${line}
        <li class="lrow${doomed ? ' doomed' : ''}${warm ? ' warm' : ''}">
          <details>
            <summary class="brow brow-live">
              <span class="rk">${r.rank}</span>
              ${avatar(r.rid)}
              <span class="who"><b>${tname(r.rid)}</b><span>${esc(leftLabel(r))}</span></span>
              <span class="bar dual" title="Now ${fmt(r.pts)}, projected ${fmt(r.proj)}"><i class="ghost" style="width:${Math.max(2, (Math.max(0, r.proj) / max) * 100)}%"></i><i style="width:${Math.max(0, (Math.max(0, r.pts) / max) * 100)}%"></i></span>
              <span class="now">${fmt(r.pts)}</span>
              <span class="pts">${fmt(r.proj)}</span>
              <span class="odds" style="${oddsTint}">${pct(r.odds)}</span>
            </summary>
            <div class="slot-wrap">
              <table class="slots">
                <thead><tr><th>Starter</th><th>Game</th><th class="n">Now</th><th class="n">Still to come</th><th class="n">Projected</th></tr></thead>
                <tbody>${slots}</tbody>
                <tfoot><tr><td colspan="2">Cushion above the projected chop line: ${cush}</td><td class="n">${fmt(r.pts)}</td><td class="n">+${fmt(r.proj - r.pts)}</td><td class="n">${fmt(r.proj)}</td></tr></tfoot>
              </table>
            </div>
          </details>
        </li>`;
    }).join('');
    return `
      <div class="board-wrap">
        <div class="sec-head">
          <div>
            <span class="eyebrow">Projected · Week ${live.week}</span>
            <h2>The Tumbril Queue</h2>
            <p>Survivors ranked by projected final score. The projection is points already scored, plus Sleeper’s projection for starters who haven’t played yet, plus the unplayed share of the projection for games in progress. It uses your league’s scoring settings, and players ruled out count as zero. Chop odds come from 10,000 simulations of the rest of the week. Tap a team to see each starter’s numbers.</p>
          </div>
          ${refreshTools()}
        </div>
        <div class="brow brow-live board-head" aria-hidden="true"><span></span><span class="av-slot"></span><span>Team</span><span class="bar"></span><span class="now">Now</span><span class="pts">Proj</span><span class="odds">Chop odds</span></div>
        <ol class="board">${items}</ol>
      </div>`;
  }

  // Completed week (or live week when projections are unavailable).
  function finalBoard(bw, isLive) {
    const rows = bw.rows;
    const max = Math.max(...rows.map((r) => r.pts), 1);
    const items = rows.map((r, i) => {
      const doomed = i === rows.length - 1;
      const warm = !doomed && i >= rows.length - 3;
      const cush = doomed ? (rows[i - 1] ? `−${fmt(rows[i - 1].pts - r.pts)}` : '') : `+${fmt(r.cushion)}`;
      const line = doomed && rows.length > 1 ? `<li class="blade-line" aria-hidden="true">the blade</li>` : '';
      return `${line}
        <li class="brow${doomed ? ' doomed' : ''}${warm ? ' warm' : ''}">
          <span class="rk">${r.rank}</span>
          ${avatar(r.rid)}
          <span class="who"><b>${tname(r.rid)}</b><span>${esc(M.teams[r.rid].manager)}</span></span>
          <span class="bar"><i style="width:${Math.max(2, (Math.max(0, r.pts) / max) * 100)}%"></i></span>
          <span class="pts">${fmt(r.pts)}</span>
          <span class="cush" title="${doomed ? 'Points needed to escape' : 'Cushion above the blade'}">${cush}</span>
        </li>`;
    }).join('');
    return `
      <div class="board-wrap">
        <div class="sec-head">
          <div>
            <span class="eyebrow">${isLive ? 'Live' : 'Final'} · Week ${bw.week}</span>
            <h2>${isLive ? 'The Tumbril Queue' : 'How the Week Ended'}</h2>
            <p>${isLive ? 'Projections couldn’t be loaded, so this is sorted by current points only.' : 'Final scores. The team below the line was chopped.'} The right-hand column is the cushion above the blade.</p>
          </div>
          ${isLive ? refreshTools() : ''}
        </div>
        <ol class="board">${items}</ol>
      </div>`;
  }

  function heroBlock(eyebrow, kicker, name, meta, canDrop, dropped) {
    return `
      <div class="hero">
        <div class="hero-art">${guillotineSVG('g-main').replace('class="guillotine"', `class="guillotine${dropped ? ' dropped' : ''}"`)}</div>
        <div class="hero-copy">
          <span class="eyebrow">${esc(eyebrow)}</span>
          <p class="hero-kicker">${esc(kicker)}</p>
          <h1 class="hero-name">${esc(name)}</h1>
          ${meta ? `<div class="hero-meta">${meta}</div>` : ''}
          ${canDrop ? `<div class="hero-actions"><button class="btn btn-blood" type="button" id="drop-blade">Release the blade</button><a class="btn btn-ghost" href="#honours" style="text-decoration:none">See this season’s awards</a></div>` : ''}
        </div>
      </div>`;
  }

  // ── Glory & Shame ──────────────────────────
  function awardCard(id, a, season) {
    const def = G.AWARDS[id];
    const fig = G.FIGURES[def.fig];
    const podium = season && a.podium && a.podium.length > 1
      ? `<ol class="podium">${a.podium.map((p, i) => `<li><span>${i + 1}. ${tname(p.rid)}</span><span>${esc(p.value)}</span></li>`).join('')}</ol>`
      : '';
    return `
      <article class="award ${season ? def.pol : ''}">
        <span class="eyebrow">${/^the /i.test(fig.name) ? '' : 'The '}${esc(fig.name)} Award</span>
        <h4>${esc(def.title)}</h4>
        <div class="val"><b>${esc(a.value)}</b><span>${esc(a.unit || '')}</span></div>
        <div class="winner">${avatar(a.rid)}<b>${tname(a.rid)}</b></div>
        <p class="detail">${esc(a.detail || def.blurb)}</p>
        ${podium}
        <details><summary>Why ${esc(fig.name)}?</summary><p>${esc(def.blurb)}</p><p>${esc(fig.fact)}</p>${fig.quote ? `<p><i>“${esc(fig.quote)}”</i></p>` : ''}</details>
      </article>`;
  }

  function renderHonours() {
    const el = $('#honours');
    if (!M.scoredWeeks.length) {
      el.innerHTML = `<div class="empty"><b>The tribunal has not yet sat.</b>Awards appear once the first week is final.</div>`;
      return;
    }
    if (!selectedWeek || !M.weeklyAwards[selectedWeek]) selectedWeek = M.scoredWeeks[M.scoredWeeks.length - 1];
    const a = M.weeklyAwards[selectedWeek];
    const col = (pol) => G.WEEKLY_AWARD_ORDER.filter((id) => a[id] && G.AWARDS[id].pol === pol).map((id) => awardCard(id, a[id])).join('');
    const seasonCards = G.SEASON_AWARD_ORDER.filter((id) => M.seasonAwards[id]).map((id) => awardCard(id, M.seasonAwards[id], true)).join('');

    el.innerHTML = `
      <div>
        <div class="sec-head">
          <div>
            <span class="eyebrow">Weekly verdicts</span>
            <h2>The Tribunal’s Verdicts</h2>
            <p>Glory for the ones who dodged the blade in style. Shame for the ones who deserved it. Each award is named for someone history put on the block, or who got off it.</p>
          </div>
          <div class="week-picker" role="group" aria-label="Choose week">
            ${M.scoredWeeks.map((w) => `<button type="button" data-week="${w}" aria-pressed="${w === selectedWeek}">Wk ${w}</button>`).join('')}
          </div>
        </div>
        <div class="verdicts">
          <div class="verdict-col glory"><h3>Glory <small>the honoured</small></h3>${col('glory') || '<p class="hint">No honours this week.</p>'}</div>
          <div class="verdict-col shame"><h3>Shame <small>the condemned</small></h3>${col('shame') || '<p class="hint">No shame this week, somehow.</p>'}</div>
        </div>
      </div>
      <div>
        <div class="sec-head">
          <div>
            <span class="eyebrow">Season to date · through week ${M.scoredWeeks[M.scoredWeeks.length - 1]}</span>
            <h2>The Long Memory of the Revolution</h2>
            <p>Season-long honours and shames. Top three shown where there’s a contest.</p>
          </div>
        </div>
        <div class="season-grid">${seasonCards}</div>
      </div>`;
    $$('.week-picker button', el).forEach((b) => b.addEventListener('click', () => { selectedWeek = +b.dataset.week; renderHonours(); }));
  }

  // ── Graveyard ──────────────────────────────
  function renderGraveyard() {
    const el = $('#graveyard');
    const head = `
      <div class="sec-head"><div>
        <span class="eyebrow">${M.chops.length} ${M.chops.length === 1 ? 'head' : 'heads'} in the basket</span>
        <h2>The Graveyard</h2>
        <p>Every team the blade has claimed, newest first. Each one goes to the scaffold in the manner of a famous predecessor.</p>
      </div></div>`;
    if (!M.chops.length) {
      el.innerHTML = head + `<div class="empty"><b>No heads have rolled. Yet.</b>The first chop comes after week ${M.live ? M.live.week : 1} goes final.</div>`;
      return;
    }
    const stones = M.chops.slice().reverse().map((c) => {
      const t = M.teams[c.rid];
      const fig = G.FIGURES[c.fig];
      const beard = c.row && c.row.top ? `<p class="rip">Their best starter, ${esc(M.pname(c.row.top.pid))}, scored ${fmt(c.row.top.pts)} and did nothing wrong.</p>` : '';
      return `
        <article class="stone">
          <span class="ord">The ${ordinal(c.order)} head · Week ${c.week}</span>
          ${c.unofficial ? '<span class="tag fail">Pending: Sleeper hasn’t made this chop official yet</span>' : ''}
          <h3>${esc(t.name)}</h3>
          <span class="mgr">${esc(t.manager)}</span>
          <span class="score">${fmt(c.pts)} <small>pts</small></span>
          ${c.savior != null ? `<p class="rip">${fmt(c.margin)} points short of ${tname(c.savior)}.</p>` : `<p class="rip">Removed by the tribunal.</p>`}
          ${beard}
          <div class="manner">Went to the scaffold like <b>${esc(fig.name)}</b>, ${esc(fig.date)}.
            ${fig.quote ? `<blockquote>“${esc(fig.quote)}”</blockquote>` : ''}
          </div>
        </article>`;
    }).join('');
    el.innerHTML = head + `<div class="stones">${stones}</div>`;
  }

  // ── Blood Ledger ───────────────────────────
  function renderLedger() {
    const el = $('#ledger');
    const weeks = M.scoredWeeks;
    const ordered = M.allRids.slice().sort((a, b) => {
      const ta = M.teams[a], tb = M.teams[b];
      if (ta.alive !== tb.alive) return ta.alive ? -1 : 1;
      if (!ta.alive) return tb.chop.week - ta.chop.week || tb.chop.order - ta.chop.order;
      return M.ledger[b].total - M.ledger[a].total;
    });
    const heat = (rank, n) => {
      const p = n > 1 ? (rank - 1) / (n - 1) : 0; // 0 = top, 1 = bottom
      const pct = Math.round(8 + p * p * 62);
      return `background: color-mix(in oklab, var(--blood) ${pct}%, var(--night-2))`;
    };
    const rowsHtml = ordered.map((rid) => {
      const t = M.teams[rid];
      const L = M.ledger[rid];
      const cells = weeks.map((w) => {
        const wk = M.weekly[w];
        const r = wk.rows.find((x) => x.rid === rid);
        if (!r) return `<td class="heat gone" aria-label="gone">·</td>`;
        if (r.chopped) return `<td class="heat cut" title="Chopped in week ${w} with ${fmt(r.pts)}">†</td>`;
        return `<td class="heat" style="${heat(r.rank, wk.rows.length)}" title="${fmt(r.pts)} pts, ${ordinal(r.rank)} of ${wk.rows.length}">${r.rank}</td>`;
      }).join('');
      return `
        <tr class="${t.alive ? '' : 'dead'}">
          <td><span class="team-cell">${avatar(rid)}<b title="${tname(rid)}">${tname(rid)}</b></span></td>
          ${cells}
          <td>${fmt(L.total)}</td><td>${fmt(L.avg)}</td><td>${fmt(L.best)}</td><td>${fmt(L.worst)}</td>
          <td>${L.bottom3}</td><td>${t.alive || L.weeks > 1 ? (isNaN(L.cushion) ? '—' : fmt(L.cushion)) : '—'}</td>
          <td>${L.won}/${L.placed}</td>
          <td>$${Math.max(0, M.budget - L.faab)}</td>
        </tr>`;
    }).join('');
    el.innerHTML = `
      <div>
        <div class="sec-head"><div>
          <span class="eyebrow">Weekly rank among survivors</span>
          <h2>The Blood Ledger</h2>
          <p>Each cell is where a team finished that week among the teams still alive. The redder the cell, the closer to the blade. † marks the week a team was chopped.</p>
        </div></div>
        <div class="legend">
          <span><i style="background: color-mix(in oklab, var(--blood) 8%, var(--night-2))"></i>Top of the week</span>
          <span><i style="background: color-mix(in oklab, var(--blood) 70%, var(--night-2))"></i>Bottom, survived</span>
          <span><i style="background: var(--blood)"></i>Chopped</span>
        </div>
        <div class="table-scroll" style="margin-top:12px">
          <table class="ledger">
            <thead><tr>
              <th>Team</th>${weeks.map((w) => `<th>W${w}</th>`).join('')}
              <th>Total</th><th>Avg</th><th>Best</th><th>Worst</th><th title="Bottom-three finishes survived">Bot 3</th><th title="Average points above the chopped team">Cushion</th><th title="Waiver claims won out of bids placed">Bids won</th><th>FAAB left</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ── The Looting ────────────────────────────
  let lootTeam = '';
  const REASON_LABEL = { won: 'Won', outbid: 'Outbid', roster: 'Roster full', budget: 'Not enough FAAB', other: 'Failed' };

  function bidSheet(sh) {
    const w = sh.winner;
    const header = `
      <div class="sheet-head">
        <div class="what">
          <b>${esc(M.pname(sh.pid))}</b> <span class="sub">${esc(M.pos(sh.pid) || '')} ${esc(M.pteam(sh.pid))}</span>
          ${sh.looted ? `<span class="tag corpse">from the corpse of ${tname(sh.looted.rid)}</span>` : ''}
          <div class="sub">${sh.teams} team${sh.teams === 1 ? '' : 's'} bid${sh.claims.length > sh.teams ? ` (${sh.claims.length} claims)` : ''}${w ? (sh.runnerUp ? (sh.overpay === 0 ? ' · won on a tiebreak' : ` · won by $${sh.overpay} over the next bid`) : ' · no rival bids') : ' · unclaimed'}</div>
        </div>
        <span class="bid">${w ? `$${w.bid}` : '—'}</span>
      </div>`;
    const rows = sh.bids.map((b) => {
      const mine = lootTeam && String(b.rid) === lootTeam;
      let tag;
      if (b.reason === 'won') tag = '<span class="tag won">Won</span>';
      else if (b.reason === 'outbid') tag = `<span class="tag lost">${b.short === 0 ? 'Lost tiebreak' : b.short != null ? `Outbid by $${b.short}` : 'Outbid'}</span>`;
      else tag = `<span class="tag fail" title="${esc(b.note)}">${REASON_LABEL[b.reason]}</span>`;
      return `
        <li class="bidrow${mine ? ' mine' : ''}${b.reason === 'won' ? ' is-won' : ''}">
          ${avatar(b.rid)}
          <span class="who"><b>${tname(b.rid)}</b>${b.drops.length || b.claims > 1 ? `<span>${[b.claims > 1 ? `${b.claims} claims` : '', b.drops.length ? `${b.reason === 'won' ? 'dropped' : 'would drop'} ${b.drops.map((p) => esc(M.pname(p))).join(', ')}` : ''].filter(Boolean).join(' · ')}</span>` : ''}</span>
          ${tag}
          <span class="amt">$${b.bid}</span>
        </li>`;
    }).join('');
    return `<article class="sheet">${header}<ol class="bids">${rows}</ol></article>`;
  }

  function renderLooting() {
    const el = $('#looting');
    const f = lootTeam;
    const sheets = M.sheets.filter((sh) => !f || sh.bids.some((b) => String(b.rid) === f));
    const fas = M.moves.filter((m) => m.type === 'free_agent' && (!f || String(m.rid) === f));
    const teamsSorted = M.allRids.slice().sort((a, b) => M.teams[a].name.localeCompare(M.teams[b].name));

    const allBids = M.sheets.reduce((n, sh) => n + sh.bids.length, 0);
    const wins = M.sheets.filter((sh) => sh.winner).length;
    const contested = M.sheets.filter((sh) => sh.teams >= 2).length;
    const hottest = M.sheets.slice().sort((a, b) => b.teams - a.teams)[0];
    let summary;
    if (f) {
      const L = M.ledger[f];
      summary = `
        <div class="tally">
          <div><span class="eyebrow">Bids placed</span><span class="big">${L.placed}</span></div>
          <div><span class="eyebrow">Claims won</span><span class="big">${L.won}</span></div>
          <div><span class="eyebrow">Bids lost</span><span class="big">${L.outbid + L.roster}</span><span class="hint">${L.outbid} outbid · ${L.roster} roster full</span></div>
          <div><span class="eyebrow">FAAB spent</span><span class="big">$${L.faab}</span><span class="hint">$${L.lostDollars} bid on players they lost</span></div>
        </div>`;
    } else {
      summary = `
        <div class="tally">
          <div><span class="eyebrow">Bids placed</span><span class="big">${allBids}</span></div>
          <div><span class="eyebrow">Claims won</span><span class="big">${wins}</span></div>
          <div><span class="eyebrow">Contested players</span><span class="big">${contested}</span></div>
          <div><span class="eyebrow">Most wanted</span><span class="big">${hottest ? `${hottest.teams}<small> teams</small>` : '—'}</span>${hottest ? `<span class="hint">${esc(M.pname(hottest.pid))}</span>` : ''}</div>
        </div>`;
    }

    const legs = [...new Set([...sheets.map((sh) => sh.leg), ...fas.map((m) => m.leg)])].sort((a, b) => b - a);
    const weeks = legs.map((leg) => {
      const ws = sheets.filter((sh) => sh.leg === leg);
      const contestedHere = ws.filter((sh) => sh.bids.length > 1 || !sh.winner || sh.claims.length > 1);
      const simple = ws.filter((sh) => sh.bids.length === 1 && sh.winner && sh.claims.length === 1);
      const faHere = fas.filter((m) => m.leg === leg);
      const spent = ws.reduce((n, sh) => n + (sh.winner ? sh.winner.bid : 0), 0);
      return `
        <div class="loot-week" id="loot-wk-${leg}">
          <h3>Week ${leg} <span class="hint">· ${ws.reduce((n, sh) => n + sh.bids.length, 0)} bids · $${spent} spent</span></h3>
          ${contestedHere.length ? `<div class="sheets">${contestedHere.map(bidSheet).join('')}</div>` : ''}
          ${simple.length ? `
            <h4 class="loot-sub">Uncontested claims</h4>
            <ol class="loot-list">${simple.map((sh) => `
              <li class="loot">${avatar(sh.winner.rid)}
                <div class="what"><b>${esc(M.pname(sh.pid))}</b> <span class="sub">${esc(M.pos(sh.pid) || '')} ${esc(M.pteam(sh.pid))}</span>
                  ${sh.looted ? `<span class="tag corpse">from the corpse of ${tname(sh.looted.rid)}</span>` : ''}
                  <div class="sub">to ${tname(sh.winner.rid)}${sh.winner.drops.length ? ` · dropped ${sh.winner.drops.map((p) => esc(M.pname(p))).join(', ')}` : ''}</div></div>
                <span class="bid">$${sh.winner.bid}</span></li>`).join('')}</ol>` : ''}
          ${faHere.length ? `
            <h4 class="loot-sub">Free agent pickups</h4>
            <ol class="loot-list">${faHere.map((m) => `
              <li class="loot">${avatar(m.rid)}
                <div class="what"><b>${esc(M.pname(m.pid))}</b> <span class="sub">${esc(M.pos(m.pid) || '')} ${esc(M.pteam(m.pid))}</span>
                  ${m.looted ? `<span class="tag corpse">from the corpse of ${tname(m.looted.rid)}</span>` : ''}
                  <div class="sub">to ${tname(m.rid)}${m.drops.length ? ` · dropped ${m.drops.map((p) => esc(M.pname(p))).join(', ')}` : ''}</div></div>
                <span class="bid"></span></li>`).join('')}</ol>` : ''}
        </div>`;
    }).join('');

    el.innerHTML = `
      <div>
        <div class="sec-head">
          <div>
            <span class="eyebrow">Waivers &amp; free agents</span>
            <h2>The Looting</h2>
            <p>Every waiver bid, won and lost. When a team is chopped, its whole roster goes to waivers, and by old custom the executioner kept the belongings of the condemned. <span class="tag corpse">from the corpse</span> marks a player who came off a chopped roster.</p>
          </div>
          <div class="loot-filter">
            <label for="loot-team">Bidding history for</label>
            <select id="loot-team">
              <option value="">All teams</option>
              ${teamsSorted.map((rid) => `<option value="${rid}"${String(rid) === f ? ' selected' : ''}>${tname(rid)}</option>`).join('')}
            </select>
          </div>
        </div>
        ${summary}
      </div>
      ${legs.length > 1 ? `<nav class="week-jump" aria-label="Jump to week"><span>Jump to</span>${legs.map((leg) => `<button type="button" data-jump="${leg}">Wk ${leg}</button>`).join('')}</nav>` : ''}
      ${weeks ? `<div class="loot-weeks">${weeks}</div>` : `<div class="empty"><b>Nothing looted yet.</b>${f ? 'This team hasn’t placed a waiver bid or picked up a free agent.' : 'Waiver claims show up here once they process.'}</div>`}`;
    $('#loot-team', el).addEventListener('change', (e) => { lootTeam = e.target.value; renderLooting(); });
    $$('[data-jump]', el).forEach((b) => b.addEventListener('click', () => {
      const target = $(`#loot-wk-${b.dataset.jump}`);
      if (target) target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }));
  }

  // ── Hall of Heads ──────────────────────────
  function renderHall() {
    const el = $('#hall');
    const named = {};
    for (const [id, def] of Object.entries(G.AWARDS)) (named[def.fig] = named[def.fig] || []).push(def);
    const order = ['marie', 'louis', 'robespierre', 'danton', 'lavoisier', 'dubarry', 'corday', 'anne', 'mary', 'charles', 'more', 'raleigh', 'janegrey', 'denis', 'paine', 'guillotin', 'sanson', 'committee', 'mike', 'horseman', 'necklace', 'assignat', 'varennes', 'conciergerie', 'talleyrand', 'djandoubi'];
    const cards = order.map((k) => {
      const f = G.FIGURES[k];
      const aw = (named[k] || []).map((d) => `<span class="pill ${d.pol}">${esc(d.title)}</span>`).join('');
      return `
        <article class="head">
          <span class="when">${esc(f.date)} · ${esc(f.place)} · ${esc(f.method)}</span>
          <h3>${esc(f.name)}</h3>
          <p>${esc(f.fact)}</p>
          ${f.quote ? `<blockquote>“${esc(f.quote)}”</blockquote>` : ''}
          ${aw ? `<div class="awards-named">${aw}</div>` : ''}
        </article>`;
    }).join('');
    el.innerHTML = `
      <div>
        <div class="sec-head"><div>
          <span class="eyebrow">The namesakes</span>
          <h2>Hall of Heads</h2>
          <p>The people behind the awards: the executed, the executioners, the ones who escaped, and one very determined chicken.</p>
        </div></div>
        <div class="heads">${cards}</div>
      </div>`;
  }

  // ── Frame ──────────────────────────────────
  function renderAll() {
    $('#league-name').textContent = `${M.league.name} · ${M.league.season}`;
    document.title = `Heads Will Roll · ${M.league.name}`;
    const chip = $('#week-chip');
    if (M.live) {
      chip.hidden = false;
      chip.innerHTML = M.live.started ? `<span class="pulse"></span>Week ${M.live.week} live` : `Week ${M.live.week}`;
    } else if (M.scoredWeeks.length) {
      chip.hidden = false;
      chip.textContent = `Through week ${M.scoredWeeks[M.scoredWeeks.length - 1]}`;
    } else chip.hidden = true;
    const banner = $('#demo-banner');
    if (banner) banner.hidden = !raw.demo;
    renderScaffold(); renderHonours(); renderGraveyard(); renderLedger(); renderLooting(); renderHall();
    showTab();
  }

  function showTab() {
    const tab = (location.hash || '#scaffold').slice(1);
    const valid = $$('.view').some((v) => v.dataset.view === tab) ? tab : 'scaffold';
    $$('.view').forEach((v) => { v.hidden = v.dataset.view !== valid; });
    $$('.tabs a').forEach((a) => { if (a.dataset.tab === valid) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  }

  function loadingView(msg) {
    $('#scaffold').innerHTML = `<div class="loading">${guillotineSVG('g-load').replace('class="guillotine"', 'class="guillotine" style="width:80px"')}<p>${esc(msg)}</p></div>`;
    $$('.view').forEach((v) => { v.hidden = v.dataset.view !== 'scaffold'; });
  }

  async function loadLeague(id) {
    clearInterval(refreshTimer);
    loadingView('Fetching your league from Sleeper…');
    try {
      raw = await G.api.loadLeague(id);
      M = G.compute(raw);
      leagueId = id;
      if (!PINNED_ID) {
        store.set('gl_league', id);
        const url = new URL(location.href);
        url.searchParams.set('league', id);
        history.replaceState(null, '', url);
      }
      selectedWeek = null;
      renderAll();
      if (M.live) refreshTimer = setInterval(() => { if (!document.hidden) refreshLive(); }, 90 * 1000);
    } catch (err) {
      const actions = PINNED_ID
        ? `<button class="btn" type="button" id="err-retry">Try again</button>`
        : `<button class="btn" type="button" data-open-picker>Try another league</button> <button class="btn btn-ghost" type="button" id="err-demo">Show the demo</button>`;
      $('#scaffold').innerHTML = `<div class="empty"><b>The tumbril broke down.</b>${esc(err.message)}<br><br>${actions}</div>`;
      if (PINNED_ID) $('#err-retry').addEventListener('click', () => loadLeague(id));
      else $('#err-demo').addEventListener('click', () => { store.del('gl_league'); loadDemo(); });
    }
  }

  async function refreshLive() {
    if (!M || !M.live || !leagueId) return;
    const btn = $('#refresh');
    if (btn) { btn.disabled = true; btn.textContent = 'Refreshing…'; }
    try {
      const [m, ctx] = await Promise.all([
        G.api.loadLive(leagueId, M.live.week),
        G.api.liveContext(M.league.season, M.live.week),
      ]);
      raw.matchups[M.live.week] = m;
      raw.liveCtx = ctx;
      M = G.compute(raw);
      renderScaffold();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Refresh failed. Try again.'; }
    }
  }

  function loadDemo() {
    clearInterval(refreshTimer);
    leagueId = null;
    raw = G.demoData();
    M = G.compute(raw);
    const url = new URL(location.href);
    url.searchParams.delete('league');
    history.replaceState(null, '', url);
    selectedWeek = null;
    renderAll();
  }

  // ── League picker ──────────────────────────
  const picker = $('#picker');
  function openPicker() {
    $('#picker-error').hidden = true;
    if (typeof picker.showModal === 'function') picker.showModal(); else picker.setAttribute('open', '');
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-open-picker]')) openPicker(); });
  $('#open-picker').addEventListener('click', openPicker);
  $('#use-demo').addEventListener('click', () => { store.del('gl_league'); picker.close(); loadDemo(); });

  $('#form-league').addEventListener('submit', (e) => {
    e.preventDefault();
    const match = $('#league-id').value.match(/\d{6,}/);
    if (!match) { showPickerError('That doesn’t look like a league ID. It should be a long number.'); return; }
    picker.close();
    loadLeague(match[0]);
  });

  $('#form-user').addEventListener('submit', async (e) => {
    e.preventDefault();
    const list = $('#league-list');
    list.innerHTML = '<li class="hint">Searching…</li>';
    $('#picker-error').hidden = true;
    try {
      const { leagues } = await G.api.findLeagues($('#username').value);
      if (!leagues.length) { list.innerHTML = ''; showPickerError('No NFL leagues this season for that user.'); return; }
      list.innerHTML = leagues.map((l) => `<li><button class="btn" type="button" data-league="${esc(l.league_id)}">${esc(l.name)} <span>${esc(l.total_rosters)} teams</span></button></li>`).join('');
      $$('button[data-league]', list).forEach((b) => b.addEventListener('click', () => { picker.close(); loadLeague(b.dataset.league); }));
    } catch (err) {
      list.innerHTML = '';
      showPickerError(err.message);
    }
  });
  function showPickerError(msg) { const p = $('#picker-error'); p.textContent = msg; p.hidden = false; }

  const mast = $('.masthead');
  const setMast = () => document.documentElement.style.setProperty('--mast-h', `${mast.offsetHeight}px`);
  setMast();
  window.addEventListener('resize', setMast);
  if (window.ResizeObserver) new ResizeObserver(setMast).observe(mast);

  window.addEventListener('hashchange', () => { showTab(); window.scrollTo({ top: 0 }); });

  // ── Boot ───────────────────────────────────
  if (PINNED_ID) {
    // Pinned league: no switching, no demo.
    $('#open-picker').remove();
    $('#demo-banner').remove();
    picker.remove();
    loadLeague(PINNED_ID);
  } else {
    const fromUrl = new URLSearchParams(location.search).get('league');
    const saved = fromUrl || store.get('gl_league');
    if (saved) loadLeague(saved); else loadDemo();
  }
})();

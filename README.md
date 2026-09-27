# Heads Will Roll

A tribunal for our Sleeper chopped (guillotine) league. It pulls live data from the public
Sleeper API in the browser, works out who was chopped each week, and hands out weekly and
season-long awards named after famous beheadings (and a few famous escapes).

## Run it locally

```bash
python3 -m http.server 8793
```

Then open http://localhost:8793 and click **Change league**. Enter the league ID (the long
number in `sleeper.com/leagues/<ID>/...`) or look it up by Sleeper username.

Share a direct link with `?league=<ID>`, e.g. `https://your-site/?league=1180000000000000000`.

## Pin the site to your league

Open `config.js` and set your league ID:

```js
window.COUP_CONFIG = {
  leagueId: '1180000000000000000',
};
```

With a league ID set, the site always opens that league, and the Change league button,
league picker and demo league are hidden. Leave it as `''` to let visitors choose.

## Host it for the league

It's plain static files with no build step and no API key. Any static host works:

- **GitHub Pages**: push this folder to a repo and enable Pages.
- **Netlify / Cloudflare Pages**: drag and drop the folder.

## How it works

- `js/api.js` fetches the league, users, rosters, and each week's matchups and transactions.
  The NFL player database is cached in the browser for a day.
- `js/engine.js` replays the season: the lowest scorer among survivors is chopped each week.
  If Sleeper has already emptied a roster, that decides tie-breaks and stat corrections.
- Chops come from Sleeper's own `chopped` transactions, which list the eliminated roster and every
  player released. If a chop hasn't been recorded yet, the lowest scorer is marked as pending.
- Waiver bids come from the same transactions feed. Failed claims are kept with Sleeper's reason
  (outbid, or roster full), so The Looting shows every bid placed, not just the winners.
- `js/history.js` holds the historical figures and award definitions. Edit it to add awards.
- `js/demo.js` generates a fictional league so the site has something to show before you connect one.

During a live week, teams are ranked by projected final score:

- Finished games count actual points.
- Games not started count Sleeper's projection, scored with the league's own scoring settings.
- Games in progress count actual points plus the share of the projection left on the game clock.
- Players listed Out, IR, or suspended count zero.

Projections and the schedule come from Sleeper's app endpoints on `api.sleeper.com`, which aren't
officially documented. The game clock comes from ESPN's public scoreboard. Chop odds come from
10,000 simulated finishes. Live data refreshes every 90 seconds.

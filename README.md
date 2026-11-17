# Zigzag Bandit

A quick mouse-shooter web game. You look down a western street at sunset; a bandit runs
away from you toward the town limit, dodging left and right in an unpredictable pattern
(1 step left, 3 right, 2 left, 7 right...). Hit him with paint before he escapes.

## Play

Open `index.html` in a browser, or run `node dev-server.js` and open http://localhost:5173.
No build step, no dependencies (the title font loads from Google Fonts and falls back to a
system serif when offline).

| Input | Action |
| --- | --- |
| Click / tap | Shoot |
| R, Space, right-click | Reload (6 shots per clip, auto-reloads when empty) |
| P / Esc | Pause |
| M | Mute |

## Rules

- Each round lasts roughly 11–15 seconds: stop the bandit or he reaches the town limit.
  The further he gets, the smaller the target.
- 3 lives. An escape costs one and the level restarts.
- Headshots do double damage and score more. Consecutive hits build a streak multiplier,
  and long-distance hits score x1.5.
- No camping: if your aim stays within a few pixels for 1.5 s, the bandit quietly steers
  around that spot (no on-screen hint). Tune with `STILL_R` / `STILL_TIME` in `game.js`.
- Crates and barrels block shots only while he is behind them.
- Bonus points for accuracy and for catching him early.
- 10 levels add speed, cover, multi-hit vests, jumps/ducks, stutter-steps, a head start
  and dust. After level 10 it continues as endless "Overtime".

## Tuning

Level difficulty is a data table (`LEVELS`) at the top of `game.js`. The perspective
constants (`D1`, `CAM`, `HORIZON`) sit just above it.

# Zigzag Bandit

A quick mouse-shooter web game. A bandit runs for the exit in an unpredictable pattern
(a few steps forward, a few back, forward again). Hit him with paint before he escapes.

## Play

Open `index.html` in a browser. No build step, no dependencies.

| Input | Action |
| --- | --- |
| Click / tap | Shoot |
| R, Space, right-click | Reload (6 shots per clip, auto-reloads when empty) |
| P / Esc | Pause |
| M | Mute |

## Rules

- Each round lasts roughly 10–15 seconds: stop the bandit or he reaches the EXIT.
- 3 lives. An escape costs one and the level restarts.
- Headshots do double damage and score more. Consecutive hits build a streak multiplier.
- Bonus points for accuracy and for catching him early.
- 10 levels add speed, cover, multi-hit vests, jumps/slides, stutter-steps, smaller targets
  and dust. After level 10 it continues as endless "Overtime".

## Tuning

Level difficulty is a data table (`LEVELS`) at the top of `game.js`.

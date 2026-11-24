# Fresh Launch Rider — Pump.fun Bot Sprint (paper bot)

[![make.fun](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/badboy0771/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/rank.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![reward](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/badboy0771/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/reward.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

A trading bot for the make.fun bounty
[Pump.fun Bot Sprint: Make Bot And Win](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed):
it trades 10 SOL of paper money on a replay of pump.fun bonding-curve
activity. Nothing is traded for real; the house replay scorer runs this
bot over chain data recorded after entries close (6 hours, starting when
the final phase opens) and ranks entries by net PnL. A prize needs a net
PnL above holding cash (above 0 SOL after every fee).

## Strategy

Buy one small fixed stake (0.05 SOL) in many fresh launches that pass a
rug screen — creator has not sold, the creator's own buy in the create
slot is modest, only a few distinct non-creator buyers piled in at
launch, the curve already holds real SOL — then ride each position with
a hard stop (-50%), a trailing stop (arms at +30%, exits on a -20% fall
from the best value), and a take-profit at +200%. The replay closes a
position when its curve completes, which is where the big wins live.
Losers cost at most the stake; one runner pays for dozens.

See [STRATEGY.md](STRATEGY.md) for the full method, the parameter sweep
on the kit's dev window, and the guardrail margins.

## Local verification (dev window, `grade-local --driver process`)

- Net PnL **-0.024 SOL**, 111 fills over 58 coins, 58 round trips, win
  rate 22.4%, max drawdown 1.8%, guardrails met (58 round trips ≥ 0.01
  SOL, ≥ 20 coins), two runs byte-identical (deterministic).
- 90% bootstrap interval over coins: -0.241…+0.238 SOL — the dev score
  is one sample and the interval covers zero.
- Neighbouring cells are all worse than the control (-0.132 SOL) is not:
  the shipped cell (-0.024) sits in a flat neighbourhood, not on a spike.
- Honest read: this entry is still below hold cash on the dev window, so
  it is a lottery ticket — a prize needs a runner in the fresh final
  window. Reference scores on the same dev window: kit pilot momentum
  -9.46 SOL, pilot reversion -3.89 SOL, pilot sniper -0.47 SOL.

## Run

The grader runs `node main.ts` (Node 22+). The bot is deterministic:
no clock, no randomness, no I/O — the two grading executions produce
byte-identical action logs.

## License

MIT — see [LICENSE](LICENSE).

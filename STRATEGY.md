# Fresh Launch Rider — method, sweep, and evidence

## Idea

Almost every fresh pump.fun coin dumps within minutes, so chasing every
uptick bleeds a little on nearly every coin. The money, when it comes at
all, comes from the rare launch that keeps climbing toward curve
completion. The bot therefore spreads one small, fixed stake (0.05 SOL)
across many fresh launches that pass a rug screen, then lets each
position ride: losers are cut by a hard stop, winners are protected by a
trailing stop, a take-profit banks the big runners, and anything still
alive is left alone until the replay itself closes it at completion.

## Entry screen

Decided within the first 3 slots after a coin is created (age 0–3):

- the creator has not sold anything yet;
- the creator's own buying in the create slot is at most 2.5 SOL (a huge
  dev buy is usually a bundled launch about to be dumped on);
- at most 5 distinct non-creator wallets bought at launch;
- the curve already holds 0.3–30 SOL of real SOL;
- sells so far are small next to buys, and no single non-creator sell is
  large next to the reserve;
- the price has not already run away from its create price (run-up
  capped at 100x).

Each buy is capped at 1% of the mint's real SOL reserve (the harness cap,
via `state.maxBuyLamports`) and at most 5 positions are open at once.

## Exits

Checked on every batch while a position is open, in this order:

- hard stop at -50% of cost;
- trailing stop: once the position's net value reaches +30% of cost,
  exit if it falls 20% below the best value seen;
- take-profit at +200% of cost;
- the creator sells while we hold;
- a 100,000-slot hold cap, effectively "never": it only guards against a
  stalled curve that never completes and never moves.

Sell value is computed against the latest reserves (marks, else the
curve's reserves) minus the 1.25% curve fee (95 bps protocol + 30 bps
creator) and the transaction fee, so the stop/trailing/take-profit
decisions are made on what a sale would actually net.

## Parameter sweep (grade-local, process driver, frozen dev window)

Dev window: 24h of pump.fun chain data, 2026-11-02 → 2026-11-03, 1,222
mints, 128,058 events. Each cell is one `grade-local` run (two
executions, byte-identical action logs required).

| Cell | Net PnL (SOL) | Fills | Coins | Win rate | Max DD |
| --- | --- | --- | --- | --- | --- |
| Control: stop -50%, trail +20%/-30%, no TP | -0.132 | 153 | 79 | 20.3% | 3.3% |
| Stop -30% | -0.311 | 235 | 120 | 16.7% | 5.0% |
| Tighter entry (≤3 buyers, ≥1 SOL reserve) | -0.150 | 117 | 61 | 16.4% | 2.3% |
| Take-profit +50% | -0.137 | 153 | 79 | 20.3% | 2.1% |
| Take-profit +100% | -0.105 | 153 | 79 | 20.3% | 2.4% |
| Take-profit +200% | -0.100 | 153 | 79 | 20.3% | 2.7% |
| Take-profit +200%, stake 0.08 SOL | -0.174 | 153 | 79 | 20.3% | 3.5% |
| **Take-profit +200%, trail +30%/-20% (SHIPPED)** | **-0.024** | **111** | **58** | **22.4%** | **1.8%** |
| Take-profit +200%, trail +40%/-15% | -0.058 | 141 | 73 | 21.9% | 2.3% |
| Take-profit +300%, trail +30%/-20% | -0.050 | 111 | 58 | 22.4% | 2.3% |

What the sweep says:

- Tighter stops churn seats and pay more fees: -0.311 SOL, the worst
  cell. Looser exits win.
- A tighter entry screen does not raise the win rate (16.4% vs 20.3%):
  the loose screen's extra coins are not the problem.
- A take-profit helps monotonically from +50% to +200%, then turns at
  +300%: banking runners before they give gains back is worth ~0.03 SOL.
- The shipped cell's edge over its neighbours (+30%/-20% vs +20%/-30%
  and +40%/-15%) comes with fewer coins (58 vs 79): looser trailing
  keeps seats occupied longer, so fewer, longer rides and fewer fees.
- The shipped cell sits in a flat neighbourhood, not on a spike — but
  the differences between the top cells (0.026–0.076 SOL) are small next
  to the 90% bootstrap interval (-0.241…+0.238 SOL). Do not read the
  ranking of these cells as a forecast.

## Shipped result (dev window)

- Net PnL **-0.024 SOL** (result_sha256
  `ce69dc6f2e90e6809c73553b2f71cc439cfc315f62d8fddd3a46001816a5dd55`)
- 111 fills, 58 coins, 58 round trips (all ≥ 0.01 SOL), win rate 22.4%
- Max drawdown 1.8% (guardrail: ≤ 50%)
- Guardrails met: ≥ 20 distinct mints with round trips ≥ 0.01 SOL
- Net PnL at 2x fees: -0.079 SOL
- L1 regrade reproduced the result byte for byte.

## Honest limitations

- The entry is below hold cash on the dev window (-0.024 SOL). A prize
  needs a runner in the fresh 6-hour final window, which is data nobody
  has seen. The dev score is one sample; the 90% interval covers zero.
- Fees are a large share of the drag: on the control cell, curve fees
  were 0.055 SOL and transaction fees 0.017 SOL against a -0.132 SOL
  net. Fewer, longer rides (the shipped cell) is the main fee defence.
- The kit pilots score far worse on this window (momentum -9.46 SOL,
  reversion -3.89 SOL, sniper -0.47 SOL), which says more about how
  hostile this window is than about this bot being good.

## Reproduce

```
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process
```

Node 22+. The bot reads the replay protocol on stdin and writes orders
on stdout; run from any working directory, it exits with the harness
error "input ended before hello" when stdin closes without a hello,
which is the expected behaviour outside the grader.

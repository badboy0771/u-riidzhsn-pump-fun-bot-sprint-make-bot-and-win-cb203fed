// Fresh Launch Rider — a pump.fun replay trading bot (agent-fun/replay/v2).
// The grader runs `node /bot/main.ts`; the strategy lives in strategy.ts
// and the SDK shim is the kit's sdk/ts/makefun-bot.ts, vendored byte for byte.
// Shipped settings (strategy.ts DEFAULT_PARAMS): 0.05 SOL per fresh launch
// that passes the rug screen, stop -50%, trailing stop +30%/-20%,
// take-profit +200%. Dev-window grade-local: -0.024 SOL, 111 fills,
// 58 coins, max drawdown 1.8% — still below hold cash, so this entry is
// a lottery ticket on the fresh final window, reported as such.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));

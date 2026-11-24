// Fresh Launch Rider — a pump.fun replay trading bot (agent-fun/replay/v2).
//
// Why this shape: almost every fresh pump.fun coin dumps within minutes,
// so a bot that chases every uptick bleeds a little on nearly every coin.
// The money, when it comes at all, comes from the rare launch that keeps
// climbing toward curve completion. This bot therefore spreads one small,
// fixed stake across many fresh launches that pass a rug screen, then lets
// each position ride: losers are cut by a hard stop, winners are protected
// by a trailing stop, a take-profit banks the big runners, and anything
// still alive is left alone until the replay itself closes it at
// completion. A winner only has to pay for a handful of losers for the run
// to come out ahead.
//
// Entry screen, decided within the first few slots after creation:
//   - the creator has not sold anything yet;
//   - the creator's own buying in the create slot is modest (a huge dev
//     buy is usually a bundled launch about to be dumped on);
//   - only a few distinct non-creator wallets bought at launch;
//   - the curve already holds a meaningful amount of real SOL, but is not
//     already enormous;
//   - sells so far are small next to buys, and no single non-creator sell
//     is large next to the reserve;
//   - the price has not already run away from its create price.
//
// Exits, checked on every batch while a position is open:
//   - hard stop: value falls to (1 - stopLoss) of cost;
//   - trailing stop: once value reaches (1 + trailArm) of cost, exit if it
//     falls trailDrop below the best value seen;
//   - take profit: value reaches (1 + takeProfit) of cost;
//   - the creator sells while we hold;
//   - a hold cap, set far out, only guards against a stalled curve that
//     never completes and never moves.
//
// How the shipped settings were picked (grade-local, process driver, on
// this competition's frozen dev window — 24h, 1,222 mints, 128,058 events):
//   control (stop -50%, trail +20%/-30%, no take-profit): -0.132 SOL
//   stop -30%: -0.311 SOL — tighter stops churn seats and pay more fees
//   tighter entry screen (max 3 buyers, min 1 SOL reserve): -0.150 SOL
//   take-profit +50% / +100% / +200% / +300%: -0.137 / -0.105 / -0.100 / -0.050 SOL
//   take-profit +200% with a 0.08 SOL stake: -0.174 SOL
//   take-profit +200%, trail +30%/-20%: -0.024 SOL  <- SHIPPED
//   take-profit +200%, trail +40%/-15%: -0.058 SOL
// The shipped cell sits in a flat neighbourhood (its neighbours are all
// better than the control), not on a spike: letting winners run longer is
// the robust direction, the exact arm/drop numbers are secondary. The dev
// window is one sample and the final window is fresh chain data, so this
// entry is a lottery ticket: if the final window behaves like dev it loses
// ~0.02 SOL of paper money and wins nothing; a prize needs a runner.
//
// Reference scores on the same dev window, same grader:
//   kit pilot momentum -9.46 SOL, pilot reversion -3.89 SOL,
//   pilot sniper -0.47 SOL, hold cash 0 SOL by definition.
//
// Deterministic by construction: no clock, no randomness, no I/O. State
// lives only in insertion-ordered maps fed by the batch stream, so the
// grader's two executions produce byte-identical action logs.

import {
  BPS,
  type Batch,
  type Bot,
  type BotState,
  type OrderInput,
  type Pubkey,
} from './vendor/makefun-bot.ts';

export interface RiderConfig {
  /** First buy may be decided from this many slots after creation. */
  earliestSlot: number;
  /** First buy may be decided up to this many slots after creation. */
  latestSlot: number;
  /** Lamports aimed at per coin (each order is still capped at 1% of real SOL). */
  stakeLamports: number;
  /** Smallest single buy worth paying the transaction fee for. */
  smallestBuyLamports: number;
  /** Real SOL reserve window at decision time (lamports). */
  reserveLowLamports: number;
  reserveHighLamports: number;
  /** Creator's own buys in the create slot: lamports window. */
  devBuyLowLamports: number;
  devBuyHighLamports: number;
  /** Distinct non-creator buyers seen before entry, at most. */
  mostBuyers: number;
  /** Distinct non-creator buyers seen before entry, at least. */
  leastBuyers: number;
  /** Trades seen before entry, at least. */
  leastTrades: number;
  /** Lamports sold by others / lamports bought, in bps, at most. */
  mostSellRatioBps: number;
  /** Largest single non-creator sell, in bps of the reserve before it, at most. */
  mostSingleSellBps: number;
  /** Price now over the create price, in bps (10000 = unchanged): window. */
  runupLowBps: number;
  runupHighBps: number;
  /** Slippage allowed on buys, in bps. */
  buySlippageBps: number;
  /** Exit when value falls this far under cost, in bps. */
  stopLossBps: number;
  /** Trailing stop arms once value is this far above cost, in bps. */
  trailArmBps: number;
  /** Once armed, exit on a fall of this much from the best value, in bps. */
  trailDropBps: number;
  /** Exit when value reaches this far above cost, in bps. 0 disables it. */
  takeProfitBps: number;
  /** Exit after holding this many slots. */
  holdCapSlots: number;
  /** Exit when the creator sells while we hold. */
  leaveOnCreatorSell: boolean;
  /** Skip a coin whose creator already sold before entry. */
  skipIfCreatorSold: boolean;
}

/** Shipped settings — the swept cell (trail +30%/-20%, take-profit +200%). */
export const DEFAULT_PARAMS: RiderConfig = {
  earliestSlot: 0,
  latestSlot: 3,
  stakeLamports: 50_000_000,
  smallestBuyLamports: 5_000_000,
  reserveLowLamports: 300_000_000,
  reserveHighLamports: 30_000_000_000,
  devBuyLowLamports: 0,
  devBuyHighLamports: 2_500_000_000,
  mostBuyers: 5,
  leastBuyers: 0,
  leastTrades: 0,
  mostSellRatioBps: 10_000,
  mostSingleSellBps: 10_000,
  runupLowBps: 0,
  runupHighBps: 1_000_000,
  buySlippageBps: 10_000,
  stopLossBps: 5_000,
  trailArmBps: 3_000,
  trailDropBps: 2_000,
  takeProfitBps: 20_000,
  holdCapSlots: 100_000,
  leaveOnCreatorSell: true,
  skipIfCreatorSold: true,
};

const LAMPORTS_PER_SOL = 1_000_000_000n;
/** Curve fee on a sale: protocol 95 bps + creator 30 bps. */
const SALE_FEE_BPS = 125n;

/** Everything remembered about one fresh launch. */
interface Coin {
  mint: Pubkey;
  createdSlot: number;
  creator: Pubkey;
  /** Reserves at creation, for the run-up check. */
  bornVq: bigint;
  bornVt: bigint;
  /** Creator's own buys in the create slot. */
  devBuy: bigint;
  /** The creator sold at any point. */
  creatorSold: boolean;
  trades: number;
  buyers: Set<Pubkey>;
  bought: bigint;
  soldByOthers: bigint;
  /** Largest single non-creator sell, in bps of the reserve before it. */
  worstSellBps: bigint;
  lastTradeSlot: number;
  /** Decided, exited, or completed: never consider again. */
  closed: boolean;
}

/** A position we hold, with the state its exits need. */
interface Ride {
  openedSlot: number;
  /** Best net value seen so far (lamports, after curve + tx fees). */
  peakValue: bigint;
  /** A sell for this position is already in flight. */
  selling: boolean;
}

/** What selling `tokens` against reserves (vq, vt) nets after the curve fee. */
function netSaleValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const quote = (tokens * vq) / (vt + tokens);
  return quote - (quote * SALE_FEE_BPS + BPS - 1n) / BPS;
}

export function createStrategy(cfg: RiderConfig = DEFAULT_PARAMS): Bot {
  const C = cfg;
  const coins = new Map<Pubkey, Coin>();
  const rides = new Map<Pubkey, Ride>();
  const exiting = new Set<Pubkey>();

  /** Fold one batch of chain events into the launch records. */
  function watch(batch: Batch): void {
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        if (!coins.has(e.mint)) {
          coins.set(e.mint, {
            mint: e.mint,
            createdSlot: e.slot,
            creator: e.creator,
            bornVq: BigInt(e.virtual_quote_reserves),
            bornVt: BigInt(e.virtual_token_reserves),
            devBuy: 0n,
            creatorSold: false,
            trades: 0,
            buyers: new Set(),
            bought: 0n,
            soldByOthers: 0n,
            worstSellBps: 0n,
            lastTradeSlot: e.slot,
            closed: false,
          });
        }
        continue;
      }
      if (e.event !== 'TradeEvent') continue;
      const coin = coins.get(e.mint);
      if (coin === undefined) continue;
      const sol = BigInt(e.sol_amount);
      const fromCreator = e.user === coin.creator;
      coin.trades += 1;
      coin.lastTradeSlot = e.slot;
      if (e.is_buy) {
        coin.bought += sol;
        if (fromCreator && e.slot === coin.createdSlot) coin.devBuy += sol;
        if (!fromCreator) coin.buyers.add(e.user);
      } else if (fromCreator) {
        coin.creatorSold = true;
      } else {
        coin.soldByOthers += sol;
        // Reserve before this sell: the trade's own SOL has just left it.
        const reserveBefore = BigInt(e.real_quote_reserves) + sol;
        if (reserveBefore > 0n) {
          const bps = (sol * BPS) / reserveBefore;
          if (bps > coin.worstSellBps) coin.worstSellBps = bps;
        }
      }
    }
  }

  /** Does this fresh launch pass the rug screen at slot `now`? */
  function passes(
    coin: Coin,
    now: number,
    curve:
      | {
          real_quote_reserves: string;
          virtual_quote_reserves: string;
          virtual_token_reserves: string;
        }
      | undefined,
  ): boolean {
    if (coin.closed || curve === undefined) return false;
    const age = now - coin.createdSlot;
    if (age < C.earliestSlot || age > C.latestSlot) return false;
    if (C.skipIfCreatorSold && coin.creatorSold) return false;
    if (coin.devBuy < BigInt(C.devBuyLowLamports) || coin.devBuy > BigInt(C.devBuyHighLamports)) return false;
    if (coin.trades < C.leastTrades || coin.buyers.size < C.leastBuyers) return false;
    if (coin.buyers.size > C.mostBuyers) return false;
    const realSol = BigInt(curve.real_quote_reserves);
    if (realSol < BigInt(C.reserveLowLamports) || realSol > BigInt(C.reserveHighLamports)) return false;
    if (coin.bought > 0n) {
      const sellRatio = (coin.soldByOthers * BPS) / coin.bought;
      if (sellRatio > BigInt(C.mostSellRatioBps)) return false;
    } else if (coin.soldByOthers > 0n) {
      return false;
    }
    if (coin.worstSellBps > BigInt(C.mostSingleSellBps)) return false;
    // Run-up vs the create price, as a ratio in bps (10000 = unchanged):
    // a coin that dipped still passes; one that already ran 100x does not.
    const vq = BigInt(curve.virtual_quote_reserves);
    const vt = BigInt(curve.virtual_token_reserves);
    if (coin.bornVq > 0n && coin.bornVt > 0n && vt > 0n) {
      const runup = (vq * coin.bornVt * BPS) / (vt * coin.bornVq);
      if (runup < BigInt(C.runupLowBps) || runup > BigInt(C.runupHighBps)) return false;
    }
    return true;
  }

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      watch(batch);
      const orders: OrderInput[] = [];
      const batchCap = state.hello.caps.max_orders_per_batch;
      const txFee = state.txFeeLamports();
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));

      // 1. Drop rides whose position is gone; a finished sell closes the coin.
      for (const [mint, ride] of rides) {
        const pos = state.positions.get(mint);
        if (pos !== undefined) continue;
        let inFlight = false;
        for (const po of state.pending.values()) {
          if (po.order.mint === mint) inFlight = true;
        }
        if (inFlight) continue;
        rides.delete(mint);
        exiting.delete(mint);
        const coin = coins.get(mint);
        if (coin !== undefined) coin.closed = true;
      }

      // 2. Exits first: stop loss, trailing stop, take profit, creator sell, hold cap.
      for (const [mint, ride] of rides) {
        if (orders.length >= batchCap) break;
        if (ride.selling || exiting.has(mint)) continue;
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined || curve === undefined || curve.complete) continue;
        const mark = marks.get(mint);
        const vq = mark !== undefined ? BigInt(mark.virtual_quote_reserves) : BigInt(curve.virtual_quote_reserves);
        const vt = mark !== undefined ? BigInt(mark.virtual_token_reserves) : BigInt(curve.virtual_token_reserves);
        const tokens = BigInt(pos.token_amount);
        const cost = BigInt(pos.cost_lamports);
        let value = netSaleValue(tokens, vq, vt);
        value = value > txFee ? value - txFee : 0n;
        if (value > ride.peakValue) ride.peakValue = value;
        const coin = coins.get(mint);
        const creatorSold = coin !== undefined && coin.creatorSold;
        let leave = false;
        if (value < (cost * BigInt(10_000 - C.stopLossBps)) / 10_000n) leave = true;
        if (
          !leave &&
          ride.peakValue >= (cost * BigInt(10_000 + C.trailArmBps)) / 10_000n &&
          value < (ride.peakValue * BigInt(10_000 - C.trailDropBps)) / 10_000n
        ) {
          leave = true;
        }
        if (!leave && C.takeProfitBps > 0 && value >= (cost * BigInt(10_000 + C.takeProfitBps)) / 10_000n) {
          leave = true;
        }
        if (!leave && C.leaveOnCreatorSell && creatorSold) leave = true;
        if (!leave && batch.slot - ride.openedSlot > C.holdCapSlots) leave = true;
        if (!leave) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        ride.selling = true;
        exiting.add(mint);
      }

      // 3. Entries: one small buy per qualifying fresh launch.
      let cashLeft = state.freeCashLamports();
      let seatsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      for (const [mint, coin] of coins) {
        if (orders.length >= batchCap || seatsLeft <= 0) break;
        if (rides.has(mint)) continue;
        let inFlight = false;
        for (const po of state.pending.values()) {
          if (po.order.mint === mint) inFlight = true;
        }
        if (inFlight) continue;
        const curve = state.curves.get(mint);
        if (!passes(coin, batch.slot, curve)) continue;
        const capLamports = state.maxBuyLamports(mint);
        let amount = BigInt(C.stakeLamports);
        if (amount > capLamports) amount = capLamports;
        if (amount < BigInt(C.smallestBuyLamports)) continue;
        // Keep enough cash to pay for this buy and its eventual sell.
        if (cashLeft < amount + txFee * 2n) continue;
        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: C.buySlippageBps });
        cashLeft -= amount + txFee;
        seatsLeft -= 1;
        rides.set(mint, { openedSlot: batch.slot, peakValue: 0n, selling: false });
        coin.closed = true;
      }
      return orders;
    },
  };
}

import { ClobClient, OrderType, Side } from '@polymarket/clob-client';

import dotenv from 'dotenv';
dotenv.config();

import { Wallet } from '@ethersproject/wallet';
import fs from 'fs/promises';
import { safeFetch } from './utils.js';
import { saveOrder, upsertBotState, loadAllBotStates, loadPurchasedMarketIds } from './db.js';

// In-memory state to track which take-profit levels have been executed per token
// Map<token_id, number of completed ladder levels>
const takeProfitProgress = new Map();

// Track markets we've already bought into across runs
const purchasedMarkets = new Set();

const TRAILING_STOP_ENABLED = true;
const TRAILING_STOP_PCT = 0.10; // 10% drawdown from local high
const trailingActiveByToken = new Map(); // Map<token_id, boolean>
const localHighByToken = new Map(); // Map<token_id, number>

// Hard stop-loss if price falls X% below average buy
const STOP_LOSS_ENABLED = true;
const STOP_LOSS_PCT = 0.10; // 10%

const TAKE_PROFIT_LADDER = [
    { thresholdPct: 5, fractionToSell: 0.25 },
    { thresholdPct: 10, fractionToSell: 0.25 },
    { thresholdPct: 15, fractionToSell: 0.25 },
    { thresholdPct: 20, fractionToSell: 1.0 }, // final clean-up: sell all remaining
  ];
  const MIN_ORDER_SIZE = 0.1; // adjust based on venue constraints
  
  // Persistence: now backed by MongoDB instead of local JSON
  const hydrateStateFromDb = async () => {
    try {
      const docs = await loadAllBotStates();
      takeProfitProgress.clear();
      trailingActiveByToken.clear();
      localHighByToken.clear();
      for (const doc of docs) {
        if (doc.completedLevels != null) takeProfitProgress.set(doc.token_id, doc.completedLevels);
        if (doc.trailingActive != null) trailingActiveByToken.set(doc.token_id, !!doc.trailingActive);
        if (doc.localHigh != null) localHighByToken.set(doc.token_id, Number(doc.localHigh));
      }
      console.log(`✅ Restored state from DB for ${docs.length} tokens`);
    } catch (e) {
      console.error('Failed to restore state from DB:', e);
    }
  };

// Helpers for tracking per-token progress
const getCompletedLevels = (tokenId) => takeProfitProgress.get(tokenId) || 0;
const setCompletedLevels = async (tokenId, levels) => {
  takeProfitProgress.set(tokenId, levels);
  try {
    await upsertBotState(tokenId, { completedLevels: levels });
  } catch (e) {
    console.error('Failed to persist completedLevels:', e);
  }
};
const computeNewlyUnlockedFraction = (profitPercent, completedLevels) => {
  const eligibleLevels = TAKE_PROFIT_LADDER.filter(l => profitPercent >= l.thresholdPct);
  const targetLevels = Math.min(eligibleLevels.length, TAKE_PROFIT_LADDER.length);
  if (targetLevels <= completedLevels) return { fraction: 0, targetLevels };
  const fraction = TAKE_PROFIT_LADDER
    .slice(completedLevels, targetLevels)
    .reduce((sum, lvl) => sum + lvl.fractionToSell, 0);
  return { fraction, targetLevels };
};


const buyPosition = async () => {
  console.log('buy position');
  try {
    console.log('in buy position')
    console.log('hello 1')
    const host = 'https://clob.polymarket.com';
    const funder = '0xa9456cecF9d6fb545F6408E0e2DbBFA307d7BaE6';
    const privateKey = process.env.PK;
    if (!privateKey)
      throw new Error('Private key is not set in environment variables');
    const signer = new Wallet(privateKey);

    const creds = await new ClobClient(
      host,
      137,
      signer
    ).createOrDeriveApiKey();

    const signatureType = 2;

    console.log('hello 2')

    const clobClient = new ClobClient(
      host,
      137,
      signer,
      await creds,
      signatureType,
      funder
    );
    console.log('clob client');

    console.log('Fetching markets...');

    const today = new Date().toISOString().split('T')[0];
    console.log('today', today);
    const category = 'Sports';

    console.log('hello 3')

    // const categoriesUrl = 'https://gamma-api.polymarket.com/markets?limit=500';
    // const res = await fetch(categoriesUrl);
    // const marketsWithCategory = await res.json();

    const url2 = `https://gamma-api.polymarket.com/markets?start_date_min=${today}&closed=false&limit=50`;
   
    const markets2 = await safeFetch(url2);

    console.log('hello 4')

    if (!markets2) {
      console.log('❌ No response from gamma API');
      return;
    }


    if (!Array.isArray(markets2)) {
      console.log('❌ Unexpected format:', markets2);
      return;
    }

    console.log('✅ Markets fetched:', markets2.length);

    if (markets2.length === 0) {
      console.log('No active markets found.');
      return;
    }

    // console.log('all market', markets2.length);

    console.log('hello 5');


    const markets3 = markets2.filter((market) => {
      console.log('markets outcome', market.outcomes);

      let outcomes = [];
      try {
        outcomes = JSON.parse(market.outcomes);
      } catch {
        // console.warn(`Market ${market.id} has invalid outcomes`);
      }

      const hasYesAndNo = outcomes.includes('Yes') && outcomes.includes('No');

      return hasYesAndNo;
    });

    console.log('hello 6')

    // console.log('yes and no filter length', markets3.length);

    try {
      const allTags = new Set();

      console.log('hello 7')

       await Promise.all(
        markets3.map(async (market) => {
          const getTagsUrl = `https://gamma-api.polymarket.com/markets/${market.id}/tags`;

          const tagsData = await safeFetch(getTagsUrl);

          const tagsLabels = tagsData?.map((tag) => tag.label) || [];

          tagsLabels.forEach((tag) => allTags.add(tag));

          market.tags = tagsLabels;

          return {
            id: market.id,
            question: market.question,
            tags: tagsLabels,
            description: market.description,
          };
        })
      );

      console.log('hello 8')

      const uniqueTags = Array.from(allTags);
      // console.log('Unique tags across markets:', uniqueTags);
    } catch (error) {
      // console.error('Error fetching markets with tags:', error);
      return [];
    }

    console.log('hello 9')

    const customTags = ['Esports', 'Politics', 'Crypto'];

    // console.log('markets 2', markets3[0]);
    const filteredMarkets = markets3.filter((market) => {
      const hasCustomTags = market.tags?.some((tag) =>
        customTags.includes(tag)
      );

      return hasCustomTags;
    });

    console.log('hello 10')

    console.log('yes/no + custom tags length', filteredMarkets.length);

    if (filteredMarkets.length == 0) {
      console.log('filtered market length is zero');
      return;
    }

    // Rank markets by liquidity and spread, then pick the best candidate
    const baseOrderSize = 5; // units to buy as base before liquidity scaling
    const spreadThresholdPct = 0.03; // 3%
    const MAX_NOTIONAL_USD = 2; // Hard cap: spend at most $2 per buy

    console.log('hello 11 in for loop')

    const candidates = [];
    for (const m of filteredMarkets) {
      // Skip if we've already purchased this market (from DB or current session)
      if (purchasedMarkets.has(m.id)) continue;
      let tokens = [];
      try {
        tokens = m.clobTokenIds ? JSON.parse(m.clobTokenIds) : [];
      } catch (e) {
        // console.warn(`Market ${m.id} has invalid clobTokenIds`);
        continue;
      }
      // console.log('tokens', tokens);
      // console.log('type of tokens', typeof tokens);
      // console.log('tokens length', tokens.length);
      if (tokens.length < 2) continue;
      const ob = await clobClient.getOrderBook(tokens[1]); // buying NO/Down
      const asks = (ob?.asks || []).slice().sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
      const bids = (ob?.bids || []).slice().sort((a, b) => parseFloat(b.price) - parseFloat(a.price));

      // console.log('asks length', asks.length);
      // console.log('bids length', bids.length);

      if (asks.length === 0 || bids.length === 0) continue;

      const bestAskPx = parseFloat(asks[0].price);
      const bestBidPx = parseFloat(bids[0].price);

      // console.log('bestAskPx', bestAskPx);
      // console.log('bestBidPx', bestBidPx);

      const mid = (bestAskPx + bestBidPx) / 2;
      if (!isFinite(mid) || mid <= 0) continue;
      const spreadPct = (bestAskPx - bestBidPx) / mid;

      // console.log('spreadPct', spreadPct);

      const top5Ask = asks.slice(0, 5).reduce((s, a) => s + parseFloat(a.size), 0);
      const top5Bid = bids.slice(0, 5).reduce((s, b) => s + parseFloat(b.size), 0);

      const liqOk = top5Ask >= baseOrderSize * 2; // enter: 2x buffer
      const spreadOk = spreadPct <= spreadThresholdPct;
      // console.log('liqOk', liqOk);
      // console.log('spreadOk', spreadOk);
      if (!liqOk || !spreadOk) continue;

      const liquidityScore = Math.min(1, Math.min(top5Ask, top5Bid) / (baseOrderSize * 5));
      const spreadScore = 1 - Math.min(1, spreadPct / spreadThresholdPct);
      const imbalance = (top5Bid - top5Ask) / Math.max(1e-9, (top5Bid + top5Ask));
      const imbalanceScore = (imbalance + 1) / 2; // 0..1

      const score = 0.5 * liquidityScore + 0.35 * spreadScore + 0.15 * imbalanceScore;
      // console.log('candidates length', candidates.length);
      candidates.push({
        market: m,
        tokens,
        ob,
        bestAskPx,
        top5Ask,
        score,
      });
    }

    console.log('hello 12')

    if (candidates.length === 0) {
      console.log('❌ No suitable market found after liquidity/spread filters.');
      return;
    }

    candidates.sort((a, b) => b.score - a.score);
    const chosen = candidates[0];
    const tradableMarket = chosen.market;
    const tokenIds = chosen.tokens;
    const orderbook = chosen.ob;
    const bestAsk = { price: chosen.bestAskPx.toString(), size: orderbook.asks[0]?.size };

    console.log('hello 13')

    // console.log('✅ Selected market:', tradableMarket.id, 'score=', chosen.score.toFixed(3));
    // console.log('Token ID (Up/YES):', tokenIds[0]);
    // console.log('Token ID (Down/NO):', tokenIds[1]);

    // Sizing based on liquidity (cap at 10% of top-5 ask)
    const maxByDepth = Math.max(MIN_ORDER_SIZE, 0.10 * chosen.top5Ask);
    const finalSize = Math.min(baseOrderSize, maxByDepth);
    let sizeToBuy = finalSize.toFixed(4);

    console.log('hello 14')


    const spotPrice = parseFloat(bestAsk.price);
    const tickSize = Number(tradableMarket.orderPriceMinTickSize || 0.001);
    const MAX_PRICE = 0.999;
    const MIN_PRICE = tickSize; // venue min equals 1 tick
    // target one tick over best ask but clamp within allowed bounds
    const rawTarget = spotPrice + tickSize;
    // Snap to tick grid
    let buyPrice = Number((Math.round(rawTarget / tickSize) * tickSize).toFixed(6));
    // Ensure within [MIN_PRICE, MAX_PRICE]
    if (buyPrice > MAX_PRICE) {
      buyPrice = Number(((Math.floor(MAX_PRICE / tickSize)) * tickSize).toFixed(6));
    }
    if (buyPrice < MIN_PRICE) {
      buyPrice = MIN_PRICE;
    }
    // Make sure we are not below the best ask; if rounding dropped us, bump up by one tick if possible
    if (buyPrice < spotPrice) {
      const bumped = Number(((Math.ceil(spotPrice / tickSize) + 1) * tickSize).toFixed(6));
      buyPrice = Math.min(bumped, Number(((Math.floor(MAX_PRICE / tickSize)) * tickSize).toFixed(6)));
    }

    console.log('hello 15')

    // // Enforce per-order notional cap (USD)
    const currentNotional = buyPrice * parseFloat(sizeToBuy);
    if (currentNotional > MAX_NOTIONAL_USD) {
      const cappedSize = Math.max(MIN_ORDER_SIZE, MAX_NOTIONAL_USD / buyPrice);
      sizeToBuy = Math.min(cappedSize, finalSize).toFixed(4);
    }

    // If still below min order size after cap, skip
    if (parseFloat(sizeToBuy) < MIN_ORDER_SIZE) {
      // console.log(`❌ Skipping ${tradableMarket.id}: size ${sizeToBuy} < MIN_ORDER_SIZE after $${MAX_NOTIONAL_USD} cap`);
      return;
    }

    console.log('=======================================');
    console.log('bid on this market')
    console.log('params', tokenIds[1], buyPrice, Side.BUY, sizeToBuy, 0, tradableMarket.orderPriceMinTickSize, tradableMarket.negRisk);
    console.log('market', tradableMarket.question, tradableMarket.description);
    console.log('CHALO CHALO =>')

    // // return;
    const result = await clobClient.createAndPostOrder(
      {
        tokenID: tokenIds[1],
        price: buyPrice,
        side: Side.BUY,
        size: sizeToBuy,
        feeRateBps: 0,
      },
      {
        tickSize: tradableMarket.orderPriceMinTickSize.toString(),
        negRisk: tradableMarket.negRisk,
      },
      // {
      //   tokenID: '32503579608775718313575165608728730358646090749209365307778208819511602679949',
      //   price: 0.97,
      //   side: Side.BUY,
      //   size: 2.0619,
      //   feeRateBps: 0,
      // },
      // {
      //   tickSize: '0.01',
      //   negRisk: false,
      // },
      OrderType.IOC
    );
    console.log('Order executedd ✅', result);

    // if(result?.err) {
    //   console.log('order failed!')
    // } else if(result.success) {
    //   console.log('save order in db')
    //   // await saveOrder({
    //   //   marketId: tradableMarket.id,
    //   //   tokenId: tokenIds[1],
    //   //   orderId: result.orderID,
    //   //   side: 'BUY',
    //   //   size: sizeToBuy,
    //   //   price: buyPrice,
    //   //   status: 'success',
    //   //   timestamp: new Date(),
    //   // });
    //   purchasedMarkets.add(tradableMarket.id);
    // }

  } catch (err) {
    console.log('err', err);
  }
};

await buyPosition()
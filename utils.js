import axios from 'axios';

// Phase 2: Spot Price Monitoring Example

export async function monitorMarket(clobClient, tokenId) {
  try {
    // Fetch the current orderbook
    const orderbook = await clobClient.getOrderBook(tokenId);

    if (!orderbook.asks.length || !orderbook.bids.length) {
      console.log('No active asks or bids, skipping this market.');
      return null;
    }

    // Sort to find best ask (lowest price) and best bid (highest price)
    const sortedAsks = orderbook.asks.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
    const sortedBids = orderbook.bids.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));

    const bestAsk = sortedAsks[0];
    const bestBid = sortedBids[0];

    console.log('Best Ask:', bestAsk.price, 'Size:', bestAsk.size);
    console.log('Best Bid:', bestBid.price, 'Size:', bestBid.size);

    // Calculate spread
    const spread = parseFloat(bestAsk.price) - parseFloat(bestBid.price);
    console.log('Spread:', spread);

    return { bestAsk, bestBid, spread, orderbook };
  } catch (err) {
    console.error('Error monitoring market:', err);
    return null;
  }
}


export async function safeFetch(url, retries = 1) {
  try {
    // const res = await axios.get(url, {
    //   headers: { 'accept': 'application/json' }

    // }, { timeout: 5000 });
    // if (!res.ok) throw new Error(`HTTP ${res.status} at ${res.url}`);

    // return res.data; // already parsed JSON
  // } catch (err) {
  //   console.error(`[SafeFetch Error] Failed to fetch ${url}:`, err.message);

  //   if (retries > 0) {
  //     console.log(`Retrying... (${retries} left)`);
  //     return safeFetch(url, retries - 1);
  //   }

  //   return null; // return null if all retries fail
  console.log('url', url);
  const res = await fetch(url, {
    headers: {
      // 'accept': 'application/json',
      // 'user-agent': 'Mozilla/5.0 (compatible; PolymarketBot/1.0; +https://github.com/yourbot)'
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });

  const text = await res.text();

  // Try parsing JSON
  try {
    const json = JSON.parse(text);
    return json;
  } catch {
    console.error('❌ Non-JSON response from', url);
    console.error(text.slice(0, 300));
    return null;
  }

} catch (err) {
  console.error('❌ Fetch failed:', url, err.message);
  return null;
}
}


export async function utilsGetUserTrades() {
  const url = 'https://data-api.polymarket.com/trades?user=0xa9456cecF9d6fb545F6408E0e2DbBFA307d7BaE6';

try {
  const res = await fetch(url, {
    headers: {
      'accept': 'application/json',
      'user-agent': 'Mozilla/5.0 (compatible; PolymarketBot/1.0; +https://github.com/yourbot)'
    }
  });

  const text = await res.text(); // always get raw response

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error("❌ Non-JSON response from Polymarket API");
    console.error(text.slice(0, 500)); // preview first 500 chars
    return;
  }

  console.log("✅ Successfully fetched", data);
} catch (err) {
  console.error(`❌ Failed to fetch ${url}:`, err.message);
}
}
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { io } from 'socket.io-client';
import { config } from './config.js';

const PORT = config.port;
const app = express();
const server = http.createServer(app);

app.use(cors({ origin: '*' }));
app.use(express.json());

// In-memory trade cache (holds top 20 recent valid trades)
let liveTradesCache = [];
const MAX_CACHE_SIZE = 20;

// Connected local WebSocket clients
const localWsClients = new Set();

// Active Shrine Socket.IO connection and subscriptions
let shrineSocket = null;
const activeSubscribedMints = new Set();

const subscribeToShrineMint = (mint) => {
  if (!mint || typeof mint !== 'string') return;
  if (!activeSubscribedMints.has(mint)) {
    activeSubscribedMints.add(mint);
    if (shrineSocket && shrineSocket.connected) {
      shrineSocket.emit('subscribe', { mint }, (ack) => {
        console.log(`📡 Subscribed Shrine price stream for mint ${mint}:`, ack);
      });
    }
  }
};

const initShrineSocket = () => {
  if (shrineSocket) return;
  console.log('🔌 Connecting to Shrine Socket.IO (https://sol.shrine.trade)...');
  shrineSocket = io('https://sol.shrine.trade', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
  });

  shrineSocket.on('connect', () => {
    console.log('✅ Connected to Shrine Socket.IO live price stream');
    // Always subscribe default token mint by default
    subscribeToShrineMint('5eHyXNn8CGYPdJRnNAWbMMn9w2Emofd1TLRr261M6THx');

    // Resubscribe to all active mints on reconnect
    for (const mint of activeSubscribedMints) {
      shrineSocket.emit('subscribe', { mint }, (ack) => {
        console.log(`📡 Resubscribed Shrine price stream for mint ${mint}:`, ack);
      });
    }
  });

  shrineSocket.on('token_update', (u) => {
    if (!u || !u.price) return;
    const priceSol = parseFloat(u.price);
    const priceUSD = u.priceUSD ? parseFloat(u.priceUSD) : null;
    const mcapUSD = u.mcapUSD ? parseFloat(u.mcapUSD) : null;

    const payload = JSON.stringify({
      type: 'collectible_price_tick',
      pool: u.pool,
      priceSol,
      priceUSD,
      mcapUSD,
      time: u.time || Math.floor(Date.now() / 1000)
    });

    for (const client of localWsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  shrineSocket.on('disconnect', (reason) => {
    console.warn('⚠️ Shrine Socket.IO disconnected:', reason);
  });

  shrineSocket.on('error', (err) => {
    console.error('❌ Shrine Socket.IO error:', err);
  });
};

initShrineSocket();

// Helper to normalize IPFS URLs to public HTTP gateway
const formatIpfsUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('ipfs://')) {
    return url.replace('ipfs://', 'https://cf-ipfs.com/ipfs/');
  }
  return url;
};

// Helper to pre-resolve token image URL using Padre CDN thumbnails
const resolveTokenImage = async (mint, data = {}) => {
  if (mint) {
    return `https://thumbnails.padre.gg/SOLANA-${mint}`;
  }

  const directImage = data.image_uri || data.image || data.icon;
  if (directImage) {
    return formatIpfsUrl(directImage);
  }

  return 'https://thumbnails.padre.gg/SOLANA-default';
};

// 24/7 new-token launches feed (PumpPortal). PumpDev is reserved for the
// wallet-trade feed below, so the two never compete for PumpDev's conn limit.
let pumpWs = null;
let reconnectTimer = null;
let currentEndpointIndex = 0;

const connectPumpPortal = () => {
  try {
    const endpoints = config.endpoints;
    
    const currentUrl = endpoints[currentEndpointIndex % endpoints.length];

    console.log(`🔌 Connecting new-token launches feed via PumpPortal: ${currentUrl}...`);
    pumpWs = new WebSocket(currentUrl);

    pumpWs.on('open', () => {
      console.log(`✅ Connected to PumpPortal new-token stream (${currentUrl})`);
      try {
        pumpWs.send(JSON.stringify({ method: 'subscribeNewToken' }));
      } catch (e) {}
    });

    pumpWs.on('message', async (dataStr) => {
      try {
        const data = JSON.parse(dataStr.toString());
        if (data && (data.txType === 'create' || data.name || data.mint || data.signature)) {
          // 1. Extract initial dev buy SOL amount
          let rawSol = data.solAmount ?? data.initialQuoteAmount ?? data.initialBuy ?? 0;
          if (typeof rawSol === 'number' && rawSol > 100) {
            rawSol = rawSol / 1e9; // Convert lamports to SOL
          }
          const devBuySol = parseFloat((Number(rawSol) || 0).toFixed(3));

          // 2. FILTER: Ignore coins with initial buys less than or equal to 0.1 SOL
          if (!devBuySol || devBuySol <= 0.1) {
            return;
          }

          // 3. PnL calculation vs 0.1 SOL baseline
          let pnl = Math.round(((devBuySol - 0.1) / 0.1) * 100);
          if (pnl === 0) {
            pnl = Math.floor(Math.random() * 30) + 10;
          }

          const isProfit = pnl >= 0;
          const mintAddress = data.mint || data.tokenMint;
          const shortWallet = data.traderPublicKey
            ? `${data.traderPublicKey.substring(0, 4)}...${data.traderPublicKey.substring(data.traderPublicKey.length - 4)}`
            : (data.signature ? `${data.signature.substring(0, 4)}...${data.signature.substring(data.signature.length - 4)}` : 'Dev');

          // 4. Resolve Image
          const imageSrc = await resolveTokenImage(mintAddress, data);
          if (!imageSrc) return;

          const tokenTitle = data.name || data.symbol || 'Pump Token';

          const tradeItem = {
            id: `pump-${mintAddress || data.signature || Date.now()}-${Math.random()}`,
            mint: mintAddress,
            signature: data.signature,
            title: tokenTitle,
            imageSrc,
            price: devBuySol,
            pnlPercent: pnl,
            isProfit,
            wallet: shortWallet,
            timestamp: 'Just now',
            isNew: true
          };

          // 5. Deduplicate and update in-memory cache
          const isDuplicate = liveTradesCache.some(item =>
            (mintAddress && item.mint === mintAddress) ||
            (data.signature && item.signature === data.signature) ||
            (item.title && item.title.toLowerCase() === tokenTitle.toLowerCase())
          );

          if (!isDuplicate) {
            liveTradesCache = [tradeItem, ...liveTradesCache.slice(0, MAX_CACHE_SIZE - 1)];
            console.log(`🚀 New Coin (>0.1 SOL): ${tokenTitle} | Dev Buy: ${devBuySol} SOL | PnL: ${pnl}%`);

            // Broadcast to all connected local website clients
            const payload = JSON.stringify({ type: 'new_trade', trade: tradeItem });
            for (const client of localWsClients) {
              if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
              }
            }
          }
        }
      } catch (err) {
        console.error('Error processing stream message:', err.message);
      }
    });

    pumpWs.on('close', () => {
      console.warn(`⚠️ PumpPortal stream closed (${currentUrl}). Reconnecting in 3s...`);
      currentEndpointIndex++;
      scheduleReconnect();
    });

    pumpWs.on('error', (err) => {
      console.error(`❌ WebSocket error (${currentUrl}):`, err.message);
      try { pumpWs.close(); } catch (e) {}
    });

  } catch (err) {
    console.error('Failed to connect to WebSocket stream:', err.message);
    currentEndpointIndex++;
    scheduleReconnect();
  }
};

const scheduleReconnect = () => {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connectPumpPortal();
  }, 3000);
};

// Start 24/7 PumpPortal connection
connectPumpPortal();

// ── Independent PumpDev KOL wallet-trade feed ────────────────────────────────
// Fully separate connection (own ws + reconnect + cache). Does NOT touch the
// launches feed above or PumpPortal. Emits its own `wallet_trade` message type.
let walletTradeWs = null;
let walletTradeReconnectTimer = null;
let walletTradesCache = [];
const MAX_WALLET_TRADES = 50;
const trackedWalletSet = new Set((config.walletTrades && config.walletTrades.wallets) || []);

// Coin metadata (name/symbol/image) resolved once per mint via Shrine and cached
// server-side, so a hot mint is looked up a single time for ALL connected clients
// instead of every visitor re-fetching it. Failed lookups cache as null (no retry).
const coinMetaCache = new Map();   // mint -> { name, symbol, image } | null
const coinMetaPending = new Map(); // mint -> in-flight Promise (dedupe)

const fetchCoinMeta = (mint) => {
  if (!mint) return Promise.resolve(null);
  if (coinMetaCache.has(mint)) return Promise.resolve(coinMetaCache.get(mint));
  if (coinMetaPending.has(mint)) return coinMetaPending.get(mint);

  const p = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`https://sol.shrine.trade/metadata?mint=${mint}`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) { coinMetaCache.set(mint, null); return null; }
      const d = await res.json();
      const name = d.name || d.symbol || null;
      // pump.fun serves the real token art for pump mints (imagedelivery CDN);
      // padre.gg stays the general fallback for everything else.
      const image = mint.endsWith('pump')
        ? `https://images.pump.fun/coin-image/${mint}?variant=80x80`
        : await resolveTokenImage(mint, d);
      const meta = (name || image) ? { name, symbol: d.symbol || null, image } : null;
      coinMetaCache.set(mint, meta);
      return meta;
    } catch (e) {
      coinMetaCache.set(mint, null);
      return null;
    } finally {
      coinMetaPending.delete(mint);
    }
  })();
  coinMetaPending.set(mint, p);
  return p;
};

const scheduleWalletTradeReconnect = () => {
  if (walletTradeReconnectTimer) clearTimeout(walletTradeReconnectTimer);
  walletTradeReconnectTimer = setTimeout(connectPumpDevWalletTrades, 3000);
};

const connectPumpDevWalletTrades = () => {
  try {
    const wt = config.walletTrades || {};
    if (!wt.url || trackedWalletSet.size === 0) {
      console.warn('⚠️ walletTrades config missing — skipping KOL trade feed.');
      return;
    }

    console.log(`🔌 Connecting PumpDev wallet-trade feed (tracking ${trackedWalletSet.size} wallets)...`);
    walletTradeWs = new WebSocket(wt.url);

    walletTradeWs.on('open', () => {
      console.log('✅ Connected to PumpDev wallet-trade feed');
      try {
        walletTradeWs.send(JSON.stringify({ method: 'subscribeAccountTrade', keys: wt.wallets }));
      } catch (e) {}
    });

    walletTradeWs.on('message', async (raw) => {
      try {
        const event = JSON.parse(raw.toString());
        if (event.type) return; // control frame (subscription ack, etc.)

        const trader = event.traderPublicKey || event.publicKey || event.wallet || event.user || null;
        // Safety net: drop anything from a wallet we didn't ask for.
        if (trader && !trackedWalletSet.has(trader)) return;

        let rawQuote = event.quoteAmount ?? event.solAmount ?? event.quoteAmountRaw ?? 0;
        if (typeof rawQuote === 'number' && rawQuote > 100) rawQuote = rawQuote / 1e9; // lamports → SOL
        const solAmount = parseFloat((Number(rawQuote) || 0).toFixed(4));
        const mint = event.mint || event.tokenMint || null;

        const trade = {
          id: `wt-${event.signature || ''}-${mint || ''}-${Date.now()}-${Math.random()}`,
          trader,
          txType: event.txType, // 'buy' | 'sell' as labelled by PumpDev
          mint,
          solAmount,
          tokenAmount: event.tokenAmount ?? event.amount ?? null,
          signature: event.signature || null,
          timestamp: Math.floor(Date.now() / 1000),
          // Resolved coin identity (Shrine name + image); null until known.
          coin: await fetchCoinMeta(mint)
        };

        walletTradesCache = [trade, ...walletTradesCache.slice(0, MAX_WALLET_TRADES - 1)];
        console.log(`💸 KOL ${trade.txType} · ${trader ? trader.slice(0, 4) + '…' + trader.slice(-4) : '?'} · ${trade.solAmount} SOL · ${trade.coin?.name || trade.mint || ''}`);

        const payload = JSON.stringify({ type: 'wallet_trade', trade });
        for (const client of localWsClients) {
          if (client.readyState === WebSocket.OPEN) client.send(payload);
        }
      } catch (err) {
        console.error('Error processing wallet-trade message:', err.message);
      }
    });

    walletTradeWs.on('close', () => {
      console.warn('⚠️ PumpDev wallet-trade feed closed. Reconnecting in 3s...');
      scheduleWalletTradeReconnect();
    });

    walletTradeWs.on('error', (err) => {
      console.error('❌ PumpDev wallet-trade feed error:', err.message);
      try { walletTradeWs.close(); } catch (e) {}
    });
  } catch (err) {
    console.error('Failed to connect PumpDev wallet-trade feed:', err.message);
    scheduleWalletTradeReconnect();
  }
};

connectPumpDevWalletTrades();

// Local WebSocket Server for Website Clients (Port 3002 /ws)
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  localWsClients.add(ws);
  // Send current cached trades immediately on connect
  ws.send(JSON.stringify({ type: 'init', trades: liveTradesCache }));
  // Separate snapshot for the KOL wallet-trade feed (independent message type)
  ws.send(JSON.stringify({ type: 'wallet_trades_init', trades: walletTradesCache }));

  ws.on('message', (msgStr) => {
    try {
      const msg = JSON.parse(msgStr.toString());
      if (msg.type === 'subscribe_mint' && msg.mint) {
        subscribeToShrineMint(msg.mint);
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    localWsClients.delete(ws);
  });
});

// REST API Endpoint: GET /api/activity
app.get('/api/activity', (req, res) => {
  res.json({
    success: true,
    count: liveTradesCache.length,
    trades: liveTradesCache
  });
});

// REST API Endpoint: GET /api/wallet-trades (KOL wallet-trade feed)
app.get('/api/wallet-trades', (req, res) => {
  res.json({
    success: true,
    count: walletTradesCache.length,
    trades: walletTradesCache
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', cachedTrades: liveTradesCache.length, localClients: localWsClients.size });
});

server.listen(PORT, () => {
  console.log(`⚡ WePump WebSocket microservice running on http://localhost:${PORT}`);
});

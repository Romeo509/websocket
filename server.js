import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
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

// 24/7 PumpDev / PumpPortal WebSocket Connection Manager
let pumpWs = null;
let reconnectTimer = null;
let currentEndpointIndex = 0;

const connectPumpPortal = () => {
  try {
    const endpoints = (config.endpoints && config.endpoints.length > 0)
      ? config.endpoints
      : ['wss://pumpportal.fun/api/data'];
    const currentUrl = endpoints[currentEndpointIndex % endpoints.length];

    console.log(`🔌 Connecting 24/7 WebSocket service to ${currentUrl}...`);
    pumpWs = new WebSocket(currentUrl);

    pumpWs.on('open', () => {
      console.log(`✅ Connected to 24/7 live stream at ${currentUrl}`);
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
        console.error('Error processing PumpPortal message:', err.message);
      }
    });

    pumpWs.on('close', () => {
      console.warn('⚠️ PumpPortal WebSocket closed. Rotating endpoint & reconnecting in 3s...');
      currentEndpointIndex++;
      scheduleReconnect();
    });

    pumpWs.on('error', (err) => {
      console.error(`❌ PumpPortal WebSocket error (${currentUrl}):`, err.message);
      try { pumpWs.close(); } catch (e) {}
    });

  } catch (err) {
    console.error('Failed to connect to PumpPortal:', err.message);
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

// Local WebSocket Server for Website Clients (Port 3002 /ws)
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  localWsClients.add(ws);
  // Send current cached trades immediately on connect
  ws.send(JSON.stringify({ type: 'init', trades: liveTradesCache }));

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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', cachedTrades: liveTradesCache.length, localClients: localWsClients.size });
});

server.listen(PORT, () => {
  console.log(`⚡ WePump WebSocket microservice running on http://localhost:${PORT}`);
});

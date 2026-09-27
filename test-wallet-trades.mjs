// Isolated PumpDev wallet-trade LIVE test — ONE connection, watch until Ctrl-C.
// Prints every buy/sell from the tracked KOL wallets with the trader's NAME
// (from the Auto-Sniper frontend roster) so you can see who moved.
//
// NOTE: PumpDev free tier = 1 connection per IP. Stop server.js before running.
import WebSocket from 'ws';

const URL = 'wss://pumpdev.io/ws?key=oLAmuHLy9bI73ObtQbU5XVKiZn55kANIl2-grScMb0g6dM_0ZnXl9qmBZIdLJG4u';

// addr -> label, straight from AutoSniperPage.tsx (first 15 of the roster).
const WALLETS = [
  { addr: '6HJetMbdHBuk3mLUainxAPpBpWzDgYbHGTS2TqDAUSX2', name: 'LJC' },
  { addr: '4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9', name: 'decu' },
  { addr: 'CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o', name: 'cented' },
  { addr: 'ardinRsN1mNYVeoJWTBsWeYeXvuR9UUDGMsCDKpb6AT', name: 'trunoest' },
  { addr: '4DdrfiDHpmx55i4SPssxVzS9ZaKLb8qr45NKY9Er9nNh', name: 'Mr. Frog' },
  { addr: 'B32QbbdDAyhvUQzjcaM5j6ZVKwjCxAwGH5Xgvb9SJqnC', name: 'Kadenox' },
  { addr: 'Bi4rd5FH5bYEN8scZ7wevxNZyNmKHdaBcvewdPFxYdLt', name: 'theo' },
  { addr: 'AuPp4YTMTyqxYXQnHc5KUc6pUuCSsHQpBJhgnD45yqrf', name: 'Dani' },
  { addr: '2fg5QD1eD7rzNNCsvnhmXFm5hqNgwTTG8p7kQ6f3rx6f', name: 'Cupsey' },
  { addr: '215nhcAHjQQGgwpQSJQ7zR26etbjjtVdW74NLzwEgQjP', name: 'OGAntD' },
  { addr: '3j5c4aD1aznxQXJ3DWw1b7UD8kKuaqXVbpaVeWPR83TG', name: 'Kaaox' },
  { addr: 'BHREKFkPQgAtDs8Vb1UfLkUpjG6ScidTjHaCWFuG2AtX', name: 'Risk' },
  { addr: 'H31vEBxSJk1nQdUN11qZgZyhScyShhscKhvhZZU3dQoU', name: 'Megga' },
  { addr: 'DNsh1UfJdxmze6T6GV9QK5SoFm7HsM5TRNxVuwVgo8Zj', name: 'Hash' },
  { addr: '5hAgYC8TJCcEZV7LTXAzkTrm7YL29YXyQQJPCNrG84zM', name: 'Schoen' }
];

const NAME_BY_ADDR = new Map(WALLETS.map((w) => [w.addr, w.name]));
const KEYS = WALLETS.map((w) => w.addr);

let tradeCount = 0;

const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '?');

console.log(`🔌 Connecting to PumpDev, tracking ${KEYS.length} KOL wallets… (Ctrl-C to stop)`);
const ws = new WebSocket(URL);

ws.on('open', () => {
  console.log('✅ Connected — subscribing subscribeAccountTrade');
  ws.send(JSON.stringify({ method: 'subscribeAccountTrade', keys: KEYS }));
});

// Heartbeat so you can tell the socket is alive even during quiet periods.
const heartbeat = setInterval(() => {
  console.log(`   … still connected · ${tradeCount} trade(s) so far · ${new Date().toLocaleTimeString()}`);
}, 20000);

ws.on('message', (raw) => {
  const str = raw.toString();
  let event;
  try {
    event = JSON.parse(str);
  } catch {
    console.log('[raw] non-JSON:', str.slice(0, 300));
    return;
  }

  // Control frames: connected / connectionStatus / subscribed / error / auth
  if (event.type) {
    console.log(`[control] ${event.type}${event.code ? ` · ${event.code}` : ''} · ${JSON.stringify(event).slice(0, 400)}`);
    return;
  }

  // Market event (buy/sell from a tracked wallet).
  const addr = event.traderPublicKey || event.publicKey || event.wallet || null;
  const name = NAME_BY_ADDR.get(addr) || 'UNKNOWN';

  // SOL amount: normalized quoteAmount/solAmount, else raw lamports.
  let sol = event.quoteAmount ?? event.solAmount ?? null;
  if (sol == null && event.quoteAmountRaw != null) {
    const raw = Number(event.quoteAmountRaw);
    sol = raw > 100 ? raw / 1e9 : raw;
  }
  sol = (Number(sol) || 0).toFixed(4);

  const side = (event.txType || '?').toUpperCase();
  const icon = side === 'BUY' ? '🟢' : side === 'SELL' ? '🔴' : '•';
  const mint = short(event.mint);

  tradeCount++;
  console.log(`${icon} ${name.padEnd(9)} ${side.padEnd(4)} ${sol.padStart(9)} SOL  mint ${mint}${event.symbol ? `  (${event.symbol})` : ''}`);
});

ws.on('close', (code, reason) => {
  clearInterval(heartbeat);
  console.log(`\n⚠️ CLOSED code=${code} reason=${(reason || '').toString()} · trades seen=${tradeCount}`);
  if (String(reason || '').includes('Too many connections')) {
    console.log('→ Another client (probably server.js) already holds PumpDev\'s 1 connection/IP. Stop it and re-run.');
  }
});

ws.on('error', (err) => {
  console.log('❌ ERROR:', err.message);
});

process.on('SIGINT', () => {
  clearInterval(heartbeat);
  console.log(`\n✋ Stopped by user · trades seen=${tradeCount}`);
  try { ws.close(); } catch {}
  process.exit(0);
});

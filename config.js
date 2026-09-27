// Single source of truth for the WebSocket service.
// Only PORT is read from the environment (Koyeb injects it); edit the rest here directly.
export const config = {
  port: process.env.PORT || 3002,
  // Launches feed: PumpPortal ONLY. PumpDev is reserved for the wallet-trade feed
  // below, so the two never compete for PumpDev's 1-connection-per-IP limit.
  endpoints: [
    'wss://pumpportal.fun/api/data'
  ],
  // Independent KOL wallet-trade feed (PumpDev `subscribeAccountTrade`).
  // First 20 wallets from the Auto-Sniper tracked roster.
  walletTrades: {
    url: 'wss://pumpdev.io/ws?key=oLAmuHLy9bI73ObtQbU5XVKiZn55kANIl2-grScMb0g6dM_0ZnXl9qmBZIdLJG4u',
    wallets: [
      '6HJetMbdHBuk3mLUainxAPpBpWzDgYbHGTS2TqDAUSX2',
      '4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9',
      'CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o',
      'ardinRsN1mNYVeoJWTBsWeYeXvuR9UUDGMsCDKpb6AT',
      '4DdrfiDHpmx55i4SPssxVzS9ZaKLb8qr45NKY9Er9nNh',
      'B32QbbdDAyhvUQzjcaM5j6ZVKwjCxAwGH5Xgvb9SJqnC',
      'Bi4rd5FH5bYEN8scZ7wevxNZyNmKHdaBcvewdPFxYdLt',
      'AuPp4YTMTyqxYXQnHc5KUc6pUuCSsHQpBJhgnD45yqrf',
      '2fg5QD1eD7rzNNCsvnhmXFm5hqNgwTTG8p7kQ6f3rx6f',
      '215nhcAHjQQGgwpQSJQ7zR26etbjjtVdW74NLzwEgQjP',
      '3j5c4aD1aznxQXJ3DWw1b7UD8kKuaqXVbpaVeWPR83TG',
      'BHREKFkPQgAtDs8Vb1UfLkUpjG6ScidTjHaCWFuG2AtX',
      'H31vEBxSJk1nQdUN11qZgZyhScyShhscKhvhZZU3dQoU',
      'DNsh1UfJdxmze6T6GV9QK5SoFm7HsM5TRNxVuwVgo8Zj',
      '5hAgYC8TJCcEZV7LTXAzkTrm7YL29YXyQQJPCNrG84zM'
    ]
  }
};

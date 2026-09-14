export const config = {
  port: process.env.PORT || 3002,
  websocketUrl: process.env.PUMPDEV_WS_URL || 'wss://pumpportal.fun/api/data',
  endpoints: [
    process.env.PUMPDEV_WS_URL,
    'wss://pumpportal.fun/api/data',
    'wss://pumpdev.io/ws?key=oV6LZ8-e_wDHySLOtG6FBTKjqyQF3i7RP6VXTAGPi4Hrg4s9M87SiyP3qJLgCY_2'
  ].filter(Boolean)
};


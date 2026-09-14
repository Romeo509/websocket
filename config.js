export const config = {
  port: process.env.PORT || 3002,
  primaryUrl: process.env.PUMPDEV_WS_URL || 'wss://pumpdev.io/ws?key=oV6LZ8-e_wDHySLOtG6FBTKjqyQF3i7RP6VXTAGPi4Hrg4s9M87SiyP3qJLgCY_2',
  endpoints: [
    process.env.PUMPDEV_WS_URL || 'wss://pumpdev.io/ws?key=oV6LZ8-e_wDHySLOtG6FBTKjqyQF3i7RP6VXTAGPi4Hrg4s9M87SiyP3qJLgCY_2',
    process.env.PUMPPORTAL_WS_URL || 'wss://pumpportal.fun/api/data',
    process.env.THIRD_FALLBACK_WS_URL
  ].filter(Boolean)
};

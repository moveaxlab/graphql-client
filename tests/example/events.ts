export enum Events {
  tokenExpired = 'token expired',
  tokenRefreshed = 'token refreshed',
  tokenRefreshFailed = 'token refresh failed',

  // socket events
  socketSubscriptionError = 'socket subscription error',
  socketConnectionError = 'socket connection error',
  socketReconnecting = 'socket reconnecting',
  socketReconnected = 'socket reconnected',
  socketError = 'socket error',
  socketDisconnected = 'socket disconnected',
  socketConnecting = 'socket connecting',
  socketConnected = 'socket connected',
}

import * as http from 'http';
import * as ws from 'ws';
import {
  ConnectionInitMessage,
  Disposable,
  makeServer,
  ServerOptions,
} from 'graphql-ws';

// for nicer documentation
type WebSocket = typeof ws.prototype;
type WebSocketServer = ws.Server;

/**
 * The extra that will be put in the `Context`.
 */
export interface Extra {
  /**
   * The actual socket connection between the server and the client.
   */
  readonly socket: WebSocket;
  /**
   * The initial HTTP request before the actual
   * socket and connection is established.
   */
  readonly request: http.IncomingMessage;
}

/**
 * Use the server on a [ws](https://github.com/websockets/ws) ws server.
 * This is a basic starter, feel free to copy the code over and adjust it to your needs
 */
export function useServer(
  options: ServerOptions<ConnectionInitMessage['payload'], Extra>,
  ws: WebSocketServer,
  /**
   * The timout between dispatched keep-alive messages. Internally uses the [ws Ping and Pongs]((https://developer.mozilla.org/en-US/docs/Web/API/wss_API/Writing_ws_servers#Pings_and_Pongs_The_Heartbeat_of_wss))
   * to check that the link between the clients and the server is operating and to prevent the link
   * from being broken due to idling.
   *
   * @default 12 * 1000 // 12 seconds
   */
  keepAlive = 12 * 1000
): Disposable {
  const server = makeServer<ConnectionInitMessage['payload'], Extra>(options);

  ws.on('error', err => {
    // catch the first thrown error and re-throw it once all clients have been notified
    let firstErr: Error | null = err;

    // report server errors by erroring out all clients with the same error
    for (const client of ws.clients) {
      try {
        client.close(1011, 'Internal Error');
      } catch (err) {
        firstErr = firstErr ?? err;
      }
    }

    if (firstErr) {
      throw firstErr;
    }
  });

  ws.on('connection', (socket, request) => {
    // keep alive through ping-pong messages
    let pongWait: ReturnType<typeof setTimeout> | null = null;
    const pingInterval =
      keepAlive > 0 && isFinite(keepAlive)
        ? setInterval(() => {
            // ping pong on open sockets only
            if (socket.readyState === socket.OPEN) {
              // terminate the connection after pong wait has passed because the client is idle
              pongWait = setTimeout(() => {
                socket.terminate();
              }, keepAlive);

              // listen for client's pong and stop socket termination
              socket.once('pong', () => {
                if (pongWait) {
                  clearTimeout(pongWait);
                  pongWait = null;
                }
              });

              socket.ping();
            }
          }, keepAlive)
        : null;

    const closed = server.opened(
      {
        protocol: socket.protocol,
        send: data =>
          new Promise((resolve, reject) => {
            socket.send(data, err => (err ? reject(err) : resolve()));
          }),
        close: (code, reason) => socket.close(code, reason),
        onMessage: cb =>
          socket.on('message', async event => {
            try {
              await cb(event.toString());
            } catch (err) {
              socket.close(1011, 'Internal Error');
            }
          }),
      },
      { socket, request }
    );

    socket.once('close', (code, reason) => {
      if (pongWait) clearTimeout(pongWait);
      if (pingInterval) clearInterval(pingInterval);
      closed(code, reason);
    });
  });

  return {
    dispose: async () => {
      for (const client of ws.clients) {
        client.close(1001, 'Going away');
      }
      ws.removeAllListeners();
      await new Promise<void>((resolve, reject) => {
        ws.close(err => (err ? reject(err) : resolve()));
      });
    },
  };
}

import { Client, createClient } from 'graphql-ws';
import stringify from 'fast-json-stable-stringify';
import {
  ApolloClient,
  DocumentNode,
  FetchResult,
  InMemoryCache,
} from '@apollo/client/core';
import { GraphQLWsLink } from './graphql-ws.link';
import { RequestVariables } from './types';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface MakeSubscriptionOptions<R, E, TE = E> {
  name: string;
  eventCreator: (event: E) => TE | null;
  subscription: DocumentNode;
}

export interface Subscription<R> {
  subscribe(variables: R): void;
  unsubscribe(variables: R): void;
}

const fatalErrorCodes: number[] = [1002, 1011, 4400, 4401, 4409, 4429];

export interface SubscriptionServiceOptions {
  host: string;
  wsImpl?: unknown;
  retryWait?: (retries: number) => Promise<void>;
}

const MAX_WAIT = 15000;
const MIN_WAIT = 1000;

function exponentialBackoff(retries: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(
      resolve,
      Math.min(
        MAX_WAIT,
        Math.max(
          MIN_WAIT,
          2 ** retries * 1000 + Math.random() * (3000 - 300) + 300
        )
      )
    );
  });
}

export abstract class SubscriptionService {
  private resolve: () => void;

  private subscriptionClient: Client;

  private websocketLink: GraphQLWsLink;

  private apolloClient: ApolloClient<unknown>;

  private subscriptionMap: Map<string, ZenObservable.Subscription>;

  private activeSubscriptions: Map<string, [string, unknown]>;

  private isConnected: Promise<void>;

  private signalConnected!: () => void;

  private isReady: Promise<void>;

  private connected: boolean = false;

  private restartRequestedBeforeConnection: boolean = false;

  constructor(private readonly options: SubscriptionServiceOptions) {
    this.isReady = new Promise(resolve => {
      this.resolve = resolve;
    });
    this.isConnected = new Promise(resolve => {
      this.signalConnected = resolve;
    });
    this.subscriptionMap = new Map();
    this.activeSubscriptions = new Map();
  }

  protected signalReady(): void {
    this.resolve();
  }

  connect = async (): Promise<void> => {
    if (this.connected) return;
    await this.isReady;
    this.initializeSubscriptionClient();
    this.initializeGraphQLClient();
    this.connected = true;
    this.signalConnected();
  };

  private gracefullyReconnect = (): void => {
    this.restartRequestedBeforeConnection = true;
  };

  reconnect = async (): Promise<void> => {
    await this.gracefullyReconnect();
  };

  disconnect = async (): Promise<void> => {
    if (!this.connected) return;
    await this.isReady;
    this.subscriptionMap.forEach(sub => {
      sub.unsubscribe();
    });
    try {
      await this.subscriptionClient.dispose();
    } catch {
      // ignore error, we're disposing of the client
    }
    this.subscriptionMap.clear();
    this.connected = false;
    this.signalDisconnected();
  };

  private signalDisconnected = () => {
    this.isConnected = new Promise(resolve => {
      this.signalConnected = resolve;
    });
  };

  private initializeGraphQLClient = () => {
    this.websocketLink = new GraphQLWsLink(this.subscriptionClient);
    this.apolloClient = new ApolloClient({
      link: this.websocketLink,
      cache: new InMemoryCache({
        resultCaching: false,
      }),
    });
  };

  private initializeSubscriptionClient = () => {
    this.subscriptionClient = createClient({
      url: this.options.host,
      webSocketImpl: this.options.wsImpl,
      retryAttempts: Number.POSITIVE_INFINITY,
      connectionParams: this.connectionParams,
      retryWait: this.options.retryWait ?? exponentialBackoff,
      shouldRetry: () => true,
      on: {
        connected: this.handleConnected,
      },
      keepAlive: 15_000,
      lazyCloseTimeout: 5_000,
    });

    let activeSocket: WebSocket;
    let timeout: ReturnType<typeof setTimeout>;
    let pingSentAt = 0;

    this.subscriptionClient.on('error', (error: CloseEvent) => {
      this.gracefullyReconnect = () => {
        this.restartRequestedBeforeConnection = true;
      };

      this.onDisconnected();
      this.onSocketConnectionError(error);
    });

    this.subscriptionClient.on('closed', (event: CloseEvent) => {
      this.gracefullyReconnect = () => {
        this.restartRequestedBeforeConnection = true;
      };

      this.onDisconnected();
      if (fatalErrorCodes.includes(event.code)) {
        this.onError(event);
      } else if (this.isTokenExpired(event)) {
        this.onTokenExpired();
      } else {
        this.onSocketConnectionError(event);
      }
    });

    this.subscriptionClient.on('connecting', () => {
      this.onConnecting();
    });

    this.subscriptionClient.on('connected', socket => {
      activeSocket = socket as WebSocket;
      this.onConnected();
    });

    this.subscriptionClient.on('ping', received => {
      if (!received) {
        pingSentAt = Date.now();
        timeout = setTimeout(() => {
          if (activeSocket && activeSocket.readyState === activeSocket.OPEN) {
            activeSocket.close(4408, 'Ping timeout');
          }
        }, 5_000);
      }
    });

    this.subscriptionClient.on('pong', received => {
      if (received) {
        this.latencyMeasured(Date.now() - pingSentAt);
        clearTimeout(timeout);
      }
    });
  };

  private handleConnected = (socket: WebSocket) => {
    this.gracefullyReconnect = () => {
      if (socket.readyState === socket.OPEN) {
        socket.close(4205, 'Client restart');
      }
    };

    if (this.restartRequestedBeforeConnection) {
      this.restartRequestedBeforeConnection = false;
      this.gracefullyReconnect();
    }
  };

  protected abstract connectionParams: () => Promise<Record<string, unknown>>;

  protected abstract onSubscriptionError: (error: Error) => void;

  /**
   * Must return true if the CloseEvent means that the token is expired.
   */
  protected abstract isTokenExpired: (event: CloseEvent) => boolean;

  /**
   * Called when an error representing a TokenExpired happens.
   */
  protected abstract onTokenExpired: () => void;

  /**
   * Called when a generic connection error happens.
   */
  protected abstract onSocketConnectionError: (error: CloseEvent) => void;

  protected abstract onConnecting: () => void;

  protected abstract onConnected: () => void;

  protected abstract onDisconnected: () => void;

  protected abstract latencyMeasured: (latencyMs: number) => void;

  /**
   * Called when a fatal error happens.
   */
  protected abstract onError: (error: CloseEvent) => void;

  protected abstract dispatch: (event: unknown | null) => void;

  protected makeSubscriptionKey = <V>(name: string, variables?: V): string => {
    return `${name}:${stringify(variables)}`;
  };

  protected subscribe = async <V extends RequestVariables, R, TR = R>(
    name: string,
    subscriptionTransformer: (data: FetchResult<R>) => TR | null,
    query: DocumentNode,
    variables: V
  ): Promise<ZenObservable.Subscription> => {
    const subscriptionKey = this.makeSubscriptionKey(name, variables);

    if (this.subscriptionMap.has(subscriptionKey)) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `Trying to subscribe twice to same subscription ${subscriptionKey}, skipping.`
        );
      }
      return this.subscriptionMap.get(subscriptionKey)!;
    }

    await this.isConnected;

    const observable = this.apolloClient.subscribe({
      query,
      variables: variables ? variables : undefined,
    });

    const dispatch = this.dispatch;
    const onSubscriptionError = this.onSubscriptionError;

    const subscription = observable.subscribe({
      next(value: FetchResult<R>) {
        dispatch(subscriptionTransformer(value));
      },
      error: onSubscriptionError,
    });

    this.subscriptionMap.set(subscriptionKey, subscription);

    this.activeSubscriptions.set(subscriptionKey, [name, variables]);

    return subscription;
  };

  protected unsubscribe = <V>(name: string, variables?: V): void => {
    const subscriptionKey = this.makeSubscriptionKey(name, variables);
    const subscription = this.subscriptionMap.get(subscriptionKey);
    if (!subscription) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `Trying to unsubscribe from ${subscriptionKey}, but subscription doesn't exist`
        );
      }
      return;
    }
    subscription.unsubscribe();
    this.subscriptionMap.delete(subscriptionKey);
    this.activeSubscriptions.delete(subscriptionKey);
  };

  protected makeSubscription = <R extends RequestVariables, E, TE = E>({
    eventCreator,
    name,
    subscription,
  }: MakeSubscriptionOptions<R, E, TE>): Subscription<R> => {
    return {
      subscribe: async (variables: R) => {
        await this.subscribe<R, E, TE>(
          name,
          ({ data }) => {
            return eventCreator(data!);
          },
          subscription,
          variables
        );
      },
      unsubscribe: (variables: R) => {
        this.unsubscribe(name, variables);
      },
    };
  };

  getActiveSubscriptions(): [string, unknown][] {
    return [...this.activeSubscriptions.values()];
  }
}

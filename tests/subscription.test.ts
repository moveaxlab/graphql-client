import { importSchema } from 'graphql-import';
import { join } from 'path';
import { ApolloServer } from 'apollo-server-express';
import ws from 'ws';
import express from 'express';
import { useServer } from './example/useServer';
import { execute, subscribe } from 'graphql';
import { SubscriptionsClient } from './example/subscriptions';
import SagaTester from 'redux-saga-tester';
import { Store } from 'redux';
import { makeExecutableSchema, PubSub } from 'apollo-server';
import { Events } from './example/events';
import { Disposable } from 'graphql-ws';
import { EventEmitter, once } from 'events';
import * as http from 'http';

const typeDefs = importSchema(join(__dirname, 'example/schema.graphql'));

jest.mock('./example/authentication', () => ({
  getAccessToken: jest.fn(),
  isTokenExpired: jest.fn(),
}));

const { getAccessToken } = jest.requireMock('./example/authentication');

const PORT = 5002;

const app = express();

const pubsub = new PubSub();

const schema = makeExecutableSchema({
  typeDefs,
  resolverValidationOptions: {
    requireResolversForResolveType: false,
  },
  resolvers: {
    Subscription: {
      catCreated: {
        subscribe: () => pubsub.asyncIterator('catCreated'),
      },
    },
  },
});

const apolloServer = new ApolloServer({
  schema,
});

apolloServer.applyMiddleware({ app });

const em = new EventEmitter();

const onConnect = jest.fn();
const onDisconnect = jest.fn();
const onSubscribe = jest.fn();
const onOperation = jest.fn();
const onClose = jest.fn();

let server: http.Server;
let disposable: Disposable;

beforeAll(async () => {
  server = await app.listen(PORT, () => {
    const wsServer = new ws.Server({
      server,
      path: '/graphql',
    });

    disposable = useServer(
      {
        schema,
        execute,
        subscribe,
        onConnect: (...args) => {
          em.emit('onConnect', ...args);
          return onConnect(...args);
        },
        onDisconnect: (...args) => {
          em.emit('onDisconnect', ...args);
          return onDisconnect(...args);
        },
        onSubscribe: (...args) => {
          em.emit('onSubscribe', ...args);
          return onSubscribe(...args);
        },
        onOperation: (...args) => {
          em.emit('onOperation', ...args);
          return onOperation(...args);
        },
        onClose: (...args) => {
          em.emit('onClose', ...args);
          return onClose(...args);
        },
      },
      wsServer
    );
  });
});

afterEach(() => {
  jest.resetAllMocks();
});

afterAll(async done => {
  await disposable.dispose();
  server.close(done);
});

describe('Test subscriptions client', () => {
  it('connects and receives a subscription', async () => {
    const client = new SubscriptionsClient({
      host: `ws://localhost:${PORT}/graphql`,
      wsImpl: ws,
    });

    onConnect.mockReturnValue(true);

    const tester = new SagaTester();

    client.initialize(tester as unknown as Store);

    await client.connect();

    // lazy initialization: not connected yet
    expect(onConnect).toHaveBeenCalledTimes(0);

    client.catCreated.subscribe({});

    // now connection has actually happened
    await tester.waitFor(Events.socketConnected);
    expect(onConnect).toHaveBeenCalledTimes(1);

    // wait for subscription to be established before sending something
    await once(em, 'onOperation');

    await pubsub.publish('catCreated', {
      catCreated: {
        id: 'id',
        name: 'name',
      },
    });

    const event = await tester.waitFor('catCreated');

    expect(event).toEqual({
      type: 'catCreated',
      payload: {
        catCreated: {
          __typename: 'CatCreated',
          id: 'id',
          name: 'name',
        },
      },
    });

    await client.disconnect();

    await Promise.all([once(em, 'onDisconnect'), once(em, 'onClose')]);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('retries connection on token expired and retains subscriptions', async () => {
    const client = new SubscriptionsClient({
      host: `ws://localhost:${PORT}/graphql`,
      wsImpl: ws,
    });

    getAccessToken
      .mockReturnValueOnce('expired token')
      .mockReturnValue('new token');

    onConnect.mockReturnValueOnce(false).mockReturnValue(true);

    const tester = new SagaTester();

    client.initialize(tester as unknown as Store);

    await client.connect();
    client.catCreated.subscribe({});

    // first connection will fail for invalid token
    await tester.waitFor(Events.tokenExpired);
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect.mock.calls[0][0].connectionParams).toEqual({
      authorization: 'Bearer expired token',
    });

    // close is always called, onDisconnect only after successful connection
    expect(onClose).toHaveBeenCalledTimes(0);
    expect(onDisconnect).toHaveBeenCalledTimes(0);

    // second connection will work
    await tester.waitFor(Events.socketConnected);
    expect(onConnect).toHaveBeenCalledTimes(2);
    expect(onConnect.mock.calls[1][0].connectionParams).toEqual({
      authorization: 'Bearer new token',
    });

    // wait for subscription to be established before sending something
    await once(em, 'onOperation');

    await pubsub.publish('catCreated', {
      catCreated: {
        id: 'id',
        name: 'name',
      },
    });

    const event = await tester.waitFor('catCreated');

    expect(event).toEqual({
      type: 'catCreated',
      payload: {
        catCreated: {
          __typename: 'CatCreated',
          id: 'id',
          name: 'name',
        },
      },
    });

    client.catCreated.unsubscribe({});

    await client.disconnect();

    await Promise.all([once(em, 'onDisconnect'), once(em, 'onClose')]);

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects while not connected yet', async () => {
    const client = new SubscriptionsClient({
      host: `ws://localhost:${PORT}/graphql`,
      wsImpl: ws,
    });

    onConnect.mockReturnValue(false);

    getAccessToken.mockReturnValue('token');

    const tester = new SagaTester();

    client.initialize(tester as unknown as Store);

    await client.connect();
    client.catCreated.subscribe({});

    await tester.waitFor(Events.socketConnecting);
    // await once(em, 'onConnect');

    await client.disconnect();
  });

  it('gracefully reconnects and retains subscriptions', async () => {
    const client = new SubscriptionsClient({
      host: `ws://localhost:${PORT}/graphql`,
      wsImpl: ws,
    });

    getAccessToken
      .mockReturnValueOnce('first token')
      .mockReturnValue('second token');

    onConnect.mockReturnValue(true);

    const tester = new SagaTester();

    client.initialize(tester as unknown as Store);

    await client.connect();
    client.catCreated.subscribe({});

    // first connection sends first token
    await tester.waitFor(Events.socketConnected);
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect.mock.calls[0][0].connectionParams).toEqual({
      authorization: 'Bearer first token',
    });

    // wait for onOperation to avoid racing with the subscription
    await once(em, 'onOperation');

    await client.reconnect();

    await tester.waitFor(Events.socketDisconnected);
    await tester.waitFor(Events.socketConnected, true);

    // second connection sends second token
    expect(onConnect).toHaveBeenCalledTimes(2);
    expect(onConnect.mock.calls[1][0].connectionParams).toEqual({
      authorization: 'Bearer second token',
    });

    // wait for subscription to be established before sending something
    await once(em, 'onOperation');

    await pubsub.publish('catCreated', {
      catCreated: {
        id: 'id',
        name: 'name',
      },
    });

    const event = await tester.waitFor('catCreated');

    expect(event).toEqual({
      type: 'catCreated',
      payload: {
        catCreated: {
          __typename: 'CatCreated',
          id: 'id',
          name: 'name',
        },
      },
    });

    client.catCreated.unsubscribe({});

    await client.disconnect();

    await Promise.all([once(em, 'onDisconnect'), once(em, 'onClose')]);

    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onDisconnect).toHaveBeenCalledTimes(2);
  });

  it('retries connection forever if server is unavailable', async () => {
    jest.setTimeout(20000);

    const client = new SubscriptionsClient({
      host: `ws://localhost:1234/graphql`,
      wsImpl: ws,
    });

    const tester = new SagaTester();

    client.initialize(tester as unknown as Store);

    await client.connect();

    client.catCreated.subscribe({});

    await tester.waitFor(Events.socketConnecting, true);

    await tester.waitFor(Events.socketDisconnected, true);

    await tester.waitFor(Events.socketConnecting, true);

    await client.disconnect();
  });
});

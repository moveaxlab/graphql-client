import { ApolloServer, makeExecutableSchema } from 'apollo-server';
import { importSchema } from 'graphql-import';
import { call, put, StrictEffect, take } from 'redux-saga/effects';
import SagaTester from 'redux-saga-tester';
import { join } from 'path';
import { GetCatResponse } from './example/queries/cat';
import { CreateCatResponse } from './example/mutations/createCat';
import { CatsClient } from './example/client';
import { Events } from './example/events';
import { InvalidCredentials } from './example/errors/invalid-credentials';
import { GraphQLError } from 'graphql';
import { AnyAction, Store } from 'redux';
import { StateMachine, stateMachineStarterSaga } from 'redux-sigma';
import { GenericAnimalQuery } from './example/__generated__/types';
import { GetGenericAnimalResponse } from './example/queries/getGenericAnimal';

const typeDefs = importSchema(join(__dirname, 'example/schema.graphql'));

jest.mock('./example/authentication', () => ({
  getAccessToken: jest.fn(),
  isTokenExpired: jest.fn(),
}));

const { getAccessToken, isTokenExpired } = jest.requireMock(
  './example/authentication'
);

const PORT = 5001;

const catQuery = jest.fn();

const catMutation = jest.fn();
const animalQuery = jest.fn();

let lastSeenHeaders;

const server = new ApolloServer({
  schema: makeExecutableSchema({
    typeDefs,
    resolverValidationOptions: {
      requireResolversForResolveType: false,
    },
  }),
  formatResponse: (r, context) => {
    lastSeenHeaders = context.request.http?.headers;
    return r!;
  },
  mocks: {
    Query: () => ({
      cat: catQuery,
      animal: animalQuery,
    }),
    Mutation: () => ({
      addCat: catMutation,
      refreshToken: () => {
        return undefined;
      },
    }),
  },
});

beforeAll(async () => {
  await server.listen(PORT);
});

afterEach(() => {
  jest.resetAllMocks();
});

afterAll(async () => {
  await server.stop();
});

describe('Test client queries', () => {
  const mockCat = {
    id: 'cat id',
    name: 'my cat',
  };

  describe('Test unauthenticated queries', () => {
    it('makes an unauthenticated query', async done => {
      const client = new CatsClient(`http://localhost:${PORT}`);

      getAccessToken.mockResolvedValue(null);

      catQuery.mockReturnValue(mockCat);

      function* querySaga() {
        try {
          const res = (yield call(client.getCat)) as GetCatResponse;
          yield put({
            type: 'cat fetched',
            payload: {
              id: res.id,
              name: res.name,
            },
          });
        } catch (e) {
          done(e);
        }
      }

      const tester = new SagaTester();

      client.initialize(tester as unknown as Store);

      tester.start(querySaga);

      await tester.waitFor('cat fetched');

      expect(getAccessToken).not.toHaveBeenCalled();

      expect(catQuery).toHaveBeenCalledTimes(1);

      expect(tester.getCalledActions()).toEqual([
        {
          type: 'cat fetched',
          payload: mockCat,
        },
      ]);

      done();
    });
  });

  describe('Test authenticated queries', () => {
    it('makes an authenticated query', async done => {
      const client = new CatsClient(`http://localhost:${PORT}`);

      getAccessToken.mockResolvedValue('access token');

      catQuery.mockReturnValue(mockCat);

      function* querySaga() {
        try {
          const res = (yield call(
            client.getCatAuthenticated
          )) as GetCatResponse;
          yield put({
            type: 'cat fetched',
            payload: {
              id: res.id,
              name: res.name,
            },
          });
        } catch (e) {
          done(e);
        }
      }

      const tester = new SagaTester();

      client.initialize(tester as unknown as Store);

      tester.start(querySaga);

      await tester.waitFor('cat fetched');

      expect(getAccessToken).toHaveBeenCalledTimes(1);

      expect(catQuery).toHaveBeenCalledTimes(1);

      expect(tester.getCalledActions()).toEqual([
        {
          type: 'cat fetched',
          payload: mockCat,
        },
      ]);

      done();
    });

    it('makes an authenticated query and refreshes the token', async done => {
      const client = new CatsClient(`http://localhost:${PORT}`);

      getAccessToken.mockResolvedValue('access token');

      catQuery
        .mockRejectedValueOnce(new Error('token expired'))
        .mockReturnValue(mockCat);

      isTokenExpired.mockReturnValueOnce(true).mockReturnValue(false);

      function* querySaga() {
        try {
          const res = (yield call(
            client.getCatAuthenticated
          )) as GetCatResponse;
          yield put({
            type: 'cat fetched',
            payload: {
              id: res.id,
              name: res.name,
            },
          });
        } catch (e) {
          done(e);
        }
      }

      const tester = new SagaTester();

      client.initialize(tester as unknown as Store);

      tester.start(querySaga);

      await tester.waitFor(Events.tokenExpired);

      expect(getAccessToken).toHaveBeenCalledTimes(1);

      expect(catQuery).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();

      client.signalTokenRefreshed();

      await tester.waitFor('cat fetched');

      expect(getAccessToken).toHaveBeenCalledTimes(1);

      expect(catQuery).toHaveBeenCalledTimes(1);

      const actions = tester.getCalledActions();

      expect(actions[actions.length - 1]).toEqual({
        type: 'cat fetched',
        payload: mockCat,
      });

      done();
    });

    it('refreshes the token then receives an error', async done => {
      const client = new CatsClient(`http://localhost:${PORT}`);

      getAccessToken.mockResolvedValue('access token');

      catQuery
        .mockRejectedValueOnce(new Error('token expired'))
        .mockRejectedValue(new Error('business error'));

      isTokenExpired.mockReturnValueOnce(true).mockReturnValue(false);

      function* querySaga() {
        try {
          yield call(client.getCatAuthenticated);
        } catch (e) {
          if (e.message === 'business error') {
            yield put({
              type: 'business error happened',
              payload: e,
              error: true,
            });
          } else {
            done(e);
          }
        }
      }

      const tester = new SagaTester();

      client.initialize(tester as unknown as Store);

      tester.start(querySaga);

      await tester.waitFor(Events.tokenExpired);

      expect(getAccessToken).toHaveBeenCalledTimes(1);

      expect(catQuery).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();

      client.signalTokenRefreshed();

      await tester.waitFor('business error happened');

      expect(getAccessToken).toHaveBeenCalledTimes(1);

      expect(catQuery).toHaveBeenCalledTimes(1);

      const errorAction = tester.getLatestCalledAction();

      expect(errorAction.payload).toEqual(new Error('business error'));

      done();
    });

    it('makes an authenticated query and fails to refresh the token', async done => {
      const client = new CatsClient(`http://localhost:${PORT}`);

      getAccessToken.mockResolvedValue('access token');

      catQuery.mockRejectedValueOnce(new Error('token expired'));

      isTokenExpired.mockReturnValueOnce(true).mockReturnValue(false);

      function* querySaga() {
        try {
          const res = (yield call(
            client.getCatAuthenticated
          )) as GetCatResponse;
          yield put({
            type: 'cat fetched',
            payload: {
              id: res.id,
              name: res.name,
            },
          });
        } catch (e) {
          done();
        }
      }

      const tester = new SagaTester();

      client.initialize(tester as unknown as Store);

      tester.start(querySaga);

      await tester.waitFor(Events.tokenExpired);

      expect(getAccessToken).toHaveBeenCalledTimes(1);

      expect(catQuery).toHaveBeenCalledTimes(1);

      client.signalTokenRefreshFailed();
    });
  });

  describe('Test converters in queries', () => {
    it('makes an unauthenticated query with a converter', async done => {
      const client = new CatsClient(`http://localhost:${PORT}`);

      getAccessToken.mockResolvedValue(null);

      catQuery.mockReturnValue(mockCat);

      function* querySaga() {
        try {
          const res = (yield call(client.getCatWithConverter)) as {
            catId: string;
            catName: string;
          };
          yield put({
            type: 'cat fetched',
            payload: res,
          });
        } catch (e) {
          done(e);
        }
      }

      const tester = new SagaTester();

      client.initialize(tester as unknown as Store);

      tester.start(querySaga);

      await tester.waitFor('cat fetched');

      expect(getAccessToken).not.toHaveBeenCalled();

      expect(catQuery).toHaveBeenCalledTimes(1);

      const actions = tester.getCalledActions();

      expect(actions[actions.length - 1]).toEqual({
        type: 'cat fetched',
        payload: {
          catId: mockCat.id,
          catName: mockCat.name,
        },
      });

      done();
    });
  });

  describe('Test error handling in queries', () => {
    it('throw an InvalidCredentials error', async done => {
      const client = new CatsClient(`http://localhost:${PORT}`);

      getAccessToken.mockResolvedValue(null);

      const error = new GraphQLError(
        'Invalid credentials',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { code: 'INVALID_CREDENTIALS' }
      );
      catQuery.mockRejectedValue(error);

      function* querySaga() {
        try {
          yield call(client.getCat);
          done(new Error('No error was thrown'));
        } catch (e) {
          if (e instanceof InvalidCredentials) {
            done();
          } else {
            done(e);
          }
        }
      }

      const tester = new SagaTester();

      client.initialize(tester as unknown as Store);

      tester.start(querySaga);
    });
  });
});

describe('Test client mutations', () => {
  describe('Test unauthenticated mutations', () => {
    it('makes an unauthenticated mutation', async done => {
      const client = new CatsClient(`http://localhost:${PORT}`);

      getAccessToken.mockResolvedValue(null);

      catMutation.mockReturnValue({ id: 'new cat id' });

      function* mutationSaga() {
        try {
          const res = (yield call(client.createCat, {
            name: 'My new cat',
          })) as CreateCatResponse;
          yield put({
            type: 'cat created',
            payload: {
              id: res.id,
            },
          });
        } catch (e) {
          done(e);
        }
      }

      const tester = new SagaTester();

      client.initialize(tester as unknown as Store);

      tester.start(mutationSaga);

      await tester.waitFor('cat created');

      expect(getAccessToken).not.toHaveBeenCalled();

      expect(catMutation).toHaveBeenCalledTimes(1);

      expect(tester.getCalledActions()).toEqual([
        {
          type: 'cat created',
          payload: {
            id: 'new cat id',
          },
        },
      ]);

      done();
    });
  });

  describe('Test authenticated mutations', () => {
    it('makes an authenticated mutation', async done => {
      const client = new CatsClient(`http://localhost:${PORT}`);

      getAccessToken.mockResolvedValue('access token');

      catMutation.mockReturnValue({ id: 'new cat id' });

      function* mutationSaga() {
        try {
          const res = (yield call([client, client.createCatAuthenticated], {
            name: 'My new cat',
          })) as CreateCatResponse;
          yield put({
            type: 'cat created',
            payload: {
              id: res.id,
            },
          });
        } catch (e) {
          done(e);
        }
      }

      const tester = new SagaTester();

      client.initialize(tester as unknown as Store);

      tester.start(mutationSaga);

      await tester.waitFor('cat created');

      expect(getAccessToken).toHaveBeenCalledTimes(1);

      expect(catMutation).toHaveBeenCalledTimes(1);

      expect(tester.getCalledActions()).toEqual([
        {
          type: 'cat created',
          payload: {
            id: 'new cat id',
          },
        },
      ]);

      done();
    });

    it('makes an authenticated mutation and refreshes the token', async done => {
      const client = new CatsClient(`http://localhost:${PORT}`);

      getAccessToken.mockResolvedValue('access token');

      catMutation
        .mockRejectedValueOnce(new Error('token expired'))
        .mockReturnValue({ id: 'new cat id' });

      isTokenExpired.mockReturnValueOnce(true).mockReturnValue(false);

      function* mutationSaga() {
        try {
          const res = (yield call(client.createCatAuthenticated, {
            name: 'My new cat',
          })) as CreateCatResponse;
          yield put({
            type: 'cat created',
            payload: {
              id: res.id,
            },
          });
        } catch (e) {
          done(e);
        }
      }

      const tester = new SagaTester();

      client.initialize(tester as unknown as Store);

      tester.start(mutationSaga);

      await tester.waitFor(Events.tokenExpired);

      expect(getAccessToken).toHaveBeenCalledTimes(1);

      expect(catMutation).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();

      client.signalTokenRefreshed();

      await tester.waitFor('cat created');

      expect(getAccessToken).toHaveBeenCalledTimes(1);

      expect(catMutation).toHaveBeenCalledTimes(1);

      const actions = tester.getCalledActions();

      expect(actions[actions.length - 1]).toEqual({
        type: 'cat created',
        payload: {
          id: 'new cat id',
        },
      });

      done();
    });

    it('makes an authenticated mutation and fails to refresh the token', async done => {
      const client = new CatsClient(`http://localhost:${PORT}`);

      getAccessToken.mockResolvedValue('access token');

      catMutation
        .mockRejectedValueOnce(new Error('token expired'))
        .mockReturnValue({ id: 'new cat id' });

      isTokenExpired.mockReturnValueOnce(true).mockReturnValue(false);

      function* mutationSaga() {
        try {
          const res = (yield call(client.createCatAuthenticated, {
            name: 'My new cat',
          })) as CreateCatResponse;
          yield put({
            type: 'cat created',
            payload: {
              id: res.id,
            },
          });
        } catch (e) {
          done();
        }
      }

      const tester = new SagaTester();

      client.initialize(tester as unknown as Store);

      tester.start(mutationSaga);

      await tester.waitFor(Events.tokenExpired);

      expect(getAccessToken).toHaveBeenCalledTimes(1);

      expect(catMutation).toHaveBeenCalledTimes(1);

      client.signalTokenRefreshFailed();
    });
  });

  describe('Test converters in mutations', () => {
    it('makes an unauthenticated mutation with a converter', async done => {
      const client = new CatsClient(`http://localhost:${PORT}`);

      getAccessToken.mockResolvedValue(null);

      catMutation.mockReturnValue({ id: 'new cat id' });

      function* mutationSaga() {
        try {
          const res = (yield call(client.createCatWithConverter, {
            name: 'My new cat',
          })) as { newCatId: string };
          yield put({
            type: 'cat created',
            payload: {
              newCatId: res.newCatId,
            },
          });
        } catch (e) {
          done(e);
        }
      }

      const tester = new SagaTester();

      client.initialize(tester as unknown as Store);

      tester.start(mutationSaga);

      await tester.waitFor('cat created');

      expect(getAccessToken).not.toHaveBeenCalled();

      expect(catMutation).toHaveBeenCalledTimes(1);

      const actions = tester.getCalledActions();

      expect(actions[actions.length - 1]).toEqual({
        type: 'cat created',
        payload: {
          newCatId: 'new cat id',
        },
      });

      done();
    });
  });
});

enum RefreshTokenStates {
  valid = 'valid',
  refreshing = 'refreshing',
}

enum StateMachineNames {
  refreshToken = 'refresh token',
}

interface RefreshTokenContext {
  client: CatsClient;
}

class RefreshTokenStm extends StateMachine<
  Events,
  RefreshTokenStates,
  StateMachineNames,
  RefreshTokenContext
> {
  protected readonly initialState = RefreshTokenStates.valid;

  readonly name = StateMachineNames.refreshToken;

  protected readonly spec = {
    [RefreshTokenStates.valid]: {
      transitions: {
        [Events.tokenExpired]: RefreshTokenStates.refreshing,
      },
    },
    [RefreshTokenStates.refreshing]: {
      onEntry: this.refreshToken,
      transitions: {
        [Events.tokenRefreshed]: RefreshTokenStates.valid,
      },
    },
  };

  *refreshToken(): Generator<StrictEffect, void> {
    try {
      yield call(this.context.client.refreshToken);
      yield put({ type: 'block' });
      yield take('run');
      yield call(this.context.client.signalTokenRefreshed);
      yield put({ type: Events.tokenRefreshed });
    } catch {
      yield call(this.context.client.signalTokenRefreshFailed);
      yield put({ type: Events.tokenRefreshFailed });
    }
  }
}

const refreshTokenStm = new RefreshTokenStm();

describe('Test token expired with concurrent calls', () => {
  it('refreshes the token with two different calls starting together', async () => {
    const client = new CatsClient(`http://localhost:${PORT}`);

    getAccessToken.mockResolvedValue('access token');

    catQuery
      .mockRejectedValueOnce(new Error('token expired'))
      .mockResolvedValue({
        id: 'cat id',
        name: 'my cat',
      });

    catMutation
      .mockRejectedValueOnce(new Error('token expired'))
      .mockResolvedValue({
        id: 'new cat id',
      });

    isTokenExpired.mockReturnValue(true);

    const tester = new SagaTester();

    tester.start(stateMachineStarterSaga, refreshTokenStm);

    tester.dispatch(refreshTokenStm.start({ client }));

    client.initialize(tester as unknown as Store);

    const queryPromise = client.getCatAuthenticated();

    const mutationPromise = client.createCatAuthenticated({ name: 'test' });

    await tester.waitFor('block');
    tester.dispatch({ type: 'run' });

    await expect(queryPromise).resolves.toEqual({
      id: 'cat id',
      name: 'my cat',
    });

    await expect(mutationPromise).resolves.toEqual({
      id: 'new cat id',
    });
  });

  it('refreshes the token with two different calls, one expires after refresh and before signal', async () => {
    const client = new CatsClient(`http://localhost:${PORT}`);

    getAccessToken.mockResolvedValue('access token');

    catQuery
      .mockRejectedValueOnce(new Error('token expired'))
      .mockResolvedValue({
        id: 'cat id',
        name: 'my cat',
      });

    catMutation
      .mockRejectedValueOnce(new Error('token expired'))
      .mockResolvedValue({
        id: 'new cat id',
      });

    isTokenExpired.mockReturnValue(true);

    const tester = new SagaTester();

    tester.start(stateMachineStarterSaga, refreshTokenStm);

    tester.dispatch(refreshTokenStm.start({ client }));

    client.initialize(tester as unknown as Store);

    const queryPromise = client.getCatAuthenticated();

    await tester.waitFor('block');

    const mutationPromise = client.createCatAuthenticated({ name: 'test' });

    await tester.waitFor(Events.tokenExpired, true);

    tester.dispatch({ type: 'run' });

    await expect(queryPromise).resolves.toEqual({
      id: 'cat id',
      name: 'my cat',
    });

    await expect(mutationPromise).resolves.toEqual({
      id: 'new cat id',
    });
  });
});

describe('test union types', () => {
  const client = new CatsClient(`http://localhost:${PORT}`);

  function* querySaga() {
    try {
      const response = (yield call(
        client.getAnimal
      )) as GetGenericAnimalResponse;
      if (response.__typename === 'Dog') {
        yield put({
          type: 'doggo fetched',
          payload: response,
        });
      } else if (response.__typename === 'Horse') {
        yield put({
          type: 'horse fetched',
          payload: response,
        });
      }
    } catch (e) {
      console.log(e);
    }
  }
  it('should return horse', async () => {
    const horse: GenericAnimalQuery['animal'] = {
      id: 'horse',
      name: 'Cavallo bianco di napoleone',
      runs: true,
      __typename: 'Horse',
    };
    animalQuery.mockReturnValue(horse);
    getAccessToken.mockResolvedValue('access token');

    const tester = new SagaTester();
    client.initialize(tester as unknown as Store);

    tester.start(querySaga);

    const event = (await tester.waitFor(
      'horse fetched'
    )) as unknown as AnyAction;

    expect(event.payload).toStrictEqual(horse);
  });
  it('should return dog', async () => {
    const dog: GenericAnimalQuery['animal'] = {
      id: 'doggo',
      name: 'pluto',
      barks: false,
      __typename: 'Dog',
    };
    animalQuery.mockReturnValue(dog);
    getAccessToken.mockResolvedValue('access token');

    const tester = new SagaTester();
    client.initialize(tester as unknown as Store);

    tester.start(querySaga);

    const event = (await tester.waitFor(
      'doggo fetched'
    )) as unknown as AnyAction;

    expect(event.payload).toStrictEqual(dog);
  });
});

describe('test custom error handling', () => {
  const client = new CatsClient(`http://localhost:${PORT}`);

  function* querySaga() {
    try {
      const res = (yield call(client.getCat)) as GetCatResponse;
      yield put({
        type: 'cat fetched',
        payload: {
          id: res.id,
          name: res.name,
        },
      });
    } catch (e) {
      yield put({
        type: 'ERROR_IN_SAGA',
      });
    }
  }

  it('test events send on error catched', async () => {
    const error = new GraphQLError(
      'handled error',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { code: 'CATCHABLE_ERROR' }
    );
    catQuery.mockRejectedValueOnce(error);
    const tester = new SagaTester();
    client.initialize(tester as unknown as Store);

    tester.start(querySaga);

    await tester.waitFor('ERROR_CATCHED');
    await tester.waitFor('ERROR_IN_SAGA');
  });
});

describe('test custom headers', function () {
  const client = new CatsClient(`http://localhost:${PORT}`);

  function* querySaga() {
    try {
      const res = (yield call(client.getCat)) as GetCatResponse;
      yield put({
        type: 'cat fetched',
        payload: {
          id: res.id,
          name: res.name,
        },
      });
    } catch (e) {
      yield put({
        type: 'ERROR_IN_SAGA',
      });
    }
  }

  it('should have my very custom header', async () => {
    const mockCat = {
      id: 'cat id',
      name: 'my cat',
    };
    catQuery.mockReturnValue(mockCat);
    const tester = new SagaTester();
    client.initialize(tester as unknown as Store);

    tester.start(querySaga);

    await tester.waitFor('cat fetched');
    expect(lastSeenHeaders!.has('my-very-custom-header')).toBeTruthy();
    expect(lastSeenHeaders!.get('my-very-custom-header')).toEqual('value');
  });
});

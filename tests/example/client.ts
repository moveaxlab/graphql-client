import fetch from 'node-fetch';
import { GraphQLClient } from '../../src';
import { Events } from './events';
import { catQuery, GetCatRequest, GetCatResponse } from './queries/cat';
import {
  createCatMutation,
  CreateCatRequest,
  CreateCatResponse,
} from './mutations/createCat';
import { getAccessToken, isTokenExpired } from './authentication';
import { InvalidCredentials } from './errors/invalid-credentials';
import { Store } from 'redux';
import { refreshToken } from './mutations/refreshToken';
import result from './__generated__/introspection-result';
import {
  getGenericAnimal,
  GetGenericAnimalRequest,
  GetGenericAnimalResponse,
} from './queries/getGenericAnimal';
import { CatchableError } from './errors/catchableError';

export class CatsClient extends GraphQLClient {
  private store?: Store;

  constructor(host: string) {
    super(host, {
      authentication: { type: 'headers', getAccessToken, isTokenExpired },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetch: fetch as any,
      introspectionResult: result,
      defaultHeaders: {
        'my-very-custom-header': 'value',
      },
    });
  }

  initialize = (store: Store) => {
    this.store = store;
  };

  readonly errorMap = {
    INVALID_CREDENTIALS: InvalidCredentials,
    CATCHABLE_ERROR: CatchableError,
  };

  onTokenExpired = () => {
    this.store!.dispatch({
      type: Events.tokenExpired,
    });
  };

  onErrorCallback = async (_type, _name, _executionTime, e) => {
    if (e instanceof CatchableError) {
      this.store?.dispatch({
        type: 'ERROR_CATCHED',
      });
    }
  };

  getCat = this.createQuery<GetCatRequest, GetCatResponse>(catQuery);

  getCatAuthenticated = this.createQuery<GetCatRequest, GetCatResponse>(
    catQuery,
    { authenticated: true }
  );

  getCatWithConverter = this.createQuery<
    GetCatRequest,
    GetCatResponse,
    { catName: string; catId: string }
  >(catQuery, {
    converter: (res: GetCatResponse) => ({ catName: res.name, catId: res.id }),
  });

  createCat = this.createMutation<CreateCatRequest, CreateCatResponse>(
    createCatMutation
  );

  createCatAuthenticated = this.createMutation<
    CreateCatRequest,
    CreateCatResponse
  >(createCatMutation, { authenticated: true });

  createCatWithConverter = this.createMutation<
    CreateCatRequest,
    CreateCatResponse,
    { newCatId: string }
  >(createCatMutation, {
    converter: (res: CreateCatResponse) => ({ newCatId: res.id }),
  });

  getAnimal = this.createQuery<
    GetGenericAnimalRequest,
    GetGenericAnimalResponse
  >(getGenericAnimal);

  refreshToken = this.createMutation<void, void>(refreshToken);
}

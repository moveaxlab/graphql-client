import { SubscriptionService } from '../../src';
import { AnyAction, Store } from 'redux';
import { Events } from './events';
import { getAccessToken } from './authentication';
import { catCreatedSubscription } from './subscriptions/catCreated';
import {
  CatCreatedSubscription,
  CatCreatedSubscriptionVariables,
} from './__generated__/types';

export class SubscriptionsClient extends SubscriptionService {
  private store!: Store;

  initialize = (store: Store) => {
    this.store = store;
    this.signalReady();
  };

  protected connectionParams = async () => {
    const accessToken = await getAccessToken();
    if (accessToken) {
      return {
        authorization: `Bearer ${accessToken}`,
      };
    } else {
      return {};
    }
  };

  protected dispatch = (event: AnyAction | null) => {
    if (event) {
      this.store.dispatch(event);
    }
  };

  protected isTokenExpired = (error: CloseEvent) => {
    return error.code === 4403;
  };

  protected onConnected = () => {
    this.store.dispatch({ type: Events.socketConnected });
  };

  protected onConnecting = () => {
    this.store.dispatch({ type: Events.socketConnecting });
  };

  protected onDisconnected = () => {
    this.store.dispatch({ type: Events.socketDisconnected });
  };

  protected onError = (error: CloseEvent) => {
    this.store.dispatch({
      type: Events.socketError,
      payload: error,
      error: true,
    });
  };

  protected onSocketConnectionError = (error: CloseEvent) => {
    this.store.dispatch({
      type: Events.socketConnectionError,
      payload: error,
      error: true,
    });
  };

  protected onSubscriptionError = (error: Error) => {
    this.store.dispatch({
      type: Events.socketSubscriptionError,
      payload: error,
      error: true,
    });
  };

  protected onTokenExpired = () => {
    this.store.dispatch({ type: Events.tokenExpired });
  };

  protected latencyMeasured = (latency: number) => {
    console.log(latency);
  };

  catCreated = this.makeSubscription<
    CatCreatedSubscriptionVariables,
    CatCreatedSubscription,
    { type: 'catCreated'; payload: CatCreatedSubscription }
  >({
    eventCreator: event => ({ type: 'catCreated', payload: event }),
    name: 'catCreated',
    subscription: catCreatedSubscription,
  });
}

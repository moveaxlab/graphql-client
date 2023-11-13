import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  NormalizedCacheObject,
  PossibleTypesMap,
} from '@apollo/client/core';
import { createUploadLink } from 'apollo-upload-client';
import {
  DocumentNode,
  FieldNode,
  GraphQLError,
  OperationDefinitionNode,
} from 'graphql';
import { ClientError } from './client-error';
import { NetworkError } from './network-error';
import { SentryLink } from 'apollo-link-sentry';
import { Operation } from '@apollo/client/core';
import { RequestVariables } from './types';

export interface IntrospectionResultData {
  __schema: {
    types: {
      kind: string;
      name: string;
      possibleTypes: {
        name: string;
      }[];
    }[];
  };
}

function getPossibleTypes(
  introspectionResult: IntrospectionResultData
): PossibleTypesMap {
  return introspectionResult.__schema.types.reduce(
    (res, { name, possibleTypes }) => {
      res[name] = possibleTypes.map(({ name }) => name);
      return res;
    },
    {} as PossibleTypesMap
  );
}

interface RequestContext {
  headers: {
    authorization?: string;
  } & Record<string, string>;
}

interface ApolloClientError {
  readonly graphQLErrors: GraphQLError[];
}

export type GraphQLAuthenticationOptions =
  | { type: 'cookies'; isTokenExpired: (e: Error) => boolean }
  | {
      type: 'headers';
      isTokenExpired: (e: Error) => boolean;
      getAccessToken: () => Promise<string | null>;
    };

export interface GraphQLClientOptions {
  authentication: GraphQLAuthenticationOptions;
  fetch?: WindowOrWorkerGlobalScope['fetch'];
  introspectionResult?: IntrospectionResultData;
  defaultHeaders?: Record<string, string>;
  shouldHandleOperation?: (operation: Operation) => boolean;
}

export interface ClientErrorMap {
  [key: string]: typeof ClientError;
}

export abstract class GraphQLClient {
  abstract readonly errorMap: ClientErrorMap;

  private readonly client: ApolloClient<NormalizedCacheObject>;

  private readonly defaultHeaders: Record<string, string>;

  constructor(host: string, private readonly options: GraphQLClientOptions) {
    const uploadLink = createUploadLink({
      uri: host,
      fetch: options.fetch,
      ...(options.authentication.type === 'cookies'
        ? { credentials: 'include' }
        : undefined),
    });

    const sentryLink = new SentryLink({
      shouldHandleOperation: options.shouldHandleOperation,
      attachBreadcrumbs: {
        includeQuery: false,
        includeVariables: true,
        includeFetchResult: false,
        includeError: true,
        includeCache: false,
        includeContext: false,
      },
    });

    this.client = new ApolloClient({
      link: ApolloLink.from([sentryLink, uploadLink]),
      cache: new InMemoryCache({
        addTypename: false,
        possibleTypes: options.introspectionResult
          ? getPossibleTypes(options.introspectionResult)
          : {},
        resultCaching: false,
      }),
    });
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  private tokenRefreshPromise: Promise<void> | null = null;

  private tokenRefreshed: (() => void) | null = null;

  private tokenRefreshFailed: (() => void) | null = null;

  private getRefreshPromise = () => {
    if (!this.tokenRefreshPromise) {
      this.tokenRefreshPromise = new Promise((resolve, reject) => {
        this.tokenRefreshed = resolve;
        this.tokenRefreshFailed = reject;
      });
    }
    return this.tokenRefreshPromise;
  };

  private signalTokenExpired = () => {
    this.onTokenExpired();
  };

  abstract onTokenExpired: () => void;

  onSuccessCallback?: (
    type: string,
    name: string,
    totalExecutionTime: number
  ) => Promise<void>;

  onErrorCallback?: (
    type: string,
    name: string,
    totalExecutionTime: number,
    error: Error
  ) => Promise<void>;

  signalTokenRefreshed = (): void => {
    if (this.tokenRefreshed) {
      this.tokenRefreshed();
      this.tokenRefreshPromise = null;
      this.tokenRefreshed = null;
      this.tokenRefreshFailed = null;
    }
  };

  signalTokenRefreshFailed = (): void => {
    if (this.tokenRefreshFailed) {
      this.tokenRefreshFailed();
      this.tokenRefreshPromise = null;
      this.tokenRefreshed = null;
      this.tokenRefreshFailed = null;
    }
  };

  private convertErrors = (e: Error | ApolloClientError): Error | undefined => {
    if ('graphQLErrors' in e && e.graphQLErrors.length > 0) {
      return e.graphQLErrors
        .reduce((res, error) => {
          if (error.extensions && error.extensions.code in this.errorMap) {
            res = res.concat(
              this.errorMap[error.extensions.code].acceptsDetails
                ? [
                    // This is not an abstract class
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    new this.errorMap[error.extensions.code](
                      undefined,
                      error.extensions.details
                    ),
                  ]
                : // This is not an abstract class
                  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                  // @ts-ignore
                  [new this.errorMap[error.extensions.code]()]
            );
          }
          return res;
        }, [] as Error[])
        .pop();
    }
    if (
      e instanceof Error &&
      ('networkError' in e ||
        ('message' in e && e.message.startsWith('Network error')))
    ) {
      return new NetworkError(e);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private withTokenRefresh = <A extends unknown[], R>(
    fn: (...args: unknown[]) => Promise<R>
  ): ((...args: unknown[]) => Promise<R>) => {
    const isTokenExpired = this.options.authentication.isTokenExpired;
    const signalTokenExpired = this.signalTokenExpired;
    const getRefreshPromise = this.getRefreshPromise;

    return async function (...args: unknown[]): Promise<R> {
      const waitTokenRefresh = getRefreshPromise();
      try {
        return await fn(...args);
      } catch (e) {
        if (isTokenExpired(e)) {
          signalTokenExpired();
          await waitTokenRefresh;
          return await fn(...args);
        } else {
          throw e;
        }
      }
    };
  };

  private getOperationName = (documentNode: DocumentNode): string => {
    if (documentNode.definitions.length !== 1) {
      throw new Error('Too many definitions in documentNode');
    }
    const operation = documentNode.definitions[0] as OperationDefinitionNode;
    if (operation.selectionSet.selections.length !== 1) {
      throw new Error('Too many selections in documentNode');
    }
    const selection = operation.selectionSet.selections[0] as FieldNode;
    return selection.name.value;
  };

  protected createMutation = <V extends RequestVariables, R, TR = R>(
    mutation: DocumentNode,
    options?: {
      authenticated?: boolean;
      converter?: (response: R) => TR;
    }
  ): ((variables: V) => Promise<TR>) => {
    const getAccessToken =
      this.options.authentication.type === 'headers'
        ? this.options.authentication.getAccessToken
        : undefined;
    const client = this.client;
    const defaultHeaders = this.defaultHeaders;
    const convertErrors = this.convertErrors;
    const operationName = this.getOperationName(mutation);
    const onSuccess = this.onSuccessCallback;
    const onError = this.onErrorCallback;

    const res = async function (variables: V): Promise<TR> {
      const context: RequestContext = {
        headers: defaultHeaders,
      };
      if (options?.authenticated && getAccessToken) {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          throw new Error('Missing access token');
        }
        context.headers.authorization = `Bearer ${accessToken}`;
      }

      const start = Date.now();

      try {
        const response = await client.mutate<R>({
          mutation,
          variables: variables ? variables : undefined,
          context,
        });

        if (onSuccess) {
          await onSuccess('mutation', operationName, Date.now() - start);
        }

        const result = response.data![operationName];

        if (options?.converter) {
          return options.converter(result);
        } else {
          return result;
        }
      } catch (e) {
        const covertedError = convertErrors(e) || e;
        if (onError) {
          await onError(
            'mutation',
            operationName,
            Date.now() - start,
            covertedError
          );
        }
        throw covertedError;
      }
    };

    if (options?.authenticated) {
      return this.withTokenRefresh(res);
    } else {
      return res;
    }
  };

  protected createQuery = <V extends RequestVariables, R, TR = R>(
    query: DocumentNode,
    options?: {
      authenticated?: boolean;
      converter?: (response: R) => TR;
    }
  ): ((variables: V) => Promise<TR>) => {
    const getAccessToken =
      this.options.authentication.type === 'headers'
        ? this.options.authentication.getAccessToken
        : undefined;
    const client = this.client;
    const defaultHeaders = this.defaultHeaders;
    const convertErrors = this.convertErrors;
    const operationName = this.getOperationName(query);
    const onSuccess = this.onSuccessCallback;
    const onError = this.onErrorCallback;

    const res = async function (variables: V): Promise<TR> {
      const context: RequestContext = {
        headers: defaultHeaders,
      };
      if (options?.authenticated && getAccessToken) {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          throw new Error('Missing access token');
        }
        context.headers.authorization = `Bearer ${accessToken}`;
      }

      const start = Date.now();

      try {
        const response = await client.query<R>({
          query,
          variables: variables ? variables : undefined,
          context,
          fetchPolicy: 'no-cache',
        });

        if (onSuccess) {
          await onSuccess('query', operationName, Date.now() - start);
        }

        const result = response.data![operationName];

        if (options?.converter) {
          return options.converter(result);
        } else {
          return result;
        }
      } catch (e) {
        const convertedError = convertErrors(e) || e;
        if (onError) {
          await onError(
            'query',
            operationName,
            Date.now() - start,
            convertedError
          );
        }
        throw convertedError;
      }
    };

    if (options?.authenticated) {
      return this.withTokenRefresh(res);
    } else {
      return res;
    }
  };
}

# GraphQL client utils
![NPM](https://img.shields.io/npm/l/%40moveaxlab%2Fgraphql-client)
[![npm](https://img.shields.io/npm/v/@moveaxlab/graphql-client)](https://www.npmjs.com/package/@moveaxlab/graphql-client)
![Static Badge](https://img.shields.io/badge/node_version-_%3E%3D12-green)

This package contains utilities to create GraphQL clients for queries, mutations, and subscriptions.
The clients provide authentication via cookies or a bearer token authorization header.

## Installation

Install the client:

```bash
yarn add @moveaxlab/graphql-client
```

## Usage

### Schema and types generation

Install code generation packages from `graphql-codegen`:

- `@graphql-codegen/cli` is the base package
- `@graphql-codegen/add` adds custom code to generated files
- `@graphql-codegen/schema-ast` allows to stitch together different schemas
- `@graphql-codegen/typescript` and `@graphql-codegen/typescript-operations` are used for type generation
- `@graphql-codegen/fragment-matcher` allows handling of union types

```yaml
overwrite: true
generates:
  # generated schema file
  ./schema.graphql:
    schema:
      - ./schemas/common.graphql # add all the .graphql files you want to combine here
    plugins:
      - add: "# THIS IS A GENERATED FILE. DO NOT EDIT IT."
      - schema-ast

  # generated file with types 
  ./src/api/graphql/__generated__/types.ts:
    plugins:
      - add: "/* eslint-disable */"
      - add: "/* THIS IS A GENERATED FILE. DO NOT EDIT */"
      - typescript
      - typescript-operations
    schema:
      - ./schema.graphql # your combined, generated schema
    documents:
      - ./src/api/graphql/queries/*.ts # path to the files containing gql tags
    config:
      scalars:
        Long: number # add any other custom scalar here
      maybeValue: T | undefined
      avoidOptionals: false
      skipTypename: true
      declarationKind: interface
      flattenGeneratedTypes: true

  # generated introspection results
  ./app/api/graphql/__generated__/introspection-result.ts:
    schema:
      - ./schema.graphql # your combined, generated schema
    plugins:
      - fragment-matcher
```

The introspection results configuration is only needed if your schema has interfaces/unions in it.

### Authentication

Both the query and mutation client and the subscription client handle authentication for you.

Authentication can be performed in one of two ways:

- using cookies (aka `cookies`)
- using a bearer token authorization header (aka `headers`)

When using header authentication, you must provide to both clients a `getAccessToekn` function that
returns the access token. The clients will use this function when making requests that need authentication.

> Subscriptions are always authenticated.

In both types of authentication, you need to pass to the clients a `isTokenExpired` function.
This function will be invoked when an error happens, and should return `true` if the error indicates that the access token is expired.

You must implement the `onTokenExpired` abstract method when extending the client.

This method will be called when a query or mutation fails for a token expired error.
Your token refresh logic must start when this method is called.
The token refresh logic must call the `signalTokenRefreshed` or `signalTokenRefreshFailed` methods of the client,
based on the outcome of the refresh operation.

> The `onTokenExpired` method may be called multiple times, if several queries or mutations happen while the token is expired.

### Query + Mutation Client

To create a query and mutation client, extend the `GraphQLClient` class.
You must implement the abstract field `errorMap`, and the abstract method `onTokenExpired`.

The `errorMap` field must be a dictionary mapping error codes to error classes.
When an error happens, if its error code matches something in the `errorMap`, its matching error class is instantiated and thrown.

To implement a query or a mutation, use the `createQuery` or `createMutation` protected methods.
Both methods take in input a `documentNode` (output of the `gql` tag) as first parameters,
and some options as second parameter.

The possible options for queries and mutations are:
- `authenticated`, boolean, true if the query should be authenticated and should thus attempt to refresh the token
- `converter`, a function that converts the return type to something else

Both methods take three generics:
- `V`, the input type
- `R`, the output type
- `TR`, the converted output type (only needed if the `converter` options is defined)

```typescript
class Client extends GraphQLClient {
  myQuery = this.makeQuery<RequestType, ReturnType, ConvertedReturnType>(
    query,
    {
      authenticated: true,
      converter: (res: ReturnType): ConvertedReturnType => { /* ... */ },
    }
  );
}
```

### Subscription Client

To create a client to handle subscription extend the `SubscriptionClient` class.
The subscription client only works with the [`graphql-ws`](https://github.com/enisdenjo/graphql-ws) protocol.

The constructor take an object of type options.

| Name      | Required	    | Type 	                             | Description  	                                                                                                                                                                                                                                                        | 
|-----------|--------------|------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| host	     | <b>true</b>	 | string 	                           | URL of the GraphQL over WebSocket Protocol compliant server to connect.	                                                                                                                                                                                              |
| wsImpl    | false        | unknown                            | A custom WebSocket implementation to use instead of the one provided by the global scope. Mostly useful for when using the client outside of the browser environment.                                                                                                 |
| retryWait | false        | (retries: number) => Promise<void> | Control the wait time between retries. You may implement your own strategy by timing the resolution of the returned promise with the retries count. Retries argument counts actual connection attempts, so it will begin with 0 after the first retryable disconnect. |

The class should implement the following methods

- `connectionParams: () => Promise<Record<string, unknown>>`: Optional parameters, passed through the payload field with the ConnectionInit message, that the client specifies when establishing a connection with the server. You can use this for securely passing arguments for authentication.
- `isTokenExpired: (event: CloseEvent) => boolean;`: Must return true if the CloseEvent means that the token is expired.
- `onTokenExpired: () => void;`: Called when an error representing a TokenExpired happens.
- `onError: (error: CloseEvent) => void;`: Called when a fatal error happens.
- `dispatch: (event: unknown | null) => void;`: Called when an event is received.
- `onConnecting: () => void;`: Called when socket is connecting
- `onConnected: () => void;`: Called when socket is connected
- `onDisconnected: () => void;`: Called when socket is disconnected
- `latencyMeasured: (latencyMs: number) => void;`: Used in order to debug the latency between client and socket

The `signalReady` method must be called after initialization is completed.
If you need custom initialization logic, call `signalReady` after it is complete, otherwise you can call `signalReady` in your constructor.

To implement a subscription use the `makeSubscription` protected method. The method take in input an object with the followgin keys:

| Name          | Type 	                      | Description  	                                                  | 
|---------------|-----------------------------|-----------------------------------------------------------------|
| subscription	 | `documentNode` 	            | The output of the `gql` tag                                     |
| name          | string                      | The name of the subscription. This must be unique.              |
| eventCreator  | `(event: R) => TR \| null;` | A method that handle the received payload from the subscription |

This method take three generics: 
- `V`, the input type
- `R`, The output type
- `TR`, the converted output type (if not present it's equal to `R`)

```typescript
class Client extends SubscriptionClient {
     
    //... class implementation here
     
    subscription = this.makeSubscription<
        SubscriptionInput,
        SubscriptionReceivedPayload,
        SubscriptionConvertedRecevidedPaylod
      >({
        subscription: gqlSubscription,
        name: 'subscriptionName',
        eventCreator: (res: SubscriptionReceivedPayload) : SubscriptionConvertedRecevidedPaylod => {/*...*/},
      });

}
```

Before activating a subscription, you must connect the subscription client, by calling the `connect` method.
If your subscription server requires authentication, you must wait for your authentication token to be available before calling `connect`.

Any subscriptions started before calling the `connect` method will block until the connection has been established.

To subscribe and unsubscribe use:

```typescript
const client = new Client();

client.subscription.subscribe(input);

client.subscription.unsubscribe(input);
```

Subscriptions are kept between socket connection and reconnection.

Calling the `disconnect` method on the subscription client will cancel all subscriptions.

The `getActiveSubscriptions` method returns a list of the currently active subscription, as a list of subscription names and parameters.
You can rely on this method to implement custom fallback logic if the socket is disconnected.

Socket connection and disconnection is signaled through the `onConnected` and `onDisconnected` methods.

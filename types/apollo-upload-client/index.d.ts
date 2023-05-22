declare module 'apollo-upload-client' {
  import { ApolloLink, HttpOptions } from '@apollo/client';

  export function createUploadLink(options: HttpOptions): ApolloLink;
}

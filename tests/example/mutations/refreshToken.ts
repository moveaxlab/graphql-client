import gql from 'graphql-tag';

export const refreshToken = gql`
  mutation RefreshToken {
    refreshToken
  }
`;

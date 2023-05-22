import gql from 'graphql-tag';

export const catCreatedSubscription = gql`
  subscription CatCreated {
    catCreated {
      id
      name
    }
  }
`;

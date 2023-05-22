import gql from 'graphql-tag';
import { GenericAnimalQuery } from '../__generated__/types';

export const getGenericAnimal = gql`
  query GenericAnimal {
    animal {
      ... on Dog {
        barks
        id
        name
        __typename
      }
      ... on Horse {
        id
        name
        runs
        __typename
      }
    }
  }
`;

export type GetGenericAnimalRequest = void;
export type GetGenericAnimalResponse = GenericAnimalQuery['animal'];

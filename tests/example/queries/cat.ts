import gql from 'graphql-tag';
import { CatQuery } from '../__generated__/types';

export const catQuery = gql`
  query Cat {
    cat {
      id
      name
    }
  }
`;

export type GetCatRequest = void;
export type GetCatResponse = CatQuery['cat'];

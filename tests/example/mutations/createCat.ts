import gql from 'graphql-tag';
import {
  CreateCatMutation,
  CreateCatMutationVariables,
} from '../__generated__/types';

export const createCatMutation = gql`
  mutation CreateCat($name: String!) {
    addCat(catInput: { name: $name }) {
      id
    }
  }
`;

export type CreateCatRequest = CreateCatMutationVariables;
export type CreateCatResponse = CreateCatMutation['addCat'];

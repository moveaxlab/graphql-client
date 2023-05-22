/* eslint-disable */
/* THIS IS A GENERATED FILE. DO NOT EDIT */
export type Maybe<T> = T | undefined;


/** All built-in and custom scalars, mapped to their actual values */
export interface Scalars {
  ID: string;
  String: string;
  Boolean: boolean;
  Int: number;
  Float: number;
}

export interface Animal {
  id: Scalars['ID'];
  name: Scalars['String'];
}

export type AnimalResult = Dog | Horse;

export interface Cat {
  id: Scalars['ID'];
  name: Scalars['String'];
}

export interface CatCreated {
  id: Scalars['ID'];
  name: Scalars['String'];
}

export interface CatInput {
  name: Scalars['String'];
}

export interface CatResponse {
  id: Scalars['ID'];
}

export interface Dog  extends Animal {
  id: Scalars['ID'];
  name: Scalars['String'];
  barks: Scalars['Boolean'];
}

export interface Horse  extends Animal {
  id: Scalars['ID'];
  name: Scalars['String'];
  runs: Scalars['Boolean'];
}

export interface Mutation {
  addCat: CatResponse;
  refreshToken?: Maybe<Scalars['Boolean']>;
}


export interface MutationAddCatArgs {
  catInput?: Maybe<CatInput>;
}

export interface Query {
  cat: Cat;
  animal: AnimalResult;
}

export interface Subscription {
  catCreated: CatCreated;
}

export type CreateCatMutationVariables = {
  name: Scalars['String'];
};


export type CreateCatMutation = { addCat: Pick<CatResponse, 'id'> };

export type RefreshTokenMutationVariables = {};


export type RefreshTokenMutation = Pick<Mutation, 'refreshToken'>;

export type CatQueryVariables = {};


export type CatQuery = { cat: Pick<Cat, 'id' | 'name'> };

export type GenericAnimalQueryVariables = {};


export type GenericAnimalQuery = { animal: (
    { __typename: 'Dog' }
    & Pick<Dog, 'barks' | 'id' | 'name'>
  ) | (
    { __typename: 'Horse' }
    & Pick<Horse, 'id' | 'name' | 'runs'>
  ) };

export type CatCreatedSubscriptionVariables = {};


export type CatCreatedSubscription = { catCreated: Pick<CatCreated, 'id' | 'name'> };

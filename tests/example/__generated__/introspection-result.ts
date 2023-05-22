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
const result: IntrospectionResultData = {
  __schema: {
    types: [
      {
        kind: 'UNION',
        name: 'AnimalResult',
        possibleTypes: [
          {
            name: 'Dog',
          },
          {
            name: 'Horse',
          },
        ],
      },
      {
        kind: 'INTERFACE',
        name: 'Animal',
        possibleTypes: [
          {
            name: 'Dog',
          },
          {
            name: 'Horse',
          },
        ],
      },
    ],
  },
};
export default result;

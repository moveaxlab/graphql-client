export class NetworkError extends Error {
  constructor(e: Error) {
    super(e.message);
  }
}

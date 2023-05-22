import { ClientError } from '../../../src/client-error';

export class InvalidCredentials extends ClientError {
  constructor() {
    super();
    this.constructor = InvalidCredentials;
    Object.setPrototypeOf(this, InvalidCredentials.prototype);
  }
}

import { ClientError } from '../../../src/client-error';

export class CatchableError extends ClientError {
  constructor() {
    super();
    this.constructor = CatchableError;
    Object.setPrototypeOf(this, CatchableError.prototype);
  }
}

export class MaskingOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaskingOperationError';
  }
}

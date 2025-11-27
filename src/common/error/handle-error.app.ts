export class AppError extends Error {
  constructor(
    public code: number = 500,
    public message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

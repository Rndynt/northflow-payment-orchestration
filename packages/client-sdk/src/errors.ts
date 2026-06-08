export interface PaymentOrchestrationClientErrorOptions {
  status: number;
  code?: string;
  details?: unknown;
  serviceError?: unknown;
  responseBody?: unknown;
}

export class PaymentOrchestrationClientError extends Error {
  public readonly status: number;
  public readonly code: string | undefined;
  public readonly details: unknown;
  public readonly serviceError: unknown;

  constructor(message: string, options: PaymentOrchestrationClientErrorOptions);
  constructor(message: string, status: number, code?: string, details?: unknown, serviceError?: unknown);
  constructor(
    message: string,
    statusOrOptions: number | PaymentOrchestrationClientErrorOptions,
    code?: string,
    details?: unknown,
    serviceError?: unknown,
  ) {
    super(message);
    this.name = 'PaymentOrchestrationClientError';

    if (typeof statusOrOptions === 'number') {
      this.status = statusOrOptions;
      this.code = code;
      this.details = details ?? null;
      this.serviceError = serviceError;
      return;
    }

    this.status = statusOrOptions.status;
    this.code = statusOrOptions.code;
    this.details = statusOrOptions.details ?? null;
    this.serviceError = statusOrOptions.serviceError ?? statusOrOptions.responseBody;
  }
}

export class PaymentOrchestrationNetworkError extends Error {
  public readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'PaymentOrchestrationNetworkError';
    this.cause = cause;
  }
}

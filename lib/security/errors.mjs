const FALLBACK_PUBLIC_MESSAGE = 'The request could not be completed';

export class SecurityError extends Error {
  constructor(status, code, publicMessage, options = {}) {
    super(publicMessage, options.cause ? { cause: options.cause } : undefined);
    this.name = 'SecurityError';
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export function mapError(error, requestId) {
  if (error instanceof SecurityError) {
    return {
      status: error.status,
      payload: {
        error: { code: error.code, message: error.publicMessage },
        requestId,
      },
    };
  }

  return {
    status: 500,
    payload: {
      error: { code: 'INTERNAL_ERROR', message: FALLBACK_PUBLIC_MESSAGE },
      requestId,
    },
  };
}

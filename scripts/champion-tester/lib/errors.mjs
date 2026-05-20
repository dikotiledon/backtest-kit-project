/**
 * Custom error classes for structured error handling.
 */

export class AppError extends Error {
  constructor(message, code = 'APP_ERROR', meta = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = 500;
    this.meta = meta;
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON() {
    return {
      ok: false,
      error: this.message,
      code: this.code,
      ...(Object.keys(this.meta).length ? { meta: this.meta } : {}),
    };
  }
}

export class ValidationError extends AppError {
  constructor(message, meta = {}) {
    super(message, 'VALIDATION_ERROR', meta);
    this.statusCode = 400;
  }
}

export class ExchangeError extends AppError {
  constructor(message, meta = {}) {
    super(message, 'EXCHANGE_ERROR', meta);
    this.statusCode = 502;
  }
}

export class RiskError extends AppError {
  constructor(message, meta = {}) {
    super(message, 'RISK_ERROR', meta);
    this.statusCode = 403;
  }
}

export class ConfigError extends AppError {
  constructor(message, meta = {}) {
    super(message, 'CONFIG_ERROR', meta);
    this.statusCode = 500;
  }
}

export class NotFoundError extends AppError {
  constructor(message, meta = {}) {
    super(message, 'NOT_FOUND', meta);
    this.statusCode = 404;
  }
}

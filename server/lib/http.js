import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Sign in to continue.') =>
  new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this resource.') =>
  new ApiError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new ApiError(404, 'not_found', message);
export const conflict = (message, code = 'conflict') => new ApiError(409, code, message);

/** Validates input with a zod schema, returning the parsed value. */
export function parse(schema, data) {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues.map((issue) => ({
        field: issue.path.join('.') || '(body)',
        message: issue.message,
      }));
      throw new ApiError(422, 'validation_failed', 'Some fields need attention.', details);
    }
    throw error;
  }
}

export function errorHandler(error, req, res, _next) {
  if (error instanceof ApiError) {
    return res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
  }

  if (error?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: { code: 'file_too_large', message: 'Images must be 5 MB or smaller.' },
    });
  }
  if (error?.code === '23505') {
    return res.status(409).json({
      error: { code: 'conflict', message: 'That record already exists.' },
    });
  }
  if (error?.code === '23503') {
    return res.status(409).json({
      error: { code: 'conflict', message: 'This record is still referenced elsewhere.' },
    });
  }

  console.error('[api] unhandled error', error);
  return res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong on our side.' },
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found.' } });
}

/** Normalises Kenyan mobile numbers to the 2547XXXXXXXX / 2541XXXXXXXX form M-Pesa expects. */
export function normalizeKenyanPhone(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  let local = digits;
  if (local.startsWith('254')) local = local.slice(3);
  else if (local.startsWith('0')) local = local.slice(1);

  if (!/^[17]\d{8}$/.test(local)) {
    throw badRequest('Enter a valid Kenyan mobile number, e.g. 0712 345 678.');
  }
  return `254${local}`;
}

export function maskPhone(phone) {
  if (!phone) return null;
  const value = String(phone);
  return `${value.slice(0, 5)}***${value.slice(-2)}`;
}

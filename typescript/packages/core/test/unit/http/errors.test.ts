import { describe, it, expect } from 'vitest';
import { CopassApiError, CopassNetworkError, CopassValidationError } from '../../../src/http/errors.js';

describe('CopassApiError', () => {
  it('stores status, body, and path', () => {
    const error = new CopassApiError('Not found', 404, { detail: 'Entity not found' }, '/api/v1/entities/abc');
    expect(error.message).toBe('Not found');
    expect(error.status).toBe(404);
    expect(error.body).toEqual({ detail: 'Entity not found' });
    expect(error.path).toBe('/api/v1/entities/abc');
    expect(error.name).toBe('CopassApiError');
  });

  it('is instanceof Error', () => {
    const error = new CopassApiError('fail', 500);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(CopassApiError);
  });
});

describe('CopassNetworkError', () => {
  it('wraps a cause', () => {
    const cause = new Error('ECONNREFUSED');
    const error = new CopassNetworkError('Network failed', cause);
    expect(error.cause).toBe(cause);
    expect(error.name).toBe('CopassNetworkError');
  });
});

describe('CopassValidationError', () => {
  it('stores field names', () => {
    const error = new CopassValidationError('Invalid input', ['query', 'project_id']);
    expect(error.fields).toEqual(['query', 'project_id']);
    expect(error.name).toBe('CopassValidationError');
  });
});

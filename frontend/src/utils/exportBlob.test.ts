import { describe, expect, it } from 'vitest';
import { assertValidCsvExport, InvalidExportError } from './exportBlob';

const blob = (body: string, type = '') => new Blob([body], { type });

describe('assertValidCsvExport', () => {
  it('accepts a CSV with a CSV content type', async () => {
    await expect(assertValidCsvExport(blob('ID,Name\n1,Ada', 'text/csv'))).resolves.toBeUndefined();
    await expect(
      assertValidCsvExport(blob('ID,Name\n1,Ada', 'text/csv; charset=utf-8')),
    ).resolves.toBeUndefined();
  });

  it('accepts generic or missing content types when the body looks like CSV', async () => {
    await expect(assertValidCsvExport(blob('ID,Name\n1,Ada'))).resolves.toBeUndefined();
    await expect(
      assertValidCsvExport(blob('ID,Name\n1,Ada', 'application/octet-stream')),
    ).resolves.toBeUndefined();
  });

  it('rejects an empty export', async () => {
    await expect(assertValidCsvExport(blob('', 'text/csv'))).rejects.toThrow(/export was empty/i);
    await expect(assertValidCsvExport(blob(''))).rejects.toBeInstanceOf(InvalidExportError);
  });

  it('rejects a JSON error body served with a 200 and surfaces its message', async () => {
    await expect(
      assertValidCsvExport(blob('{"message":"Export limit exceeded"}', 'application/json')),
    ).rejects.toThrow('The server returned an error instead of a file: Export limit exceeded');
  });

  it('joins validation messages sent as an array', async () => {
    await expect(
      assertValidCsvExport(blob('{"message":["a is bad","b is bad"]}', 'application/json')),
    ).rejects.toThrow(/a is bad, b is bad/);
  });

  it('handles a JSON error without a message', async () => {
    await expect(assertValidCsvExport(blob('{}', 'application/json'))).rejects.toThrow(
      /^The server returned an error instead of a file\.$/,
    );
  });

  it('catches a mislabelled JSON or HTML body', async () => {
    await expect(
      assertValidCsvExport(blob('{"error":"Forbidden"}', 'application/octet-stream')),
    ).rejects.toThrow(/Forbidden/);
    await expect(assertValidCsvExport(blob('{"statusCode":500}'))).rejects.toThrow(
      /error instead of a file/,
    );
    await expect(
      assertValidCsvExport(blob('<!DOCTYPE html><html></html>', 'text/plain')),
    ).rejects.toThrow(/web page/);
  });

  it('rejects an HTML page and unexpected content types', async () => {
    await expect(assertValidCsvExport(blob('<html></html>', 'text/html'))).rejects.toThrow(/web page/);
    await expect(assertValidCsvExport(blob('x', 'image/png'))).rejects.toThrow(
      /Unexpected export content type "image\/png"/,
    );
  });

  it('does not reject a CSV whose first cell merely looks like an array', async () => {
    await expect(assertValidCsvExport(blob('[draft],1\n', 'text/plain'))).resolves.toBeUndefined();
  });
});

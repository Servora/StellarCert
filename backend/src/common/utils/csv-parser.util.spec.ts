import { parseCsv } from './csv-parser.util';

describe('csv-parser.util', () => {
  it('parses standard CSV with headers', () => {
    const csv =
      'recipientEmail,recipientName,title\nalice@example.com,Alice,Course A\nbob@example.com,Bob,Course B';
    const result = parseCsv(csv);
    expect(result).toEqual([
      {
        recipientEmail: 'alice@example.com',
        recipientName: 'Alice',
        title: 'Course A',
      },
      {
        recipientEmail: 'bob@example.com',
        recipientName: 'Bob',
        title: 'Course B',
      },
    ]);
  });

  it('handles quotes, commas inside quotes and escaped quotes', () => {
    const csv =
      'title,recipientName\n"Cert, with comma","Alice ""The Great"" Smith"';
    const result = parseCsv(csv);
    expect(result).toEqual([
      { title: 'Cert, with comma', recipientName: 'Alice "The Great" Smith' },
    ]);
  });

  it('handles multiline cells and CRLF', () => {
    const csv = 'title,description\r\nCert,"Line 1\r\nLine 2"\r\n';
    const result = parseCsv(csv);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('Line 1\r\nLine 2');
  });

  it('strips BOM and handles formula-escaped strings', () => {
    const csv = '\ufeffrecipientEmail,title\n"\'=1+1",hello';
    const result = parseCsv(csv);
    expect(result).toEqual([{ recipientEmail: '=1+1', title: 'hello' }]);
  });

  it('returns empty array on empty input', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('   \n\n')).toEqual([]);
  });
});

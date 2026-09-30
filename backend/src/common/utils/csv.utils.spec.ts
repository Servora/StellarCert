import { escapeCsvCell, toCsv, toCsvRow } from './csv.utils';

describe('csv.utils', () => {
  describe('escapeCsvCell', () => {
    it('quotes a plain value', () => {
      expect(escapeCsvCell('hello')).toBe('"hello"');
    });

    it('renders null and undefined as an empty quoted field', () => {
      expect(escapeCsvCell(null)).toBe('""');
      expect(escapeCsvCell(undefined)).toBe('""');
    });

    it('doubles embedded quotes', () => {
      expect(escapeCsvCell('He said "hi"')).toBe('"He said ""hi"""');
    });

    it('keeps commas and newlines inside a single quoted field', () => {
      expect(escapeCsvCell('Doe, Jane')).toBe('"Doe, Jane"');
      expect(escapeCsvCell('line one\nline two')).toBe('"line one\nline two"');
    });

    it('neutralises every formula trigger with a leading apostrophe', () => {
      expect(escapeCsvCell('=1+1')).toBe(`"'=1+1"`);
      expect(escapeCsvCell('+SUM(A1:A9)')).toBe(`"'+SUM(A1:A9)"`);
      expect(escapeCsvCell('-2+3')).toBe(`"'-2+3"`);
      expect(escapeCsvCell('@cmd')).toBe(`"'@cmd"`);
      expect(escapeCsvCell('\tcmd')).toBe(`"'\tcmd"`);
      expect(escapeCsvCell('\rcmd')).toBe(`"'\rcmd"`);
    });

    it('neutralises a formula before escaping its embedded quotes', () => {
      expect(escapeCsvCell('=HYPERLINK("http://x","y")')).toBe(
        `"'=HYPERLINK(""http://x"",""y"")"`,
      );
    });

    it('does not neutralise text that merely contains a trigger', () => {
      expect(escapeCsvCell('a=b')).toBe('"a=b"');
      expect(escapeCsvCell('user@example.com')).toBe('"user@example.com"');
    });
  });

  describe('toCsvRow', () => {
    it('joins escaped fields with commas', () => {
      expect(toCsvRow(['a', 'b,c', 'd"e'])).toBe('"a","b,c","d""e"');
    });
  });

  describe('toCsv', () => {
    it('emits a header row and data rows with newline separators', () => {
      const csv = toCsv(['Name', 'Note'], [['Doe, Jane', '=1+1'], ['Smith', 'ok']]);
      expect(csv).toBe(
        ['"Name","Note"', '"Doe, Jane","\'=1+1"', '"Smith","ok"'].join('\n'),
      );
    });

    it('produces only the header row when there is no data', () => {
      expect(toCsv(['A', 'B'], [])).toBe('"A","B"');
    });
  });
});

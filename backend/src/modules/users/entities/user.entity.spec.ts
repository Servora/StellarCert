import { getMetadataArgsStorage } from 'typeorm';
import { User } from './user.entity';

const SECRET_COLUMNS = [
  'emailVerificationToken',
  'passwordResetToken',
  'passwordResetTokenHash',
  'refreshToken',
];

describe('User entity secret columns (#1238)', () => {
  it.each(SECRET_COLUMNS)('never selects %s by default', (propertyName) => {
    const column = getMetadataArgsStorage().columns.find(
      (entry) => entry.target === User && entry.propertyName === propertyName,
    );

    expect(column).toBeDefined();
    expect(column?.options.select).toBe(false);
  });
});

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import IssuerProfile from './IssuerProfile';

// @stellar/stellar-sdk cannot run under vitest's jsdom environment:
// @stellar/stellar-base wraps seeds in Node Buffers, whose prototype chain
// does not satisfy @noble/curves' cross-realm `instanceof Uint8Array`
// checks (the jsdom environment swaps the Uint8Array global for a
// different realm's class). In real browsers the package's `browser`
// bundle sidesteps this, so the SDK is mocked here with realistic
// Stellar StrKey values — the component wiring is what is under test.
vi.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    random: () => ({
      publicKey: () => 'G' + 'ABCD2345'.repeat(7) + 'EF',
      secret: () => 'S' + 'ABCD2345'.repeat(7) + 'EF',
    }),
  },
}));

it('generates stellar keypair', async () => {
  const user = userEvent.setup();

  render(<IssuerProfile />);

  await user.click(
    screen.getByRole('button', {
      name: /generate stellar keypair/i,
    }),
  );

  expect(screen.getByDisplayValue(/^G[A-Z2-7]+$/)).toBeInTheDocument();
  expect(screen.getByDisplayValue(/^S[A-Z2-7]+$/)).toBeInTheDocument();
});

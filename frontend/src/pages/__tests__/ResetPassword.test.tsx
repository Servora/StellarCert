import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ResetPassword from '../ResetPassword';
import { authApi } from '../../api/endpoints';
import { ApiError } from '../../api/types';

// Mock the authApi
vi.mock('../../api/endpoints', () => ({
  authApi: {
    resetPassword: vi.fn(),
  },
}));

const renderResetPassword = (token = 'valid-token') => {
  return render(
    <MemoryRouter initialEntries={[`/reset-password?token=${token}`]}>
      <ResetPassword />
    </MemoryRouter>,
  );
};

describe('ResetPassword error handling (#996)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays server error message when reset fails', async () => {
    const serverError = new ApiError('Token expired', 400, 'Bad Request');
    vi.mocked(authApi.resetPassword).mockRejectedValue(serverError);

    renderResetPassword();

    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'newpassword123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByText('Token expired')).toBeInTheDocument();
    });
  });

  it('displays generic error for non-ApiError exceptions', async () => {
    vi.mocked(authApi.resetPassword).mockRejectedValue(new Error('Network error'));

    renderResetPassword();

    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'newpassword123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('displays fallback for unknown error types', async () => {
    vi.mocked(authApi.resetPassword).mockRejectedValue('string error');

    renderResetPassword();

    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'newpassword123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByText('An unexpected error occurred')).toBeInTheDocument();
    });
  });
});
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

describe('ResetPassword missing-token link (#1324)', () => {
  it('navigates to /login client-side instead of a full page reload', () => {
    render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <Routes>
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: /request a new reset link/i });
    expect(link).toHaveAttribute('href', '/login');

    // A raw <a href> is not intercepted by MemoryRouter, so the route would
    // not change; a router Link swaps the element without leaving the SPA.
    fireEvent.click(link);

    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText(/missing or invalid reset token/i)).not.toBeInTheDocument();
  });
});

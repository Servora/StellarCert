import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ProtectedRoute from './ProtectedRoute';
import { useAuth } from '../context/AuthContext';
import { User, UserRole } from '../api/types';

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));

const issuer: User = {
  id: '1',
  email: 'issuer@example.com',
  firstName: 'I',
  lastName: 'S',
  role: UserRole.ISSUER,
};

const setUser = (user: User | null) =>
  vi.mocked(useAuth).mockReturnValue({
    user,
    setUser: vi.fn(),
    isAuthenticated: !!user,
    isLoading: false,
    clearAuth: vi.fn(),
    login: vi.fn(),
  });

function LocationSpy() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/certificates" element={<div>certs list</div>} />
          <Route path="/certificates/:id" element={<div>cert detail</div>} />
        </Route>
        <Route path="/" element={<div>home</div>} />
        <Route path="/login" element={<><div>login</div><LocationSpy /></>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('returnUrl preservation (#747)', () => {
  it('appends returnUrl to login redirect for unauthenticated user', () => {
    setUser(null);
    renderAt('/certificates/abc-123?tab=files');
    expect(screen.getByText('login')).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toContain('returnUrl=');
  });

  it('encodes pathname and search params in returnUrl', () => {
    setUser(null);
    renderAt('/certificates/abc-123?tab=files&q=a%20b');
    const loc = screen.getByTestId('location').textContent ?? '';
    expect(loc).toContain('returnUrl=%2Fcertificates%2Fabc-123%3Ftab%3Dfiles%26q%3Da%2520b');
  });

  it('does not append returnUrl for public /verify path', () => {
    setUser(null);
    render(
      <MemoryRouter initialEntries={['/verify']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/verify" element={<div>verify page</div>} />
          </Route>
          <Route path="/login" element={<><div>login</div><LocationSpy /></>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('verify page')).toBeTruthy();
    expect(screen.queryByText('login')).toBeNull();
  });

  it('includes query string in returnUrl', () => {
    setUser(null);
    renderAt('/certificates?sort=recent');
    const loc = screen.getByTestId('location').textContent ?? '';
    expect(loc).toContain('returnUrl=%2Fcertificates%3Fsort%3Drecent');
  });
});

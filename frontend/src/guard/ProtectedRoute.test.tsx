import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

const renderAt = (path: string, allowedRoles?: UserRole[]) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute allowedRoles={allowedRoles} />}>
          <Route path="/certificates" element={<div>certs list</div>} />
          <Route path="/certificates/:id" element={<div>cert detail</div>} />
          <Route path="/certificatesfoo" element={<div>certs foo</div>} />
          <Route path="/issue" element={<div>issue page</div>} />
        </Route>
        <Route path="/" element={<div>home</div>} />
        <Route path="/login" element={<div>login</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  setUser(issuer);
});

describe('ProtectedRoute prefix matching (#565)', () => {
  it('allows the exact base path', () => {
    renderAt('/certificates');
    expect(screen.getByText('certs list')).toBeTruthy();
  });

  it('allows a sub-route of an allowed base path', () => {
    // The bug: /certificates/abc-123 was redirected for an authorized issuer.
    renderAt('/certificates/abc-123');
    expect(screen.getByText('cert detail')).toBeTruthy();
    expect(screen.queryByText('home')).toBeNull();
  });

  it('does not grant access to a sibling path that merely shares a prefix', () => {
    // The built-in per-role path matrix was removed in #852; authorization
    // now comes from the explicit allowedRoles on each route group. A
    // /certificatesfoo route wrapped for recipients must not be reachable
    // by an issuer.
    renderAt('/certificatesfoo', [UserRole.RECIPIENT]);
    expect(screen.getByText('home')).toBeTruthy();
    expect(screen.queryByText('certs foo')).toBeNull();
  });

  it('redirects a disallowed path to home (incl. sub-routes)', () => {
    setUser({ ...issuer, role: UserRole.RECIPIENT }); // recipient: only /wallet
    renderAt('/certificates/abc-123', [UserRole.ISSUER, UserRole.ADMIN]);
    expect(screen.getByText('home')).toBeTruthy();
    expect(screen.queryByText('cert detail')).toBeNull();
  });

  it('redirects an unauthenticated user to login', () => {
    setUser(null);
    renderAt('/certificates/abc-123');
    expect(screen.getByText('login')).toBeTruthy();
  });

  it('honours explicit allowedRoles (role mismatch redirects home)', () => {
    // issuer hitting an admin-only route
    renderAt('/issue', [UserRole.ADMIN]);
    expect(screen.getByText('home')).toBeTruthy();
    expect(screen.queryByText('issue page')).toBeNull();
  });

  it('honours explicit allowedRoles (role match renders)', () => {
    renderAt('/issue', [UserRole.ISSUER]);
    expect(screen.getByText('issue page')).toBeTruthy();
  });
});

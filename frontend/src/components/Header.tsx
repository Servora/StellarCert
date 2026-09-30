import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';
import { Menu, User, X, Users } from 'lucide-react';
import NotificationDropdown from './NotificationDropdown';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../api/types';
import { canAccessWallet } from '../constants/routeAccess';

type NavItem = {
  label: string;
  to: string;
  icon?: React.ReactNode;
};

export default function Header(): JSX.Element {
  const { user, logout } = useAuth();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const isIssuerOrAdmin =
    user?.role === UserRole.ISSUER || user?.role === UserRole.ADMIN;

  // Gated on the same list the /wallet route guards with, so the link is never
  // offered to a role the route will bounce straight back to `/`.
  const showWalletLink = canAccessWallet(user?.role);

  useEffect(() => {
    document.body.style.overflow = isDrawerOpen ? 'hidden' : '';

    return () => {
      document.body.style.overflow = '';
    };
  }, [isDrawerOpen]);

  const closeDrawer = () => setIsDrawerOpen(false);

  const handleSignOut = async () => {
    closeDrawer();
    await logout();
  };

  const navItems: NavItem[] = [
    { label: 'Home', to: '/' },
    { label: 'Verify', to: '/verify' },
    ...(user ? ([{ label: 'Dashboard', to: '/dashboard' }] as NavItem[]) : []),
    ...(isIssuerOrAdmin
      ? ([{ label: 'Issue', to: '/issue' }, { label: 'Revoke', to: '/revoke' }] as NavItem[])
      : []),
    ...(showWalletLink ? ([{ label: 'Wallet', to: '/wallet' }] as NavItem[]) : []),
    ...(isIssuerOrAdmin
      ? ([{ label: 'Certificates', to: '/certificates' }] as NavItem[])
      : []),
    ...(user?.role === UserRole.ADMIN
      ? ([{ label: 'Users', to: '/admin/users', icon: <Users className="h-4 w-4" />}] as NavItem[])
      : []),
    ...(user
      ? ([
          {
            label: 'Profile',
            to: '/profile',
            icon: <User className="h-4 w-4" />,
          },
        ] as NavItem[])
      : []),
  ];

  return (
    <header className="no-print border-b border-gray-200 bg-white transition-colors duration-250 dark:border-white/10 dark:bg-slate-950/90 dark:backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary font-semibold text-white transition-colors duration-250 dark:text-slate-950">
            SC
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900 transition-colors duration-250 dark:text-white">StellarCert</p>
            <p className="text-xs text-gray-600 transition-colors duration-250 dark:text-slate-400">Certificate Verification System</p>
          </div>
        </div>

        <div className="hidden items-center gap-6 md:flex">
          <nav className="flex items-center gap-6 text-sm font-medium text-gray-700 transition-colors duration-250 dark:text-slate-300">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `transition-colors duration-250 ${isActive
                    ? 'text-primary dark:text-primary'
                    : 'hover:text-gray-900 dark:hover:text-white'}`
                }
              >
                {item.label}
              </NavLink>
            ))}
            {user ? (
              <button
                type="button"
                onClick={handleSignOut}
                className="transition-colors duration-250 hover:text-gray-900 dark:hover:text-white"
              >
                Sign out
              </button>
            ) : (
              <NavLink
                to="/login"
                className="transition-colors duration-250 hover:text-gray-900 dark:hover:text-white"
              >
                Sign in
              </NavLink>
            )}
          </nav>
          <div className="h-6 w-px bg-gray-300 transition-colors duration-250 dark:bg-slate-700" />
          <NotificationDropdown />
          <ThemeToggle />
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <NotificationDropdown />
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setIsDrawerOpen(true)}
            aria-label="Open navigation menu"
            aria-controls="mobile-navigation-drawer"
            aria-expanded={isDrawerOpen}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 transition-colors duration-250 hover:bg-gray-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-white/5"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="md:hidden">
        <div
          aria-hidden={!isDrawerOpen}
          className={`fixed inset-0 z-40 bg-slate-950/60 transition-opacity duration-200 ${isDrawerOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
          onClick={closeDrawer}
        />
        <aside
          id="mobile-navigation-drawer"
          aria-hidden={!isDrawerOpen}
          className={`fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col border-l border-gray-200 bg-white p-4 shadow-2xl transition-transform duration-200 dark:border-white/10 dark:bg-slate-950 ${isDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
        >
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Menu</p>
            <button
              type="button"
              onClick={closeDrawer}
              aria-label="Close navigation menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-gray-700 transition-colors duration-250 hover:bg-gray-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-1 text-sm font-medium text-gray-700 dark:text-slate-200">
            {navItems.map((item) => (
              <NavLink
                key={`mobile-${item.to}`}
                to={item.to}
                onClick={closeDrawer}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-3 transition-colors duration-250 ${isActive
                    ? 'bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary'
                    : 'hover:bg-gray-100 dark:hover:bg-white/5'}`
                }
              >
                {item.label}
              </NavLink>
            ))}
            {user ? (
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-lg px-3 py-3 text-left transition-colors duration-250 hover:bg-gray-100 dark:hover:bg-white/5"
              >
                Sign out
              </button>
            ) : (
              <NavLink
                to="/login"
                onClick={closeDrawer}
                className="rounded-lg px-3 py-3 transition-colors duration-250 hover:bg-gray-100 dark:hover:bg-white/5"
              >
                Sign in
              </NavLink>
            )}
          </nav>

          <div className="mt-4 border-t border-gray-200 pt-4 dark:border-white/10">
            <p className="mb-2 text-xs uppercase tracking-[0.2em] text-gray-500 dark:text-slate-400">Quick actions</p>
            <div className="flex items-center justify-between gap-2">
              <NotificationDropdown />
              <ThemeToggle />
            </div>
          </div>
        </aside>
      </div>
    </header>
  );
}

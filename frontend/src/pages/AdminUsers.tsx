import { Suspense, lazy } from 'react';
import ProtectedRoute from '../guard/ProtectedRoute';
import { UserRole } from '../api/types';

const AdminUsersPage = lazy(() => import('../components/admin/users/UserManagement'));

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[200px]">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
  </div>
);

export default function AdminUsers() {
  return (
    <Suspense fallback={<PageLoader />}>
      <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
        <AdminUsersPage />
      </ProtectedRoute>
    </Suspense>
  );
}
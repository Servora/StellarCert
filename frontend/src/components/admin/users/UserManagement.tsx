import React, { useState } from 'react';
import { userApi } from '../../../api/endpoints';
import type { User as ApiUser } from '../../../api/types';
import { getErrorMessage } from '../../../api/types';
import { useUserListQuery } from '../../../api/queries';
import { useDebounce } from '../../../hooks/useDebounce';

interface User extends ApiUser {
  name?: string;
  isActive?: boolean;
  lastLogin?: string;
}

const UserManagement: React.FC = () => {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Debounced so typing a name doesn't fire a request per keystroke. The list is
  // cached per (search, role) pair, so switching back to a previous filter is
  // instant instead of re-fetching.
  const debouncedSearch = useDebounce(search, 300);

  const usersQuery = useUserListQuery({
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(roleFilter !== 'all' ? { role: roleFilter } : {}),
  });

  const users: User[] = usersQuery.data ?? [];
  const loading = usersQuery.isPending;
  const error = usersQuery.isError
    ? usersQuery.error instanceof Error
      ? usersQuery.error.message
      : 'Failed to fetch users'
    : actionError;

  const handleRoleChange = async (userId: string, newRole: string) => {
    setUpdatingId(userId);
    setActionError(null);
    try {
      await userApi.updateRole(userId, newRole);
      await usersQuery.refetch();
    } catch (err: unknown) { setActionError(getErrorMessage(err)); }
    finally { setUpdatingId(null); }
  };

  const handleToggleStatus = async (userId: string, current: boolean) => {
    setUpdatingId(userId);
    setActionError(null);
    try {
      await userApi.toggleStatus(userId, !current);
      await usersQuery.refetch();
    } catch (err: unknown) { setActionError(getErrorMessage(err)); }
    finally { setUpdatingId(null); }
  };

  const handleDelete = async (userId: string) => {
    if (!window.confirm('Delete this user?')) return;
    setActionError(null);
    try {
      await userApi.delete(userId);
      await usersQuery.refetch();
    } catch (err: unknown) { setActionError(getErrorMessage(err)); }
  };

  const roleBadge = (role: string) =>
    ({ admin: 'bg-purple-100 text-purple-800', issuer: 'bg-blue-100 text-blue-800', recipient: 'bg-gray-100 text-gray-800' }[role] || 'bg-gray-100 text-gray-700');

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">User Management</h2>
        <span className="text-sm text-gray-500">{users.length} users</span>
      </div>
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <input type="text" placeholder="Search by name or email…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm">
          <option value="all">All Roles</option>
          <option value="admin">Admin</option>
          <option value="issuer">Issuer</option>
          <option value="recipient">Recipient</option>
        </select>
      </div>
      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-red-700 text-sm">{error}</div>}
      {loading
        ? <div className="text-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" /></div>
        : (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>{['User','Role','Status','Last Login','Actions'].map((h) =>
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.id} className={updatingId === user.id ? 'opacity-50 pointer-events-none' : ''}>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900 text-sm">
                        {user.name || `${user.firstName} ${user.lastName}`.trim()}
                      </div>
                      <div className="text-gray-500 text-xs">{user.email}</div>
                    </td>
                    <td className="px-6 py-4">
                      <select value={user.role} onChange={(e) => handleRoleChange(user.id, e.target.value)}
                        className={`text-xs font-semibold px-2 py-1 rounded-full border-0 cursor-pointer ${roleBadge(user.role)}`}>
                        <option value="admin">Admin</option>
                        <option value="issuer">Issuer</option>
                        <option value="recipient">Recipient</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <button onClick={() => handleToggleStatus(user.id, !!user.isActive)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${user.isActive ? 'bg-green-500' : 'bg-gray-300'}`}>
                        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${user.isActive ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-6 py-4">
                      <button onClick={() => handleDelete(user.id)} className="text-red-500 hover:text-red-700 text-sm font-medium">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 && <p className="text-center text-gray-500 py-8 text-sm">No users found.</p>}
          </div>
        )}
    </div>
  );
};

export default UserManagement;

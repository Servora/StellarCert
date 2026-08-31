import { useState } from 'react';
import UserManagement from '@/components/admin/users/UserManagement';
import { CertificateSearchBar } from '@/components/CertificateSearchBar';
import { CsvExportButton } from '@/components/CsvExportButton';

export default function AdminUsersPage() {
  const {searchQuery, setSearchQuery} = useState('');

  const handleExport = async () => {
    // TODO: implement actual CSV export
    console.log('Export users with query:', searchQuery);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <CertificateSearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search users..." />
        <CsvExportButton onExport={handleExport} label="Export Users" />
      </div>
      <UserManagement />
    </div>
  );
}

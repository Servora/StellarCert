import { useState, useEffect, useRef } from 'react';
import {
    Search,
    ChevronUp,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Download,
    X,
    Snowflake,
    AlertTriangle,
    FileText,
    Check,
    XCircle,
    Send,
    History
} from 'lucide-react';
import { certificateApi } from '../api';
import type { Certificate, CertificateExportFilters, ActivityItem } from '../api';
import Modal from './Modal';
import { useDebounce } from '../hooks/useDebounce';
import {
    useBulkRevokeCertificatesMutation,
    useCertificateHistoryQuery,
    useCertificatesQuery,
    useFreezeCertificateMutation,
    useInitiateTransferMutation,
    useUnfreezeCertificateMutation,
} from '../api/queries';

type SortField = 'recipientName' | 'title' | 'issuerName' | 'issueDate' | 'status' | 'serialNumber';
type SortOrder = 'asc' | 'desc';

interface CertificateTableProps {
    onError?: (message: string) => void;
    onSuccess?: (message: string) => void;
}

// One place for the message a user must see when an action fails. Rendered
// inside the dialog that started the action when there is one, and above the
// table otherwise, so a failure is never only a console entry.
const ActionError = ({ message, className = '' }: { message: string | null; className?: string }) =>
    message ? (
        <p
            role="alert"
            className={`text-sm text-red-700 dark:text-red-200 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md px-3 py-2 ${className}`}
        >
            {message}
        </p>
    ) : null;

const CertificateTable = ({ onError, onSuccess }: CertificateTableProps) => {
    // Pagination / filter / sort inputs. The list is a single query keyed on all
    // of them, so revisiting a combination that was already loaded is instant
    // and the six post-mutation refetch calls collapse into invalidation.
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);

    // State for filters
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebounce(search, 300);
    const [statusFilter, setStatusFilter] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // State for sorting
    const [sortBy, setSortBy] = useState<SortField>('issueDate');
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

    const certificatesQuery = useCertificatesQuery({
        page,
        limit,
        search: debouncedSearch || undefined,
        status: statusFilter || undefined,
        sortBy,
        sortOrder,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
    });

    const certificates: Certificate[] = certificatesQuery.data?.data ?? [];
    const loading = certificatesQuery.isPending;
    const total = certificatesQuery.data?.total ?? 0;
    const totalPages = certificatesQuery.data?.totalPages ?? 0;

    // Drives the "export all filtered" count and the table's own empty state.
    const filteredCount = total;

    // Report a failed page load to the parent once per failure.
    const reportedError = useRef(false);
    useEffect(() => {
        if (certificatesQuery.isError) {
            if (reportedError.current) return;
            reportedError.current = true;
            console.error('Failed to fetch certificates:', certificatesQuery.error);
            onError?.('Failed to fetch certificates');
        } else {
            reportedError.current = false;
        }
    }, [certificatesQuery.isError, certificatesQuery.error, onError]);

    // State for selection
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [selectAll, setSelectAll] = useState(false);

    // State for filtered export
    const [exportingFiltered, setExportingFiltered] = useState(false);

    // Freeze modal state
    const [showFreezeModal, setShowFreezeModal] = useState(false);
    const [freezeReason, setFreezeReason] = useState('');
    const [freezeDuration, setFreezeDuration] = useState(7);
    const [freezingCertId, setFreezingCertId] = useState<string | null>(null);

    // Revoke modal state
    const [showRevokeModal, setShowRevokeModal] = useState(false);
    const [revokeReason, setRevokeReason] = useState('');
    const [revokingCertIds, setRevokingCertIds] = useState<string[]>([]);

    // Transfer modal state
    const [showTransferModal, setShowTransferModal] = useState(false);
    const [transferData, setTransferData] = useState({
        certificateId: '',
        newOwnerEmail: '',
        newOwnerName: '',
        reason: ''
    });

    // History modal state. The audit trail is server state too, so it is fetched
    // by key rather than copied into local state.
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [historyCertId, setHistoryCertId] = useState<string | null>(null);
    const historyQuery = useCertificateHistoryQuery(
        showHistoryModal ? historyCertId : null,
    );
    const certHistory: ActivityItem[] = historyQuery.data ?? [];
    const loadingHistory = historyQuery.isPending;

    // Failure/feedback state. `loadError` is separate from the certificate list
    // so a failed load can render as a failure with a retry rather than as an
    // empty result set. `pendingAction` drives the in-flight (disabled) state of
    // the buttons that fire a mutation, so a double click cannot double-submit.
    const [actionError, setActionError] = useState<string | null>(null);
    // `loadError` is separate from the certificate list so a failed load can
    // render as a failure with a retry rather than as an empty result set. The
    // query owns the failure, so the message is derived from it rather than
    // copied into state that could drift out of sync with the query.
    const loadError = certificatesQuery.isError ? 'Failed to fetch certificates' : null;
    const [pendingAction, setPendingAction] = useState<string | null>(null);

    // Certificate detail modal state. Holds the row's certificate rather than
    // just its id: the table already has every field the detail view shows, so
    // opening it needs no second request.
    const [viewingCertificate, setViewingCertificate] = useState<Certificate | null>(null);

    // Row actions. Each mutation invalidates the certificate queries instead of
    // the table re-fetching by hand, so a list open elsewhere in the app (or in
    // another tab) stays consistent too.
    const freezeMutation = useFreezeCertificateMutation();
    const unfreezeMutation = useUnfreezeCertificateMutation();
    const revokeMutation = useBulkRevokeCertificatesMutation();
    const transferMutation = useInitiateTransferMutation();

    // Handle sort
    const handleSort = (field: SortField) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortOrder('asc');
        }
    };

    // Handle selection
    const handleSelectAll = () => {
        if (selectAll) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(certificates.map(c => c.id)));
        }
        setSelectAll(!selectAll);
    };

    const handleSelect = (id: string) => {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
        setSelectAll(newSelected.size === certificates.length);
    };

    // Handle bulk export
    const handleBulkExport = async () => {
        setActionError(null);
        setPendingAction('export');
        try {
            const filters: CertificateExportFilters = {
                search: search || undefined,
                status: statusFilter || undefined,
                startDate: startDate || undefined,
                endDate: endDate || undefined,
            };
            const blob = await certificateApi.bulkExport(
                Array.from(selectedIds),
                filters,
            );
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `certificates-export-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            onSuccess?.('Certificates exported successfully');
        } catch (err) {
            console.error('Export failed:', err);
            setActionError('Failed to export certificates');
            onError?.('Failed to export certificates');
        } finally {
            setPendingAction(null);
        }
    };

    // Handle bulk export of all filtered results
    const handleBulkExportAll = async () => {
        setExportingFiltered(true);
        setActionError(null);
        setPendingAction('export-all');
        try {
            const filters: CertificateExportFilters = {
                search: search || undefined,
                status: statusFilter || undefined,
                startDate: startDate || undefined,
                endDate: endDate || undefined,
            };
            const blob = await certificateApi.bulkExportAll(filters);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `certificates-export-all-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            onSuccess?.(`Successfully exported ${filteredCount} certificates`);
        } catch (err) {
            console.error('Export failed:', err);
            setActionError('Failed to export certificates');
            onError?.('Failed to export certificates');
        } finally {
            setExportingFiltered(false);
            setPendingAction(null);
        }
    };

    // Handle bulk revoke
    const handleBulkRevoke = () => {
        setRevokingCertIds(Array.from(selectedIds));
        setShowRevokeModal(true);
    };

    const closeRevokeModal = () => {
        setShowRevokeModal(false);
        setRevokeReason('');
        setRevokingCertIds([]);
        setActionError(null);
    };

    const confirmRevoke = async () => {
        setActionError(null);
        setPendingAction('revoke');
        try {
            await revokeMutation.mutateAsync({
                certificateIds: revokingCertIds,
                reason: revokeReason,
            });
            onSuccess?.('Certificates revoked successfully');
            setShowRevokeModal(false);
            setRevokeReason('');
            setSelectedIds(new Set());
            setSelectAll(false);
        } catch (err) {
            console.error('Revoke failed:', err);
            setActionError('Failed to revoke certificates');
            onError?.('Failed to revoke certificates');
        } finally {
            setPendingAction(null);
        }
    };

    // Handle freeze
    const handleFreeze = (certId: string) => {
        setFreezingCertId(certId);
        setShowFreezeModal(true);
    };

    const closeFreezeModal = () => {
        setShowFreezeModal(false);
        setFreezeReason('');
        setFreezingCertId(null);
        setActionError(null);
    };

    const confirmFreeze = async () => {
        if (!freezingCertId) return;
        setActionError(null);
        setPendingAction('freeze');
        try {
            const durationDays = Math.max(1, Number.isFinite(freezeDuration) ? Math.trunc(freezeDuration) : 1);
            await freezeMutation.mutateAsync({
                certificateId: freezingCertId,
                reason: freezeReason,
                durationDays,
            });
            onSuccess?.('Certificate frozen successfully');
            setShowFreezeModal(false);
            setFreezeReason('');
            setFreezeDuration(7);
            setFreezingCertId(null);
        } catch (err) {
            console.error('Freeze failed:', err);
            setActionError('Failed to freeze certificate');
            onError?.('Failed to freeze certificate');
        } finally {
            setPendingAction(null);
        }
    };

    // Handle unfreeze
    const handleUnfreeze = async (certId: string) => {
        setActionError(null);
        setPendingAction(`unfreeze:${certId}`);
        try {
            await unfreezeMutation.mutateAsync(certId);
            onSuccess?.('Certificate unfrozen successfully');
        } catch (err) {
            console.error('Unfreeze failed:', err);
            setActionError('Failed to unfreeze certificate');
            onError?.('Failed to unfreeze certificate');
        } finally {
            setPendingAction(null);
        }
    };

    // Handle transfer
    const handleTransfer = (cert: Certificate) => {
        setTransferData({
            certificateId: cert.id,
            newOwnerEmail: '',
            newOwnerName: '',
            reason: ''
        });
        setShowTransferModal(true);
    };

    const closeTransferModal = () => {
        setShowTransferModal(false);
        setActionError(null);
    };

    const confirmTransfer = async () => {
        setActionError(null);
        setPendingAction('transfer');
        try {
            await transferMutation.mutateAsync(transferData);
            onSuccess?.('Transfer initiated successfully. New owner must approve.');
            setShowTransferModal(false);
        } catch (err) {
            console.error('Transfer failed:', err);
            setActionError('Failed to initiate transfer');
            onError?.('Failed to initiate transfer');
        } finally {
            setPendingAction(null);
        }
    };

    // Handle History. The request itself belongs to `useCertificateHistoryQuery`;
    // opening the dialog just selects the key it should load.
    const handleViewHistory = (certId: string) => {
        setHistoryCertId(certId);
        setShowHistoryModal(true);
        setActionError(null);
    };

    // Surface a failed history load in the dialog that asked for it, so the
    // failure is not only a console entry. Reported once per failure, the same
    // way the certificate list reports its own.
    const reportedHistoryError = useRef(false);
    useEffect(() => {
        if (historyQuery.isError) {
            if (reportedHistoryError.current) return;
            reportedHistoryError.current = true;
            console.error('Failed to fetch history:', historyQuery.error);
            setActionError('Failed to load certificate history');
            onError?.('Failed to load certificate history');
        } else {
            reportedHistoryError.current = false;
        }
    }, [historyQuery.isError, historyQuery.error, onError]);

    const closeHistoryModal = () => {
        setShowHistoryModal(false);
        setActionError(null);
    };

    const getStatusBadge = (status: string) => {
        const baseClasses = 'px-2 py-1 rounded-full text-xs font-medium';
        switch (status) {
            case 'active':
                return <span className={`${baseClasses} bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200`}>Active</span>;
            case 'revoked':
                return <span className={`${baseClasses} bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200`}>Revoked</span>;
            case 'expired':
                return <span className={`${baseClasses} bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300`}>Expired</span>;
            case 'frozen':
                return <span className={`${baseClasses} bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200`}>Frozen</span>;
            default:
                return <span className={`${baseClasses} bg-gray-100 text-gray-800`}>{status}</span>;
        }
    };

    // Sort icon component
    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortBy !== field) return null;
        return sortOrder === 'asc' ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />;
    };

    // Clear filters
    const clearFilters = () => {
        setSearch('');
        setStatusFilter('');
        setStartDate('');
        setEndDate('');
        setPage(1);
    };

    const hasActiveFilters = search || statusFilter || startDate || endDate;

    // True while one of the dialogs that can display `actionError` is open, so
    // the message is rendered next to the action that failed, not twice.
    const anyModalOpen = showFreezeModal || showRevokeModal || showTransferModal || showHistoryModal;

    // Export selected button
    const ExportButton = () => (
        <button
            onClick={handleBulkExport}
            disabled={selectedIds.size === 0 || pendingAction !== null}
            className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-slate-800 dark:text-gray-200 dark:border-slate-600 dark:hover:bg-slate-700"
        >
            <Download className="w-4 h-4 mr-2" />
            Export ({selectedIds.size})
        </button>
    );

    // Export all filtered button
    const ExportAllButton = () => (
        <button
            onClick={handleBulkExportAll}
            disabled={exportingFiltered || filteredCount === 0 || pendingAction !== null}
            className="inline-flex items-center px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-300 rounded-md hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-600 dark:hover:bg-blue-900/30"
        >
            <Download className="w-4 h-4 mr-2" />
            {exportingFiltered ? 'Exporting...' : `Export All (${filteredCount})`}
        </button>
    );

    // Revoke button
    const RevokeButton = () => (
        <button
            onClick={handleBulkRevoke}
            disabled={selectedIds.size === 0 || pendingAction !== null}
            className="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
            <XCircle className="w-4 h-4 mr-2" />
            Revoke ({selectedIds.size})
        </button>
    );

    return (
        <div className="space-y-4">
            {/* Search and Filters */}
            <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-md dark:shadow-lg dark:border dark:border-slate-700">
                <div className="flex flex-col lg:flex-row gap-4">
                    {/* Search */}
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                        <input
                            type="text"
                            placeholder="Search by recipient, ID, or issuer..."
                            value={search}
                            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                        />
                    </div>

                    {/* Status Filter */}
                    <select
                        value={statusFilter}
                        onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                        className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                    >
                        <option value="">All Statuses</option>
                        <option value="active">Active</option>
                        <option value="revoked">Revoked</option>
                        <option value="expired">Expired</option>
                        <option value="frozen">Frozen</option>
                    </select>

                    {/* Date Range */}
                    <div className="flex gap-2">
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                            className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                            placeholder="Start Date"
                        />
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                            className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                            placeholder="End Date"
                        />
                    </div>

                    {/* Clear Filters */}
                    {hasActiveFilters && (
                        <button
                            onClick={clearFilters}
                            className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white"
                        >
                            <X className="w-4 h-4 mr-1" />
                            Clear
                        </button>
                    )}
                </div>

                {/* Bulk Actions */}
                <div className="flex gap-2 mt-4">
                    <ExportButton />
                    <ExportAllButton />
                    <RevokeButton />
                </div>
            </div>

            {/* Table-level action feedback. Actions started from a dialog render
                their error inside that dialog instead. */}
            {!anyModalOpen && <ActionError message={actionError} />}

            {/* Table */}
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-md dark:shadow-lg dark:border dark:border-slate-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                        <thead className="bg-gray-50 dark:bg-slate-800">
                            <tr>
                                <th className="px-6 py-3 text-left">
                                    <input
                                        type="checkbox"
                                        checked={selectAll}
                                        onChange={handleSelectAll}
                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                </th>
                                <th
                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700"
                                    onClick={() => handleSort('serialNumber')}
                                >
                                    <div className="flex items-center">
                                        Certificate ID
                                        <SortIcon field="serialNumber" />
                                    </div>
                                </th>
                                <th
                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700"
                                    onClick={() => handleSort('recipientName')}
                                >
                                    <div className="flex items-center">
                                        Recipient
                                        <SortIcon field="recipientName" />
                                    </div>
                                </th>
                                <th
                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700"
                                    onClick={() => handleSort('title')}
                                >
                                    <div className="flex items-center">
                                        Title
                                        <SortIcon field="title" />
                                    </div>
                                </th>
                                <th
                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700"
                                    onClick={() => handleSort('issuerName')}
                                >
                                    <div className="flex items-center">
                                        Issuer
                                        <SortIcon field="issuerName" />
                                    </div>
                                </th>
                                <th
                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700"
                                    onClick={() => handleSort('issueDate')}
                                >
                                    <div className="flex items-center">
                                        Issue Date
                                        <SortIcon field="issueDate" />
                                    </div>
                                </th>
                                <th
                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700"
                                    onClick={() => handleSort('status')}
                                >
                                    <div className="flex items-center">
                                        Status
                                        <SortIcon field="status" />
                                    </div>
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-700">
                            {loading ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-gray-500 dark:text-slate-400">
                                        <div className="flex justify-center items-center">
                                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                                            <span className="ml-3">Loading certificates...</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : loadError ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center">
                                        <div role="alert" className="text-red-700 dark:text-red-300">
                                            {loadError}
                                        </div>
                                        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                                            The certificate list could not be loaded. This is not an empty result.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => { void certificatesQuery.refetch(); }}
                                            className="mt-4 inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                                        >
                                            Retry
                                        </button>
                                    </td>
                                </tr>
                            ) : certificates.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-gray-500 dark:text-slate-400">
                                        No certificates found
                                    </td>
                                </tr>
                            ) : (
                                certificates.map((cert) => (
                                    <tr key={cert.id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(cert.id)}
                                                onChange={() => handleSelect(cert.id)}
                                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                            />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900 dark:text-white">
                                            {cert.serialNumber}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                            {cert.recipientName}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                            {cert.title}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                            {cert.issuerName}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                            {new Date(cert.issueDate).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {getStatusBadge(cert.status)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleFreeze(cert.id)}
                                                    className="p-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                                                    title="Freeze Certificate"
                                                    disabled={cert.status === 'frozen' || cert.status === 'revoked' || pendingAction !== null}
                                                >
                                                    <Snowflake className="w-5 h-5" />
                                                </button>
                                                {cert.status === 'frozen' && (
                                                    <button
                                                        onClick={() => handleUnfreeze(cert.id)}
                                                        className="p-1 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300"
                                                        title="Unfreeze Certificate"
                                                        disabled={pendingAction !== null}
                                                    >
                                                        <Check className="w-5 h-5" />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => { setRevokingCertIds([cert.id]); setShowRevokeModal(true); }}
                                                    className="p-1 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                                                    title="Revoke Certificate"
                                                    disabled={cert.status === 'revoked' || pendingAction !== null}
                                                >
                                                    <XCircle className="w-5 h-5" />
                                                </button>
                                                <button
                                                    onClick={() => handleTransfer(cert)}
                                                    className="p-1 text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300"
                                                    title="Transfer Certificate"
                                                    disabled={cert.status !== 'active' || pendingAction !== null}
                                                >
                                                    <Send className="w-5 h-5" />
                                                </button>
                                                <button
                                                    onClick={() => handleViewHistory(cert.id)}
                                                    className="p-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                                                    title="View History"
                                                >
                                                    <History className="w-5 h-5" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setViewingCertificate(cert)}
                                                    className="p-1 text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300"
                                                    title="View Certificate"
                                                    aria-label={`View certificate ${cert.serialNumber}`}
                                                >
                                                    <FileText className="w-5 h-5" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="px-6 py-4 flex items-center justify-between border-t border-gray-200 dark:border-slate-700">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500 dark:text-slate-400">
                            Showing {(page - 1) * limit + 1} to {Math.min(page * limit, total)} of {total} results
                        </span>
                        <select
                            value={limit}
                            onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
                            className="ml-2 px-2 py-1 text-sm border border-gray-300 rounded-md dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                        >
                            <option value={10}>10</option>
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                        </select>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="p-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-600 dark:hover:bg-slate-700"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <span className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">
                            Page {page} of {totalPages}
                        </span>
                        <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                            className="p-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-600 dark:hover:bg-slate-700"
                        >
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>

            <Modal
                isOpen={showFreezeModal}
                onClose={closeFreezeModal}
                labelledBy="freeze-certificate-title"
                wrapperClassName="fixed inset-0 z-50 flex items-center justify-center"
                overlayClassName="absolute inset-0 bg-black/50"
                dialogClassName="relative bg-white dark:bg-slate-900 rounded-lg p-6 max-w-md w-full mx-4"
            >
                <div className="flex items-center gap-2 mb-4">
                    <Snowflake className="w-6 h-6 text-blue-600" />
                    <h3 id="freeze-certificate-title" className="text-lg font-semibold dark:text-white">Freeze Certificate</h3>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    This will temporarily freeze the certificate during a dispute. You can unfreeze it at any time.
                </p>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="freeze-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Reason for freezing
                        </label>
                        <textarea
                            id="freeze-reason"
                            value={freezeReason}
                            onChange={(e) => setFreezeReason(e.target.value)}
                            rows={3}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                            placeholder="Enter the reason for freezing..."
                        />
                    </div>
                    <div>
                        <label htmlFor="freeze-duration" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Freeze Duration (days)
                        </label>
                        <input
                            id="freeze-duration"
                            type="number"
                            min={1}
                            max={90}
                            value={freezeDuration}
                            onChange={(e) => setFreezeDuration(Number(e.target.value))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                        />
                        <p className="text-xs text-gray-500 mt-1">Maximum 90 days. Leave empty for indefinite.</p>
                    </div>
                </div>
                <ActionError message={actionError} className="mt-4" />
                <div className="flex gap-3 mt-6">
                    <button
                        type="button"
                        onClick={closeFreezeModal}
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-700"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={confirmFreeze}
                        disabled={!freezeReason || pendingAction === 'freeze'}
                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                        {pendingAction === 'freeze' ? 'Freezing…' : 'Freeze'}
                    </button>
                </div>
            </Modal>

            <Modal
                isOpen={showRevokeModal}
                onClose={closeRevokeModal}
                labelledBy="revoke-certificate-title"
                wrapperClassName="fixed inset-0 z-50 flex items-center justify-center"
                overlayClassName="absolute inset-0 bg-black/50"
                dialogClassName="relative bg-white dark:bg-slate-900 rounded-lg p-6 max-w-md w-full mx-4"
            >
                <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-6 h-6 text-red-600" />
                    <h3 id="revoke-certificate-title" className="text-lg font-semibold dark:text-white">Revoke Certificate{revokingCertIds.length > 1 ? 's' : ''}</h3>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Are you sure you want to revoke {revokingCertIds.length} certificate{revokingCertIds.length > 1 ? 's' : ''}? This action cannot be undone.
                </p>
                <div>
                    <label htmlFor="revoke-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Reason for revocation
                    </label>
                    <textarea
                        id="revoke-reason"
                        value={revokeReason}
                        onChange={(e) => setRevokeReason(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-red-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                        placeholder="Enter the reason for revocation..."
                    />
                </div>
                <ActionError message={actionError} className="mt-4" />
                <div className="flex gap-3 mt-6">
                    <button
                        type="button"
                        onClick={closeRevokeModal}
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-700"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={confirmRevoke}
                        disabled={pendingAction === 'revoke'}
                        className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                    >
                        {pendingAction === 'revoke' ? 'Revoking…' : 'Revoke'}
                    </button>
                </div>
            </Modal>

            <Modal
                isOpen={showTransferModal}
                onClose={closeTransferModal}
                labelledBy="transfer-certificate-title"
                wrapperClassName="fixed inset-0 z-50 flex items-center justify-center"
                overlayClassName="absolute inset-0 bg-black/50"
                dialogClassName="relative bg-white dark:bg-slate-900 rounded-lg p-6 max-w-md w-full mx-4"
            >
                <div className="flex items-center gap-2 mb-4">
                    <Send className="w-6 h-6 text-purple-600" />
                    <h3 id="transfer-certificate-title" className="text-lg font-semibold dark:text-white">Initiate Transfer</h3>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Transfer ownership of this certificate to a new recipient. The new owner will need to approve the transfer.
                </p>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="transfer-owner-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            New Owner Name
                        </label>
                        <input
                            id="transfer-owner-name"
                            type="text"
                            value={transferData.newOwnerName}
                            onChange={(e) => setTransferData({ ...transferData, newOwnerName: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                            placeholder="Recipient's full name"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="transfer-owner-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            New Owner Email
                        </label>
                        <input
                            id="transfer-owner-email"
                            type="email"
                            value={transferData.newOwnerEmail}
                            onChange={(e) => setTransferData({ ...transferData, newOwnerEmail: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                            placeholder="recipient@example.com"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="transfer-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Reason (Optional)
                        </label>
                        <textarea
                            id="transfer-reason"
                            value={transferData.reason}
                            onChange={(e) => setTransferData({ ...transferData, reason: e.target.value })}
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                            placeholder="e.g., Correction of name, change of ownership..."
                        />
                    </div>
                </div>
                <ActionError message={actionError} className="mt-4" />
                <div className="flex gap-3 mt-6">
                    <button
                        type="button"
                        onClick={closeTransferModal}
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-700"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={confirmTransfer}
                        disabled={!transferData.newOwnerEmail || !transferData.newOwnerName || pendingAction === 'transfer'}
                        className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
                    >
                        {pendingAction === 'transfer' ? 'Initiating…' : 'Initiate Transfer'}
                    </button>
                </div>
            </Modal>

            <Modal
                isOpen={showHistoryModal}
                onClose={closeHistoryModal}
                labelledBy="certificate-history-title"
                wrapperClassName="fixed inset-0 z-50 flex items-center justify-center"
                overlayClassName="absolute inset-0 bg-black/50"
                dialogClassName="relative bg-white dark:bg-slate-900 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto"
            >
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                        <History className="w-6 h-6 text-blue-600" />
                        <h3 id="certificate-history-title" className="text-lg font-semibold dark:text-white">Certificate History</h3>
                    </div>
                    <button
                        type="button"
                        onClick={closeHistoryModal}
                        className="text-gray-500 hover:text-gray-700 dark:text-gray-400"
                        aria-label="Close certificate history"
                    >
                        <XCircle className="w-6 h-6" />
                    </button>
                </div>

                {loadingHistory ? (
                    <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                ) : actionError ? (
                    <ActionError message={actionError} />
                ) : certHistory.length === 0 ? (
                    <p className="text-center py-8 text-gray-500 dark:text-gray-400">No history found for this certificate.</p>
                ) : (
                    <div className="space-y-6">
                        {certHistory.map((item, index) => (
                            <div key={index} className="flex gap-4">
                                <div className="flex flex-col items-center">
                                    <div className="w-3 h-3 bg-blue-600 rounded-full mt-1.5"></div>
                                    {index !== certHistory.length - 1 && (
                                        <div className="w-0.5 h-full bg-gray-200 dark:bg-slate-700 my-1"></div>
                                    )}
                                </div>
                                <div>
                                    <p className="text-sm font-medium dark:text-white capitalize">
                                        {item.type.replace('_', ' ')}
                                    </p>
                                    <p className="text-sm text-gray-600 dark:text-gray-400">
                                        {item.description}
                                    </p>
                                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                        {new Date(item.date).toLocaleString()}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="mt-8">
                    <button
                        type="button"
                        onClick={closeHistoryModal}
                        className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-md dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white"
                    >
                        Close
                    </button>
                </div>
            </Modal>

            {viewingCertificate && (
                <Modal
                    isOpen
                    onClose={() => setViewingCertificate(null)}
                    labelledBy="certificate-details-title"
                    wrapperClassName="fixed inset-0 z-50 flex items-center justify-center"
                    overlayClassName="absolute inset-0 bg-black/50"
                    dialogClassName="relative bg-white dark:bg-slate-900 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto"
                >
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-2">
                            <FileText className="w-6 h-6 text-gray-600 dark:text-gray-300" />
                            <h3 id="certificate-details-title" className="text-lg font-semibold dark:text-white">Certificate Details</h3>
                        </div>
                        <button
                            type="button"
                            onClick={() => setViewingCertificate(null)}
                            className="text-gray-500 hover:text-gray-700 dark:text-gray-400"
                            aria-label="Close certificate details"
                        >
                            <XCircle className="w-6 h-6" />
                        </button>
                    </div>

                    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Serial Number</dt>
                            <dd className="mt-1 font-mono text-sm text-gray-900 dark:text-white break-all">
                                {viewingCertificate.serialNumber}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Status</dt>
                            <dd className="mt-1">{getStatusBadge(viewingCertificate.status)}</dd>
                        </div>
                        <div>
                            <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Recipient</dt>
                            <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                                {viewingCertificate.recipientName}
                                {viewingCertificate.recipientEmail && (
                                    <span className="block text-xs text-gray-500 dark:text-slate-400">
                                        {viewingCertificate.recipientEmail}
                                    </span>
                                )}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Issuer</dt>
                            <dd className="mt-1 text-sm text-gray-900 dark:text-white">{viewingCertificate.issuerName}</dd>
                        </div>
                        <div>
                            <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Title</dt>
                            <dd className="mt-1 text-sm text-gray-900 dark:text-white">{viewingCertificate.title}</dd>
                        </div>
                        <div>
                            <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Course</dt>
                            <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                                {viewingCertificate.courseName || '—'}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Issued</dt>
                            <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                                {new Date(viewingCertificate.issueDate).toLocaleDateString()}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Expires</dt>
                            <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                                {viewingCertificate.expiryDate
                                    ? new Date(viewingCertificate.expiryDate).toLocaleDateString()
                                    : 'No expiry'}
                            </dd>
                        </div>
                        {viewingCertificate.status === 'frozen' && viewingCertificate.freezeReason && (
                            <div className="sm:col-span-2">
                                <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Freeze Reason</dt>
                                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                                    {viewingCertificate.freezeReason}
                                </dd>
                            </div>
                        )}
                        {viewingCertificate.txHash && (
                            <div className="sm:col-span-2">
                                <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Transaction Hash</dt>
                                <dd className="mt-1 font-mono text-xs text-gray-900 dark:text-white break-all">
                                    {viewingCertificate.txHash}
                                </dd>
                            </div>
                        )}
                        {viewingCertificate.cid && (
                            <div className="sm:col-span-2">
                                <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">IPFS CID</dt>
                                <dd className="mt-1 font-mono text-xs text-gray-900 dark:text-white break-all">
                                    {viewingCertificate.cid}
                                </dd>
                            </div>
                        )}
                    </dl>

                    <div className="flex gap-3 mt-6">
                        {viewingCertificate.pdfUrl && (
                            <a
                                href={viewingCertificate.pdfUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-center"
                            >
                                Open Certificate File
                            </a>
                        )}
                        <button
                            type="button"
                            onClick={() => setViewingCertificate(null)}
                            className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-md dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white"
                        >
                            Close
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
};

export default CertificateTable;

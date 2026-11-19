import Modal from '../../Modal';
import { useAuditSearchQuery } from '../../../api/queries';
import type { AuditLogItem } from '../../../api/types';

/** Most recent audit entries shown for a user. */
export const USER_ACTIVITY_LIMIT = 20;

interface Props {
  user: { id: string; name: string };
  onClose: () => void;
}

// Audit timestamps arrive either as epoch milliseconds or as ISO strings.
const formatTimestamp = (timestamp: string) => {
  const parsed = /^\d+$/.test(timestamp)
    ? new Date(Number(timestamp))
    : new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? timestamp : parsed.toLocaleString();
};

const formatAction = (action: string) =>
  action
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');

const describeEntry = (log: AuditLogItem) =>
  log.description ||
  log.errorMessage ||
  (log.resourceType
    ? `${log.resourceType}${log.resourceId ? ` ${log.resourceId}` : ''}`
    : '');

/**
 * Per-user activity history for the admin user list (#1322). Reads the user's
 * most recent entries from the audit log (GET /audit/logs?userId=…).
 */
export default function UserActivityModal({ user, onClose }: Props) {
  const activityQuery = useAuditSearchQuery({
    userId: user.id,
    take: USER_ACTIVITY_LIMIT,
  });
  const activities = activityQuery.data?.data ?? [];

  return (
    <Modal
      isOpen
      onClose={onClose}
      labelledBy="user-activity-title"
      wrapperClassName="fixed inset-0 z-50 flex items-center justify-center"
      overlayClassName="absolute inset-0 bg-black/50"
      dialogClassName="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <h2 id="user-activity-title" className="text-lg font-semibold text-gray-800">
          Activity History — {user.name}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-xl font-bold"
          aria-label="Close activity history"
        >
          &times;
        </button>
      </div>

      <div className="px-6 py-4 max-h-96 overflow-y-auto space-y-3">
        {activityQuery.isPending ? (
          <p className="text-sm text-gray-500 text-center py-8">Loading activity…</p>
        ) : activityQuery.isError ? (
          <p role="alert" className="text-sm text-red-600 text-center py-8">
            {activityQuery.error instanceof Error
              ? activityQuery.error.message
              : 'Failed to load activity.'}
          </p>
        ) : activities.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No activity found.</p>
        ) : (
          <ul className="space-y-3">
            {activities.map((activity) => (
              <li key={activity.id} className="flex gap-3 text-sm border-b pb-3 last:border-b-0">
                <div className="flex-1">
                  <p className="font-medium text-gray-700">{formatAction(activity.action)}</p>
                  {describeEntry(activity) && (
                    <p className="text-gray-500 text-xs mt-0.5">{describeEntry(activity)}</p>
                  )}
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  {formatTimestamp(activity.timestamp)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="px-6 py-4 border-t flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg"
        >
          Close
        </button>
      </div>
    </Modal>
  );
}

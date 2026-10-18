import Modal from '../../Modal';
import { User } from './types';

interface Props {
  user: User;
  onClose: () => void;
}

export default function UserActivityModal({ user, onClose }: Props) {
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
        {user.activities.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No activity found.</p>
        ) : (
          user.activities.map((activity) => (
            <div key={activity.id} className="flex gap-3 text-sm border-b pb-3 last:border-b-0">
              <div className="flex-1">
                <p className="font-medium text-gray-700">{activity.action}</p>
                <p className="text-gray-500 text-xs mt-0.5">{activity.details}</p>
              </div>
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {new Date(activity.timestamp).toLocaleString()}
              </span>
            </div>
          ))
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

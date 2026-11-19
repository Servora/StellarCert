import React, { useEffect, useState, useCallback, useRef } from "react";
import { useNotifications, Notification } from "../context/NotificationContext";
import { X, CheckCircle, Info, AlertTriangle } from "lucide-react";

/** Only unread notifications newer than this are surfaced as toasts. */
export const TOAST_RECENT_WINDOW_MS = 10000;

/**
 * Upper bound on remembered dismissals. Pruning below already keeps the set to
 * the notifications still inside the recent window; this is a backstop for a
 * burst of notifications that all arrive within that window.
 */
export const MAX_DISMISSED_TOAST_IDS = 100;

const isRecent = (notification: Notification, now: number) =>
  now - new Date(notification.createdAt).getTime() < TOAST_RECENT_WINDOW_MS;

/**
 * Drops dismissal records that can no longer matter (#1328): a notification
 * that has aged out of the recent window, or is no longer in the list, can
 * never be re-shown as a toast, so remembering its dismissal only grows the
 * set for the rest of the session. Mutates and returns `dismissedIds`.
 */
export const pruneDismissedIds = (
  dismissedIds: Set<string>,
  notifications: Notification[],
  now: number = Date.now(),
): Set<string> => {
  if (dismissedIds.size === 0) return dismissedIds;

  const stillRecent = new Set(
    notifications.filter((n) => isRecent(n, now)).map((n) => n.id),
  );
  for (const id of dismissedIds) {
    if (!stillRecent.has(id)) dismissedIds.delete(id);
  }

  // Sets iterate in insertion order, so this evicts the oldest dismissals.
  for (const id of dismissedIds) {
    if (dismissedIds.size <= MAX_DISMISSED_TOAST_IDS) break;
    dismissedIds.delete(id);
  }

  return dismissedIds;
};

const ToastMessage: React.FC<{
  notification: Notification;
  onClose: () => void;
}> = ({ notification, onClose }) => {
  // Use a ref to store the timer ID so it doesn't restart on re-renders
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      onClose();
    }, 5000);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [onClose]);

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-green-500" />,
    error: <AlertTriangle className="w-5 h-5 text-red-500" />,
    info: <Info className="w-5 h-5 text-blue-500" />,
  };

  const colors = {
    success:
      "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800",
    error: "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800",
    info: "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800",
  };

  return (
    <div
      className={`flex items-start gap-3 p-4 mb-3 border rounded-lg shadow-lg ${colors[notification.type]} transition-all duration-300`}
    >
      <div className="flex-shrink-0 mt-0.5">{icons[notification.type]}</div>
      <div className="flex-1">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
          {notification.title}
        </h4>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
          {notification.message}
        </p>
      </div>
      <button
        onClick={onClose}
        className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        aria-label={`Dismiss ${notification.title} notification`}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default function ToastContainer() {
  const { notifications } = useNotifications();
  const [activeToasts, setActiveToasts] = useState<Notification[]>([]);

  // Use a ref to track the previous notifications length to detect new ones
  const prevNotificationsRef = useRef(notifications);

  // Toasts that have already been shown and dismissed. Without this the
  // effect below re-adds a toast the moment it is dismissed: it re-runs on
  // activeToasts.length, sees an empty list and a still-recent unread
  // notification, and puts it straight back - so the 5s auto-dismiss never
  // actually removed anything (#1000). Entries are pruned once their
  // notification ages out of the recent window, so the set stays bounded for
  // a long-lived session (#1328).
  const dismissedIdsRef = useRef<Set<string>>(new Set());

  const removeToast = useCallback((id: string) => {
    dismissedIdsRef.current.add(id);
    setActiveToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const now = Date.now();
    pruneDismissedIds(dismissedIdsRef.current, notifications, now);

    // Only show unread notifications from the last 10 seconds as toasts on load/receive
    const recentUnread = notifications.filter(
      (n) =>
        !n.isRead && !dismissedIdsRef.current.has(n.id) && isRecent(n, now),
    );

    // Check if there are new notifications
    const prevUnread = prevNotificationsRef.current.filter(
      (n) =>
        !n.isRead && !dismissedIdsRef.current.has(n.id) && isRecent(n, now),
    );

    if (recentUnread.length > 0 && activeToasts.length === 0) {
      setActiveToasts(recentUnread.slice(0, 3)); // Show up to 3 toasts max
    } else if (recentUnread.length > prevUnread.length) {
      // New notification arrived
      setActiveToasts(recentUnread.slice(0, 3));
    }

    prevNotificationsRef.current = notifications;
  }, [notifications, activeToasts.length]);

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-80 max-w-full flex flex-col items-end"
      role="status"
      aria-live="polite"
      aria-label="Notifications"
    >
      {activeToasts.map((toast) => (
        <ToastMessage
          key={toast.id}
          notification={toast}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}

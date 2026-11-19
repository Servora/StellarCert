import { useEffect, useRef, useState } from "react";
import { Bell, CheckCircle, AlertTriangle, Info, Save, X } from "lucide-react";
import {
  useNotificationPreferencesQuery,
  useSaveNotificationPreferencesMutation,
} from "../api/queries";
import type { NotificationPreferences as Preferences } from "../api/types";

interface ToastState {
  type: "success" | "error";
  message: string;
}

export default function NotificationPreferences() {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const preferencesQuery = useNotificationPreferencesQuery();
  const saveMutation = useSaveNotificationPreferencesMutation();

  const loading = preferencesQuery.isPending;
  const saving = saveMutation.isPending;

  useEffect(() => {
    // Success is transient, but a failed save has to stay on screen until the
    // user dismisses it — otherwise it is too easy to miss that nothing saved.
    if (!toast || toast.type === "error") return;

    const timeoutId = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  // Copy the server's preferences into the form once they are cached. Unsaved
  // edits live in local state, so a background revalidation won't clobber them.
  const seeded = useRef(false);
  useEffect(() => {
    const data = preferencesQuery.data;
    if (!data || seeded.current) return;
    seeded.current = true;
    setPreferences({
      inAppEnabled: data.inAppEnabled,
      infoEnabled: data.infoEnabled,
      successEnabled: data.successEnabled,
      errorEnabled: data.errorEnabled,
    });
  }, [preferencesQuery.data]);

  const handleToggle = (key: keyof Preferences) => {
    if (preferences) {
      setPreferences({ ...preferences, [key]: !preferences[key] });
    }
  };

  const handleSave = async () => {
    if (!preferences) return;
    try {
      await saveMutation.mutateAsync(preferences);
      setToast({
        type: "success",
        message: "Notification preferences saved successfully.",
      });
    } catch (error) {
      console.error("Failed to save preferences:", error);
      setToast({
        type: "error",
        message: "Failed to save notification preferences.",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!preferences) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="mx-auto h-12 w-12 text-yellow-500 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
          Could not load preferences
        </h3>
        <p className="text-gray-500 dark:text-gray-400">
          Please try again later.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      {toast && (
        <div className="fixed right-4 top-4 z-50">
          <div
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg ${
              toast.type === "success"
                ? "border-green-200 bg-green-50 text-green-900 dark:border-green-900/40 dark:bg-green-900/30 dark:text-green-100"
                : "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-900/30 dark:text-red-100"
            }`}
            role={toast.type === "error" ? "alert" : "status"}
            aria-live={toast.type === "error" ? "assertive" : "polite"}
          >
            {toast.type === "success" ? (
              <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
            )}
            <p className="text-sm font-medium">{toast.message}</p>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className="-mr-1 -mt-1 flex-shrink-0 rounded p-1 opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-current"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      <div className="bg-white dark:bg-slate-900 shadow rounded-lg overflow-hidden border border-gray-200 dark:border-slate-800">
        <div className="px-6 py-5 border-b border-gray-200 dark:border-slate-800 flex items-center gap-3 bg-gray-50 dark:bg-slate-800/50">
          <Bell className="w-6 h-6 text-primary" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Notification Preferences
          </h2>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                In-App Notifications
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Receive real-time notifications while using the application.
                Check this to enable WebSockets.
              </p>
            </div>
            <button
              onClick={() => handleToggle("inAppEnabled")}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
                preferences.inAppEnabled
                  ? "bg-primary"
                  : "bg-gray-200 dark:bg-slate-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  preferences.inAppEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div
            className={`space-y-4 pt-4 border-t border-gray-200 dark:border-slate-800 ${!preferences.inAppEnabled ? "opacity-50 pointer-events-none" : ""}`}
          >
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
              Notification Types
            </h4>

            <div className="flex items-center justify-between p-3 rounded-lg bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30">
              <div className="flex items-center gap-3">
                <Info className="w-5 h-5 text-blue-500" />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    Information
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Updates, tips, and general system events
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={preferences.infoEnabled}
                onChange={() => handleToggle("infoEnabled")}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary dark:border-slate-600 dark:bg-slate-700 dark:ring-offset-slate-900"
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-green-50/50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/30">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    Success
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Successful actions like issuing a certificate
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={preferences.successEnabled}
                onChange={() => handleToggle("successEnabled")}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary dark:border-slate-600 dark:bg-slate-700 dark:ring-offset-slate-900"
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-red-50/50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    Errors & Warnings
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Failed actions and critical system alerts
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={preferences.errorEnabled}
                onChange={() => handleToggle("errorEnabled")}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary dark:border-slate-600 dark:bg-slate-700 dark:ring-offset-slate-900"
              />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary dark:focus:ring-offset-slate-900 disabled:opacity-50"
          >
            {saving ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save Preferences
          </button>
        </div>
      </div>
    </div>
  );
}

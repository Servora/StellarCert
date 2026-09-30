import React, { createContext, useContext, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_URL } from '../api';
import { tokenStorage } from '../api/tokens';
import { useQueryClient } from '@tanstack/react-query';
import {
    queryKeys,
    useMarkAllNotificationsReadMutation,
    useMarkNotificationReadMutation,
    useNotificationsQuery,
} from '../api/queries';
import type { Notification, NotificationType } from '../api/types';
import { useAuth } from './AuthContext';

export type { Notification, NotificationType };

interface NotificationContextProps {
    notifications: Notification[];
    unreadCount: number;
    markAsRead: (id: string) => Promise<void>;
    markAllAsRead: () => Promise<void>;
    refetchNotifications: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextProps | undefined>(undefined);

// #562 — derive socket origin reliably instead of fragile string.replace()
const getSocketOrigin = (): string => {
    try {
        return new URL(API_URL).origin;
    } catch {
        return API_URL;
    }
};

export const useNotifications = () => {
    const context = useContext(NotificationContext);
    if (!context) throw new Error('useNotifications must be used within NotificationProvider');
    return context;
};

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();
    // #563 — keep socket ref so we can reconnect on token rotation
    const socketRef = useRef<Socket | null>(null);

    const notificationsEnabled = isAuthenticated && !!tokenStorage.getAccessToken();
    const notificationsQuery = useNotificationsQuery(notificationsEnabled);
    const markAsReadMutation = useMarkNotificationReadMutation();
    const markAllAsReadMutation = useMarkAllNotificationsReadMutation();

    const notifications = notificationsEnabled ? (notificationsQuery.data ?? []) : [];

    const connectSocket = useCallback((token: string) => {
        // Disconnect any existing socket before creating a new one
        if (socketRef.current) {
            socketRef.current.disconnect();
        }

        const newSocket = io(getSocketOrigin(), {
            auth: { token },
        });

        newSocket.on('newNotification', (notification: Notification) => {
            // A push updates the cached list in place instead of local state, so
            // every consumer (badge, dropdown, toasts) sees it immediately.
            queryClient.setQueryData<Notification[]>(queryKeys.notifications.list(),
                (current) =>
                    current
                        ? [notification, ...current.filter((n) => n.id !== notification.id)]
                        : [notification],
            );
        });

        socketRef.current = newSocket;
    }, [queryClient]);

    useEffect(() => {
        if (!isAuthenticated) {
            socketRef.current?.disconnect();
            socketRef.current = null;
            // Drop the previous user's notifications so they cannot leak into
            // the next session rendered from cache.
            queryClient.removeQueries({ queryKey: queryKeys.notifications.root });
            return;
        }

        const token = tokenStorage.getAccessToken();
        if (!token) return;

        connectSocket(token);

        // #563 — reconnect with the new token whenever it is rotated.
        const handleTokenRotation = (e: StorageEvent) => {
            if (e.key === 'accessToken' && e.newValue && e.newValue !== e.oldValue) {
                connectSocket(e.newValue);
            }
        };

        window.addEventListener('storage', handleTokenRotation);

        return () => {
            window.removeEventListener('storage', handleTokenRotation);
            socketRef.current?.disconnect();
        };
    }, [isAuthenticated, queryClient, connectSocket]);

    const markAsRead = useCallback(
        async (id: string) => {
            try {
                await markAsReadMutation.mutateAsync(id);
            } catch (error) {
                console.error('Failed to mark as read:', error);
            }
        },
        [markAsReadMutation],
    );

    const markAllAsRead = useCallback(async () => {
        try {
            await markAllAsReadMutation.mutateAsync();
        } catch (error) {
            console.error('Failed to mark all as read:', error);
        }
    }, [markAllAsReadMutation]);

    const refetchNotifications = useCallback(async () => {
        await notificationsQuery.refetch();
    }, [notificationsQuery]);

    const unreadCount = notifications.filter((n) => !n.isRead).length;

    return (
        <NotificationContext.Provider
            value={{ notifications, unreadCount, markAsRead, markAllAsRead, refetchNotifications }}
        >
            {children}
        </NotificationContext.Provider>
    );
};

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { apiClient, API_URL } from '../api';
import { tokenStorage } from '../api/tokens';
import { useAuth } from './AuthContext';

export type NotificationType = 'info' | 'success' | 'error';

export interface Notification {
    id: string;
    type: NotificationType;
    title: string;
    message: string;
    isRead: boolean;
    createdAt: string;
}

interface NotificationContextProps {
    notifications: Notification[];
    unreadCount: number;
    markAsRead: (id: string) => Promise<void>;
    markAllAsRead: () => Promise<void>;
    fetchNotifications: () => Promise<void>;
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
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const { isAuthenticated } = useAuth();
    // #563 — keep socket ref so we can reconnect on token rotation
    const socketRef = useRef<Socket | null>(null);

    const fetchNotifications = async () => {
        try {
            const token = tokenStorage.getAccessToken();
            if (!token) return;

            const data = await apiClient<Notification[]>('/notifications');
            setNotifications(data);
        } catch (error) {
            console.error('Failed to fetch notifications:', error);
        }
    };

    const connectSocket = (token: string) => {
        // Disconnect any existing socket before creating a new one
        if (socketRef.current) {
            socketRef.current.disconnect();
        }

        const newSocket = io(getSocketOrigin(), {
            auth: { token },
        });

        newSocket.on('newNotification', (notification: Notification) => {
            setNotifications((prev) => [notification, ...prev]);
        });

        socketRef.current = newSocket;
    };

    useEffect(() => {
        if (!isAuthenticated) {
            socketRef.current?.disconnect();
            socketRef.current = null;
            setNotifications([]);
            return;
        }

        const token = tokenStorage.getAccessToken();
        if (!token) return;

        fetchNotifications();
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
    }, [isAuthenticated]);

    const markAsRead = async (id: string) => {
        try {
            await apiClient(`/notifications/${id}/read`, {
                method: 'PATCH',
            });
            setNotifications((prev) =>
                prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
            );
        } catch (error) {
            console.error('Failed to mark as read:', error);
        }
    };

    const markAllAsRead = async () => {
        try {
            await apiClient(`/notifications/read-all`, {
                method: 'PATCH',
            });
            setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
        } catch (error) {
            console.error('Failed to mark all as read:', error);
        }
    };

    const unreadCount = notifications.filter((n) => !n.isRead).length;

    return (
        <NotificationContext.Provider
            value={{ notifications, unreadCount, markAsRead, markAllAsRead, fetchNotifications }}
        >
            {children}
        </NotificationContext.Provider>
    );
};

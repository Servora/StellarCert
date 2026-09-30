import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationsGateway } from './notifications.gateway';
import { LoggingService } from '../../common/logging/logging.service';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepository: Repository<NotificationPreference>,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly logger: LoggingService,
  ) {}

  async createNotification(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
  ): Promise<Notification> {
    const preferences = await this.getPreferences(userId);

    const notification = this.notificationRepository.create({
      userId,
      type,
      title,
      message,
    });

    const savedNotification =
      await this.notificationRepository.save(notification);

    // Check if the user wants in-app notifications and for this specific type
    if (preferences.inAppEnabled) {
      let shouldSend = false;
      switch (type) {
        case NotificationType.INFO:
          shouldSend = preferences.infoEnabled;
          break;
        case NotificationType.SUCCESS:
          shouldSend = preferences.successEnabled;
          break;
        case NotificationType.ERROR:
          shouldSend = preferences.errorEnabled;
          break;
      }

      if (shouldSend) {
        this.notificationsGateway.sendNotification(userId, savedNotification);
      }
    }

    return savedNotification;
  }

  async getUserNotifications(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{
    data: Notification[];
    total: number;
    page: number;
    limit: number;
  }> {
    const [data, total] = await this.notificationRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }

  async markAsRead(
    userId: string,
    notificationId: string,
  ): Promise<Notification | null> {
    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId, userId },
    });

    if (notification && !notification.isRead) {
      notification.isRead = true;
      return this.notificationRepository.save(notification);
    }

    return notification;
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationRepository.update(
      { userId, isRead: false },
      { isRead: true },
    );
  }

  async getPreferences(userId: string): Promise<NotificationPreference> {
    let pref = await this.preferenceRepository.findOne({ where: { userId } });
    if (!pref) {
      pref = this.preferenceRepository.create({ userId });
      pref = await this.preferenceRepository.save(pref);
    }
    return pref;
  }

  async updatePreferences(
    userId: string,
    updateData: Partial<NotificationPreference>,
  ): Promise<NotificationPreference> {
    const pref = await this.getPreferences(userId);

    if (updateData.inAppEnabled !== undefined)
      pref.inAppEnabled = updateData.inAppEnabled;
    if (updateData.infoEnabled !== undefined)
      pref.infoEnabled = updateData.infoEnabled;
    if (updateData.successEnabled !== undefined)
      pref.successEnabled = updateData.successEnabled;
    if (updateData.errorEnabled !== undefined)
      pref.errorEnabled = updateData.errorEnabled;

    return this.preferenceRepository.save(pref);
  }
}

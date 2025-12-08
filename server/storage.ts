import { 
  maps, 
  devices,
  devicePlacements,
  connections,
  credentialProfiles,
  settings,
  notifications,
  deviceNotifications,
  notificationHistory,
  logs,
  scanProfiles,
  backups,
  users,
  portLocks,
  userNotificationChannels,
  dutyUserSchedules,
  dutyShiftConfig,
  alarmMutes,
  type Map, 
  type InsertMap,
  type Device,
  type InsertDevice,
  type DevicePlacement,
  type InsertDevicePlacement,
  type Connection,
  type InsertConnection,
  type CredentialProfile,
  type InsertCredentialProfile,
  type Notification,
  type InsertNotification,
  type DeviceNotification,
  type InsertDeviceNotification,
  type Log,
  type InsertLog,
  type ScanProfile,
  type InsertScanProfile,
  type Backup,
  type InsertBackup,
  type User,
  type InsertUser,
  type PortLock,
  type InsertPortLock,
  type UserNotificationChannel,
  type InsertUserNotificationChannel,
  type DutyUserSchedule,
  type InsertDutyUserSchedule,
  type DutyShiftConfig,
  type InsertDutyShiftConfig,
  type AlarmMute,
  type InsertAlarmMute
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, isNotNull, isNull, or, gt } from "drizzle-orm";

export interface IStorage {
  // Maps
  getAllMaps(): Promise<Map[]>;
  getMap(id: string): Promise<Map | undefined>;
  createMap(map: InsertMap): Promise<Map>;
  updateMap(id: string, map: Partial<InsertMap>): Promise<Map>;
  deleteMap(id: string): Promise<void>;

  // Devices (global)
  getAllDevices(): Promise<Device[]>;
  getDevice(id: string): Promise<Device | undefined>;
  createDevice(device: InsertDevice): Promise<Device>;
  updateDevice(id: string, device: Partial<InsertDevice>): Promise<Device | undefined>;
  deleteDevice(id: string): Promise<void>;

  // Device Placements
  getAllPlacements(): Promise<DevicePlacement[]>;
  getPlacementsByMapId(mapId: string): Promise<DevicePlacement[]>;
  getPlacement(id: string): Promise<DevicePlacement | undefined>;
  createPlacement(placement: InsertDevicePlacement): Promise<DevicePlacement>;
  updatePlacement(id: string, placement: Partial<InsertDevicePlacement>): Promise<DevicePlacement | undefined>;
  deletePlacement(id: string): Promise<void>;

  // Connections
  getConnectionsByMapId(mapId: string): Promise<Connection[]>;
  getConnection(id: string): Promise<Connection | undefined>;
  getMonitoredConnections(): Promise<Connection[]>;
  createConnection(connection: InsertConnection): Promise<Connection>;
  updateConnection(id: string, connection: Partial<InsertConnection>): Promise<Connection | undefined>;
  deleteConnection(id: string): Promise<void>;

  // Credential Profiles
  getAllCredentialProfiles(): Promise<CredentialProfile[]>;
  getCredentialProfile(id: string): Promise<CredentialProfile | undefined>;
  createCredentialProfile(profile: InsertCredentialProfile): Promise<CredentialProfile>;
  updateCredentialProfile(id: string, profile: Partial<InsertCredentialProfile>): Promise<CredentialProfile | undefined>;
  deleteCredentialProfile(id: string): Promise<void>;

  // Settings
  getSetting(key: string): Promise<any>;
  setSetting(key: string, value: any): Promise<void>;

  // Notifications
  getAllNotifications(): Promise<Notification[]>;
  getNotification(id: string): Promise<Notification | undefined>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  updateNotification(id: string, notification: Partial<InsertNotification>): Promise<Notification | undefined>;
  deleteNotification(id: string): Promise<void>;

  // Device Notifications
  getDeviceNotifications(deviceId: string): Promise<DeviceNotification[]>;
  addDeviceNotification(deviceNotification: InsertDeviceNotification): Promise<DeviceNotification>;
  removeDeviceNotification(deviceId: string, notificationId: string): Promise<void>;

  // Logs
  getAllLogs(limit?: number): Promise<Log[]>;
  getLogsByDeviceId(deviceId: string, limit?: number): Promise<Log[]>;
  createLog(log: InsertLog): Promise<Log>;

  // Scan Profiles
  getAllScanProfiles(): Promise<ScanProfile[]>;
  getScanProfile(id: string): Promise<ScanProfile | undefined>;
  createScanProfile(profile: InsertScanProfile): Promise<ScanProfile>;
  updateScanProfile(id: string, profile: Partial<InsertScanProfile>): Promise<ScanProfile | undefined>;
  deleteScanProfile(id: string): Promise<void>;

  // Backups
  getAllBackups(): Promise<Backup[]>;
  getBackup(id: string): Promise<Backup | undefined>;
  createBackup(backup: InsertBackup): Promise<Backup>;
  deleteBackup(id: string): Promise<void>;

  // Users
  getAllUsers(): Promise<User[]>;
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined>;
  updateUserLastLogin(id: string): Promise<void>;
  deleteUser(id: string): Promise<void>;

  // Port Locks
  getPortLocks(deviceId: string): Promise<PortLock[]>;
  getPortLock(deviceId: string, portName: string): Promise<PortLock | undefined>;
  createPortLock(portLock: InsertPortLock): Promise<PortLock>;
  deletePortLock(deviceId: string, portName: string): Promise<void>;

  // User Notification Channels
  getUserNotificationChannels(userId: string): Promise<UserNotificationChannel[]>;
  getAllUserNotificationChannels(): Promise<UserNotificationChannel[]>;
  getUserNotificationChannel(id: string): Promise<UserNotificationChannel | undefined>;
  createUserNotificationChannel(channel: InsertUserNotificationChannel): Promise<UserNotificationChannel>;
  updateUserNotificationChannel(id: string, channel: Partial<InsertUserNotificationChannel>): Promise<UserNotificationChannel | undefined>;
  deleteUserNotificationChannel(id: string): Promise<void>;

  // Duty User Schedules (simplified: users assigned directly to day/night shifts)
  getAllDutyUserSchedules(): Promise<DutyUserSchedule[]>;
  getDutyUserSchedulesByShift(shift: 'day' | 'night'): Promise<DutyUserSchedule[]>;
  addDutyUserSchedule(schedule: InsertDutyUserSchedule): Promise<DutyUserSchedule>;
  removeDutyUserSchedule(userId: string, shift: 'day' | 'night'): Promise<void>;
  removeDutyUserScheduleById(id: string): Promise<void>;
  clearDutyUserSchedules(): Promise<void>;

  // Duty Shift Config
  getDutyShiftConfig(): Promise<DutyShiftConfig | undefined>;
  updateDutyShiftConfig(config: Partial<InsertDutyShiftConfig>): Promise<DutyShiftConfig>;

  // Alarm Mutes
  getAllAlarmMutes(): Promise<AlarmMute[]>;
  getActiveAlarmMutes(): Promise<AlarmMute[]>;
  getAlarmMuteForUser(userId: string): Promise<AlarmMute | undefined>;
  getGlobalAlarmMute(): Promise<AlarmMute | undefined>;
  createAlarmMute(mute: InsertAlarmMute): Promise<AlarmMute>;
  deleteAlarmMute(id: string): Promise<void>;
  clearExpiredAlarmMutes(): Promise<void>;

  // Map Health Summary
  getMapHealthSummary(): Promise<{ mapId: string; hasOffline: boolean }[]>;

  // Bulk Delete Operations
  deleteAllNetworkData(): Promise<{ devicesDeleted: number; mapsDeleted: number; logsDeleted: number }>;
}

export class DatabaseStorage implements IStorage {
  // Maps
  async getAllMaps(): Promise<Map[]> {
    return await db.select().from(maps).orderBy(maps.createdAt);
  }

  async getMap(id: string): Promise<Map | undefined> {
    const [map] = await db.select().from(maps).where(eq(maps.id, id));
    return map || undefined;
  }

  async createMap(insertMap: InsertMap): Promise<Map> {
    const [map] = await db
      .insert(maps)
      .values(insertMap)
      .returning();
    return map;
  }

  async updateMap(id: string, updateData: Partial<InsertMap>): Promise<Map> {
    const [map] = await db
      .update(maps)
      .set(updateData)
      .where(eq(maps.id, id))
      .returning();
    return map;
  }

  async deleteMap(id: string): Promise<void> {
    await db.delete(maps).where(eq(maps.id, id));
  }

  // Devices (global)
  async getAllDevices(): Promise<Device[]> {
    return await db.select().from(devices).orderBy(devices.name);
  }

  async getDevice(id: string): Promise<Device | undefined> {
    const [device] = await db.select().from(devices).where(eq(devices.id, id));
    return device || undefined;
  }

  async createDevice(insertDevice: InsertDevice): Promise<Device> {
    const [device] = await db
      .insert(devices)
      .values(insertDevice)
      .returning();
    return device;
  }

  async updateDevice(id: string, updateData: Partial<InsertDevice>): Promise<Device | undefined> {
    const [device] = await db
      .update(devices)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(devices.id, id))
      .returning();
    return device || undefined;
  }

  async deleteDevice(id: string): Promise<void> {
    await db.delete(devices).where(eq(devices.id, id));
  }

  // Device Placements
  async getAllPlacements(): Promise<DevicePlacement[]> {
    return await db.select().from(devicePlacements);
  }

  async getPlacementsByMapId(mapId: string): Promise<DevicePlacement[]> {
    return await db.select().from(devicePlacements).where(eq(devicePlacements.mapId, mapId));
  }

  async getPlacement(id: string): Promise<DevicePlacement | undefined> {
    const [placement] = await db.select().from(devicePlacements).where(eq(devicePlacements.id, id));
    return placement || undefined;
  }

  async createPlacement(insertPlacement: InsertDevicePlacement): Promise<DevicePlacement> {
    const [placement] = await db
      .insert(devicePlacements)
      .values(insertPlacement)
      .returning();
    return placement;
  }

  async updatePlacement(id: string, updateData: Partial<InsertDevicePlacement>): Promise<DevicePlacement | undefined> {
    const [placement] = await db
      .update(devicePlacements)
      .set(updateData)
      .where(eq(devicePlacements.id, id))
      .returning();
    return placement || undefined;
  }

  async deletePlacement(id: string): Promise<void> {
    await db.delete(devicePlacements).where(eq(devicePlacements.id, id));
  }

  // Connections
  async getConnectionsByMapId(mapId: string): Promise<Connection[]> {
    return await db.select().from(connections).where(eq(connections.mapId, mapId));
  }

  async getConnection(id: string): Promise<Connection | undefined> {
    const [connection] = await db.select().from(connections).where(eq(connections.id, id));
    return connection || undefined;
  }

  async getMonitoredConnections(): Promise<Connection[]> {
    return await db.select().from(connections).where(isNotNull(connections.monitorInterface));
  }

  async createConnection(insertConnection: InsertConnection): Promise<Connection> {
    const [connection] = await db
      .insert(connections)
      .values(insertConnection)
      .returning();
    return connection;
  }

  async updateConnection(id: string, updateData: Partial<InsertConnection>): Promise<Connection | undefined> {
    const [connection] = await db
      .update(connections)
      .set(updateData)
      .where(eq(connections.id, id))
      .returning();
    return connection || undefined;
  }

  async deleteConnection(id: string): Promise<void> {
    await db.delete(connections).where(eq(connections.id, id));
  }

  // Credential Profiles
  async getAllCredentialProfiles(): Promise<CredentialProfile[]> {
    return await db.select().from(credentialProfiles).orderBy(credentialProfiles.name);
  }

  async getCredentialProfile(id: string): Promise<CredentialProfile | undefined> {
    const [profile] = await db.select().from(credentialProfiles).where(eq(credentialProfiles.id, id));
    return profile || undefined;
  }

  async createCredentialProfile(insertProfile: InsertCredentialProfile): Promise<CredentialProfile> {
    const [profile] = await db
      .insert(credentialProfiles)
      .values(insertProfile)
      .returning();
    return profile;
  }

  async updateCredentialProfile(id: string, updateData: Partial<InsertCredentialProfile>): Promise<CredentialProfile | undefined> {
    const [profile] = await db
      .update(credentialProfiles)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(credentialProfiles.id, id))
      .returning();
    return profile || undefined;
  }

  async deleteCredentialProfile(id: string): Promise<void> {
    await db.delete(credentialProfiles).where(eq(credentialProfiles.id, id));
  }

  // Settings
  async getSetting(key: string): Promise<any> {
    const [setting] = await db.select().from(settings).where(eq(settings.key, key));
    return setting?.value;
  }

  async setSetting(key: string, value: any): Promise<void> {
    await db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date() },
      });
  }

  // Notifications
  async getAllNotifications(): Promise<Notification[]> {
    return await db.select().from(notifications).orderBy(notifications.name);
  }

  async getNotification(id: string): Promise<Notification | undefined> {
    const [notif] = await db.select().from(notifications).where(eq(notifications.id, id));
    return notif || undefined;
  }

  async createNotification(insertNotification: InsertNotification): Promise<Notification> {
    const [notif] = await db
      .insert(notifications)
      .values(insertNotification)
      .returning();
    return notif;
  }

  async updateNotification(id: string, updateData: Partial<InsertNotification>): Promise<Notification | undefined> {
    const [notif] = await db
      .update(notifications)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(notifications.id, id))
      .returning();
    return notif || undefined;
  }

  async deleteNotification(id: string): Promise<void> {
    await db.delete(notifications).where(eq(notifications.id, id));
  }

  async getDeviceNotifications(deviceId: string): Promise<DeviceNotification[]> {
    return await db.select().from(deviceNotifications).where(eq(deviceNotifications.deviceId, deviceId));
  }

  async addDeviceNotification(insertDeviceNotification: InsertDeviceNotification): Promise<DeviceNotification> {
    const [dn] = await db
      .insert(deviceNotifications)
      .values(insertDeviceNotification)
      .returning();
    return dn;
  }

  async removeDeviceNotification(deviceId: string, notificationId: string): Promise<void> {
    await db
      .delete(deviceNotifications)
      .where(and(eq(deviceNotifications.deviceId, deviceId), eq(deviceNotifications.notificationId, notificationId)));
  }

  // Logs
  async getAllLogs(limit: number = 1000): Promise<Log[]> {
    return await db
      .select()
      .from(logs)
      .orderBy(desc(logs.timestamp))
      .limit(limit);
  }

  async getLogsByDeviceId(deviceId: string, limit: number = 1000): Promise<Log[]> {
    return await db
      .select()
      .from(logs)
      .where(eq(logs.deviceId, deviceId))
      .orderBy(desc(logs.timestamp))
      .limit(limit);
  }

  async createLog(insertLog: InsertLog): Promise<Log> {
    const [log] = await db
      .insert(logs)
      .values(insertLog)
      .returning();
    return log;
  }

  async deleteAllLogs(): Promise<void> {
    await db.delete(logs);
  }

  async deleteLogsByDeviceId(deviceId: string): Promise<void> {
    await db.delete(logs).where(eq(logs.deviceId, deviceId));
  }

  // Scan Profiles
  async getAllScanProfiles(): Promise<ScanProfile[]> {
    return await db.select().from(scanProfiles).orderBy(scanProfiles.name);
  }

  async getScanProfile(id: string): Promise<ScanProfile | undefined> {
    const [profile] = await db.select().from(scanProfiles).where(eq(scanProfiles.id, id));
    return profile || undefined;
  }

  async createScanProfile(insertProfile: InsertScanProfile): Promise<ScanProfile> {
    const [profile] = await db
      .insert(scanProfiles)
      .values(insertProfile)
      .returning();
    return profile;
  }

  async updateScanProfile(id: string, updateData: Partial<InsertScanProfile>): Promise<ScanProfile | undefined> {
    const [profile] = await db
      .update(scanProfiles)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(scanProfiles.id, id))
      .returning();
    return profile || undefined;
  }

  async deleteScanProfile(id: string): Promise<void> {
    await db.delete(scanProfiles).where(eq(scanProfiles.id, id));
  }

  // Backups
  async getAllBackups(): Promise<Backup[]> {
    return await db.select().from(backups).orderBy(desc(backups.createdAt));
  }

  async getBackup(id: string): Promise<Backup | undefined> {
    const [backup] = await db.select().from(backups).where(eq(backups.id, id));
    return backup || undefined;
  }

  async createBackup(insertBackup: InsertBackup): Promise<Backup> {
    const [backup] = await db
      .insert(backups)
      .values(insertBackup)
      .returning();
    return backup;
  }

  async deleteBackup(id: string): Promise<void> {
    await db.delete(backups).where(eq(backups.id, id));
  }

  // Users
  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(users.username);
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async updateUser(id: string, updateData: Partial<InsertUser>): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async updateUserLastLogin(id: string): Promise<void> {
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, id));
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  // Port Locks
  async getPortLocks(deviceId: string): Promise<PortLock[]> {
    return await db.select().from(portLocks).where(eq(portLocks.deviceId, deviceId));
  }

  async getPortLock(deviceId: string, portName: string): Promise<PortLock | undefined> {
    const [lock] = await db
      .select()
      .from(portLocks)
      .where(and(eq(portLocks.deviceId, deviceId), eq(portLocks.portName, portName)));
    return lock || undefined;
  }

  async createPortLock(insertLock: InsertPortLock): Promise<PortLock> {
    const [lock] = await db
      .insert(portLocks)
      .values(insertLock)
      .returning();
    return lock;
  }

  async deletePortLock(deviceId: string, portName: string): Promise<void> {
    await db
      .delete(portLocks)
      .where(and(eq(portLocks.deviceId, deviceId), eq(portLocks.portName, portName)));
  }

  // User Notification Channels
  async getUserNotificationChannels(userId: string): Promise<UserNotificationChannel[]> {
    return await db.select().from(userNotificationChannels).where(eq(userNotificationChannels.userId, userId));
  }

  async getAllUserNotificationChannels(): Promise<UserNotificationChannel[]> {
    return await db.select().from(userNotificationChannels);
  }

  async getUserNotificationChannel(id: string): Promise<UserNotificationChannel | undefined> {
    const [channel] = await db.select().from(userNotificationChannels).where(eq(userNotificationChannels.id, id));
    return channel || undefined;
  }

  async createUserNotificationChannel(insertChannel: InsertUserNotificationChannel): Promise<UserNotificationChannel> {
    const [channel] = await db
      .insert(userNotificationChannels)
      .values(insertChannel)
      .returning();
    return channel;
  }

  async updateUserNotificationChannel(id: string, updateData: Partial<InsertUserNotificationChannel>): Promise<UserNotificationChannel | undefined> {
    const [channel] = await db
      .update(userNotificationChannels)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(userNotificationChannels.id, id))
      .returning();
    return channel || undefined;
  }

  async deleteUserNotificationChannel(id: string): Promise<void> {
    await db.delete(userNotificationChannels).where(eq(userNotificationChannels.id, id));
  }

  // Duty User Schedules (simplified: users assigned directly to day/night shifts)
  async getAllDutyUserSchedules(): Promise<DutyUserSchedule[]> {
    return await db.select().from(dutyUserSchedules);
  }

  async getDutyUserSchedulesByShift(shift: 'day' | 'night'): Promise<DutyUserSchedule[]> {
    return await db.select().from(dutyUserSchedules).where(eq(dutyUserSchedules.shift, shift));
  }

  async addDutyUserSchedule(insertSchedule: InsertDutyUserSchedule): Promise<DutyUserSchedule> {
    // Check if this user+shift combo already exists
    const existing = await db.select().from(dutyUserSchedules)
      .where(and(eq(dutyUserSchedules.userId, insertSchedule.userId), eq(dutyUserSchedules.shift, insertSchedule.shift)));
    if (existing.length > 0) {
      return existing[0]; // Already exists
    }
    const [schedule] = await db
      .insert(dutyUserSchedules)
      .values(insertSchedule)
      .returning();
    return schedule;
  }

  async removeDutyUserSchedule(userId: string, shift: 'day' | 'night'): Promise<void> {
    await db
      .delete(dutyUserSchedules)
      .where(and(eq(dutyUserSchedules.userId, userId), eq(dutyUserSchedules.shift, shift)));
  }

  async removeDutyUserScheduleById(id: string): Promise<void> {
    await db.delete(dutyUserSchedules).where(eq(dutyUserSchedules.id, id));
  }

  async clearDutyUserSchedules(): Promise<void> {
    await db.delete(dutyUserSchedules);
  }

  // Duty Shift Config
  async getDutyShiftConfig(): Promise<DutyShiftConfig | undefined> {
    const [config] = await db.select().from(dutyShiftConfig);
    return config || undefined;
  }

  async updateDutyShiftConfig(updateData: Partial<InsertDutyShiftConfig>): Promise<DutyShiftConfig> {
    const existing = await this.getDutyShiftConfig();
    if (existing) {
      const [config] = await db
        .update(dutyShiftConfig)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(dutyShiftConfig.id, existing.id))
        .returning();
      return config;
    } else {
      const [config] = await db
        .insert(dutyShiftConfig)
        .values(updateData as InsertDutyShiftConfig)
        .returning();
      return config;
    }
  }

  // Alarm Mutes
  async getAllAlarmMutes(): Promise<AlarmMute[]> {
    return await db.select().from(alarmMutes).orderBy(desc(alarmMutes.createdAt));
  }

  async getActiveAlarmMutes(): Promise<AlarmMute[]> {
    const now = new Date();
    return await db.select().from(alarmMutes).where(
      or(
        isNull(alarmMutes.muteUntil), // Forever mutes
        gt(alarmMutes.muteUntil, now) // Not yet expired
      )
    );
  }

  async getAlarmMuteForUser(userId: string): Promise<AlarmMute | undefined> {
    const now = new Date();
    const [mute] = await db.select().from(alarmMutes).where(
      and(
        eq(alarmMutes.userId, userId),
        or(
          isNull(alarmMutes.muteUntil),
          gt(alarmMutes.muteUntil, now)
        )
      )
    );
    return mute || undefined;
  }

  async getGlobalAlarmMute(): Promise<AlarmMute | undefined> {
    const now = new Date();
    const [mute] = await db.select().from(alarmMutes).where(
      and(
        isNull(alarmMutes.userId), // Global mute has no userId
        or(
          isNull(alarmMutes.muteUntil),
          gt(alarmMutes.muteUntil, now)
        )
      )
    );
    return mute || undefined;
  }

  async createAlarmMute(mute: InsertAlarmMute): Promise<AlarmMute> {
    // First delete any existing mute for this user (or global if userId is null)
    if (mute.userId) {
      await db.delete(alarmMutes).where(eq(alarmMutes.userId, mute.userId));
    } else {
      await db.delete(alarmMutes).where(isNull(alarmMutes.userId));
    }
    
    const [created] = await db.insert(alarmMutes).values(mute).returning();
    return created;
  }

  async deleteAlarmMute(id: string): Promise<void> {
    await db.delete(alarmMutes).where(eq(alarmMutes.id, id));
  }

  async clearExpiredAlarmMutes(): Promise<void> {
    const now = new Date();
    // Delete mutes where muteUntil is in the past (now > muteUntil)
    // Using lt(column, now) instead of gt(now, column)
    const { lt } = await import('drizzle-orm');
    await db.delete(alarmMutes).where(
      and(
        isNotNull(alarmMutes.muteUntil),
        lt(alarmMutes.muteUntil, now)
      )
    );
  }

  // Map Health Summary - aggregate device statuses per map
  async getMapHealthSummary(): Promise<{ mapId: string; hasOffline: boolean }[]> {
    // Get all placements with their device statuses
    const allPlacements = await db.select().from(devicePlacements);
    const allDevices = await db.select().from(devices);
    
    // Build a device status lookup
    const deviceStatusMap = new Map<string, string>();
    for (const device of allDevices) {
      deviceStatusMap.set(device.id, device.status);
    }
    
    // Group placements by mapId and check for offline devices
    const mapHealthMap = new Map<string, boolean>();
    
    for (const placement of allPlacements) {
      const deviceStatus = deviceStatusMap.get(placement.deviceId);
      const hasOffline = mapHealthMap.get(placement.mapId) || false;
      
      // Mark map as having offline if any device is offline
      if (deviceStatus === 'offline') {
        mapHealthMap.set(placement.mapId, true);
      } else if (!mapHealthMap.has(placement.mapId)) {
        mapHealthMap.set(placement.mapId, false);
      }
    }
    
    // Convert to array format
    return Array.from(mapHealthMap.entries()).map(([mapId, hasOffline]) => ({
      mapId,
      hasOffline
    }));
  }

  // Bulk Delete Operations - deletes all network data but preserves users, credentials, and settings
  async deleteAllNetworkData(): Promise<{ devicesDeleted: number; mapsDeleted: number; logsDeleted: number }> {
    // Count before deletion for reporting
    const allDevices = await db.select().from(devices);
    const allMaps = await db.select().from(maps);
    const allLogs = await db.select().from(logs);
    
    const devicesDeleted = allDevices.length;
    const mapsDeleted = allMaps.length;
    const logsDeleted = allLogs.length;
    
    // Delete in order - cascades will handle related data
    // Logs first (has FK to devices)
    await db.delete(logs);
    // Notification history (has FK to devices)
    await db.delete(notificationHistory);
    // Device notifications (has FK to devices)
    await db.delete(deviceNotifications);
    // Port locks (has FK to devices)
    await db.delete(portLocks);
    // Connections (has FK to devices and maps)
    await db.delete(connections);
    // Device placements (has FK to devices and maps)
    await db.delete(devicePlacements);
    // Devices
    await db.delete(devices);
    // Maps
    await db.delete(maps);
    
    return { devicesDeleted, mapsDeleted, logsDeleted };
  }
}

export const storage = new DatabaseStorage();

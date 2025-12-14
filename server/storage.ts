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
  deviceStatusEvents,
  proxmoxVms,
  ipamPools,
  ipamAddresses,
  ipamAddressAssignments,
  deviceInterfaces,
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
  type InsertAlarmMute,
  type DeviceStatusEvent,
  type InsertDeviceStatusEvent,
  type ProxmoxVm,
  type InsertProxmoxVm,
  type IpamPool,
  type InsertIpamPool,
  type IpamAddress,
  type InsertIpamAddress,
  type DeviceInterface,
  type InsertDeviceInterface,
  type IpamAddressAssignment,
  type InsertIpamAddressAssignment,
  type IpamAddressWithAssignments
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, isNotNull, isNull, or, gt } from "drizzle-orm";

// IP utility functions for IPAM pool matching
function ipToLong(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function isIpInCidr(ip: string, cidr: string): boolean {
  const [baseIp, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const ipNum = ipToLong(ip);
  const baseNum = ipToLong(baseIp);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const network = baseNum & mask;
  const broadcast = network | (~mask >>> 0);
  
  // Check if IP is in the network range
  if ((ipNum & mask) !== network) return false;
  
  // For /31 and /32, all addresses are valid hosts
  if (prefix >= 31) return true;
  
  // Exclude network and broadcast addresses for standard subnets
  return ipNum !== network && ipNum !== broadcast;
}

function isIpInRange(ip: string, rangeStart: string, rangeEnd: string): boolean {
  const ipNum = ipToLong(ip);
  const startNum = ipToLong(rangeStart);
  const endNum = ipToLong(rangeEnd);
  return ipNum >= startNum && ipNum <= endNum;
}

function findPoolForIp(ip: string, pools: IpamPool[]): IpamPool | null {
  for (const pool of pools) {
    if (pool.entryType === 'cidr' && pool.cidr) {
      if (isIpInCidr(ip, pool.cidr)) return pool;
    } else if (pool.entryType === 'range' && pool.rangeStart && pool.rangeEnd) {
      if (isIpInRange(ip, pool.rangeStart, pool.rangeEnd)) return pool;
    } else if (pool.entryType === 'single') {
      // Single-entry pools may store IP in rangeStart or cidr
      if (pool.rangeStart === ip || pool.cidr === ip) return pool;
    }
  }
  return null;
}

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

  // Device Status Events
  createDeviceStatusEvent(event: InsertDeviceStatusEvent): Promise<DeviceStatusEvent>;
  getDeviceStatusEvents(deviceId: string, options?: { since?: Date; until?: Date; includeWarnings?: boolean; limit?: number }): Promise<DeviceStatusEvent[]>;
  getDeviceStatusSummary(deviceId: string, since: Date): Promise<{ status: string; durationMs: number }[]>;
  deleteOldDeviceStatusEvents(olderThan: Date): Promise<number>;

  // Proxmox VMs
  getProxmoxVmsByHost(hostDeviceId: string): Promise<ProxmoxVm[]>;
  getProxmoxVm(id: string): Promise<ProxmoxVm | undefined>;
  getProxmoxVmByVmid(hostDeviceId: string, vmid: number): Promise<ProxmoxVm | undefined>;
  createProxmoxVm(vm: InsertProxmoxVm): Promise<ProxmoxVm>;
  updateProxmoxVm(id: string, vm: Partial<InsertProxmoxVm>): Promise<ProxmoxVm | undefined>;
  upsertProxmoxVm(hostDeviceId: string, vmid: number, vm: Partial<InsertProxmoxVm>): Promise<ProxmoxVm>;
  deleteProxmoxVm(id: string): Promise<void>;
  deleteProxmoxVmsByHost(hostDeviceId: string): Promise<void>;
  getProxmoxVmByMatchedDevice(matchedDeviceId: string): Promise<ProxmoxVm | undefined>;
  getAllProxmoxVms(): Promise<ProxmoxVm[]>;
  matchProxmoxVmToDevice(vmId: string, matchedDeviceId: string | null): Promise<ProxmoxVm | undefined>;
  autoMatchVmToDevices(vmId: string, ipAddresses: string[], macAddresses?: string[]): Promise<string | null>;

  // Map Health Summary
  getMapHealthSummary(): Promise<{ mapId: string; hasOffline: boolean }[]>;

  // Bulk Delete Operations
  deleteAllNetworkData(): Promise<{ devicesDeleted: number; mapsDeleted: number; logsDeleted: number }>;

  // IPAM Pools
  getAllIpamPools(): Promise<IpamPool[]>;
  getIpamPool(id: string): Promise<IpamPool | undefined>;
  createIpamPool(pool: InsertIpamPool): Promise<IpamPool>;
  updateIpamPool(id: string, pool: Partial<InsertIpamPool>): Promise<IpamPool | undefined>;
  deleteIpamPool(id: string): Promise<void>;

  // IPAM Addresses
  getAllIpamAddresses(): Promise<IpamAddress[]>;
  getIpamAddressesByPool(poolId: string): Promise<IpamAddress[]>;
  getUnassignedIpamAddresses(): Promise<IpamAddress[]>;
  getIpamPoolStats(): Promise<{ poolId: string | null; total: number; assigned: number; available: number; reserved: number }[]>;
  getIpamAddress(id: string): Promise<IpamAddress | undefined>;
  getIpamAddressByIp(ipAddress: string): Promise<IpamAddress | undefined>;
  getIpamAddressesByDevice(deviceId: string): Promise<IpamAddress[]>;
  createIpamAddress(address: InsertIpamAddress): Promise<IpamAddress>;
  createIpamAddressesBulk(addresses: InsertIpamAddress[]): Promise<IpamAddress[]>;
  upsertIpamAddress(address: InsertIpamAddress): Promise<IpamAddress>;
  updateIpamAddress(id: string, address: Partial<InsertIpamAddress>): Promise<IpamAddress | undefined>;
  deleteIpamAddress(id: string): Promise<void>;
  deleteIpamAddressesByPool(poolId: string): Promise<void>;

  // Device Interfaces
  getAllDeviceInterfaces(): Promise<DeviceInterface[]>;
  getDeviceInterfaces(deviceId: string): Promise<DeviceInterface[]>;
  getDeviceInterface(id: string): Promise<DeviceInterface | undefined>;
  createDeviceInterface(iface: InsertDeviceInterface): Promise<DeviceInterface>;
  createDeviceInterfacesBulk(interfaces: InsertDeviceInterface[]): Promise<DeviceInterface[]>;
  updateDeviceInterface(id: string, iface: Partial<InsertDeviceInterface>): Promise<DeviceInterface | undefined>;
  deleteDeviceInterface(id: string): Promise<void>;
  deleteDeviceInterfacesByDevice(deviceId: string): Promise<void>;
  syncDeviceInterfaces(deviceId: string, interfaces: Omit<InsertDeviceInterface, 'deviceId'>[]): Promise<DeviceInterface[]>;
  syncDeviceIpAddresses(deviceId: string, discoveredAddresses: { ipAddress: string; networkAddress?: string; interfaceName: string; disabled?: boolean; comment?: string }[], interfaces: DeviceInterface[]): Promise<IpamAddress[]>;
  
  // IPAM Address Assignments (junction table)
  getAssignmentsByAddress(addressId: string): Promise<IpamAddressAssignment[]>;
  getAssignmentsByDevice(deviceId: string): Promise<IpamAddressAssignment[]>;
  createAssignment(assignment: InsertIpamAddressAssignment): Promise<IpamAddressAssignment>;
  deleteAssignment(id: string): Promise<void>;
  deleteAssignmentsByAddress(addressId: string): Promise<void>;
  deleteAssignmentsByDevice(deviceId: string): Promise<void>;
  upsertAssignment(addressId: string, deviceId: string, interfaceId: string | null, source: 'manual' | 'discovered' | 'sync'): Promise<IpamAddressAssignment>;
  getIpamAddressesWithAssignments(poolId?: string | null): Promise<IpamAddressWithAssignments[]>;
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

  // Device Status Events
  async createDeviceStatusEvent(event: InsertDeviceStatusEvent): Promise<DeviceStatusEvent> {
    const [statusEvent] = await db
      .insert(deviceStatusEvents)
      .values(event)
      .returning();
    return statusEvent;
  }

  async getDeviceStatusEvents(
    deviceId: string, 
    options?: { since?: Date; until?: Date; includeWarnings?: boolean; limit?: number }
  ): Promise<DeviceStatusEvent[]> {
    const { gte, lte, ne } = await import('drizzle-orm');
    
    let query = db.select().from(deviceStatusEvents)
      .where(eq(deviceStatusEvents.deviceId, deviceId))
      .orderBy(desc(deviceStatusEvents.createdAt));

    // Build conditions array for additional filters
    const conditions = [eq(deviceStatusEvents.deviceId, deviceId)];
    
    if (options?.since) {
      conditions.push(gte(deviceStatusEvents.createdAt, options.since));
    }
    
    if (options?.until) {
      conditions.push(lte(deviceStatusEvents.createdAt, options.until));
    }
    
    // Filter out warning status if requested
    if (options?.includeWarnings === false) {
      conditions.push(ne(deviceStatusEvents.newStatus, 'warning'));
      conditions.push(or(
        isNull(deviceStatusEvents.previousStatus),
        ne(deviceStatusEvents.previousStatus, 'warning')
      )!);
    }

    const results = await db.select().from(deviceStatusEvents)
      .where(and(...conditions))
      .orderBy(desc(deviceStatusEvents.createdAt))
      .limit(options?.limit ?? 1000);
    
    return results;
  }

  async getDeviceStatusSummary(deviceId: string, since: Date): Promise<{ status: string; durationMs: number }[]> {
    const { gte, lt } = await import('drizzle-orm');
    
    const now = new Date();
    const statusDurations: Record<string, number> = {};
    
    // Get the last event before the "since" date to determine starting status
    const [lastEventBeforeSince] = await db.select().from(deviceStatusEvents)
      .where(and(
        eq(deviceStatusEvents.deviceId, deviceId),
        lt(deviceStatusEvents.createdAt, since)
      ))
      .orderBy(desc(deviceStatusEvents.createdAt))
      .limit(1);
    
    // Get all status events since the start time, ordered by creation date
    const eventsInRange = await db.select().from(deviceStatusEvents)
      .where(and(
        eq(deviceStatusEvents.deviceId, deviceId),
        gte(deviceStatusEvents.createdAt, since)
      ))
      .orderBy(deviceStatusEvents.createdAt);
    
    // If no events at all, fall back to device's current status for the entire window
    if (!lastEventBeforeSince && eventsInRange.length === 0) {
      const device = await this.getDevice(deviceId);
      if (device) {
        const durationMs = now.getTime() - since.getTime();
        return [{ status: device.status, durationMs }];
      }
      return [];
    }
    
    // Track current status and time as we walk through the timeline
    // Use pre-window event status, or fall back to first in-range event's previousStatus
    let currentStatus: string | undefined = lastEventBeforeSince?.newStatus;
    
    // If no pre-window event but we have in-range events, use the first event's previousStatus as baseline
    if (!currentStatus && eventsInRange.length > 0) {
      currentStatus = eventsInRange[0].previousStatus || undefined;
    }
    
    let lastTime = since;
    
    // Process each event in range
    for (const event of eventsInRange) {
      const eventTime = new Date(event.createdAt);
      
      // If we have a current status, add duration from lastTime to this event
      if (currentStatus) {
        const durationMs = eventTime.getTime() - lastTime.getTime();
        if (durationMs > 0) {
          statusDurations[currentStatus] = (statusDurations[currentStatus] || 0) + durationMs;
        }
      }
      
      // Update current status and lastTime for next iteration
      currentStatus = event.newStatus;
      lastTime = eventTime;
    }
    
    // Add the tail interval from the last event to now
    if (currentStatus) {
      const durationMs = now.getTime() - lastTime.getTime();
      if (durationMs > 0) {
        statusDurations[currentStatus] = (statusDurations[currentStatus] || 0) + durationMs;
      }
    }
    
    return Object.entries(statusDurations).map(([status, durationMs]) => ({
      status,
      durationMs
    }));
  }

  async deleteOldDeviceStatusEvents(olderThan: Date): Promise<number> {
    const { lt } = await import('drizzle-orm');
    const result = await db.delete(deviceStatusEvents)
      .where(lt(deviceStatusEvents.createdAt, olderThan))
      .returning();
    return result.length;
  }

  // Proxmox VMs
  async getProxmoxVmsByHost(hostDeviceId: string): Promise<ProxmoxVm[]> {
    return await db.select().from(proxmoxVms)
      .where(eq(proxmoxVms.hostDeviceId, hostDeviceId))
      .orderBy(proxmoxVms.vmid);
  }

  async getProxmoxVm(id: string): Promise<ProxmoxVm | undefined> {
    const [vm] = await db.select().from(proxmoxVms).where(eq(proxmoxVms.id, id));
    return vm || undefined;
  }

  async getProxmoxVmByVmid(hostDeviceId: string, vmid: number): Promise<ProxmoxVm | undefined> {
    const [vm] = await db.select().from(proxmoxVms)
      .where(and(
        eq(proxmoxVms.hostDeviceId, hostDeviceId),
        eq(proxmoxVms.vmid, vmid)
      ));
    return vm || undefined;
  }

  async createProxmoxVm(vm: InsertProxmoxVm): Promise<ProxmoxVm> {
    const [created] = await db.insert(proxmoxVms).values(vm).returning();
    return created;
  }

  async updateProxmoxVm(id: string, vm: Partial<InsertProxmoxVm>): Promise<ProxmoxVm | undefined> {
    const [updated] = await db.update(proxmoxVms)
      .set({ ...vm, lastSeen: new Date() })
      .where(eq(proxmoxVms.id, id))
      .returning();
    return updated || undefined;
  }

  async upsertProxmoxVm(hostDeviceId: string, vmid: number, vm: Partial<InsertProxmoxVm>): Promise<ProxmoxVm> {
    const existing = await this.getProxmoxVmByVmid(hostDeviceId, vmid);
    if (existing) {
      const updated = await this.updateProxmoxVm(existing.id, vm);
      return updated!;
    } else {
      return await this.createProxmoxVm({
        hostDeviceId,
        vmid,
        vmType: vm.vmType || 'qemu',
        name: vm.name || `VM ${vmid}`,
        status: vm.status || 'unknown',
        node: vm.node || 'unknown',
        ...vm
      } as InsertProxmoxVm);
    }
  }

  async deleteProxmoxVm(id: string): Promise<void> {
    await db.delete(proxmoxVms).where(eq(proxmoxVms.id, id));
  }

  async deleteProxmoxVmsByHost(hostDeviceId: string): Promise<void> {
    await db.delete(proxmoxVms).where(eq(proxmoxVms.hostDeviceId, hostDeviceId));
  }

  async getProxmoxVmByMatchedDevice(matchedDeviceId: string): Promise<ProxmoxVm | undefined> {
    const [vm] = await db.select().from(proxmoxVms)
      .where(eq(proxmoxVms.matchedDeviceId, matchedDeviceId));
    return vm || undefined;
  }

  async getAllProxmoxVms(): Promise<ProxmoxVm[]> {
    return await db.select().from(proxmoxVms).orderBy(proxmoxVms.hostDeviceId, proxmoxVms.vmid);
  }

  async matchProxmoxVmToDevice(vmId: string, matchedDeviceId: string | null): Promise<ProxmoxVm | undefined> {
    const [updated] = await db.update(proxmoxVms)
      .set({ matchedDeviceId })
      .where(eq(proxmoxVms.id, vmId))
      .returning();
    return updated || undefined;
  }

  async autoMatchVmToDevices(vmId: string, ipAddresses: string[], macAddresses?: string[]): Promise<string | null> {
    if (!ipAddresses || ipAddresses.length === 0) {
      return null;
    }

    // Get all devices to match against
    const allDevices = await this.getAllDevices();
    
    // Try to find a device with a matching IP address
    for (const ip of ipAddresses) {
      // Skip link-local and localhost addresses
      if (ip.startsWith('127.') || ip.startsWith('169.254.') || ip === '::1' || ip.startsWith('fe80:')) {
        continue;
      }
      
      const matchedDevice = allDevices.find(d => d.ipAddress === ip);
      if (matchedDevice) {
        // Update the VM with the matched device ID
        await this.matchProxmoxVmToDevice(vmId, matchedDevice.id);
        return matchedDevice.id;
      }
    }

    // No match found - clear any existing match
    await this.matchProxmoxVmToDevice(vmId, null);
    return null;
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

  // IPAM Pools
  async getAllIpamPools(): Promise<IpamPool[]> {
    return await db.select().from(ipamPools).orderBy(ipamPools.name);
  }

  async getIpamPool(id: string): Promise<IpamPool | undefined> {
    const [pool] = await db.select().from(ipamPools).where(eq(ipamPools.id, id));
    return pool || undefined;
  }

  async createIpamPool(insertPool: InsertIpamPool): Promise<IpamPool> {
    const [pool] = await db.insert(ipamPools).values(insertPool).returning();
    return pool;
  }

  async updateIpamPool(id: string, updateData: Partial<InsertIpamPool>): Promise<IpamPool | undefined> {
    const [pool] = await db.update(ipamPools).set({ ...updateData, updatedAt: new Date() }).where(eq(ipamPools.id, id)).returning();
    return pool || undefined;
  }

  async deleteIpamPool(id: string): Promise<void> {
    await db.delete(ipamPools).where(eq(ipamPools.id, id));
  }

  // IPAM Addresses
  async getAllIpamAddresses(): Promise<IpamAddress[]> {
    return await db.select().from(ipamAddresses).orderBy(ipamAddresses.ipAddress);
  }

  async getIpamAddressesByPool(poolId: string): Promise<IpamAddress[]> {
    return await db.select().from(ipamAddresses).where(eq(ipamAddresses.poolId, poolId));
  }

  async getUnassignedIpamAddresses(): Promise<IpamAddress[]> {
    return await db.select().from(ipamAddresses).where(isNull(ipamAddresses.poolId));
  }

  async getIpamPoolStats(): Promise<{ poolId: string | null; total: number; assigned: number; available: number; reserved: number }[]> {
    const allAddresses = await this.getAllIpamAddresses();
    const statsMap = new Map<string | null, { total: number; assigned: number; available: number; reserved: number }>();
    
    for (const addr of allAddresses) {
      const key = addr.poolId;
      const stats = statsMap.get(key) || { total: 0, assigned: 0, available: 0, reserved: 0 };
      stats.total++;
      if (addr.status === 'assigned') stats.assigned++;
      else if (addr.status === 'available') stats.available++;
      else if (addr.status === 'reserved') stats.reserved++;
      statsMap.set(key, stats);
    }
    
    return Array.from(statsMap.entries()).map(([poolId, stats]) => ({ poolId, ...stats }));
  }

  async getIpamAddress(id: string): Promise<IpamAddress | undefined> {
    const [addr] = await db.select().from(ipamAddresses).where(eq(ipamAddresses.id, id));
    return addr || undefined;
  }

  async getIpamAddressByIp(ipAddress: string): Promise<IpamAddress | undefined> {
    const [addr] = await db.select().from(ipamAddresses).where(eq(ipamAddresses.ipAddress, ipAddress));
    return addr || undefined;
  }

  async getIpamAddressesByDevice(deviceId: string): Promise<IpamAddress[]> {
    return await db.select().from(ipamAddresses).where(eq(ipamAddresses.assignedDeviceId, deviceId));
  }

  async createIpamAddress(insertAddr: InsertIpamAddress): Promise<IpamAddress> {
    const [addr] = await db.insert(ipamAddresses).values(insertAddr).returning();
    return addr;
  }

  async createIpamAddressesBulk(addresses: InsertIpamAddress[]): Promise<IpamAddress[]> {
    if (addresses.length === 0) return [];
    return await db.insert(ipamAddresses).values(addresses).returning();
  }

  async upsertIpamAddress(insertAddr: InsertIpamAddress): Promise<IpamAddress> {
    // Atomic upsert using ON CONFLICT - preserves existing values for undefined fields
    // Build update set dynamically to only overwrite explicitly provided fields
    const updateSet: Record<string, any> = { updatedAt: new Date() };
    
    if (insertAddr.poolId !== undefined) updateSet.poolId = insertAddr.poolId;
    if (insertAddr.networkAddress !== undefined) updateSet.networkAddress = insertAddr.networkAddress;
    if (insertAddr.status !== undefined) updateSet.status = insertAddr.status;
    if (insertAddr.source !== undefined) updateSet.source = insertAddr.source;
    if (insertAddr.notes !== undefined) updateSet.notes = insertAddr.notes;
    if (insertAddr.lastSeenAt !== undefined) updateSet.lastSeenAt = insertAddr.lastSeenAt;
    if (insertAddr.assignedDeviceId !== undefined) updateSet.assignedDeviceId = insertAddr.assignedDeviceId;
    if (insertAddr.role !== undefined) updateSet.role = insertAddr.role;

    const [addr] = await db
      .insert(ipamAddresses)
      .values(insertAddr)
      .onConflictDoUpdate({
        target: ipamAddresses.ipAddress,
        set: updateSet,
      })
      .returning();
    return addr;
  }

  async updateIpamAddress(id: string, updateData: Partial<InsertIpamAddress>): Promise<IpamAddress | undefined> {
    const [addr] = await db.update(ipamAddresses).set({ ...updateData, updatedAt: new Date() }).where(eq(ipamAddresses.id, id)).returning();
    return addr || undefined;
  }

  async deleteIpamAddress(id: string): Promise<void> {
    await db.delete(ipamAddresses).where(eq(ipamAddresses.id, id));
  }

  async deleteIpamAddressesByPool(poolId: string): Promise<void> {
    await db.delete(ipamAddresses).where(eq(ipamAddresses.poolId, poolId));
  }

  // Device Interfaces
  async getAllDeviceInterfaces(): Promise<DeviceInterface[]> {
    return await db.select().from(deviceInterfaces).orderBy(deviceInterfaces.deviceId, deviceInterfaces.name);
  }

  async getDeviceInterfaces(deviceId: string): Promise<DeviceInterface[]> {
    return await db.select().from(deviceInterfaces).where(eq(deviceInterfaces.deviceId, deviceId)).orderBy(deviceInterfaces.name);
  }

  async getDeviceInterface(id: string): Promise<DeviceInterface | undefined> {
    const [iface] = await db.select().from(deviceInterfaces).where(eq(deviceInterfaces.id, id));
    return iface || undefined;
  }

  async createDeviceInterface(insertIface: InsertDeviceInterface): Promise<DeviceInterface> {
    const [iface] = await db.insert(deviceInterfaces).values(insertIface).returning();
    return iface;
  }

  async createDeviceInterfacesBulk(interfaces: InsertDeviceInterface[]): Promise<DeviceInterface[]> {
    if (interfaces.length === 0) return [];
    return await db.insert(deviceInterfaces).values(interfaces).returning();
  }

  async updateDeviceInterface(id: string, updateData: Partial<InsertDeviceInterface>): Promise<DeviceInterface | undefined> {
    const [iface] = await db.update(deviceInterfaces).set(updateData).where(eq(deviceInterfaces.id, id)).returning();
    return iface || undefined;
  }

  async deleteDeviceInterface(id: string): Promise<void> {
    await db.delete(deviceInterfaces).where(eq(deviceInterfaces.id, id));
  }

  async deleteDeviceInterfacesByDevice(deviceId: string): Promise<void> {
    await db.delete(deviceInterfaces).where(eq(deviceInterfaces.deviceId, deviceId));
  }

  async syncDeviceInterfaces(deviceId: string, interfaces: Omit<InsertDeviceInterface, 'deviceId'>[]): Promise<DeviceInterface[]> {
    // Get existing interfaces for this device
    const existing = await this.getDeviceInterfaces(deviceId);
    const existingByName = new Map(existing.map(i => [i.name, i]));
    
    const result: DeviceInterface[] = [];
    const now = new Date();
    
    for (const iface of interfaces) {
      const existingIface = existingByName.get(iface.name);
      if (existingIface) {
        // Update existing interface
        const updated = await this.updateDeviceInterface(existingIface.id, {
          ...iface,
          lastSeenAt: now,
        });
        if (updated) result.push(updated);
        existingByName.delete(iface.name);
      } else {
        // Create new interface
        const created = await this.createDeviceInterface({
          ...iface,
          deviceId,
          lastSeenAt: now,
        });
        result.push(created);
      }
    }
    
    // Mark interfaces that weren't seen as stale (don't delete - they may have IP assignments)
    // We don't delete them because IPAM addresses may reference them
    
    return result;
  }

  async syncDeviceIpAddresses(
    deviceId: string, 
    discoveredAddresses: { ipAddress: string; networkAddress?: string; interfaceName: string; disabled?: boolean; comment?: string }[],
    interfaces: DeviceInterface[]
  ): Promise<IpamAddress[]> {
    // Build map of interface name -> interface id for linking
    const interfaceByName = new Map(interfaces.map(i => [i.name, i]));
    
    // Get all IPAM pools for matching discovered IPs to pools
    const allPools = await this.getAllIpamPools();
    
    // Get existing discovered addresses for this device (only source='discovered')
    const existingAddresses = await this.getIpamAddressesByDevice(deviceId);
    const discoveredExisting = existingAddresses.filter(a => a.source === 'discovered');
    const existingByIp = new Map(discoveredExisting.map(a => [a.ipAddress, a]));
    
    const result: IpamAddress[] = [];
    const now = new Date();
    const seenIps = new Set<string>();
    
    for (const discovered of discoveredAddresses) {
      // Extract IP and CIDR prefix if present (e.g., "192.168.1.1/24" -> ip="192.168.1.1", prefix=24)
      const parts = discovered.ipAddress.split('/');
      const ipOnly = parts[0];
      const cidrPrefix = parts[1] ? parseInt(parts[1], 10) : null;
      
      // Use provided networkAddress or construct from CIDR if available
      const networkAddr = discovered.networkAddress || (cidrPrefix ? `${ipOnly}/${cidrPrefix}` : null);
      
      seenIps.add(ipOnly);
      
      // Find matching interface
      const iface = interfaceByName.get(discovered.interfaceName);
      
      // Find matching IPAM pool for this IP
      const matchingPool = findPoolForIp(ipOnly, allPools);
      
      // Atomic upsert - only include fields with actual values to preserve existing data
      const upsertData: any = {
        ipAddress: ipOnly,
        status: discovered.disabled ? 'offline' : 'assigned',
        lastSeenAt: now,
        assignedDeviceId: deviceId,  // Link IP to device
      };
      // Only include fields when they have values to avoid overwriting existing data
      if (networkAddr) upsertData.networkAddress = networkAddr;
      if (matchingPool?.id) upsertData.poolId = matchingPool.id;
      if (discovered.comment) upsertData.notes = discovered.comment;
      if (iface?.id) upsertData.assignedInterfaceId = iface.id;  // Link IP to interface
      // Don't override source if IP already exists (preserve 'manual' source)
      
      const upserted = await this.upsertIpamAddress(upsertData);
      result.push(upserted);
      const addressId = upserted.id;
      
      // Create/update assignment in junction table (allows multiple devices per IP)
      await this.upsertAssignment(addressId, deviceId, iface?.id || null, 'discovered');
    }
    
    // Mark discovered addresses that weren't seen as offline
    // Only affects source='discovered' addresses - manual entries are never touched
    for (const existing of discoveredExisting) {
      if (!seenIps.has(existing.ipAddress) && existing.status !== 'offline') {
        const updated = await this.updateIpamAddress(existing.id, { status: 'offline', lastSeenAt: now });
        if (updated) result.push(updated);
      }
    }
    
    return result;
  }

  // IPAM Address Assignments (junction table) implementations
  async getAssignmentsByAddress(addressId: string): Promise<IpamAddressAssignment[]> {
    return await db.select().from(ipamAddressAssignments)
      .where(eq(ipamAddressAssignments.addressId, addressId));
  }

  async getAssignmentsByDevice(deviceId: string): Promise<IpamAddressAssignment[]> {
    return await db.select().from(ipamAddressAssignments)
      .where(eq(ipamAddressAssignments.deviceId, deviceId));
  }

  async createAssignment(assignment: InsertIpamAddressAssignment): Promise<IpamAddressAssignment> {
    const [created] = await db.insert(ipamAddressAssignments).values(assignment).returning();
    return created;
  }

  async deleteAssignment(id: string): Promise<void> {
    await db.delete(ipamAddressAssignments).where(eq(ipamAddressAssignments.id, id));
  }

  async deleteAssignmentsByAddress(addressId: string): Promise<void> {
    await db.delete(ipamAddressAssignments).where(eq(ipamAddressAssignments.addressId, addressId));
  }

  async deleteAssignmentsByDevice(deviceId: string): Promise<void> {
    await db.delete(ipamAddressAssignments).where(eq(ipamAddressAssignments.deviceId, deviceId));
  }

  async upsertAssignment(addressId: string, deviceId: string, interfaceId: string | null, source: 'manual' | 'discovered' | 'sync'): Promise<IpamAddressAssignment> {
    // Check if assignment already exists
    const existing = await db.select().from(ipamAddressAssignments)
      .where(and(
        eq(ipamAddressAssignments.addressId, addressId),
        eq(ipamAddressAssignments.deviceId, deviceId),
        interfaceId 
          ? eq(ipamAddressAssignments.interfaceId, interfaceId)
          : isNull(ipamAddressAssignments.interfaceId)
      ));
    
    if (existing.length > 0) {
      return existing[0];
    }

    // Create new assignment
    const [created] = await db.insert(ipamAddressAssignments).values({
      addressId,
      deviceId,
      interfaceId,
      source,
    }).returning();
    return created;
  }

  async getIpamAddressesWithAssignments(poolId?: string | null): Promise<IpamAddressWithAssignments[]> {
    // Get addresses
    let addresses: IpamAddress[];
    if (poolId === 'unassigned' || poolId === null) {
      addresses = await db.select().from(ipamAddresses).where(isNull(ipamAddresses.poolId));
    } else if (poolId) {
      addresses = await db.select().from(ipamAddresses).where(eq(ipamAddresses.poolId, poolId));
    } else {
      addresses = await db.select().from(ipamAddresses);
    }

    // Get all assignments for these addresses
    const addressIds = addresses.map(a => a.id);
    if (addressIds.length === 0) {
      return [];
    }

    const allAssignments = await db.select().from(ipamAddressAssignments);
    const assignmentsByAddress = new Map<string, IpamAddressAssignment[]>();
    for (const assignment of allAssignments) {
      if (addressIds.includes(assignment.addressId)) {
        const existing = assignmentsByAddress.get(assignment.addressId) || [];
        existing.push(assignment);
        assignmentsByAddress.set(assignment.addressId, existing);
      }
    }

    // Combine addresses with their assignments
    return addresses.map(addr => ({
      ...addr,
      assignments: assignmentsByAddress.get(addr.id) || [],
    }));
  }
}

export const storage = new DatabaseStorage();

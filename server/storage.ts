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
  proxmoxNodes,
  ipamPools,
  ipamAddresses,
  ipamAddressAssignments,
  deviceInterfaces,
  deviceMetricsHistory,
  connectionBandwidthHistory,
  prometheusMetricsHistory,
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
  type ProxmoxNode,
  type InsertProxmoxNode,
  type IpamPool,
  type InsertIpamPool,
  type IpamAddress,
  type InsertIpamAddress,
  type DeviceInterface,
  type InsertDeviceInterface,
  type IpamAddressAssignment,
  type InsertIpamAddressAssignment,
  type IpamAddressWithAssignments,
  type DeviceMetricsHistory,
  type InsertDeviceMetricsHistory,
  type ConnectionBandwidthHistory,
  type InsertConnectionBandwidthHistory,
  type PrometheusMetricsHistory,
  type InsertPrometheusMetricsHistory,
  pingTargets,
  pingHistory,
  type PingTarget,
  type InsertPingTarget,
  type PingHistory,
  type InsertPingHistory
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, isNotNull, isNull, or, gt, lt, gte, lte, asc, inArray, sql } from "drizzle-orm";

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
  getDeviceStatusSegments(deviceId: string, since: Date): Promise<{ status: string; startTime: Date; endTime: Date }[]>;
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

  // Proxmox Cluster Nodes (for VM migration tracking)
  getAllProxmoxNodes(): Promise<ProxmoxNode[]>;
  getProxmoxNodesByCluster(clusterName: string): Promise<ProxmoxNode[]>;
  getProxmoxNodeByName(clusterName: string, nodeName: string): Promise<ProxmoxNode | undefined>;
  getProxmoxNodesByHost(hostDeviceId: string): Promise<ProxmoxNode[]>;
  upsertProxmoxNode(node: InsertProxmoxNode): Promise<ProxmoxNode>;
  deleteProxmoxNodesByHost(hostDeviceId: string): Promise<void>;

  // Dynamic Connections (for VM-to-host connections that update on migration)
  getDynamicConnectionsForVm(vmDeviceId: string): Promise<Connection[]>;
  getDynamicConnections(): Promise<Connection[]>;
  updateDynamicConnectionHost(connectionId: string, newHostDeviceId: string, nodeName: string): Promise<Connection | undefined>;

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
  getAllIpamAddressAssignments(): Promise<IpamAddressAssignment[]>;
  getAssignmentsByAddress(addressId: string): Promise<IpamAddressAssignment[]>;
  getAssignmentsByDevice(deviceId: string): Promise<IpamAddressAssignment[]>;
  createAssignment(assignment: InsertIpamAddressAssignment): Promise<IpamAddressAssignment>;
  deleteAssignment(id: string): Promise<void>;
  deleteAssignmentsByAddress(addressId: string): Promise<void>;
  deleteAssignmentsByDevice(deviceId: string): Promise<void>;
  clearIpamAssignmentsForDevice(deviceId: string): Promise<void>;
  upsertAssignment(addressId: string, deviceId: string, interfaceId: string | null, source: 'manual' | 'discovered' | 'sync'): Promise<IpamAddressAssignment>;
  getIpamAddressesWithAssignments(poolId?: string | null): Promise<IpamAddressWithAssignments[]>;

  // Device Metrics History
  insertDeviceMetricsHistoryBatch(metrics: InsertDeviceMetricsHistory[]): Promise<number>;
  getDeviceMetricsHistory(deviceId: string, since: Date, until?: Date): Promise<DeviceMetricsHistory[]>;
  deleteOldDeviceMetrics(olderThan: Date): Promise<number>;
  deleteDeviceMetricsHistoryBefore(cutoff: Date, deviceIds: string[]): Promise<number>;
  
  // Connection Bandwidth History
  insertConnectionBandwidthHistoryBatch(records: InsertConnectionBandwidthHistory[]): Promise<number>;
  getConnectionBandwidthHistory(connectionId: string, since: Date, until?: Date): Promise<ConnectionBandwidthHistory[]>;
  deleteOldConnectionBandwidth(olderThan: Date): Promise<number>;
  deleteConnectionBandwidthHistoryBefore(cutoff: Date): Promise<number>;
  
  // Prometheus Metrics History
  insertPrometheusMetricsHistoryBatch(records: InsertPrometheusMetricsHistory[]): Promise<number>;
  getPrometheusMetricsHistory(deviceId: string, metricId: string, since: Date, until?: Date): Promise<PrometheusMetricsHistory[]>;
  getPrometheusMetricsHistoryAllMetrics(deviceId: string, since: Date, until?: Date): Promise<PrometheusMetricsHistory[]>;
  deleteOldPrometheusMetrics(olderThan: Date): Promise<number>;

  // Ping Targets (latency monitoring)
  getAllPingTargets(): Promise<PingTarget[]>;
  getEnabledPingTargets(): Promise<PingTarget[]>;
  getPingTargetsByDevice(deviceId: string): Promise<PingTarget[]>;
  getPingTarget(id: string): Promise<PingTarget | undefined>;
  createPingTarget(target: InsertPingTarget): Promise<PingTarget>;
  updatePingTarget(id: string, target: Partial<InsertPingTarget>): Promise<PingTarget | undefined>;
  deletePingTarget(id: string): Promise<void>;
  deletePingTargetsByDevice(deviceId: string): Promise<void>;

  // Ping History (latency data)
  insertPingHistoryBatch(records: InsertPingHistory[]): Promise<number>;
  getPingHistory(targetId: string, since: Date, until?: Date): Promise<PingHistory[]>;
  getPingHistoryByDevice(deviceId: string, since: Date, until?: Date): Promise<{ targetId: string; ipAddress: string; label: string | null; history: PingHistory[] }[]>;
  deleteOldPingHistory(olderThan: Date): Promise<number>;
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

  async getDeviceByAnyIp(ip: string): Promise<Device | undefined> {
    // First check device primary IP
    const [deviceByPrimary] = await db.select().from(devices).where(eq(devices.ipAddress, ip));
    if (deviceByPrimary) {
      return deviceByPrimary;
    }
    
    // Then check IPAM addresses (supports multiple IPs per device)
    const [ipamAddr] = await db.select().from(ipamAddresses).where(eq(ipamAddresses.ipAddress, ip));
    if (ipamAddr?.assignedDeviceId) {
      return await this.getDevice(ipamAddr.assignedDeviceId);
    }
    
    return undefined;
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

  async getDeviceStatusSegments(deviceId: string, since: Date): Promise<{ status: string; startTime: Date; endTime: Date }[]> {
    const { gte, lt } = await import('drizzle-orm');
    
    const now = new Date();
    const segments: { status: string; startTime: Date; endTime: Date }[] = [];
    
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
        return [{ status: device.status, startTime: since, endTime: now }];
      }
      return [];
    }
    
    // Track current status and time as we walk through the timeline
    let currentStatus: string | undefined = lastEventBeforeSince?.newStatus;
    
    // If no pre-window event but we have in-range events, use the first event's previousStatus as baseline
    if (!currentStatus && eventsInRange.length > 0) {
      currentStatus = eventsInRange[0].previousStatus || undefined;
    }
    
    let lastTime = since;
    
    // Process each event in range
    for (const event of eventsInRange) {
      const eventTime = new Date(event.createdAt);
      
      // If we have a current status, add segment from lastTime to this event
      if (currentStatus && eventTime.getTime() > lastTime.getTime()) {
        segments.push({
          status: currentStatus,
          startTime: lastTime,
          endTime: eventTime
        });
      }
      
      // Update current status and lastTime for next iteration
      currentStatus = event.newStatus;
      lastTime = eventTime;
    }
    
    // Add the tail segment from the last event to now
    if (currentStatus && now.getTime() > lastTime.getTime()) {
      segments.push({
        status: currentStatus,
        startTime: lastTime,
        endTime: now
      });
    }
    
    return segments;
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
    // Use atomic upsert with ON CONFLICT to prevent race conditions during concurrent probes
    const insertData: InsertProxmoxVm = {
      hostDeviceId,
      vmid,
      vmType: vm.vmType || 'qemu',
      name: vm.name || `VM ${vmid}`,
      status: vm.status || 'unknown',
      node: vm.node || 'unknown',
      ...vm
    } as InsertProxmoxVm;
    
    try {
      const [upserted] = await db
        .insert(proxmoxVms)
        .values(insertData)
        .onConflictDoUpdate({
          target: [proxmoxVms.hostDeviceId, proxmoxVms.vmid],
          set: {
            name: vm.name,
            status: vm.status,
            node: vm.node,
            cpuUsage: vm.cpuUsage,
            cpuUsagePct: vm.cpuUsagePct,
            memoryBytes: vm.memoryBytes,
            memoryUsagePct: vm.memoryUsagePct,
            diskBytes: vm.diskBytes,
            uptime: vm.uptime,
            ipAddresses: vm.ipAddresses,
            macAddresses: vm.macAddresses,
            matchedDeviceId: vm.matchedDeviceId,
            clusterName: vm.clusterName,
            lastSeen: new Date(),
          },
        })
        .returning();
      
      return upserted;
    } catch (error: any) {
      // Fallback to original logic if upsert fails (e.g., unique index doesn't exist yet)
      console.error(`[Storage] Proxmox VM upsert failed, falling back:`, error.message);
      const existing = await this.getProxmoxVmByVmid(hostDeviceId, vmid);
      if (existing) {
        const updated = await this.updateProxmoxVm(existing.id, vm);
        return updated!;
      } else {
        return await this.createProxmoxVm(insertData);
      }
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
    
    // Build a map of IP -> deviceId from IPAM addresses for multi-IP device matching
    const allIpamAddresses = await this.getAllIpamAddresses();
    const ipToDeviceMap = new Map<string, string>();
    for (const addr of allIpamAddresses) {
      if (addr.assignedDeviceId) {
        ipToDeviceMap.set(addr.ipAddress, addr.assignedDeviceId);
      }
    }
    
    // Try to find a device with a matching IP address
    for (const ip of ipAddresses) {
      // Skip link-local and localhost addresses
      if (ip.startsWith('127.') || ip.startsWith('169.254.') || ip === '::1' || ip.startsWith('fe80:')) {
        continue;
      }
      
      // First check device primary IP
      const matchedDevice = allDevices.find(d => d.ipAddress === ip);
      if (matchedDevice) {
        // Update the VM with the matched device ID
        await this.matchProxmoxVmToDevice(vmId, matchedDevice.id);
        return matchedDevice.id;
      }
      
      // Then check IPAM addresses (supports multiple IPs per device)
      const deviceIdFromIpam = ipToDeviceMap.get(ip);
      if (deviceIdFromIpam) {
        await this.matchProxmoxVmToDevice(vmId, deviceIdFromIpam);
        return deviceIdFromIpam;
      }
    }

    // No match found - clear any existing match
    await this.matchProxmoxVmToDevice(vmId, null);
    return null;
  }

  // Proxmox Cluster Nodes - for tracking which host device corresponds to which cluster node
  async getAllProxmoxNodes(): Promise<ProxmoxNode[]> {
    return await db.select().from(proxmoxNodes).orderBy(proxmoxNodes.clusterName, proxmoxNodes.nodeName);
  }

  async getProxmoxNodesByCluster(clusterName: string): Promise<ProxmoxNode[]> {
    return await db.select().from(proxmoxNodes)
      .where(eq(proxmoxNodes.clusterName, clusterName))
      .orderBy(proxmoxNodes.nodeName);
  }

  async getProxmoxNodeByName(clusterName: string, nodeName: string): Promise<ProxmoxNode | undefined> {
    const [node] = await db.select().from(proxmoxNodes)
      .where(and(
        eq(proxmoxNodes.clusterName, clusterName),
        eq(proxmoxNodes.nodeName, nodeName)
      ));
    return node || undefined;
  }

  async getProxmoxNodesByHost(hostDeviceId: string): Promise<ProxmoxNode[]> {
    return await db.select().from(proxmoxNodes)
      .where(eq(proxmoxNodes.hostDeviceId, hostDeviceId));
  }

  async upsertProxmoxNode(node: InsertProxmoxNode): Promise<ProxmoxNode> {
    const existing = await this.getProxmoxNodeByName(node.clusterName, node.nodeName);
    if (existing) {
      // Update the existing node's host device ID and last seen
      const [updated] = await db.update(proxmoxNodes)
        .set({ hostDeviceId: node.hostDeviceId, lastSeen: new Date() })
        .where(eq(proxmoxNodes.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(proxmoxNodes).values(node).returning();
      return created;
    }
  }

  async deleteProxmoxNodesByHost(hostDeviceId: string): Promise<void> {
    await db.delete(proxmoxNodes).where(eq(proxmoxNodes.hostDeviceId, hostDeviceId));
  }

  // Dynamic Connections - for VM-to-host connections that automatically update when VMs migrate
  async getDynamicConnectionsForVm(vmDeviceId: string): Promise<Connection[]> {
    // Find connections where this VM is either source or target and the connection is dynamic
    return await db.select().from(connections)
      .where(and(
        eq(connections.isDynamic, true),
        eq(connections.dynamicType, 'proxmox_vm_host'),
        or(
          eq(connections.sourceDeviceId, vmDeviceId),
          eq(connections.targetDeviceId, vmDeviceId)
        )
      ));
  }

  async getDynamicConnections(): Promise<Connection[]> {
    return await db.select().from(connections)
      .where(and(
        eq(connections.isDynamic, true),
        isNotNull(connections.dynamicType)
      ));
  }

  async updateDynamicConnectionHost(connectionId: string, newHostDeviceId: string, nodeName: string): Promise<Connection | undefined> {
    const conn = await this.getConnection(connectionId);
    if (!conn || !conn.isDynamic || conn.dynamicType !== 'proxmox_vm_host') {
      return undefined;
    }

    const metadata = conn.dynamicMetadata || {};
    const vmEnd = metadata.vmEnd || 'source';
    
    // Update the host device ID on the opposite end from the VM
    // Also clear the port name since it refers to the old host's interface
    const updateData: Partial<Connection> = {
      dynamicMetadata: {
        ...metadata,
        lastResolvedHostId: newHostDeviceId,
        lastResolvedNodeName: nodeName,
        state: 'resolved'
      }
    };

    // Update the correct endpoint based on which end is the VM
    // Clear the port name for the host end (it's no longer valid after host change)
    if (vmEnd === 'source') {
      updateData.targetDeviceId = newHostDeviceId;
      updateData.targetPort = null; // Clear port name - it belonged to old host
    } else {
      updateData.sourceDeviceId = newHostDeviceId;
      updateData.sourcePort = null; // Clear port name - it belonged to old host
    }

    const [updated] = await db.update(connections)
      .set(updateData)
      .where(eq(connections.id, connectionId))
      .returning();
    return updated || undefined;
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
    if (insertAddr.assignedInterfaceId !== undefined) updateSet.assignedInterfaceId = insertAddr.assignedInterfaceId;
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
    // Use upsert pattern with ON CONFLICT to prevent race conditions causing duplicate interfaces
    // The unique constraint on (deviceId, name) ensures each interface is unique per device
    const result: DeviceInterface[] = [];
    const now = new Date();
    
    for (const iface of interfaces) {
      // Use raw SQL for upsert since Drizzle's onConflictDoUpdate requires the conflict target
      // The unique index idx_device_interfaces_unique on (device_id, name) handles duplicates
      const insertData: InsertDeviceInterface = {
        ...iface,
        deviceId,
        lastSeenAt: now,
      };
      
      try {
        // Try to insert - if conflict on (deviceId, name), update instead
        const [upserted] = await db
          .insert(deviceInterfaces)
          .values(insertData)
          .onConflictDoUpdate({
            target: [deviceInterfaces.deviceId, deviceInterfaces.name],
            set: {
              description: iface.description,
              type: iface.type,
              parentInterfaceId: iface.parentInterfaceId,
              snmpIndex: iface.snmpIndex,
              macAddress: iface.macAddress,
              isVirtual: iface.isVirtual,
              operStatus: iface.operStatus,
              adminStatus: iface.adminStatus,
              speed: iface.speed,
              duplex: iface.duplex,
              discoverySource: iface.discoverySource,
              lastSeenAt: now,
            },
          })
          .returning();
        
        if (upserted) result.push(upserted);
      } catch (error: any) {
        // Log but continue - don't let one interface failure break the whole sync
        console.error(`[Storage] Failed to sync interface ${iface.name} for device ${deviceId}:`, error.message);
      }
    }
    
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
  async getAllIpamAddressAssignments(): Promise<IpamAddressAssignment[]> {
    return await db.select().from(ipamAddressAssignments);
  }

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

  async clearIpamAssignmentsForDevice(deviceId: string): Promise<void> {
    // Clear assignedDeviceId and set status to 'available' for all IPAM addresses assigned to this device
    await db.update(ipamAddresses)
      .set({ 
        assignedDeviceId: null, 
        assignedInterfaceId: null,
        status: 'available',
        updatedAt: new Date() 
      })
      .where(eq(ipamAddresses.assignedDeviceId, deviceId));
    
    // Also delete from junction table (cascade should handle this, but be explicit)
    await this.deleteAssignmentsByDevice(deviceId);
  }

  async upsertAssignment(addressId: string, deviceId: string, interfaceId: string | null, source: 'manual' | 'discovered' | 'sync'): Promise<IpamAddressAssignment> {
    // Check if assignment already exists for this address+device combo
    // Only check addressId+deviceId to prevent duplicates when interfaceId changes
    const existing = await db.select().from(ipamAddressAssignments)
      .where(and(
        eq(ipamAddressAssignments.addressId, addressId),
        eq(ipamAddressAssignments.deviceId, deviceId)
      ));
    
    if (existing.length > 0) {
      // Update interfaceId if it changed
      if (existing[0].interfaceId !== interfaceId) {
        const [updated] = await db.update(ipamAddressAssignments)
          .set({ interfaceId })
          .where(eq(ipamAddressAssignments.id, existing[0].id))
          .returning();
        return updated;
      }
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

  // Device Metrics History
  async insertDeviceMetricsHistoryBatch(metrics: InsertDeviceMetricsHistory[]): Promise<number> {
    if (metrics.length === 0) return 0;
    
    // Filter out records with no actual metrics data
    const validMetrics = metrics.filter(m => 
      m.cpuUsagePct !== undefined || 
      m.memoryUsagePct !== undefined || 
      m.diskUsagePct !== undefined ||
      m.pingRtt !== undefined ||
      m.uptimeSeconds !== undefined
    );
    
    if (validMetrics.length === 0) return 0;
    
    try {
      await db.insert(deviceMetricsHistory).values(validMetrics);
      return validMetrics.length;
    } catch (error: any) {
      console.error('[MetricsHistory] Batch insert failed:', error.message);
      return 0;
    }
  }

  async getDeviceMetricsHistory(deviceId: string, since: Date, until?: Date): Promise<DeviceMetricsHistory[]> {
    const conditions = [
      eq(deviceMetricsHistory.deviceId, deviceId),
      gte(deviceMetricsHistory.timestamp, since),
    ];
    
    if (until) {
      conditions.push(lte(deviceMetricsHistory.timestamp, until));
    }
    
    return await db.select()
      .from(deviceMetricsHistory)
      .where(and(...conditions))
      .orderBy(asc(deviceMetricsHistory.timestamp));
  }

  async deleteOldDeviceMetrics(olderThan: Date): Promise<number> {
    const result = await db.delete(deviceMetricsHistory)
      .where(lt(deviceMetricsHistory.timestamp, olderThan))
      .returning();
    return result.length;
  }

  // Connection Bandwidth History
  async insertConnectionBandwidthHistoryBatch(records: InsertConnectionBandwidthHistory[]): Promise<number> {
    if (records.length === 0) return 0;
    
    // Filter out records with no actual bandwidth data
    const validRecords = records.filter(r => 
      r.inBytesPerSec !== undefined || 
      r.outBytesPerSec !== undefined
    );
    
    if (validRecords.length === 0) return 0;
    
    try {
      await db.insert(connectionBandwidthHistory).values(validRecords);
      return validRecords.length;
    } catch (error: any) {
      console.error('[BandwidthHistory] Batch insert failed:', error.message);
      return 0;
    }
  }

  async getConnectionBandwidthHistory(connectionId: string, since: Date, until?: Date): Promise<ConnectionBandwidthHistory[]> {
    const conditions = [
      eq(connectionBandwidthHistory.connectionId, connectionId),
      gte(connectionBandwidthHistory.timestamp, since),
    ];
    
    if (until) {
      conditions.push(lte(connectionBandwidthHistory.timestamp, until));
    }
    
    return await db.select()
      .from(connectionBandwidthHistory)
      .where(and(...conditions))
      .orderBy(asc(connectionBandwidthHistory.timestamp));
  }

  async deleteOldConnectionBandwidth(olderThan: Date): Promise<number> {
    const result = await db.delete(connectionBandwidthHistory)
      .where(lt(connectionBandwidthHistory.timestamp, olderThan))
      .returning();
    return result.length;
  }

  async deleteDeviceMetricsHistoryBefore(cutoff: Date, deviceIds: string[]): Promise<number> {
    if (deviceIds.length === 0) return 0;
    
    const result = await db.delete(deviceMetricsHistory)
      .where(and(
        lt(deviceMetricsHistory.timestamp, cutoff),
        inArray(deviceMetricsHistory.deviceId, deviceIds)
      ))
      .returning();
    return result.length;
  }

  async deleteConnectionBandwidthHistoryBefore(cutoff: Date): Promise<number> {
    const result = await db.delete(connectionBandwidthHistory)
      .where(lt(connectionBandwidthHistory.timestamp, cutoff))
      .returning();
    return result.length;
  }

  // Prometheus Metrics History
  async insertPrometheusMetricsHistoryBatch(records: InsertPrometheusMetricsHistory[]): Promise<number> {
    if (records.length === 0) return 0;
    
    // Filter out records with invalid values
    const validRecords = records.filter(r => 
      r.value !== undefined && 
      r.value !== null && 
      !isNaN(r.value) &&
      isFinite(r.value)
    );
    
    if (validRecords.length === 0) return 0;
    
    try {
      await db.insert(prometheusMetricsHistory).values(validRecords);
      return validRecords.length;
    } catch (error: any) {
      console.error('[PrometheusMetricsHistory] Batch insert failed:', error.message);
      return 0;
    }
  }

  async getPrometheusMetricsHistory(deviceId: string, metricId: string, since: Date, until?: Date): Promise<PrometheusMetricsHistory[]> {
    const conditions = [
      eq(prometheusMetricsHistory.deviceId, deviceId),
      eq(prometheusMetricsHistory.metricId, metricId),
      gte(prometheusMetricsHistory.timestamp, since),
    ];
    
    if (until) {
      conditions.push(lte(prometheusMetricsHistory.timestamp, until));
    }
    
    return await db.select()
      .from(prometheusMetricsHistory)
      .where(and(...conditions))
      .orderBy(asc(prometheusMetricsHistory.timestamp));
  }

  async getPrometheusMetricsHistoryAllMetrics(deviceId: string, since: Date, until?: Date): Promise<PrometheusMetricsHistory[]> {
    const conditions = [
      eq(prometheusMetricsHistory.deviceId, deviceId),
      gte(prometheusMetricsHistory.timestamp, since),
    ];
    
    if (until) {
      conditions.push(lte(prometheusMetricsHistory.timestamp, until));
    }
    
    return await db.select()
      .from(prometheusMetricsHistory)
      .where(and(...conditions))
      .orderBy(asc(prometheusMetricsHistory.timestamp));
  }

  async deleteOldPrometheusMetrics(olderThan: Date): Promise<number> {
    const result = await db.delete(prometheusMetricsHistory)
      .where(lt(prometheusMetricsHistory.timestamp, olderThan))
      .returning();
    return result.length;
  }

  // Ping Targets
  async getAllPingTargets(): Promise<PingTarget[]> {
    return await db.select().from(pingTargets).orderBy(pingTargets.createdAt);
  }

  async getEnabledPingTargets(): Promise<PingTarget[]> {
    return await db.select().from(pingTargets)
      .where(eq(pingTargets.enabled, true))
      .orderBy(pingTargets.createdAt);
  }

  async getPingTargetsByDevice(deviceId: string): Promise<PingTarget[]> {
    return await db.select().from(pingTargets)
      .where(eq(pingTargets.deviceId, deviceId))
      .orderBy(pingTargets.createdAt);
  }

  async getPingTarget(id: string): Promise<PingTarget | undefined> {
    const [target] = await db.select().from(pingTargets).where(eq(pingTargets.id, id));
    return target || undefined;
  }

  async createPingTarget(target: InsertPingTarget): Promise<PingTarget> {
    const [created] = await db.insert(pingTargets).values(target).returning();
    return created;
  }

  async updatePingTarget(id: string, target: Partial<InsertPingTarget>): Promise<PingTarget | undefined> {
    const [updated] = await db.update(pingTargets)
      .set({ ...target, updatedAt: new Date() })
      .where(eq(pingTargets.id, id))
      .returning();
    return updated || undefined;
  }

  async deletePingTarget(id: string): Promise<void> {
    await db.delete(pingTargets).where(eq(pingTargets.id, id));
  }

  async deletePingTargetsByDevice(deviceId: string): Promise<void> {
    await db.delete(pingTargets).where(eq(pingTargets.deviceId, deviceId));
  }

  // Ping History
  async insertPingHistoryBatch(records: InsertPingHistory[]): Promise<number> {
    if (records.length === 0) return 0;
    
    try {
      await db.insert(pingHistory).values(records);
      return records.length;
    } catch (error: any) {
      console.error('[PingHistory] Batch insert failed:', error.message);
      return 0;
    }
  }

  async getPingHistory(targetId: string, since: Date, until?: Date): Promise<PingHistory[]> {
    const conditions = [
      eq(pingHistory.targetId, targetId),
      gte(pingHistory.timestamp, since),
    ];
    
    if (until) {
      conditions.push(lte(pingHistory.timestamp, until));
    }
    
    return await db.select()
      .from(pingHistory)
      .where(and(...conditions))
      .orderBy(asc(pingHistory.timestamp));
  }

  async getPingHistoryByDevice(deviceId: string, since: Date, until?: Date): Promise<{ targetId: string; ipAddress: string; label: string | null; history: PingHistory[] }[]> {
    // Get all ping targets for this device
    const targets = await this.getPingTargetsByDevice(deviceId);
    
    const results = await Promise.all(targets.map(async (target) => {
      const history = await this.getPingHistory(target.id, since, until);
      return {
        targetId: target.id,
        ipAddress: target.ipAddress,
        label: target.label,
        history,
      };
    }));
    
    return results;
  }

  async deleteOldPingHistory(olderThan: Date): Promise<number> {
    const result = await db.delete(pingHistory)
      .where(lt(pingHistory.timestamp, olderThan))
      .returning();
    return result.length;
  }
}

export const storage = new DatabaseStorage();

// Startup cleanup function to deduplicate Proxmox VMs
// This handles upgrades from older versions that may have duplicate VM records
// Also creates the unique index if it doesn't exist after cleanup
export async function cleanupDuplicateProxmoxVms(): Promise<number> {
  try {
    // Find duplicates using raw SQL
    const duplicates = await db.execute<{ host_device_id: string; vmid: number; cnt: string }>(
      sql`SELECT host_device_id, vmid, COUNT(*) as cnt 
          FROM proxmox_vms 
          GROUP BY host_device_id, vmid 
          HAVING COUNT(*) > 1`
    );
    
    let deletedCount = 0;
    
    if (duplicates.rows && duplicates.rows.length > 0) {
      for (const dup of duplicates.rows) {
        // Get all VMs with this hostDeviceId and vmid, ordered by lastSeen desc (keep newest)
        const vms = await db.select()
          .from(proxmoxVms)
          .where(and(
            eq(proxmoxVms.hostDeviceId, dup.host_device_id),
            eq(proxmoxVms.vmid, dup.vmid)
          ))
          .orderBy(desc(proxmoxVms.lastSeen));
        
        // Delete all but the first (newest) one
        for (let i = 1; i < vms.length; i++) {
          await db.delete(proxmoxVms).where(eq(proxmoxVms.id, vms[i].id));
          deletedCount++;
        }
      }
      
      if (deletedCount > 0) {
        console.log(`[Storage] Cleaned up ${deletedCount} duplicate Proxmox VM records`);
      }
    }
    
    // After cleanup, ensure the unique index exists (handles upgrade case)
    try {
      await db.execute(
        sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_proxmox_vms_unique 
            ON proxmox_vms (host_device_id, vmid)`
      );
    } catch (indexError: any) {
      if (!indexError.message?.includes('already exists')) {
        console.error('[Storage] Failed to create Proxmox VMs unique index:', indexError.message);
      }
    }
    
    return deletedCount;
  } catch (error: any) {
    console.error('[Storage] Error cleaning up duplicate Proxmox VMs:', error.message);
    return 0;
  }
}

// Startup cleanup function to deduplicate device interfaces
// This handles upgrades from older versions that may have duplicate interfaces
// Also creates the unique index if it doesn't exist after cleanup
export async function cleanupDuplicateInterfaces(): Promise<number> {
  try {
    // Find duplicates using raw SQL
    const duplicates = await db.execute<{ device_id: string; name: string; cnt: string }>(
      sql`SELECT device_id, name, COUNT(*) as cnt 
          FROM device_interfaces 
          GROUP BY device_id, name 
          HAVING COUNT(*) > 1`
    );
    
    let deletedCount = 0;
    
    if (duplicates.rows && duplicates.rows.length > 0) {
      for (const dup of duplicates.rows) {
        // Get all interfaces with this deviceId and name, ordered by lastSeenAt desc (keep newest)
        const interfaces = await db.select()
          .from(deviceInterfaces)
          .where(and(
            eq(deviceInterfaces.deviceId, dup.device_id),
            eq(deviceInterfaces.name, dup.name)
          ))
          .orderBy(desc(deviceInterfaces.lastSeenAt));
        
        // Delete all but the first (newest) one
        for (let i = 1; i < interfaces.length; i++) {
          await db.delete(deviceInterfaces).where(eq(deviceInterfaces.id, interfaces[i].id));
          deletedCount++;
        }
      }
      
      if (deletedCount > 0) {
        console.log(`[Storage] Cleaned up ${deletedCount} duplicate interface records`);
      }
    }
    
    // After cleanup, ensure the unique index exists (handles upgrade case)
    // This will silently succeed if index already exists
    try {
      await db.execute(
        sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_device_interfaces_unique 
            ON device_interfaces (device_id, name)`
      );
    } catch (indexError: any) {
      // Index creation might fail if duplicates still exist (shouldn't happen after cleanup)
      // or if index already exists with different definition
      if (!indexError.message?.includes('already exists')) {
        console.error('[Storage] Failed to create unique index:', indexError.message);
      }
    }
    
    return deletedCount;
  } catch (error: any) {
    console.error('[Storage] Error cleaning up duplicate interfaces:', error.message);
    return 0;
  }
}

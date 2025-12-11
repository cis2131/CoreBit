import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const userSessions = pgTable("user_sessions", {
  sid: varchar("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
}, (table) => [
  index("IDX_session_expire").on(table.expire),
]);

export const maps = pgTable("maps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const credentialProfiles = pgTable("credential_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(), // mikrotik, snmp, prometheus
  credentials: jsonb("credentials").notNull().$type<{
    username?: string;
    password?: string;
    apiPort?: number;
    snmpVersion?: '1' | '2c' | '3';
    snmpCommunity?: string;
    snmpUsername?: string;
    snmpAuthProtocol?: 'MD5' | 'SHA';
    snmpAuthKey?: string;
    snmpPrivProtocol?: 'DES' | 'AES';
    snmpPrivKey?: string;
    // Prometheus node_exporter settings
    prometheusPort?: number; // Default 9100
    prometheusPath?: string; // Default /metrics
    prometheusScheme?: 'http' | 'https';
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const settings = pgTable("settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  url: text("url").notNull(),
  method: text("method").notNull().default("POST"),
  messageTemplate: text("message_template").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const deviceNotifications = pgTable("device_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  notificationId: varchar("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const notificationHistory = pgTable("notification_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  notificationId: varchar("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
  oldStatus: text("old_status"),
  newStatus: text("new_status").notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
});

export const logs = pgTable("logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  deviceId: varchar("device_id").references(() => devices.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  severity: text("severity").notNull().default("info"),
  message: text("message").notNull(),
  oldStatus: text("old_status"),
  newStatus: text("new_status"),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
});

export const devices = pgTable("devices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(),
  ipAddress: text("ip_address"),
  status: text("status").notNull().default("unknown"),
  lastSeen: timestamp("last_seen"), // Timestamp of last successful probe response
  probeTimeout: integer("probe_timeout"), // Custom probe timeout in seconds (null = use default 6s)
  offlineThreshold: integer("offline_threshold"), // Number of consecutive failed probe cycles before marking offline (null = immediate)
  failureCount: integer("failure_count").default(0), // Current consecutive failure count
  deviceData: jsonb("device_data").$type<{
    uptime?: string;
    model?: string;
    version?: string;
    systemIdentity?: string;
    ports?: Array<{ 
      name: string; 
      defaultName?: string;
      status: string; 
      speed?: string; 
      description?: string;
      snmpIndex?: number; // SNMP ifIndex for this interface - allows direct OID construction for traffic monitoring
    }>;
    cpuUsagePct?: number;
    memoryUsagePct?: number;
    diskUsagePct?: number;
  }>(),
  credentialProfileId: varchar("credential_profile_id").references(() => credentialProfiles.id, { onDelete: "set null" }),
  linkedMapId: varchar("linked_map_id").references(() => maps.id, { onDelete: "set null" }), // Link to navigate to another map
  customCredentials: jsonb("custom_credentials").$type<{
    username?: string;
    password?: string;
    apiPort?: number;
    snmpVersion?: '1' | '2c' | '3';
    snmpCommunity?: string;
    snmpUsername?: string;
    snmpAuthProtocol?: 'MD5' | 'SHA';
    snmpAuthKey?: string;
    snmpPrivProtocol?: 'DES' | 'AES';
    snmpPrivKey?: string;
    // Prometheus node_exporter settings
    prometheusPort?: number;
    prometheusPath?: string;
    prometheusScheme?: 'http' | 'https';
  }>(),
  useOnDuty: boolean("use_on_duty").default(false).notNull(), // Also send alerts to on-duty operators (in addition to global channels)
  mutedUntil: timestamp("muted_until"), // Device notifications muted until this time (null = not muted)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const devicePlacements = pgTable("device_placements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  mapId: varchar("map_id").notNull().references(() => maps.id, { onDelete: "cascade" }),
  position: jsonb("position").notNull().$type<{ x: number; y: number }>(),
  linkedMapId: varchar("linked_map_id").references(() => maps.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const connections = pgTable("connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mapId: varchar("map_id").notNull().references(() => maps.id, { onDelete: "cascade" }),
  sourceDeviceId: varchar("source_device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  targetDeviceId: varchar("target_device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  sourcePort: text("source_port"),
  targetPort: text("target_port"),
  connectionType: text("connection_type").default("ethernet"),
  linkSpeed: text("link_speed").default("1G"),
  curveMode: text("curve_mode").$type<'straight' | 'curved' | 'auto'>().default("straight"),
  curveOffset: integer("curve_offset").default(0),
  monitorInterface: text("monitor_interface").$type<'source' | 'target' | null>(),
  monitorSnmpIndex: integer("monitor_snmp_index"),
  flipTrafficDirection: boolean("flip_traffic_direction").default(false),
  linkStats: jsonb("link_stats").$type<{
    inBytesPerSec?: number;
    outBytesPerSec?: number;
    inBitsPerSec?: number;
    outBitsPerSec?: number;
    utilizationPct?: number;
    lastSampleAt?: string;
    previousInOctets?: number;
    previousOutOctets?: number;
    previousSampleAt?: string;
    isStale?: boolean;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const scanProfiles = pgTable("scan_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  ipRange: text("ip_range").notNull(),
  credentialProfileIds: text("credential_profile_ids").array().notNull(),
  probeTypes: text("probe_types").array().notNull().$type<Array<'mikrotik' | 'snmp' | 'server' | 'find_all'>>(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const backups = pgTable("backups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  filename: text("filename").notNull(),
  filePath: text("file_path").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  type: text("type").notNull().$type<'manual' | 'scheduled'>(),
  status: text("status").notNull().default("completed").$type<'pending' | 'completed' | 'failed'>(),
  metadata: jsonb("metadata").$type<{
    deviceCount?: number;
    mapCount?: number;
    connectionCount?: number;
    credentialProfileCount?: number;
    version?: string;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userRoles = ['admin', 'superuser', 'viewer'] as const;
export type UserRole = typeof userRoles[number];

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("viewer").$type<UserRole>(),
  displayName: text("display_name"),
  email: text("email"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const portLocks = pgTable("port_locks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  portName: text("port_name").notNull(),
  lockedBy: varchar("locked_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  lockedAt: timestamp("locked_at").defaultNow().notNull(),
  reason: text("reason"),
});

export const mapsRelations = relations(maps, ({ many }) => ({
  devicePlacements: many(devicePlacements),
  connections: many(connections),
}));

export const devicesRelations = relations(devices, ({ many }) => ({
  placements: many(devicePlacements),
  sourceConnections: many(connections, { relationName: "sourceDevice" }),
  targetConnections: many(connections, { relationName: "targetDevice" }),
}));

export const devicePlacementsRelations = relations(devicePlacements, ({ one }) => ({
  device: one(devices, {
    fields: [devicePlacements.deviceId],
    references: [devices.id],
  }),
  map: one(maps, {
    fields: [devicePlacements.mapId],
    references: [maps.id],
  }),
}));

export const connectionsRelations = relations(connections, ({ one }) => ({
  map: one(maps, {
    fields: [connections.mapId],
    references: [maps.id],
  }),
  sourceDevice: one(devices, {
    fields: [connections.sourceDeviceId],
    references: [devices.id],
    relationName: "sourceDevice",
  }),
  targetDevice: one(devices, {
    fields: [connections.targetDeviceId],
    references: [devices.id],
    relationName: "targetDevice",
  }),
}));

export const insertMapSchema = createInsertSchema(maps).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  isDefault: z.boolean().optional(),
});

const credentialsSchema = z.object({
  username: z.string().optional(),
  password: z.string().optional(),
  apiPort: z.number().optional(),
  snmpVersion: z.enum(['1', '2c', '3']).optional(),
  snmpCommunity: z.string().optional(),
  snmpUsername: z.string().optional(),
  snmpAuthProtocol: z.enum(['MD5', 'SHA']).optional(),
  snmpAuthKey: z.string().optional(),
  snmpPrivProtocol: z.enum(['DES', 'AES']).optional(),
  snmpPrivKey: z.string().optional(),
});

export const insertCredentialProfileSchema = createInsertSchema(credentialProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  credentials: credentialsSchema,
});

export const insertDeviceSchema = createInsertSchema(devices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  deviceData: z.object({
    uptime: z.string().optional(),
    model: z.string().optional(),
    version: z.string().optional(),
    ports: z.array(z.object({
      name: z.string(),
      status: z.string(),
      speed: z.string().optional(),
    })).optional(),
    cpuUsagePct: z.number().optional(),
    memoryUsagePct: z.number().optional(),
  }).optional(),
  customCredentials: credentialsSchema.optional(),
  probeTimeout: z.union([z.number().int().min(1).max(120), z.null()]).optional(),
  useOnDuty: z.boolean().optional(),
});

export const insertDevicePlacementSchema = createInsertSchema(devicePlacements).omit({
  id: true,
  createdAt: true,
}).extend({
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
});

export const insertConnectionSchema = createInsertSchema(connections).omit({
  id: true,
  createdAt: true,
}).extend({
  linkSpeed: z.enum(['1G', '10G', '25G', '40G', '100G']).optional(),
  monitorInterface: z.enum(['source', 'target']).nullable().optional(),
  linkStats: z.object({
    inBytesPerSec: z.number().optional(),
    outBytesPerSec: z.number().optional(),
    inBitsPerSec: z.number().optional(),
    outBitsPerSec: z.number().optional(),
    utilizationPct: z.number().optional(),
    lastSampleAt: z.string().optional(),
    previousInOctets: z.number().optional(),
    previousOutOctets: z.number().optional(),
    previousSampleAt: z.string().optional(),
    isStale: z.boolean().optional(),
  }).optional(),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  enabled: z.boolean().optional(),
});

export const insertDeviceNotificationSchema = createInsertSchema(deviceNotifications).omit({
  id: true,
  createdAt: true,
});

export const insertLogSchema = createInsertSchema(logs).omit({
  id: true,
  timestamp: true,
}).extend({
  severity: z.enum(['info', 'warning', 'error']).optional(),
  metadata: z.record(z.any()).optional(),
});

export const insertScanProfileSchema = createInsertSchema(scanProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  credentialProfileIds: z.array(z.string()),
  probeTypes: z.array(z.enum(['mikrotik', 'snmp', 'server', 'find_all'])),
  isDefault: z.boolean().optional(),
});

export const insertBackupSchema = createInsertSchema(backups).omit({
  id: true,
  createdAt: true,
}).extend({
  type: z.enum(['manual', 'scheduled']),
  status: z.enum(['pending', 'completed', 'failed']).optional(),
  metadata: z.object({
    deviceCount: z.number().optional(),
    mapCount: z.number().optional(),
    connectionCount: z.number().optional(),
    credentialProfileCount: z.number().optional(),
    version: z.string().optional(),
  }).optional(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
}).extend({
  role: z.enum(['admin', 'superuser', 'viewer']).optional(),
});

export const insertPortLockSchema = createInsertSchema(portLocks).omit({
  id: true,
  lockedAt: true,
});

// User notification channels - allows each user to have their own notification methods
export const userNotificationChannels = pgTable("user_notification_channels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull().$type<'webhook' | 'email' | 'telegram' | 'pushover'>(),
  config: jsonb("config").notNull().$type<{
    // Webhook config
    url?: string;
    method?: string;
    messageTemplate?: string;
    // Email config  
    emailAddress?: string;
    // Telegram config
    botToken?: string;
    chatId?: string;
    // Pushover config
    pushoverUserKey?: string;
    pushoverAppToken?: string;
    pushoverDevice?: string;
    pushoverSound?: string;
    pushoverPriority?: number;
  }>(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Duty user schedules - users assigned directly to day/night shifts
// Simplified model: users are assigned to either Day shift or Night shift (or both)
export const dutyUserSchedules = pgTable("duty_user_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  shift: text("shift").notNull().$type<'day' | 'night'>(), // day = during day hours, night = during night hours
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Shift configuration settings
export const dutyShiftConfig = pgTable("duty_shift_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dayShiftStart: text("day_shift_start").notNull().default("07:00"), // HH:MM format
  dayShiftEnd: text("day_shift_end").notNull().default("19:00"),
  nightShiftStart: text("night_shift_start").notNull().default("19:00"),
  nightShiftEnd: text("night_shift_end").notNull().default("07:00"),
  timezone: text("timezone").notNull().default("UTC"),
  rotationWeeks: integer("rotation_weeks").notNull().default(4), // Number of weeks in rotation cycle
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Alarm mutes - mute notifications for specific users or globally
export const alarmMutes = pgTable("alarm_mutes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }), // null = global mute for all on-duty
  mutedBy: varchar("muted_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  muteUntil: timestamp("mute_until"), // null = forever
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserNotificationChannelSchema = createInsertSchema(userNotificationChannels).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  type: z.enum(['webhook', 'email', 'telegram', 'pushover']),
  config: z.object({
    url: z.string().optional(),
    method: z.string().optional(),
    messageTemplate: z.string().optional(),
    emailAddress: z.string().email().optional(),
    botToken: z.string().optional(),
    chatId: z.string().optional(),
    pushoverUserKey: z.string().optional(),
    pushoverAppToken: z.string().optional(),
    pushoverDevice: z.string().optional(),
    pushoverSound: z.string().optional(),
    pushoverPriority: z.number().min(-2).max(2).optional(),
  }),
  enabled: z.boolean().optional(),
});

export const insertDutyUserScheduleSchema = createInsertSchema(dutyUserSchedules).omit({
  id: true,
  createdAt: true,
}).extend({
  shift: z.enum(['day', 'night']),
});

export const insertDutyShiftConfigSchema = createInsertSchema(dutyShiftConfig).omit({
  id: true,
  updatedAt: true,
}).extend({
  dayShiftStart: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  dayShiftEnd: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  nightShiftStart: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  nightShiftEnd: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  rotationWeeks: z.number().int().min(1).max(52).optional(),
});

export const insertAlarmMuteSchema = createInsertSchema(alarmMutes).omit({
  id: true,
  createdAt: true,
});

export type Map = typeof maps.$inferSelect;
export type InsertMap = z.infer<typeof insertMapSchema>;
export type Device = typeof devices.$inferSelect;
export type InsertDevice = z.infer<typeof insertDeviceSchema>;
export type DevicePlacement = typeof devicePlacements.$inferSelect;
export type InsertDevicePlacement = z.infer<typeof insertDevicePlacementSchema>;
export type Connection = typeof connections.$inferSelect;
export type InsertConnection = z.infer<typeof insertConnectionSchema>;
export type CredentialProfile = typeof credentialProfiles.$inferSelect;
export type InsertCredentialProfile = z.infer<typeof insertCredentialProfileSchema>;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type DeviceNotification = typeof deviceNotifications.$inferSelect;
export type InsertDeviceNotification = z.infer<typeof insertDeviceNotificationSchema>;
export type Log = typeof logs.$inferSelect;
export type InsertLog = z.infer<typeof insertLogSchema>;
export type ScanProfile = typeof scanProfiles.$inferSelect;
export type InsertScanProfile = z.infer<typeof insertScanProfileSchema>;
export type Backup = typeof backups.$inferSelect;
export type InsertBackup = z.infer<typeof insertBackupSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type PortLock = typeof portLocks.$inferSelect;
export type InsertPortLock = z.infer<typeof insertPortLockSchema>;
export type UserNotificationChannel = typeof userNotificationChannels.$inferSelect;
export type InsertUserNotificationChannel = z.infer<typeof insertUserNotificationChannelSchema>;
export type DutyUserSchedule = typeof dutyUserSchedules.$inferSelect;
export type InsertDutyUserSchedule = z.infer<typeof insertDutyUserScheduleSchema>;
export type DutyShiftConfig = typeof dutyShiftConfig.$inferSelect;
export type InsertDutyShiftConfig = z.infer<typeof insertDutyShiftConfigSchema>;
export type AlarmMute = typeof alarmMutes.$inferSelect;
export type InsertAlarmMute = z.infer<typeof insertAlarmMuteSchema>;

import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  type: text("type").notNull(),
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
      snmpIndex?: number;
    }>;
    cpuUsagePct?: number;
    memoryUsagePct?: number;
    diskUsagePct?: number;
  }>(),
  credentialProfileId: varchar("credential_profile_id").references(() => credentialProfiles.id, { onDelete: "set null" }),
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
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const devicePlacements = pgTable("device_placements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  mapId: varchar("map_id").notNull().references(() => maps.id, { onDelete: "cascade" }),
  position: jsonb("position").notNull().$type<{ x: number; y: number }>(),
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
  monitorInterface: text("monitor_interface").$type<'source' | 'target' | null>(),
  monitorSnmpIndex: integer("monitor_snmp_index"),
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
  probeTypes: text("probe_types").array().notNull().$type<Array<'mikrotik' | 'snmp' | 'server'>>(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
  probeTypes: z.array(z.enum(['mikrotik', 'snmp', 'server'])),
  isDefault: z.boolean().optional(),
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

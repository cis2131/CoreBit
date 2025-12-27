import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, boolean, index, uniqueIndex, doublePrecision } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Prometheus metric configuration type - used in credential profiles (defaults) and devices (overrides)
export type PrometheusMetricConfig = {
  id: string; // Unique identifier for this metric config
  metricName: string; // Prometheus metric name (e.g., 'node_filesystem_avail_bytes')
  label: string; // Display label (e.g., 'Disk Available')
  displayType: 'bar' | 'gauge' | 'number' | 'text' | 'bytes' | 'percentage' | 'boolean' | 'rate'; // How to visualize ('rate' for counter metrics - shows change/second)
  unit?: string; // Optional unit suffix (e.g., 'GB', '%', 'ms')
  labelFilter?: Record<string, string>; // Optional label filter (e.g., {device: '/dev/sda1'})
  labelSelector?: string; // Full label selector string (e.g., '{chip="platform_coretemp_0",sensor="temp1"}')
  transform?: 'toGB' | 'toMB' | 'toPercent' | 'divide1000' | 'none'; // Value transformation
  maxValue?: number; // For bar/gauge - the max value for percentage calculation
  warningThreshold?: number; // Optional warning threshold
  criticalThreshold?: number; // Optional critical threshold
};

// SNMP metric configuration type - used for custom SNMP OID monitoring
export type SNMPMetricConfig = {
  id: string; // Unique identifier for this metric config (hash of OID)
  oid: string; // SNMP OID to query (e.g., '1.3.6.1.2.1.1.3.0' for sysUpTime)
  label: string; // Display label (e.g., 'System Uptime')
  displayType: 'number' | 'bytes' | 'percentage' | 'bar' | 'text' | 'boolean' | 'rate'; // How to visualize
  unit?: string; // Optional unit suffix (e.g., 'ms', 'packets')
  valueType?: 'counter' | 'gauge' | 'integer' | 'string'; // SNMP value type hint
  transform?: 'divide100' | 'divide1000' | 'toSeconds' | 'none'; // Value transformation (e.g., timeticks to seconds)
  warningThreshold?: number; // Optional warning threshold
  criticalThreshold?: number; // Optional critical threshold
};

// Common Prometheus metrics available for selection
export const PROMETHEUS_METRIC_PRESETS: PrometheusMetricConfig[] = [
  // Load averages (gauge metrics - show current value)
  { id: 'load1', metricName: 'node_load1', label: 'Load (1m)', displayType: 'number' },
  { id: 'load5', metricName: 'node_load5', label: 'Load (5m)', displayType: 'number' },
  { id: 'load15', metricName: 'node_load15', label: 'Load (15m)', displayType: 'number' },
  // Filesystem - available space on root
  { id: 'fs_root_avail', metricName: 'node_filesystem_avail_bytes', label: 'Root FS Free', displayType: 'bytes', labelFilter: { mountpoint: '/' }, transform: 'toGB' },
  // Swap - available swap space  
  { id: 'swap_free', metricName: 'node_memory_SwapFree_bytes', label: 'Swap Free', displayType: 'bytes', transform: 'toGB' },
  // File descriptors (gauge - currently allocated)
  { id: 'open_fds', metricName: 'node_filefd_allocated', label: 'Open File Descriptors', displayType: 'number' },
  // Entropy (gauge - current available)
  { id: 'entropy', metricName: 'node_entropy_available_bits', label: 'Entropy Available', displayType: 'number' },
  // TCP connections (gauge - current established)
  { id: 'tcp_conns', metricName: 'node_netstat_Tcp_CurrEstab', label: 'TCP Connections', displayType: 'number' },
  // Process counts (gauge - current running/blocked)
  { id: 'procs_running', metricName: 'node_procs_running', label: 'Running Processes', displayType: 'number' },
  { id: 'procs_blocked', metricName: 'node_procs_blocked', label: 'Blocked Processes', displayType: 'number' },
  // Memory pressure indicator  
  { id: 'mem_available', metricName: 'node_memory_MemAvailable_bytes', label: 'Memory Available', displayType: 'bytes', transform: 'toGB' },
];

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
  type: text("type").notNull(), // mikrotik, snmp, prometheus, proxmox
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
    usePrometheus?: boolean; // Explicitly enable Prometheus probing for this profile
    prometheusPort?: number; // Default 9100
    prometheusPath?: string; // Default /metrics
    prometheusScheme?: 'http' | 'https';
    prometheusMetrics?: PrometheusMetricConfig[]; // Extra metrics to collect (profile defaults)
    // Proxmox VE API settings
    proxmoxPort?: number; // Default 8006
    proxmoxApiTokenId?: string; // API token ID (user@realm!tokenid)
    proxmoxApiTokenSecret?: string; // API token secret
    proxmoxVerifySsl?: boolean; // Default false (self-signed certs common)
    proxmoxRealm?: string; // Default 'pam'
    // SNMP custom metrics
    snmpMetrics?: SNMPMetricConfig[]; // Custom SNMP OIDs to monitor (profile defaults)
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
  type: text("type").notNull().default("webhook").$type<'webhook' | 'telegram' | 'slack' | 'pushover' | 'email'>(),
  // Legacy webhook fields (kept for backward compatibility)
  url: text("url"),
  method: text("method").default("POST"),
  // Type-specific config stored as JSON
  config: jsonb("config").$type<{
    // Webhook config
    url?: string;
    method?: string;
    // Telegram config
    botToken?: string;
    chatId?: string;
    // Slack config
    webhookUrl?: string;
    channel?: string; // Optional channel override
    username?: string; // Optional username override
    iconEmoji?: string; // Optional icon emoji
    // Pushover config
    pushoverUserKey?: string;
    pushoverAppToken?: string;
    pushoverDevice?: string;
    pushoverSound?: string;
    pushoverPriority?: number;
    // Email config (future)
    emailAddress?: string;
  }>(),
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
    customMetrics?: Record<string, number | string>; // Collected custom Prometheus metrics (id -> value)
    availableMetrics?: string[]; // List of available Prometheus metric names discovered from device
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
    usePrometheus?: boolean;
    prometheusPort?: number;
    prometheusPath?: string;
    prometheusScheme?: 'http' | 'https';
    prometheusMetrics?: PrometheusMetricConfig[]; // Extra metrics to collect (device-specific overrides)
    // Proxmox VE API settings
    proxmoxPort?: number;
    proxmoxApiTokenId?: string;
    proxmoxApiTokenSecret?: string;
    proxmoxVerifySsl?: boolean;
    proxmoxRealm?: string;
    // SNMP custom metrics
    snmpMetrics?: SNMPMetricConfig[]; // Custom SNMP OIDs to monitor (device-specific overrides)
  }>(),
  useOnDuty: boolean("use_on_duty").default(false).notNull(), // Also send alerts to on-duty operators (in addition to global channels)
  mutedUntil: timestamp("muted_until"), // Device notifications muted until this time (null = not muted)
  statusChangedAt: timestamp("status_changed_at"), // Timestamp when status last changed (for offline duration display)
  metricsRetentionHours: integer("metrics_retention_hours"), // Override global retention for this device (null = use global default)
  lastProbeError: text("last_probe_error"), // Last error message from failed probe (for diagnostics)
  pollingInterfaceId: varchar("polling_interface_id"), // FK to deviceInterfaces - which interface to use for polling (added later via ALTER)
  pollingAddressId: varchar("polling_address_id"), // FK to ipamAddresses - which IP address to use for polling (added later via ALTER)
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

// Device interfaces - stores network interfaces discovered from devices
export const deviceInterfaces = pgTable("device_interfaces", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"), // Interface description/comment from device
  type: text("type").$type<'ethernet' | 'vlan' | 'bridge' | 'loopback' | 'wireless' | 'tunnel' | 'bonding' | 'other'>(),
  parentInterfaceId: varchar("parent_interface_id"), // For VLANs - references self
  snmpIndex: integer("snmp_index"),
  macAddress: text("mac_address"),
  isVirtual: boolean("is_virtual").default(false),
  operStatus: text("oper_status").$type<'up' | 'down' | 'unknown'>(), // Operational status
  adminStatus: text("admin_status").$type<'enabled' | 'disabled' | 'unknown'>(), // Administrative status
  speed: text("speed"), // Link speed (e.g. "1G", "10G", "100M")
  duplex: text("duplex").$type<'full' | 'half' | 'unknown'>(), // Duplex mode
  discoverySource: text("discovery_source").$type<'probe' | 'manual' | 'sync'>(),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_device_interfaces_device").on(table.deviceId),
]);

export const connections = pgTable("connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mapId: varchar("map_id").notNull().references(() => maps.id, { onDelete: "cascade" }),
  sourceDeviceId: varchar("source_device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  targetDeviceId: varchar("target_device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  sourcePort: text("source_port"),
  targetPort: text("target_port"),
  connectionType: text("connection_type").default("ethernet"),
  linkSpeed: text("link_speed").default("1G"),
  curveMode: text("curve_mode").$type<'straight' | 'curved' | 'spline' | 'auto'>().default("straight"),
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
  isDynamic: boolean("is_dynamic").default(false),
  dynamicType: text("dynamic_type").$type<'proxmox_vm_host' | null>(),
  dynamicMetadata: jsonb("dynamic_metadata").$type<{
    vmDeviceId?: string;
    vmEnd?: 'source' | 'target';
    lastResolvedHostId?: string;
    lastResolvedNodeName?: string;
    state?: 'resolved' | 'unresolved' | 'pending';
  }>(),
  warningThresholdPct: integer("warning_threshold_pct").default(70),
  criticalThresholdPct: integer("critical_threshold_pct").default(90),
  labelPosition: integer("label_position").default(50),
  customLinkSpeedMbps: integer("custom_link_speed_mbps"),
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

// Zod schema for PrometheusMetricConfig
const prometheusMetricConfigSchema = z.object({
  id: z.string(),
  metricName: z.string(),
  label: z.string(),
  displayType: z.enum(['bar', 'gauge', 'number', 'text', 'bytes', 'percentage', 'boolean', 'rate']),
  unit: z.string().optional(),
  labelFilter: z.record(z.string()).optional(),
  labelSelector: z.string().optional(),
  transform: z.enum(['toGB', 'toMB', 'toPercent', 'divide1000', 'none']).optional(),
  maxValue: z.number().optional(),
  warningThreshold: z.number().optional(),
  criticalThreshold: z.number().optional(),
});

// Zod schema for SNMPMetricConfig
const snmpMetricConfigSchema = z.object({
  id: z.string(),
  oid: z.string(),
  label: z.string(),
  displayType: z.enum(['number', 'bytes', 'percentage', 'bar', 'text', 'boolean', 'rate']),
  unit: z.string().optional(),
  valueType: z.enum(['counter', 'gauge', 'integer', 'string']).optional(),
  transform: z.enum(['divide100', 'divide1000', 'toSeconds', 'none']).optional(),
  warningThreshold: z.number().optional(),
  criticalThreshold: z.number().optional(),
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
  // Prometheus settings
  usePrometheus: z.boolean().optional(),
  prometheusPort: z.number().optional(),
  prometheusPath: z.string().optional(),
  prometheusScheme: z.enum(['http', 'https']).optional(),
  prometheusMetrics: z.array(prometheusMetricConfigSchema).optional(),
  // Proxmox VE API settings
  proxmoxPort: z.number().optional(),
  proxmoxApiTokenId: z.string().optional(),
  proxmoxApiTokenSecret: z.string().optional(),
  proxmoxVerifySsl: z.boolean().optional(),
  proxmoxRealm: z.string().optional(),
  // SNMP custom metrics
  snmpMetrics: z.array(snmpMetricConfigSchema).optional(),
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
  customCredentials: credentialsSchema.nullable().optional(),
  credentialProfileId: z.string().nullable().optional(),
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
  linkSpeed: z.enum(['1G', '2.5G', '10G', '25G', '40G', '100G', 'WiFi', 'Custom']).optional(),
  customLinkSpeedMbps: z.number().int().min(1).max(1000000).nullable().optional(),
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
  type: z.enum(['webhook', 'telegram', 'slack', 'pushover', 'email']).optional(),
  url: z.string().optional(), // Legacy field for backward compatibility
  method: z.string().optional(), // Legacy field for backward compatibility
  config: z.object({
    // Webhook config
    url: z.string().optional(),
    method: z.string().optional(),
    // Telegram config
    botToken: z.string().optional(),
    chatId: z.string().optional(),
    // Slack config
    webhookUrl: z.string().optional(),
    channel: z.string().optional(),
    username: z.string().optional(),
    iconEmoji: z.string().optional(),
    // Pushover config
    pushoverUserKey: z.string().optional(),
    pushoverAppToken: z.string().optional(),
    pushoverDevice: z.string().optional(),
    pushoverSound: z.string().optional(),
    pushoverPriority: z.number().min(-2).max(2).optional(),
    // Email config (future)
    emailAddress: z.string().email().optional(),
  }).optional(),
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
  type: text("type").notNull().$type<'webhook' | 'email' | 'telegram' | 'pushover' | 'slack'>(),
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
    // Slack config
    webhookUrl?: string;
    channel?: string; // Optional channel override
    username?: string; // Optional username override
    iconEmoji?: string; // Optional icon emoji
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

// Device status events - tracks every status change for history/analytics
export const deviceStatusEvents = pgTable("device_status_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  previousStatus: text("previous_status"), // null for initial status
  newStatus: text("new_status").notNull(), // online, warning, stale, offline, unknown
  message: text("message"), // Optional description of why status changed
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_device_status_events_device_created").on(table.deviceId, table.createdAt),
]);

// Proxmox VM instances - tracks VMs running on Proxmox hosts
export const proxmoxVms = pgTable("proxmox_vms", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  hostDeviceId: varchar("host_device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  vmid: integer("vmid").notNull(), // Proxmox VM ID (e.g., 100, 101)
  vmType: text("vm_type").notNull().$type<'qemu' | 'lxc'>(), // QEMU VM or LXC container
  name: text("name").notNull(),
  status: text("status").notNull(), // running, stopped, paused, etc.
  node: text("node").notNull(), // Proxmox node name (for cluster tracking)
  cpuUsage: integer("cpu_usage"), // CPU cores assigned
  cpuUsagePct: integer("cpu_usage_pct"), // CPU usage percentage
  memoryBytes: text("memory_bytes"), // Memory in bytes
  memoryUsagePct: integer("memory_usage_pct"), // Memory usage percentage
  diskBytes: text("disk_bytes"), // Disk size in bytes
  uptime: integer("uptime"), // Uptime in seconds
  ipAddresses: text("ip_addresses").array(), // IP addresses detected
  macAddresses: text("mac_addresses").array(), // MAC addresses from config
  matchedDeviceId: varchar("matched_device_id").references(() => devices.id, { onDelete: "set null" }), // Link to existing device by IP/MAC
  clusterName: text("cluster_name"), // Proxmox cluster name if clustered
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_proxmox_vms_host").on(table.hostDeviceId),
  index("idx_proxmox_vms_matched").on(table.matchedDeviceId),
]);

// Proxmox cluster nodes - maps cluster node names to Proxmox host devices
// Used to resolve which host device a VM should connect to after migration
export const proxmoxNodes = pgTable("proxmox_nodes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clusterName: text("cluster_name").notNull(), // Proxmox cluster name
  nodeName: text("node_name").notNull(), // Proxmox node name within cluster
  hostDeviceId: varchar("host_device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_proxmox_nodes_cluster").on(table.clusterName),
  index("idx_proxmox_nodes_host").on(table.hostDeviceId),
]);

export const insertProxmoxNodeSchema = createInsertSchema(proxmoxNodes).omit({
  id: true,
  createdAt: true,
  lastSeen: true,
});

export type InsertProxmoxNode = z.infer<typeof insertProxmoxNodeSchema>;
export type ProxmoxNode = typeof proxmoxNodes.$inferSelect;

export const insertUserNotificationChannelSchema = createInsertSchema(userNotificationChannels).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  type: z.enum(['webhook', 'email', 'telegram', 'pushover', 'slack']),
  config: z.object({
    url: z.string().optional(),
    method: z.string().optional(),
    messageTemplate: z.string().optional(),
    emailAddress: z.string().email().optional(),
    botToken: z.string().optional(),
    chatId: z.string().optional(),
    // Slack config
    webhookUrl: z.string().optional(),
    channel: z.string().optional(),
    username: z.string().optional(),
    iconEmoji: z.string().optional(),
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

export const insertDeviceStatusEventSchema = createInsertSchema(deviceStatusEvents).omit({
  id: true,
  createdAt: true,
});

export const insertProxmoxVmSchema = createInsertSchema(proxmoxVms).omit({
  id: true,
  createdAt: true,
  lastSeen: true,
}).extend({
  vmType: z.enum(['qemu', 'lxc']),
  ipAddresses: z.array(z.string()).optional(),
  macAddresses: z.array(z.string()).optional(),
});

// IPAM Pools - defines IP address ranges/blocks to track
export const ipamPools = pgTable("ipam_pools", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  entryType: text("entry_type").notNull().$type<'cidr' | 'range' | 'single'>(),
  cidr: text("cidr"), // For CIDR notation (e.g., 192.168.1.0/24)
  rangeStart: text("range_start"), // For range notation start IP
  rangeEnd: text("range_end"), // For range notation end IP
  vlan: integer("vlan"), // Optional VLAN tag
  gateway: text("gateway"), // Optional gateway IP
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// IPAM Addresses - individual IP addresses tracked within pools
export const ipamAddresses = pgTable("ipam_addresses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ipAddress: text("ip_address").notNull(),
  networkAddress: text("network_address"), // CIDR notation with prefix (e.g., "192.168.1.1/24")
  poolId: varchar("pool_id").references(() => ipamPools.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("available").$type<'available' | 'assigned' | 'reserved' | 'offline'>(),
  assignedDeviceId: varchar("assigned_device_id").references(() => devices.id, { onDelete: "set null" }),
  assignedInterfaceId: varchar("assigned_interface_id").references(() => deviceInterfaces.id, { onDelete: "set null" }), // FK to specific interface
  assignedInterfaceIndex: integer("assigned_interface_index"), // Legacy: Index into device's ports array (deprecated)
  role: text("role").$type<'primary' | 'secondary' | 'management' | 'unused'>(), // Role of this IP on the device
  source: text("source").$type<'manual' | 'discovered' | 'sync'>(), // How this address was added
  assignmentSource: text("assignment_source").$type<'manual' | 'auto'>(), // Legacy: How was this assignment made
  hostname: text("hostname"), // Optional hostname for this IP
  notes: text("notes"),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_ipam_addresses_pool").on(table.poolId),
  index("idx_ipam_addresses_device").on(table.assignedDeviceId),
  index("idx_ipam_addresses_interface").on(table.assignedInterfaceId),
  uniqueIndex("idx_ipam_addresses_ip_unique").on(table.ipAddress),
]);

// IPAM Address Assignments - junction table for many-to-many IP-to-interface relationships
// Allows multiple devices/interfaces to share the same IP address (e.g., VRRP, failover)
export const ipamAddressAssignments = pgTable("ipam_address_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  addressId: varchar("address_id").notNull().references(() => ipamAddresses.id, { onDelete: "cascade" }),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  interfaceId: varchar("interface_id").references(() => deviceInterfaces.id, { onDelete: "set null" }),
  role: text("role").$type<'primary' | 'secondary' | 'management' | 'unused'>(),
  source: text("source").$type<'manual' | 'discovered' | 'sync'>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_ipam_assignments_address").on(table.addressId),
  index("idx_ipam_assignments_device").on(table.deviceId),
  index("idx_ipam_assignments_interface").on(table.interfaceId),
]);

export const insertIpamPoolSchema = createInsertSchema(ipamPools).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  entryType: z.enum(['cidr', 'range', 'single']),
  vlan: z.number().int().min(1).max(4094).optional().nullable(),
});

export const insertIpamAddressSchema = createInsertSchema(ipamAddresses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: z.enum(['available', 'assigned', 'reserved', 'offline']).optional(),
  role: z.enum(['primary', 'secondary', 'management', 'unused']).optional().nullable(),
  source: z.enum(['manual', 'discovered', 'sync']).optional().nullable(),
  assignmentSource: z.enum(['manual', 'auto']).optional().nullable(),
});

export const insertDeviceInterfaceSchema = createInsertSchema(deviceInterfaces).omit({
  id: true,
  createdAt: true,
}).extend({
  type: z.enum(['ethernet', 'vlan', 'bridge', 'loopback', 'wireless', 'tunnel', 'bonding', 'other']).optional().nullable(),
  discoverySource: z.enum(['probe', 'manual', 'sync']).optional().nullable(),
  operStatus: z.enum(['up', 'down', 'unknown']).optional().nullable(),
  adminStatus: z.enum(['enabled', 'disabled', 'unknown']).optional().nullable(),
  duplex: z.enum(['full', 'half', 'unknown']).optional().nullable(),
});

export const insertIpamAddressAssignmentSchema = createInsertSchema(ipamAddressAssignments).omit({
  id: true,
  createdAt: true,
}).extend({
  role: z.enum(['primary', 'secondary', 'management', 'unused']).optional().nullable(),
  source: z.enum(['manual', 'discovered', 'sync']).optional().nullable(),
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
export type DeviceStatusEvent = typeof deviceStatusEvents.$inferSelect;
export type InsertDeviceStatusEvent = z.infer<typeof insertDeviceStatusEventSchema>;
export type ProxmoxVm = typeof proxmoxVms.$inferSelect;
export type InsertProxmoxVm = z.infer<typeof insertProxmoxVmSchema>;
export type IpamPool = typeof ipamPools.$inferSelect;
export type InsertIpamPool = z.infer<typeof insertIpamPoolSchema>;
export type IpamAddress = typeof ipamAddresses.$inferSelect;
export type InsertIpamAddress = z.infer<typeof insertIpamAddressSchema>;
export type DeviceInterface = typeof deviceInterfaces.$inferSelect;
export type InsertDeviceInterface = z.infer<typeof insertDeviceInterfaceSchema>;
export type IpamAddressAssignment = typeof ipamAddressAssignments.$inferSelect;
export type InsertIpamAddressAssignment = z.infer<typeof insertIpamAddressAssignmentSchema>;

// Extended type for IPAM address with assignments
export interface IpamAddressWithAssignments extends IpamAddress {
  assignments: IpamAddressAssignment[];
}

// Device metrics history - time-series storage for device vitals
export const deviceMetricsHistory = pgTable("device_metrics_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  cpuUsagePct: integer("cpu_usage_pct"),
  memoryUsagePct: integer("memory_usage_pct"),
  diskUsagePct: integer("disk_usage_pct"),
  pingRtt: integer("ping_rtt"), // Ping round-trip time in ms
  uptimeSeconds: integer("uptime_seconds"), // Raw uptime in seconds for tracking
}, (table) => [
  index("idx_device_metrics_device_time").on(table.deviceId, table.timestamp),
  index("idx_device_metrics_timestamp").on(table.timestamp),
]);

export const insertDeviceMetricsHistorySchema = createInsertSchema(deviceMetricsHistory).omit({
  id: true,
});

// Connection bandwidth history - time-series storage for link traffic
export const connectionBandwidthHistory = pgTable("connection_bandwidth_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  connectionId: varchar("connection_id").notNull().references(() => connections.id, { onDelete: "cascade" }),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  inBytesPerSec: integer("in_bytes_per_sec"),
  outBytesPerSec: integer("out_bytes_per_sec"),
  utilizationPct: integer("utilization_pct"),
}, (table) => [
  index("idx_bandwidth_connection_time").on(table.connectionId, table.timestamp),
  index("idx_bandwidth_timestamp").on(table.timestamp),
]);

export const insertConnectionBandwidthHistorySchema = createInsertSchema(connectionBandwidthHistory).omit({
  id: true,
});

// Prometheus custom metrics history - time-series storage for selected scan metrics
export const prometheusMetricsHistory = pgTable("prometheus_metrics_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  metricId: text("metric_id").notNull(), // The metric config ID (e.g., 'load1', 'fs_root_avail')
  metricName: text("metric_name").notNull(), // Prometheus metric name for reference
  value: doublePrecision("value").notNull(), // The metric value (already transformed)
  rawValue: doublePrecision("raw_value"), // Original untransformed value (optional, for debugging)
  timestamp: timestamp("timestamp").defaultNow().notNull(),
}, (table) => [
  index("idx_prom_metrics_device_metric_time").on(table.deviceId, table.metricId, table.timestamp),
  index("idx_prom_metrics_timestamp").on(table.timestamp),
]);

// License table for software licensing
export const licenses = pgTable("licenses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  licenseKey: text("license_key").notNull().unique(),
  tier: text("tier").notNull().default("free"), // free, pro
  fingerprint: text("fingerprint").notNull(), // Server fingerprint hash
  deviceLimit: integer("device_limit").default(10), // null = unlimited
  purchaseDate: timestamp("purchase_date"),
  updatesValidUntil: timestamp("updates_valid_until"), // Updates entitlement expiry
  stripeSessionId: text("stripe_session_id"), // Stripe checkout session ID
  stripeCustomerId: text("stripe_customer_id"), // Stripe customer ID
  activatedAt: timestamp("activated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertLicenseSchema = createInsertSchema(licenses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type License = typeof licenses.$inferSelect;
export type InsertLicense = z.infer<typeof insertLicenseSchema>;

export type DeviceMetricsHistory = typeof deviceMetricsHistory.$inferSelect;
export type InsertDeviceMetricsHistory = z.infer<typeof insertDeviceMetricsHistorySchema>;
export type ConnectionBandwidthHistory = typeof connectionBandwidthHistory.$inferSelect;
export type InsertConnectionBandwidthHistory = z.infer<typeof insertConnectionBandwidthHistorySchema>;

export const insertPrometheusMetricsHistorySchema = createInsertSchema(prometheusMetricsHistory).omit({
  id: true,
});
export type PrometheusMetricsHistory = typeof prometheusMetricsHistory.$inferSelect;
export type InsertPrometheusMetricsHistory = z.infer<typeof insertPrometheusMetricsHistorySchema>;

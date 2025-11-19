import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const maps = pgTable("maps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
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

export const devices = pgTable("devices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mapId: varchar("map_id").notNull().references(() => maps.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  ipAddress: text("ip_address"),
  position: jsonb("position").notNull().$type<{ x: number; y: number }>(),
  status: text("status").notNull().default("unknown"),
  deviceData: jsonb("device_data").$type<{
    uptime?: string;
    model?: string;
    version?: string;
    ports?: Array<{ name: string; status: string; speed?: string }>;
    cpuUsagePct?: number;
    memoryUsagePct?: number;
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

export const connections = pgTable("connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mapId: varchar("map_id").notNull().references(() => maps.id, { onDelete: "cascade" }),
  sourceDeviceId: varchar("source_device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  targetDeviceId: varchar("target_device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  sourcePort: text("source_port"),
  targetPort: text("target_port"),
  connectionType: text("connection_type").default("ethernet"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const mapsRelations = relations(maps, ({ many }) => ({
  devices: many(devices),
  connections: many(connections),
}));

export const devicesRelations = relations(devices, ({ one, many }) => ({
  map: one(maps, {
    fields: [devices.mapId],
    references: [maps.id],
  }),
  sourceConnections: many(connections, { relationName: "sourceDevice" }),
  targetConnections: many(connections, { relationName: "targetDevice" }),
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
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  deviceData: z.object({
    uptime: z.string().optional(),
    model: z.string().optional(),
    version: z.string().optional(),
    ports: z.array(z.object({
      name: z.string(),
      status: z.string(),
      speed: z.string().optional(),
    })).optional(),
  }).optional(),
  customCredentials: credentialsSchema.optional(),
});

export const insertConnectionSchema = createInsertSchema(connections).omit({
  id: true,
  createdAt: true,
});

export type Map = typeof maps.$inferSelect;
export type InsertMap = z.infer<typeof insertMapSchema>;
export type Device = typeof devices.$inferSelect;
export type InsertDevice = z.infer<typeof insertDeviceSchema>;
export type Connection = typeof connections.$inferSelect;
export type InsertConnection = z.infer<typeof insertConnectionSchema>;
export type CredentialProfile = typeof credentialProfiles.$inferSelect;
export type InsertCredentialProfile = z.infer<typeof insertCredentialProfileSchema>;

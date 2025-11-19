import { 
  maps, 
  devices, 
  connections,
  credentialProfiles,
  settings,
  type Map, 
  type InsertMap,
  type Device,
  type InsertDevice,
  type Connection,
  type InsertConnection,
  type CredentialProfile,
  type InsertCredentialProfile
} from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";

export interface IStorage {
  // Maps
  getAllMaps(): Promise<Map[]>;
  getMap(id: string): Promise<Map | undefined>;
  createMap(map: InsertMap): Promise<Map>;
  deleteMap(id: string): Promise<void>;

  // Devices
  getDevicesByMapId(mapId: string): Promise<Device[]>;
  getDevice(id: string): Promise<Device | undefined>;
  createDevice(device: InsertDevice): Promise<Device>;
  updateDevice(id: string, device: Partial<InsertDevice>): Promise<Device | undefined>;
  deleteDevice(id: string): Promise<void>;

  // Connections
  getConnectionsByMapId(mapId: string): Promise<Connection[]>;
  getConnection(id: string): Promise<Connection | undefined>;
  createConnection(connection: InsertConnection): Promise<Connection>;
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

  async deleteMap(id: string): Promise<void> {
    await db.delete(maps).where(eq(maps.id, id));
  }

  // Devices
  async getDevicesByMapId(mapId: string): Promise<Device[]> {
    return await db.select().from(devices).where(eq(devices.mapId, mapId));
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

  // Connections
  async getConnectionsByMapId(mapId: string): Promise<Connection[]> {
    return await db.select().from(connections).where(eq(connections.mapId, mapId));
  }

  async getConnection(id: string): Promise<Connection | undefined> {
    const [connection] = await db.select().from(connections).where(eq(connections.id, id));
    return connection || undefined;
  }

  async createConnection(insertConnection: InsertConnection): Promise<Connection> {
    const [connection] = await db
      .insert(connections)
      .values(insertConnection)
      .returning();
    return connection;
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
}

export const storage = new DatabaseStorage();

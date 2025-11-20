import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { probeDevice, determineDeviceStatus } from "./deviceProbe";
import { insertMapSchema, insertDeviceSchema, insertConnectionSchema, insertCredentialProfileSchema, type Device } from "@shared/schema";
import { z } from "zod";

// Helper function to resolve credentials from profile or custom
async function resolveCredentials(device: Pick<Device, 'credentialProfileId' | 'customCredentials'>) {
  if (device.credentialProfileId) {
    const profile = await storage.getCredentialProfile(device.credentialProfileId);
    return profile?.credentials;
  }
  return device.customCredentials;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Map routes
  app.get("/api/maps", async (_req, res) => {
    try {
      const maps = await storage.getAllMaps();
      res.json(maps);
    } catch (error) {
      console.error('Error fetching maps:', error);
      res.status(500).json({ error: 'Failed to fetch maps' });
    }
  });

  app.get("/api/maps/:id", async (req, res) => {
    try {
      const map = await storage.getMap(req.params.id);
      if (!map) {
        return res.status(404).json({ error: 'Map not found' });
      }
      res.json(map);
    } catch (error) {
      console.error('Error fetching map:', error);
      res.status(500).json({ error: 'Failed to fetch map' });
    }
  });

  app.post("/api/maps", async (req, res) => {
    try {
      const data = insertMapSchema.parse(req.body);
      const map = await storage.createMap(data);
      res.status(201).json(map);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid map data', details: error.errors });
      }
      console.error('Error creating map:', error);
      res.status(500).json({ error: 'Failed to create map' });
    }
  });

  app.delete("/api/maps/:id", async (req, res) => {
    try {
      await storage.deleteMap(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting map:', error);
      res.status(500).json({ error: 'Failed to delete map' });
    }
  });

  // Device routes
  app.get("/api/devices", async (req, res) => {
    try {
      const mapId = req.query.mapId as string;
      if (!mapId) {
        return res.status(400).json({ error: 'mapId query parameter is required' });
      }
      const devices = await storage.getDevicesByMapId(mapId);
      res.json(devices);
    } catch (error) {
      console.error('Error fetching devices:', error);
      res.status(500).json({ error: 'Failed to fetch devices' });
    }
  });

  app.get("/api/devices/:id", async (req, res) => {
    try {
      const device = await storage.getDevice(req.params.id);
      if (!device) {
        return res.status(404).json({ error: 'Device not found' });
      }
      res.json(device);
    } catch (error) {
      console.error('Error fetching device:', error);
      res.status(500).json({ error: 'Failed to fetch device' });
    }
  });

  app.post("/api/devices", async (req, res) => {
    try {
      const data = insertDeviceSchema.parse(req.body);
      
      // Resolve credentials from profile or custom
      const credentials = await resolveCredentials({
        credentialProfileId: data.credentialProfileId || null,
        customCredentials: data.customCredentials || null,
      });
      
      // Probe device for additional information
      const probeResult = await probeDevice(data.type, data.ipAddress || undefined, credentials);
      const status = determineDeviceStatus(probeResult.data, probeResult.success);

      const device = await storage.createDevice({
        ...data,
        status,
        deviceData: probeResult.success ? probeResult.data : undefined,
      });
      
      res.status(201).json(device);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid device data', details: error.errors });
      }
      console.error('Error creating device:', error);
      res.status(500).json({ error: 'Failed to create device' });
    }
  });

  app.patch("/api/devices/:id", async (req, res) => {
    try {
      const updateData = insertDeviceSchema.partial().parse(req.body);
      
      // Re-probe device if IP, type, or credentials changed
      let finalUpdateData = { ...updateData };
      if (updateData.type || updateData.ipAddress || updateData.credentialProfileId !== undefined || updateData.customCredentials !== undefined) {
        const existingDevice = await storage.getDevice(req.params.id);
        if (existingDevice) {
          const mergedDevice = { ...existingDevice, ...updateData };
          const credentials = await resolveCredentials(mergedDevice);
          
          const probeResult = await probeDevice(
            updateData.type || existingDevice.type, 
            (updateData.ipAddress !== undefined ? updateData.ipAddress : existingDevice.ipAddress) || undefined,
            credentials
          );
          const status = determineDeviceStatus(probeResult.data, probeResult.success);
          finalUpdateData = {
            ...updateData,
            status,
            deviceData: probeResult.success ? probeResult.data : (existingDevice.deviceData || undefined),
          };
        }
      }
      
      const device = await storage.updateDevice(req.params.id, finalUpdateData);
      
      if (!device) {
        return res.status(404).json({ error: 'Device not found' });
      }
      
      res.json(device);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid device data', details: error.errors });
      }
      console.error('Error updating device:', error);
      res.status(500).json({ error: 'Failed to update device' });
    }
  });

  app.delete("/api/devices/:id", async (req, res) => {
    try {
      await storage.deleteDevice(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting device:', error);
      res.status(500).json({ error: 'Failed to delete device' });
    }
  });

  app.post("/api/devices/:id/probe", async (req, res) => {
    try {
      const device = await storage.getDevice(req.params.id);
      if (!device) {
        return res.status(404).json({ error: 'Device not found' });
      }

      const credentials = await resolveCredentials(device);
      const probeResult = await probeDevice(device.type, device.ipAddress || undefined, credentials);
      const status = determineDeviceStatus(probeResult.data, probeResult.success);

      const updatedDevice = await storage.updateDevice(req.params.id, {
        status,
        deviceData: probeResult.success ? probeResult.data : (device.deviceData || undefined),
      });

      res.json(updatedDevice);
    } catch (error) {
      console.error('Error probing device:', error);
      res.status(500).json({ error: 'Failed to probe device' });
    }
  });

  // Connection routes
  app.get("/api/connections", async (req, res) => {
    try {
      const mapId = req.query.mapId as string;
      if (!mapId) {
        return res.status(400).json({ error: 'mapId query parameter is required' });
      }
      const connections = await storage.getConnectionsByMapId(mapId);
      res.json(connections);
    } catch (error) {
      console.error('Error fetching connections:', error);
      res.status(500).json({ error: 'Failed to fetch connections' });
    }
  });

  app.post("/api/connections", async (req, res) => {
    try {
      const data = insertConnectionSchema.parse(req.body);
      const connection = await storage.createConnection(data);
      res.status(201).json(connection);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid connection data', details: error.errors });
      }
      console.error('Error creating connection:', error);
      res.status(500).json({ error: 'Failed to create connection' });
    }
  });

  app.patch("/api/connections/:id", async (req, res) => {
    try {
      const data = insertConnectionSchema.partial().parse(req.body);
      const connection = await storage.updateConnection(req.params.id, data);
      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }
      res.json(connection);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid connection data', details: error.errors });
      }
      console.error('Error updating connection:', error);
      res.status(500).json({ error: 'Failed to update connection' });
    }
  });

  app.delete("/api/connections/:id", async (req, res) => {
    try {
      await storage.deleteConnection(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting connection:', error);
      res.status(500).json({ error: 'Failed to delete connection' });
    }
  });

  // Credential Profile routes
  app.get("/api/credential-profiles", async (_req, res) => {
    try {
      const profiles = await storage.getAllCredentialProfiles();
      res.json(profiles);
    } catch (error) {
      console.error('Error fetching credential profiles:', error);
      res.status(500).json({ error: 'Failed to fetch credential profiles' });
    }
  });

  app.get("/api/credential-profiles/:id", async (req, res) => {
    try {
      const profile = await storage.getCredentialProfile(req.params.id);
      if (!profile) {
        return res.status(404).json({ error: 'Credential profile not found' });
      }
      res.json(profile);
    } catch (error) {
      console.error('Error fetching credential profile:', error);
      res.status(500).json({ error: 'Failed to fetch credential profile' });
    }
  });

  app.post("/api/credential-profiles", async (req, res) => {
    try {
      const data = insertCredentialProfileSchema.parse(req.body);
      const profile = await storage.createCredentialProfile(data);
      res.status(201).json(profile);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid credential profile data', details: error.errors });
      }
      console.error('Error creating credential profile:', error);
      res.status(500).json({ error: 'Failed to create credential profile' });
    }
  });

  app.patch("/api/credential-profiles/:id", async (req, res) => {
    try {
      const data = insertCredentialProfileSchema.partial().parse(req.body);
      const profile = await storage.updateCredentialProfile(req.params.id, data);
      if (!profile) {
        return res.status(404).json({ error: 'Credential profile not found' });
      }
      res.json(profile);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid credential profile data', details: error.errors });
      }
      console.error('Error updating credential profile:', error);
      res.status(500).json({ error: 'Failed to update credential profile' });
    }
  });

  app.delete("/api/credential-profiles/:id", async (req, res) => {
    try {
      await storage.deleteCredentialProfile(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting credential profile:', error);
      res.status(500).json({ error: 'Failed to delete credential profile' });
    }
  });

  // Settings routes
  app.get("/api/settings/:key", async (req, res) => {
    try {
      const value = await storage.getSetting(req.params.key);
      if (value === undefined) {
        return res.status(404).json({ error: 'Setting not found' });
      }
      res.json({ key: req.params.key, value });
    } catch (error) {
      console.error('Error fetching setting:', error);
      res.status(500).json({ error: 'Failed to fetch setting' });
    }
  });

  app.put("/api/settings/:key", async (req, res) => {
    try {
      const { value } = req.body;
      if (value === undefined) {
        return res.status(400).json({ error: 'Value is required' });
      }
      await storage.setSetting(req.params.key, value);
      res.json({ key: req.params.key, value });
    } catch (error) {
      console.error('Error updating setting:', error);
      res.status(500).json({ error: 'Failed to update setting' });
    }
  });

  // Parallel probing with bounded concurrency
  // For 400+ devices in 30s window: 80 concurrent * 6s timeout = ~400 devices in 30s worst-case
  const CONCURRENT_PROBES = 80; // Scaled for 400+ devices
  const PROBE_TIMEOUT_MS = 6000; // Per-device timeout
  
  interface ProbeResult {
    device: any;
    success: boolean;
    timeout: boolean;
    error?: string;
  }
  
  async function probeDeviceWithTimeout(device: any, credentials: any): Promise<ProbeResult> {
    let timeoutId: NodeJS.Timeout;
    let timedOut = false;
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        reject(new Error('Probe timeout'));
      }, PROBE_TIMEOUT_MS);
    });
    
    const probePromise = (async () => {
      const probeResult = await probeDevice(
        device.type,
        device.ipAddress,
        credentials
      );
      
      if (timedOut) {
        return { device, success: false, timeout: true };
      }
      
      const status = determineDeviceStatus(probeResult.data, probeResult.success);
      
      if (status !== device.status || probeResult.success) {
        await storage.updateDevice(device.id, {
          status,
          deviceData: probeResult.success ? probeResult.data : (device.deviceData || undefined),
        });
        console.log(`[Probing] Updated ${device.name} (${device.ipAddress}): ${status}`);
      }
      
      return { device, success: probeResult.success, timeout: false };
    })();
    
    try {
      const result = await Promise.race([probePromise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (error: any) {
      clearTimeout(timeoutId!);
      if (error.message === 'Probe timeout') {
        console.warn(`[Probing] Timeout probing ${device.name} (${device.ipAddress})`);
        return { device, success: false, timeout: true };
      }
      console.error(`[Probing] Failed to probe ${device.name}:`, error.message);
      return { device, success: false, timeout: false, error: error.message };
    }
  }
  
  async function processConcurrentQueue(devices: any[], concurrency: number): Promise<ProbeResult[]> {
    const results: ProbeResult[] = [];
    const queue = [...devices];
    const active: Promise<void>[] = [];
    
    while (queue.length > 0 || active.length > 0) {
      while (active.length < concurrency && queue.length > 0) {
        const device = queue.shift()!;
        if (!device.ipAddress) continue;
        
        const promise = (async () => {
          try {
            const credentials = await resolveCredentials(device);
            const result = await probeDeviceWithTimeout(device, credentials);
            results.push(result);
          } catch (error: any) {
            results.push({ device, success: false, timeout: false, error: error.message });
          }
        })();
        
        active.push(promise);
        promise.finally(() => {
          const index = active.indexOf(promise);
          if (index > -1) active.splice(index, 1);
        });
      }
      
      if (active.length > 0) {
        await Promise.race(active);
      }
    }
    
    return results;
  }
  
  // Start periodic device probing (configurable interval)
  let isProbing = false; // Guard against overlapping runs
  
  async function startPeriodicProbing() {
    const pollingInterval = await storage.getSetting('polling_interval') || 30;
    const intervalMs = parseInt(pollingInterval) * 1000;
    
    console.log(`[Probing] Starting automatic device probing service (${pollingInterval}s interval, ${CONCURRENT_PROBES} concurrent)`);
    
    setInterval(async () => {
      if (isProbing) {
        console.warn('[Probing] Previous probe cycle still running, skipping this interval');
        return;
      }
      
      isProbing = true;
      const startTime = Date.now();
      
      try {
        const maps = await storage.getAllMaps();
        const allDevices: any[] = [];
        
        for (const map of maps) {
          const devices = await storage.getDevicesByMapId(map.id);
          allDevices.push(...devices.filter(d => d.ipAddress));
        }
        
        const totalDevices = allDevices.length;
        console.log(`[Probing] Starting probe cycle for ${totalDevices} devices`);
        
        const results = await processConcurrentQueue(allDevices, CONCURRENT_PROBES);
        
        const successCount = results.filter(r => r.success).length;
        const timeoutCount = results.filter(r => r.timeout).length;
        const errorCount = results.filter(r => !r.success && !r.timeout).length;
        const successRate = totalDevices > 0 ? ((successCount / totalDevices) * 100).toFixed(1) : '0';
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        
        console.log(`[Probing] Completed cycle in ${duration}s: ${totalDevices} devices, ${successCount} success (${successRate}%), ${timeoutCount} timeout, ${errorCount} error`);
      } catch (error) {
        console.error('[Probing] Error in periodic probing:', error);
      } finally {
        isProbing = false;
      }
    }, intervalMs);
  }
  
  startPeriodicProbing();

  const httpServer = createServer(app);
  return httpServer;
}

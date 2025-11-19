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

  // Start periodic device probing (configurable interval)
  async function startPeriodicProbing() {
    const pollingInterval = await storage.getSetting('polling_interval') || 30;
    const intervalMs = parseInt(pollingInterval) * 1000;
    
    console.log(`[Probing] Starting automatic device probing service (${pollingInterval}s interval)`);
    
    setInterval(async () => {
      try {
        const maps = await storage.getAllMaps();
        for (const map of maps) {
          const devices = await storage.getDevicesByMapId(map.id);
          
          for (const device of devices) {
            if (!device.ipAddress) continue;
            
            try {
              const credentials = await resolveCredentials(device);
              const probeResult = await probeDevice(
                device.type,
                device.ipAddress,
                credentials
              );
              const status = determineDeviceStatus(probeResult.data, probeResult.success);
              
              // Only update if status or data changed
              if (status !== device.status || probeResult.success) {
                await storage.updateDevice(device.id, {
                  status,
                  deviceData: probeResult.success ? probeResult.data : (device.deviceData || undefined),
                });
                console.log(`[Probing] Updated ${device.name} (${device.ipAddress}): ${status}`);
              }
            } catch (error: any) {
              console.error(`[Probing] Failed to probe ${device.name}:`, error.message);
            }
          }
        }
      } catch (error) {
        console.error('[Probing] Error in periodic probing:', error);
      }
    }, intervalMs);
  }
  
  startPeriodicProbing();

  const httpServer = createServer(app);
  return httpServer;
}

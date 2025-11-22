import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { probeDevice, determineDeviceStatus } from "./deviceProbe";
import { insertMapSchema, insertDeviceSchema, insertDevicePlacementSchema, insertConnectionSchema, insertCredentialProfileSchema, insertNotificationSchema, insertDeviceNotificationSchema, type Device } from "@shared/schema";
import { z } from "zod";

// Helper function to resolve credentials from profile or custom
async function resolveCredentials(device: Pick<Device, 'credentialProfileId' | 'customCredentials'>) {
  if (device.credentialProfileId) {
    const profile = await storage.getCredentialProfile(device.credentialProfileId);
    return profile?.credentials;
  }
  return device.customCredentials;
}

// Helper function to render message template with device variables
function renderMessageTemplate(template: string, device: any, newStatus: string, oldStatus?: string): string {
  return template
    .replace(/\[Device\.Name\]/g, device.name || 'Unknown')
    .replace(/\[Device\.Address\]/g, device.ipAddress || 'N/A')
    .replace(/\[Device\.Identity\]/g, device.deviceData?.systemIdentity || device.name || 'Unknown')
    .replace(/\[Device\.Type\]/g, device.type?.replace(/_/g, ' ') || 'Unknown')
    .replace(/\[Service\.Status\]/g, newStatus)
    .replace(/\[Status\.Old\]/g, oldStatus || 'unknown')
    .replace(/\[Status\.New\]/g, newStatus);
}

// Helper function to send notification via HTTP
async function sendNotification(notification: any, device: any, newStatus: string, oldStatus?: string) {
  if (!notification.enabled) {
    console.log(`[Notification] Skipping disabled notification: ${notification.name}`);
    return;
  }

  const message = renderMessageTemplate(notification.messageTemplate, device, newStatus, oldStatus);
  
  try {
    const url = notification.url;
    const method = notification.method.toUpperCase();
    
    console.log(`[Notification] Sending ${method} to ${url} for device ${device.name}`);
    
    let finalUrl = url;
    let fetchOptions: RequestInit = { method };
    
    if (method === 'GET') {
      // For GET, append the message to the URL
      // User should provide URL ending with parameter name and '=' (e.g., ...?text=)
      // We append the URL-encoded message value
      finalUrl = `${url}${encodeURIComponent(message)}`;
    } else {
      // For POST, send the rendered message as the body
      // User can configure the URL with query params for any additional parameters
      fetchOptions.headers = { 'Content-Type': 'text/plain' };
      fetchOptions.body = message;
    }
    
    const response = await fetch(finalUrl, fetchOptions);
    
    if (!response.ok) {
      console.error(`[Notification] HTTP ${response.status} from ${finalUrl}`);
    } else {
      console.log(`[Notification] Successfully sent to ${finalUrl}`);
    }
  } catch (error: any) {
    console.error(`[Notification] Failed to send to ${notification.url}:`, error.message);
  }
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

  app.patch("/api/maps/:id", async (req, res) => {
    try {
      const data = insertMapSchema.partial().parse(req.body);
      const map = await storage.updateMap(req.params.id, data);
      res.json(map);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid map data', details: error.errors });
      }
      console.error('Error updating map:', error);
      res.status(500).json({ error: 'Failed to update map' });
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

  // Device routes (global devices)
  app.get("/api/devices", async (_req, res) => {
    try {
      const devices = await storage.getAllDevices();
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

  // Device Placement routes
  app.get("/api/placements/:mapId", async (req, res) => {
    try {
      const mapId = req.params.mapId;
      const placements = await storage.getPlacementsByMapId(mapId);
      res.json(placements);
    } catch (error) {
      console.error('Error fetching placements:', error);
      res.status(500).json({ error: 'Failed to fetch placements' });
    }
  });

  app.post("/api/placements", async (req, res) => {
    try {
      const data = insertDevicePlacementSchema.parse(req.body);
      
      // Check for duplicate placement (same device on same map)
      const existingPlacements = await storage.getPlacementsByMapId(data.mapId);
      const duplicatePlacement = existingPlacements.find(p => p.deviceId === data.deviceId);
      if (duplicatePlacement) {
        return res.status(400).json({ error: 'Device is already placed on this map' });
      }
      
      const placement = await storage.createPlacement(data);
      res.status(201).json(placement);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid placement data', details: error.errors });
      }
      console.error('Error creating placement:', error);
      res.status(500).json({ error: 'Failed to create placement' });
    }
  });

  app.patch("/api/placements/:id", async (req, res) => {
    try {
      const data = insertDevicePlacementSchema.partial().parse(req.body);
      const placement = await storage.updatePlacement(req.params.id, data);
      if (!placement) {
        return res.status(404).json({ error: 'Placement not found' });
      }
      res.json(placement);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid placement data', details: error.errors });
      }
      console.error('Error updating placement:', error);
      res.status(500).json({ error: 'Failed to update placement' });
    }
  });

  app.delete("/api/placements/:id", async (req, res) => {
    try {
      // Get placement to find deviceId and mapId
      const placement = await storage.getPlacement(req.params.id);
      if (!placement) {
        return res.status(404).json({ error: 'Placement not found' });
      }
      
      // Clean up connections on this map that involve this device
      const mapConnections = await storage.getConnectionsByMapId(placement.mapId);
      const connectionsToDelete = mapConnections.filter(
        conn => conn.sourceDeviceId === placement.deviceId || conn.targetDeviceId === placement.deviceId
      );
      
      for (const conn of connectionsToDelete) {
        await storage.deleteConnection(conn.id);
      }
      
      // Delete the placement
      await storage.deletePlacement(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting placement:', error);
      res.status(500).json({ error: 'Failed to delete placement' });
    }
  });

  app.post("/api/devices/:id/probe", async (req, res) => {
    try {
      const device = await storage.getDevice(req.params.id);
      if (!device) {
        return res.status(404).json({ error: 'Device not found' });
      }

      const credentials = await resolveCredentials(device);
      
      // Manual probe should always be detailed and preserve cached speeds
      const previousPorts = device.deviceData?.ports;
      const probeResult = await probeDevice(
        device.type, 
        device.ipAddress || undefined, 
        credentials,
        true, // detailedProbe - user explicitly requested probe
        previousPorts
      );
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
  app.get("/api/connections/:mapId", async (req, res) => {
    try {
      const mapId = req.params.mapId;
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

  // Notification routes
  app.get("/api/notifications", async (_req, res) => {
    try {
      const notifications = await storage.getAllNotifications();
      res.json(notifications);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  });

  app.get("/api/notifications/:id", async (req, res) => {
    try {
      const notification = await storage.getNotification(req.params.id);
      if (!notification) {
        return res.status(404).json({ error: 'Notification not found' });
      }
      res.json(notification);
    } catch (error) {
      console.error('Error fetching notification:', error);
      res.status(500).json({ error: 'Failed to fetch notification' });
    }
  });

  app.post("/api/notifications", async (req, res) => {
    try {
      const data = insertNotificationSchema.parse(req.body);
      const notification = await storage.createNotification(data);
      res.status(201).json(notification);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid notification data', details: error.errors });
      }
      console.error('Error creating notification:', error);
      res.status(500).json({ error: 'Failed to create notification' });
    }
  });

  app.patch("/api/notifications/:id", async (req, res) => {
    try {
      const data = insertNotificationSchema.partial().parse(req.body);
      const notification = await storage.updateNotification(req.params.id, data);
      if (!notification) {
        return res.status(404).json({ error: 'Notification not found' });
      }
      res.json(notification);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid notification data', details: error.errors });
      }
      console.error('Error updating notification:', error);
      res.status(500).json({ error: 'Failed to update notification' });
    }
  });

  app.delete("/api/notifications/:id", async (req, res) => {
    try {
      await storage.deleteNotification(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting notification:', error);
      res.status(500).json({ error: 'Failed to delete notification' });
    }
  });

  // Device notification assignment routes
  app.get("/api/devices/:deviceId/notifications", async (req, res) => {
    try {
      const assignments = await storage.getDeviceNotifications(req.params.deviceId);
      res.json(assignments);
    } catch (error) {
      console.error('Error fetching device notifications:', error);
      res.status(500).json({ error: 'Failed to fetch device notifications' });
    }
  });

  app.post("/api/devices/:deviceId/notifications", async (req, res) => {
    try {
      const data = insertDeviceNotificationSchema.parse({
        deviceId: req.params.deviceId,
        notificationId: req.body.notificationId,
      });
      const assignment = await storage.addDeviceNotification(data);
      res.status(201).json(assignment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid data', details: error.errors });
      }
      console.error('Error adding device notification:', error);
      res.status(500).json({ error: 'Failed to add device notification' });
    }
  });

  app.delete("/api/devices/:deviceId/notifications/:notificationId", async (req, res) => {
    try {
      await storage.removeDeviceNotification(req.params.deviceId, req.params.notificationId);
      res.status(204).send();
    } catch (error) {
      console.error('Error removing device notification:', error);
      res.status(500).json({ error: 'Failed to remove device notification' });
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
  
  async function probeDeviceWithTimeout(device: any, credentials: any, isDetailedCycle: boolean = false): Promise<ProbeResult> {
    let timeoutId: NodeJS.Timeout;
    let timedOut = false;
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        reject(new Error('Probe timeout'));
      }, PROBE_TIMEOUT_MS);
    });
    
    const probePromise = (async () => {
      // Detect link state changes for Mikrotik devices
      const previousPorts = device.deviceData?.ports || [];
      let needsDetailedProbe = isDetailedCycle;
      
      if (isDetailedCycle) {
        console.log(`[Probing] Detailed cycle for ${device.name}, will run full ethernet monitoring`);
      }
      
      // For Mikrotik devices, check if any ports transitioned from down to up
      if (device.type.startsWith('mikrotik_') && previousPorts.length > 0 && !isDetailedCycle) {
        const quickProbe = await probeDevice(device.type, device.ipAddress, credentials, false, previousPorts);
        
        if (quickProbe.success && quickProbe.data.ports) {
          // Check for down→up transitions
          for (const currentPort of quickProbe.data.ports) {
            const prevPort = previousPorts.find((p: any) => p.name === currentPort.name);
            if (prevPort && prevPort.status === 'down' && currentPort.status === 'up') {
              console.log(`[Probing] Link state change detected on ${device.name} port ${currentPort.name}: down → up, triggering detailed probe`);
              needsDetailedProbe = true;
              break;
            }
          }
        }
        
        // If we don't need detailed probe, use the quick probe result and return early
        if (!needsDetailedProbe && quickProbe.success) {
          const status = determineDeviceStatus(quickProbe.data, quickProbe.success);
          const oldStatus = device.status;
          const statusChanged = status !== oldStatus;
          
          if (status !== device.status || quickProbe.success) {
            await storage.updateDevice(device.id, {
              status,
              deviceData: quickProbe.data,
            });
            console.log(`[Probing] Updated ${device.name} (${device.ipAddress}): ${oldStatus} → ${status}`);
          }
          
          if (statusChanged) {
            try {
              const deviceNotifications = await storage.getDeviceNotifications(device.id);
              if (deviceNotifications.length > 0) {
                console.log(`[Notification] Status changed for ${device.name}: ${oldStatus} → ${status}`);
                
                for (const dn of deviceNotifications) {
                  const notification = await storage.getNotification(dn.notificationId);
                  if (notification) {
                    await sendNotification(notification, device, status, oldStatus);
                  }
                }
              }
            } catch (error: any) {
              console.error(`[Notification] Error sending notifications for ${device.name}:`, error.message);
            }
          }
          
          if (timedOut) {
            return { device, success: false, timeout: true };
          }
          
          return { device, success: quickProbe.success, timeout: false };
        }
      }
      
      // Run detailed probe if needed
      const probeResult = await probeDevice(
        device.type,
        device.ipAddress,
        credentials,
        needsDetailedProbe,
        previousPorts
      );
      
      if (timedOut) {
        return { device, success: false, timeout: true };
      }
      
      const status = determineDeviceStatus(probeResult.data, probeResult.success);
      const oldStatus = device.status;
      const statusChanged = status !== oldStatus;
      
      if (status !== device.status || probeResult.success) {
        await storage.updateDevice(device.id, {
          status,
          deviceData: probeResult.success ? probeResult.data : (device.deviceData || undefined),
        });
        console.log(`[Probing] Updated ${device.name} (${device.ipAddress}): ${oldStatus} → ${status}`);
      }
      
      // Trigger notifications only on status change
      if (statusChanged) {
        try {
          const deviceNotifications = await storage.getDeviceNotifications(device.id);
          if (deviceNotifications.length > 0) {
            console.log(`[Notification] Status changed for ${device.name}: ${oldStatus} → ${status}`);
            
            for (const dn of deviceNotifications) {
              const notification = await storage.getNotification(dn.notificationId);
              if (notification) {
                await sendNotification(notification, device, status, oldStatus);
              }
            }
          }
        } catch (error: any) {
          console.error(`[Notification] Error sending notifications for ${device.name}:`, error.message);
        }
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
  
  async function processConcurrentQueue(devices: any[], concurrency: number, isDetailedCycle: boolean = false): Promise<ProbeResult[]> {
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
            const result = await probeDeviceWithTimeout(device, credentials, isDetailedCycle);
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
  let probeCycle = 0; // Track probe cycles for detailed probing
  const DETAILED_PROBE_INTERVAL = 10; // Run detailed probe every 10 cycles (~5 minutes with 30s polling)
  
  async function startPeriodicProbing() {
    const pollingInterval = await storage.getSetting('polling_interval') || 30;
    const intervalMs = parseInt(pollingInterval) * 1000;
    
    console.log(`[Probing] Starting automatic device probing service (${pollingInterval}s interval, ${CONCURRENT_PROBES} concurrent)`);
    console.log(`[Probing] Detailed link speed probing every ${DETAILED_PROBE_INTERVAL} cycles (~${DETAILED_PROBE_INTERVAL * parseInt(pollingInterval) / 60} minutes)`);
    
    setInterval(async () => {
      if (isProbing) {
        console.warn('[Probing] Previous probe cycle still running, skipping this interval');
        return;
      }
      
      isProbing = true;
      probeCycle++;
      const startTime = Date.now();
      const isDetailedCycle = probeCycle % DETAILED_PROBE_INTERVAL === 0;
      
      try {
        const allDevices = await storage.getAllDevices();
        const devicesWithIp = allDevices.filter(d => d.ipAddress);
        
        const totalDevices = devicesWithIp.length;
        console.log(`[Probing] Starting probe cycle #${probeCycle} for ${totalDevices} devices${isDetailedCycle ? ' (DETAILED)' : ''}`);
        
        const results = await processConcurrentQueue(devicesWithIp, CONCURRENT_PROBES, isDetailedCycle);
        
        const successCount = results.filter(r => r.success).length;
        const timeoutCount = results.filter(r => r.timeout).length;
        const errorCount = results.filter(r => !r.success && !r.timeout).length;
        const successRate = totalDevices > 0 ? ((successCount / totalDevices) * 100).toFixed(1) : '0';
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        
        console.log(`[Probing] Completed cycle #${probeCycle} in ${duration}s: ${totalDevices} devices, ${successCount} success (${successRate}%), ${timeoutCount} timeout, ${errorCount} error`);
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

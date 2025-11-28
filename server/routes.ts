import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { probeDevice, determineDeviceStatus, probeInterfaceTraffic } from "./deviceProbe";
import { insertMapSchema, insertDeviceSchema, insertDevicePlacementSchema, insertConnectionSchema, insertCredentialProfileSchema, insertNotificationSchema, insertDeviceNotificationSchema, insertScanProfileSchema, type Device, type Connection } from "@shared/schema";
import { z } from "zod";

// CIDR IP range expansion utilities
function ipToLong(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function longToIp(num: number): string {
  return [(num >>> 24) & 255, (num >>> 16) & 255, (num >>> 8) & 255, num & 255].join('.');
}

function expandCidr(cidr: string): string[] {
  const ips: string[] = [];
  
  // Handle single IP
  if (!cidr.includes('/') && !cidr.includes('-')) {
    return [cidr];
  }
  
  // Handle CIDR notation (e.g., 192.168.1.0/24)
  if (cidr.includes('/')) {
    const [baseIp, prefixStr] = cidr.split('/');
    const prefix = parseInt(prefixStr);
    const baseNum = ipToLong(baseIp);
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    const network = baseNum & mask;
    const broadcast = network | (~mask >>> 0);
    
    // Skip network and broadcast for standard subnets, include all for /31 and /32
    const start = prefix >= 31 ? network : network + 1;
    const end = prefix >= 31 ? broadcast : broadcast - 1;
    
    for (let i = start; i <= end && ips.length < 65536; i++) {
      ips.push(longToIp(i));
    }
    return ips;
  }
  
  // Handle range notation (e.g., 192.168.1.1-192.168.1.254)
  if (cidr.includes('-')) {
    const [startIp, endIp] = cidr.split('-').map(s => s.trim());
    const startNum = ipToLong(startIp);
    const endNum = ipToLong(endIp);
    
    for (let i = startNum; i <= endNum && ips.length < 65536; i++) {
      ips.push(longToIp(i));
    }
    return ips;
  }
  
  return ips;
}

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

  // Log routes
  app.get("/api/logs", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 1000;
      const logs = await storage.getAllLogs(limit);
      res.json(logs);
    } catch (error) {
      console.error('Error fetching logs:', error);
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  app.get("/api/logs/device/:deviceId", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 1000;
      const logs = await storage.getLogsByDeviceId(req.params.deviceId, limit);
      res.json(logs);
    } catch (error) {
      console.error('Error fetching device logs:', error);
      res.status(500).json({ error: 'Failed to fetch device logs' });
    }
  });

  app.delete("/api/logs", async (req, res) => {
    try {
      await storage.deleteAllLogs();
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting logs:', error);
      res.status(500).json({ error: 'Failed to delete logs' });
    }
  });

  app.delete("/api/logs/device/:deviceId", async (req, res) => {
    try {
      await storage.deleteLogsByDeviceId(req.params.deviceId);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting device logs:', error);
      res.status(500).json({ error: 'Failed to delete device logs' });
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
      
      // Manual probe should always be detailed and get SNMP indices
      const previousPorts = device.deviceData?.ports;
      const probeResult = await probeDevice(
        device.type, 
        device.ipAddress || undefined, 
        credentials,
        true, // detailedProbe - user explicitly requested probe
        previousPorts,
        true  // needsSnmpIndexing - always get indices on manual probe
      );
      const status = determineDeviceStatus(probeResult.data, probeResult.success);

      const updatedDevice = await storage.updateDevice(req.params.id, {
        status,
        deviceData: probeResult.success ? probeResult.data : (device.deviceData || undefined),
      });
      
      // Update cached SNMP indices for connections monitoring this device
      if (probeResult.success && probeResult.data?.ports) {
        const monitoredConnections = await storage.getMonitoredConnections();
        for (const conn of monitoredConnections) {
          const isSource = conn.monitorInterface === 'source' && conn.sourceDeviceId === device.id;
          const isTarget = conn.monitorInterface === 'target' && conn.targetDeviceId === device.id;
          
          if (isSource || isTarget) {
            const portName = isSource ? conn.sourcePort : conn.targetPort;
            const port = probeResult.data.ports.find(p => p.name === portName);
            
            if (port?.snmpIndex && port.snmpIndex !== conn.monitorSnmpIndex) {
              console.log(`[Probe] Updating connection ${conn.id} SNMP index: ${conn.monitorSnmpIndex} -> ${port.snmpIndex}`);
              await storage.updateConnection(conn.id, { monitorSnmpIndex: port.snmpIndex });
            }
          }
        }
      }

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
      
      // If monitorInterface is set, look up and cache the SNMP index
      if (data.monitorInterface) {
        const isSource = data.monitorInterface === 'source';
        const deviceId = isSource ? data.sourceDeviceId : data.targetDeviceId;
        const portName = isSource ? data.sourcePort : data.targetPort;
        
        if (portName) {
          const device = await storage.getDevice(deviceId);
          if (device?.deviceData?.ports) {
            const port = device.deviceData.ports.find(p => p.name === portName);
            if (port?.snmpIndex) {
              data.monitorSnmpIndex = port.snmpIndex;
              console.log(`[Connection] Caching SNMP index ${port.snmpIndex} for ${portName} on new connection`);
            }
          }
        }
      }
      
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
      
      // Get the current connection to check if monitorInterface changed
      const existingConn = await storage.getConnection(req.params.id);
      if (!existingConn) {
        return res.status(404).json({ error: 'Connection not found' });
      }
      
      // If monitorInterface is being set/changed, look up the SNMP index
      if (data.monitorInterface && (data.monitorInterface !== existingConn.monitorInterface || 
          data.sourcePort !== existingConn.sourcePort || data.targetPort !== existingConn.targetPort)) {
        const isSource = data.monitorInterface === 'source';
        const deviceId = isSource ? existingConn.sourceDeviceId : existingConn.targetDeviceId;
        const portName = isSource ? (data.sourcePort || existingConn.sourcePort) : (data.targetPort || existingConn.targetPort);
        
        if (portName) {
          const device = await storage.getDevice(deviceId);
          if (device?.deviceData?.ports) {
            const port = device.deviceData.ports.find(p => p.name === portName);
            if (port?.snmpIndex) {
              data.monitorSnmpIndex = port.snmpIndex;
              console.log(`[Connection] Setting SNMP index ${port.snmpIndex} for ${portName} on connection ${req.params.id}`);
            }
          }
        }
      }
      
      // If monitorInterface is being cleared, also clear the cached index
      if (data.monitorInterface === null) {
        data.monitorSnmpIndex = null;
      }
      
      const connection = await storage.updateConnection(req.params.id, data);
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

  // Scan Profile routes
  app.get("/api/scan-profiles", async (_req, res) => {
    try {
      const profiles = await storage.getAllScanProfiles();
      res.json(profiles);
    } catch (error) {
      console.error('Error fetching scan profiles:', error);
      res.status(500).json({ error: 'Failed to fetch scan profiles' });
    }
  });

  app.get("/api/scan-profiles/:id", async (req, res) => {
    try {
      const profile = await storage.getScanProfile(req.params.id);
      if (!profile) {
        return res.status(404).json({ error: 'Scan profile not found' });
      }
      res.json(profile);
    } catch (error) {
      console.error('Error fetching scan profile:', error);
      res.status(500).json({ error: 'Failed to fetch scan profile' });
    }
  });

  app.post("/api/scan-profiles", async (req, res) => {
    try {
      const data = insertScanProfileSchema.parse(req.body);
      const profile = await storage.createScanProfile(data);
      res.status(201).json(profile);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid scan profile data', details: error.errors });
      }
      console.error('Error creating scan profile:', error);
      res.status(500).json({ error: 'Failed to create scan profile' });
    }
  });

  app.patch("/api/scan-profiles/:id", async (req, res) => {
    try {
      const data = insertScanProfileSchema.partial().parse(req.body);
      const profile = await storage.updateScanProfile(req.params.id, data);
      if (!profile) {
        return res.status(404).json({ error: 'Scan profile not found' });
      }
      res.json(profile);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid scan profile data', details: error.errors });
      }
      console.error('Error updating scan profile:', error);
      res.status(500).json({ error: 'Failed to update scan profile' });
    }
  });

  app.delete("/api/scan-profiles/:id", async (req, res) => {
    try {
      await storage.deleteScanProfile(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting scan profile:', error);
      res.status(500).json({ error: 'Failed to delete scan profile' });
    }
  });

  // Network Scanner endpoint
  const scanRequestSchema = z.object({
    ipRange: z.string(),
    credentialProfileIds: z.array(z.string()),
    probeTypes: z.array(z.enum(['mikrotik', 'snmp', 'server'])),
  });

  interface ScanResult {
    ip: string;
    status: 'success' | 'failed' | 'timeout';
    deviceType?: string;
    deviceData?: any;
    credentialProfileId?: string;
    error?: string;
  }

  app.post("/api/network-scan", async (req, res) => {
    try {
      const { ipRange, credentialProfileIds, probeTypes } = scanRequestSchema.parse(req.body);
      
      // Expand IP range
      const ips = expandCidr(ipRange);
      if (ips.length === 0) {
        return res.status(400).json({ error: 'Invalid IP range' });
      }
      
      console.log(`[Network Scan] Starting scan of ${ips.length} IPs with ${credentialProfileIds.length} credential profiles`);
      
      // Fetch credential profiles
      const credProfiles = await Promise.all(
        credentialProfileIds.map(id => storage.getCredentialProfile(id))
      );
      const validCredProfiles = credProfiles.filter(p => p !== undefined);
      
      if (validCredProfiles.length === 0) {
        return res.status(400).json({ error: 'No valid credential profiles provided' });
      }
      
      // Check which IPs already exist as devices
      const existingDevices = await storage.getAllDevices();
      const existingIPs = new Set(existingDevices.map(d => d.ipAddress).filter(Boolean));
      
      const results: ScanResult[] = [];
      const SCAN_CONCURRENCY = 40; // Concurrent probes for scanning
      const SCAN_TIMEOUT = 3000; // 3 second timeout per probe
      
      // Probe function with timeout
      const scanIP = async (ip: string): Promise<ScanResult> => {
        // Try each credential profile in order
        for (const profile of validCredProfiles) {
          const credentials = profile.credentials;
          
          // Map probe types to device types and try in order
          for (const probeType of probeTypes) {
            let deviceType: string;
            switch (probeType) {
              case 'mikrotik':
                deviceType = 'mikrotik_router';
                break;
              case 'snmp':
                deviceType = 'generic_snmp';
                break;
              case 'server':
                deviceType = 'server';
                break;
              default:
                continue; // Skip unknown probe types (validated by zod, so shouldn't happen)
            }
            
            try {
              const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Timeout')), SCAN_TIMEOUT);
              });
              
              const probePromise = probeDevice(deviceType, ip, credentials);
              const probeResult = await Promise.race([probePromise, timeoutPromise]);
              
              if (probeResult.success) {
                return {
                  ip,
                  status: 'success',
                  deviceType,
                  deviceData: probeResult.data,
                  credentialProfileId: profile.id,
                };
              }
            } catch (error: any) {
              if (error.message === 'Timeout') {
                continue; // Try next probe type
              }
              // Continue to next probe type on error
            }
          }
        }
        
        return { ip, status: 'failed' };
      };
      
      // Process in batches with concurrency control
      const queue = [...ips];
      const active: Promise<void>[] = [];
      
      while (queue.length > 0 || active.length > 0) {
        while (active.length < SCAN_CONCURRENCY && queue.length > 0) {
          const ip = queue.shift()!;
          
          const promise = (async () => {
            const result = await scanIP(ip);
            results.push(result);
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
      
      const successCount = results.filter(r => r.status === 'success').length;
      console.log(`[Network Scan] Completed: ${successCount}/${ips.length} devices discovered`);
      
      // Return results with existing device info
      const enrichedResults = results.map(r => ({
        ...r,
        alreadyExists: existingIPs.has(r.ip),
      }));
      
      res.json({
        totalScanned: ips.length,
        discovered: successCount,
        results: enrichedResults.filter(r => r.status === 'success'),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid scan request', details: error.errors });
      }
      console.error('Error during network scan:', error);
      res.status(500).json({ error: 'Network scan failed' });
    }
  });

  // Batch device creation from scan results
  const batchDeviceSchema = z.object({
    devices: z.array(z.object({
      name: z.string(),
      type: z.string(),
      ipAddress: z.string(),
      credentialProfileId: z.string().optional(),
      deviceData: z.any().optional(),
    })),
  });

  app.post("/api/devices/batch", async (req, res) => {
    try {
      const { devices } = batchDeviceSchema.parse(req.body);
      
      const createdDevices = [];
      const errors = [];
      
      for (const deviceData of devices) {
        try {
          // Check if device already exists
          const existingDevices = await storage.getAllDevices();
          const exists = existingDevices.find(d => d.ipAddress === deviceData.ipAddress);
          if (exists) {
            errors.push({ ip: deviceData.ipAddress, error: 'Device already exists' });
            continue;
          }
          
          const device = await storage.createDevice({
            name: deviceData.name,
            type: deviceData.type,
            ipAddress: deviceData.ipAddress,
            status: 'online',
            credentialProfileId: deviceData.credentialProfileId || null,
            deviceData: deviceData.deviceData || undefined,
          });
          createdDevices.push(device);
        } catch (error: any) {
          errors.push({ ip: deviceData.ipAddress, error: error.message });
        }
      }
      
      res.status(201).json({
        created: createdDevices.length,
        failed: errors.length,
        devices: createdDevices,
        errors,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid batch device data', details: error.errors });
      }
      console.error('Error creating batch devices:', error);
      res.status(500).json({ error: 'Failed to create batch devices' });
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
  
  async function probeDeviceWithTimeout(device: any, credentials: any, isDetailedCycle: boolean = false, needsSnmpIndexing: boolean = false): Promise<ProbeResult> {
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
        const quickProbe = await probeDevice(device.type, device.ipAddress, credentials, false, previousPorts, needsSnmpIndexing);
        
        if (quickProbe.success && quickProbe.data.ports) {
          // Check for down→up transitions
          // Match by defaultName first (stable identifier), then fall back to name
          for (const currentPort of quickProbe.data.ports as any[]) {
            const prevPort = previousPorts.find((p: any) => 
              (currentPort.defaultName && p.defaultName === currentPort.defaultName) || p.name === currentPort.name
            );
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
            // Create log entry for status change
            try {
              await storage.createLog({
                deviceId: device.id,
                eventType: 'status_change',
                severity: status === 'offline' ? 'error' : status === 'warning' ? 'warning' : 'info',
                message: `Device ${device.name} status changed from ${oldStatus} to ${status}`,
                oldStatus,
                newStatus: status,
              });
            } catch (error: any) {
              console.error(`[Logging] Error creating log for ${device.name}:`, error.message);
            }

            // Send notifications
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
        previousPorts,
        needsSnmpIndexing
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
      
      // Trigger notifications and logging on status change
      if (statusChanged) {
        // Create log entry for status change
        try {
          await storage.createLog({
            deviceId: device.id,
            eventType: 'status_change',
            severity: status === 'offline' ? 'error' : status === 'warning' ? 'warning' : 'info',
            message: `Device ${device.name} status changed from ${oldStatus} to ${status}`,
            oldStatus,
            newStatus: status,
          });
        } catch (error: any) {
          console.error(`[Logging] Error creating log for ${device.name}:`, error.message);
        }

        // Send notifications
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
  
  async function processConcurrentQueue(devices: any[], concurrency: number, isDetailedCycle: boolean = false, devicesNeedingSnmp: Set<string> = new Set()): Promise<ProbeResult[]> {
    const results: ProbeResult[] = [];
    const queue = [...devices];
    const active: Promise<void>[] = [];
    
    while (queue.length > 0 || active.length > 0) {
      while (active.length < concurrency && queue.length > 0) {
        const device = queue.shift()!;
        if (!device.ipAddress) continue;
        
        const needsSnmpIndexing = devicesNeedingSnmp.has(device.id);
        
        const promise = (async () => {
          try {
            const credentials = await resolveCredentials(device);
            const result = await probeDeviceWithTimeout(device, credentials, isDetailedCycle, needsSnmpIndexing);
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
  let currentPhase = ''; // Track what phase we're in for debugging
  let probeCycle = 0; // Track probe cycles for detailed probing
  const DETAILED_PROBE_INTERVAL = 10; // Run detailed probe every 10 cycles (~5 minutes with 30s polling)
  
  async function startPeriodicProbing() {
    const pollingInterval = await storage.getSetting('polling_interval') || 30;
    const intervalMs = parseInt(pollingInterval) * 1000;
    
    console.log(`[Probing] Starting automatic device probing service (${pollingInterval}s interval, ${CONCURRENT_PROBES} concurrent)`);
    console.log(`[Probing] Detailed link speed probing every ${DETAILED_PROBE_INTERVAL} cycles (~${DETAILED_PROBE_INTERVAL * parseInt(pollingInterval) / 60} minutes)`);
    
    setInterval(async () => {
      if (isProbing) {
        const elapsed = currentPhase ? ` (stuck in: ${currentPhase})` : '';
        console.warn(`[Probing] Previous probe cycle still running, skipping this interval${elapsed}`);
        return;
      }
      
      isProbing = true;
      currentPhase = 'init';
      probeCycle++;
      const startTime = Date.now();
      const isDetailedCycle = probeCycle % DETAILED_PROBE_INTERVAL === 0;
      
      try {
        currentPhase = 'fetching devices';
        const allDevices = await storage.getAllDevices();
        const devicesWithIp = allDevices.filter(d => d.ipAddress);
        
        // Build set of device IDs that have monitored connections (need SNMP indexing)
        const monitoredConnections = await storage.getMonitoredConnections();
        const devicesNeedingSnmp = new Set<string>();
        for (const conn of monitoredConnections) {
          if (conn.monitorInterface === 'source') {
            devicesNeedingSnmp.add(conn.sourceDeviceId);
          } else if (conn.monitorInterface === 'target') {
            devicesNeedingSnmp.add(conn.targetDeviceId);
          }
        }
        
        const totalDevices = devicesWithIp.length;
        const snmpDeviceCount = devicesNeedingSnmp.size;
        console.log(`[Probing] Starting probe cycle #${probeCycle} for ${totalDevices} devices${isDetailedCycle ? ' (DETAILED)' : ''}, ${snmpDeviceCount} need SNMP indexing`);
        
        currentPhase = 'device probing';
        const results = await processConcurrentQueue(devicesWithIp, CONCURRENT_PROBES, isDetailedCycle, devicesNeedingSnmp);
        
        const successCount = results.filter(r => r.success).length;
        const timeoutCount = results.filter(r => r.timeout).length;
        const errorCount = results.filter(r => !r.success && !r.timeout).length;
        const successRate = totalDevices > 0 ? ((successCount / totalDevices) * 100).toFixed(1) : '0';
        const deviceDuration = ((Date.now() - startTime) / 1000).toFixed(1);
        
        console.log(`[Probing] Cycle #${probeCycle} complete in ${deviceDuration}s: ${totalDevices} devices, ${successCount} success (${successRate}%), ${timeoutCount} timeout, ${errorCount} error`);
      } catch (error) {
        console.error('[Probing] Error in periodic probing:', error);
      } finally {
        currentPhase = '';
        isProbing = false;
      }
    }, intervalMs);
  }
  
  // Traffic monitoring for connections with monitorInterface set
  const TRAFFIC_CONCURRENT_PROBES = 40; // Parallel traffic probes
  const TRAFFIC_PROBE_TIMEOUT = 30000; // 30 second timeout per traffic probe (must be > 25s SNMP walk timeout)
  
  async function probeConnectionTraffic(allDevices: Device[]) {
    try {
      const monitoredConnections = await storage.getMonitoredConnections();
      if (monitoredConnections.length === 0) return;
      
      console.log(`[Traffic] Probing ${monitoredConnections.length} monitored connections (${TRAFFIC_CONCURRENT_PROBES} concurrent)`);
      
      // Build device lookup map
      const deviceMap = new Map(allDevices.map(d => [d.id, d]));
      
      // Process connections in parallel with bounded concurrency
      const queue = [...monitoredConnections];
      const active: Promise<void>[] = [];
      let successCount = 0;
      let errorCount = 0;
      let timeoutCount = 0;
      
      while (queue.length > 0 || active.length > 0) {
        // Fill up to concurrency limit
        while (active.length < TRAFFIC_CONCURRENT_PROBES && queue.length > 0) {
          const conn = queue.shift()!;
          
          const promise = (async () => {
            try {
              const success = await probeSingleConnection(conn, deviceMap);
              if (success) {
                successCount++;
              } else {
                errorCount++;
              }
            } catch (error: any) {
              if (error.message?.includes('timeout')) {
                timeoutCount++;
              } else {
                errorCount++;
              }
            }
          })();
          
          // Wrap with timeout
          const device = deviceMap.get(conn.monitorInterface === 'source' ? conn.sourceDeviceId : conn.targetDeviceId);
          const portName = conn.monitorInterface === 'source' ? conn.sourcePort : conn.targetPort;
          const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error('Traffic probe timeout')), TRAFFIC_PROBE_TIMEOUT);
          });
          
          const wrappedPromise = Promise.race([promise, timeoutPromise]).catch(() => {
            console.warn(`[Traffic] TIMEOUT ${portName}@${device?.ipAddress || 'unknown'} after ${TRAFFIC_PROBE_TIMEOUT/1000}s`);
            timeoutCount++;
          });
          
          active.push(wrappedPromise as Promise<void>);
          wrappedPromise.finally(() => {
            const index = active.indexOf(wrappedPromise as Promise<void>);
            if (index > -1) active.splice(index, 1);
          });
        }
        
        if (active.length > 0) {
          await Promise.race(active);
        }
      }
      
      console.log(`[Traffic] Completed: ${successCount} success, ${timeoutCount} timeout, ${errorCount} error`);
    } catch (error: any) {
      console.error('[Traffic] Error in traffic monitoring:', error.message);
    }
  }
  
  // Probe a single connection for traffic stats
  // Returns true if successful, false if failed (for counting purposes)
  async function probeSingleConnection(conn: Connection, deviceMap: Map<string, Device>): Promise<boolean> {
    // Determine which device and port to monitor
    const isSource = conn.monitorInterface === 'source';
    const deviceId = isSource ? conn.sourceDeviceId : conn.targetDeviceId;
    const portName = isSource ? conn.sourcePort : conn.targetPort;
    
    if (!portName) {
      return true; // Skip - no port configured (not counted as failure)
    }
    
    const device = deviceMap.get(deviceId);
    if (!device || !device.ipAddress) {
      return true; // Skip - device not available (not counted as failure)
    }
    
    // Get credentials for the device
    const credentials = await resolveCredentials(device);
    
    // Use cached SNMP index from connection (fast path) or fall back to device port lookup
    let snmpIndex = conn.monitorSnmpIndex ?? undefined;
    
    // If no cached index, try to get from device ports as fallback
    if (snmpIndex === undefined) {
      const port = device.deviceData?.ports?.find(p => p.name === portName);
      snmpIndex = port?.snmpIndex;
      
      // If we found an index, cache it on the connection for next time
      if (snmpIndex !== undefined) {
        await storage.updateConnection(conn.id, { monitorSnmpIndex: snmpIndex });
      }
    }
    
    // Probe interface traffic (fast if we have cached index)
    let result = await probeInterfaceTraffic(device.ipAddress, portName, credentials, snmpIndex);
    
    // Handle stale SNMP index - if we got noSuchName/noSuchInstance error with a cached index,
    // the index is stale. Clear it and retry with a walk to get fresh index.
    if (!result.success && snmpIndex !== undefined && result.error?.includes('noSuch')) {
      console.log(`[Traffic] Stale SNMP index ${snmpIndex} for ${portName}, clearing and retrying with walk`);
      await storage.updateConnection(conn.id, { monitorSnmpIndex: null });
      
      // Retry without cached index (will do SNMP walk)
      result = await probeInterfaceTraffic(device.ipAddress, portName, credentials, undefined);
    }
    
    // If probe returned a new index (from SNMP walk), cache it
    if (result.success && result.data?.ifIndex && result.data.ifIndex !== snmpIndex) {
      await storage.updateConnection(conn.id, { monitorSnmpIndex: result.data.ifIndex });
    }
    
    // Check for stale data - if last sample is more than 2 minutes old, reset rates
    const STALE_THRESHOLD_MS = 120000; // 2 minutes
    const previousStats = conn.linkStats;
    if (previousStats?.lastSampleAt) {
      const lastSampleTime = new Date(previousStats.lastSampleAt).getTime();
      const isStale = Date.now() - lastSampleTime > STALE_THRESHOLD_MS;
      
      if (isStale && !result.success) {
        // Data is stale and we can't get fresh data - reset rates to zero
        await storage.updateConnection(conn.id, {
          linkStats: {
            ...previousStats,
            inBytesPerSec: 0,
            outBytesPerSec: 0,
            inBitsPerSec: 0,
            outBitsPerSec: 0,
            utilizationPct: 0,
            isStale: true,
          },
        });
        return false; // Probe failed
      }
    }
    
    // If probe wasn't successful, return false
    if (!result.success) {
      return false;
    }
    
    if (result.success && result.data) {
      const counters = result.data;
      const previousStats = conn.linkStats;
      
      // Calculate rates if we have previous data
      let inBytesPerSec = 0;
      let outBytesPerSec = 0;
      
      // Validate current counters are valid numbers
      const currentInValid = typeof counters.inOctets === 'number' && !isNaN(counters.inOctets);
      const currentOutValid = typeof counters.outOctets === 'number' && !isNaN(counters.outOctets);
      
      if (!currentInValid || !currentOutValid) {
        console.warn(`[Traffic] Invalid counter values for connection ${conn.id}: in=${counters.inOctets}, out=${counters.outOctets}`);
      }
      
      // First sample - no logging needed, just store counters
      
      if (currentInValid && currentOutValid && previousStats?.previousInOctets !== undefined && 
          previousStats?.previousOutOctets !== undefined &&
          previousStats?.previousSampleAt &&
          typeof previousStats.previousInOctets === 'number' && !isNaN(previousStats.previousInOctets) &&
          typeof previousStats.previousOutOctets === 'number' && !isNaN(previousStats.previousOutOctets)) {
        const prevTimestamp = new Date(previousStats.previousSampleAt).getTime();
        const timeDeltaSec = (counters.timestamp - prevTimestamp) / 1000;
        
        if (timeDeltaSec > 0 && timeDeltaSec < 300) { // Ignore stale samples > 5 minutes
          // Handle counter wrap (32-bit counters can wrap around)
          const MAX_32BIT = 4294967295;
          let inDelta = counters.inOctets - previousStats.previousInOctets;
          let outDelta = counters.outOctets - previousStats.previousOutOctets;
          
          // Handle wrap-around for 32-bit counters
          if (inDelta < 0) inDelta += MAX_32BIT;
          if (outDelta < 0) outDelta += MAX_32BIT;
          
          // Calculate rates
          const rawInRate = inDelta / timeDeltaSec;
          const rawOutRate = outDelta / timeDeltaSec;
          
          // Sanity check: clamp rates to reasonable max (100Gbps = 12.5GB/s)
          const MAX_RATE = 12500000000; // 100Gbps in bytes/sec
          if (!isNaN(rawInRate) && !isNaN(rawOutRate) && rawInRate <= MAX_RATE && rawOutRate <= MAX_RATE) {
            inBytesPerSec = Math.round(rawInRate);
            outBytesPerSec = Math.round(rawOutRate);
          } else if (isNaN(rawInRate) || isNaN(rawOutRate)) {
            console.warn(`[Traffic] FAILED rate calc ${conn.id}: NaN (counters: in=${counters.inOctets}, out=${counters.outOctets}, prev: in=${previousStats.previousInOctets}, out=${previousStats.previousOutOctets})`);
          } else {
            // Counter reset or wrap issue - skip this sample
            console.warn(`[Traffic] FAILED rate calc ${conn.id}: sanity check (in=${rawInRate}, out=${rawOutRate})`);
          }
        }
      }
      
      // Calculate utilization based on link speed
      const linkSpeedBps = parseLinkSpeed(conn.linkSpeed || '1G');
      const maxBytesPerSec = linkSpeedBps / 8;
      const utilizationPct = maxBytesPerSec > 0 
        ? Math.min(100, Math.round(((inBytesPerSec + outBytesPerSec) / (2 * maxBytesPerSec)) * 100))
        : 0;
      
      // Update connection with traffic stats
      const updatedStats = {
        inBytesPerSec,
        outBytesPerSec,
        inBitsPerSec: inBytesPerSec * 8,
        outBitsPerSec: outBytesPerSec * 8,
        utilizationPct,
        lastSampleAt: new Date().toISOString(),
        previousInOctets: counters.inOctets,
        previousOutOctets: counters.outOctets,
        previousSampleAt: new Date(counters.timestamp).toISOString(),
        isStale: false, // Clear stale flag on successful update
      };
      await storage.updateConnection(conn.id, { linkStats: updatedStats });
    }
    
    return true; // Success
  }
  
  // Parse link speed string to bits per second
  function parseLinkSpeed(speed: string): number {
    const match = speed.match(/^(\d+)(G|M|K)?$/i);
    if (!match) return 1000000000; // Default 1Gbps
    
    const value = parseInt(match[1]);
    const unit = (match[2] || 'G').toUpperCase();
    
    switch (unit) {
      case 'G': return value * 1000000000;
      case 'M': return value * 1000000;
      case 'K': return value * 1000;
      default: return value * 1000000000;
    }
  }
  
  // Start separate traffic polling loop (10s interval, independent of device probing)
  let isPollingTraffic = false;
  let trafficCycle = 0;
  const TRAFFIC_POLLING_INTERVAL = 10000; // 10 seconds
  
  async function startTrafficPolling() {
    console.log(`[Traffic] Starting traffic polling service (${TRAFFIC_POLLING_INTERVAL / 1000}s interval, ${TRAFFIC_CONCURRENT_PROBES} concurrent)`);
    
    setInterval(async () => {
      if (isPollingTraffic) {
        console.warn('[Traffic] Previous traffic cycle still running, skipping');
        return;
      }
      
      isPollingTraffic = true;
      trafficCycle++;
      const startTime = Date.now();
      
      try {
        const allDevices = await storage.getAllDevices();
        await probeConnectionTraffic(allDevices);
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        // Only log completion for non-empty cycles
        const monitoredCount = (await storage.getMonitoredConnections()).length;
        if (monitoredCount > 0) {
          console.log(`[Traffic] Cycle #${trafficCycle} complete in ${duration}s`);
        }
      } catch (error: any) {
        console.error('[Traffic] Error in traffic polling:', error.message);
      } finally {
        isPollingTraffic = false;
      }
    }, TRAFFIC_POLLING_INTERVAL);
  }
  
  startPeriodicProbing();
  startTrafficPolling();

  const httpServer = createServer(app);
  return httpServer;
}

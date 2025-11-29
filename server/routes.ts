import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { probeDevice, determineDeviceStatus, probeInterfaceTraffic } from "./deviceProbe";
import { insertMapSchema, insertDeviceSchema, insertDevicePlacementSchema, insertConnectionSchema, insertCredentialProfileSchema, insertNotificationSchema, insertDeviceNotificationSchema, insertScanProfileSchema, insertUserSchema, type Device, type Connection } from "@shared/schema";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { 
  setupSession, 
  requireAuth, 
  requireRole, 
  requireAdmin, 
  canModify,
  hashPassword, 
  verifyPassword, 
  seedDefaultAdmin,
  getUserSafeData,
  type AuthenticatedRequest 
} from "./auth";

const BACKUP_DIR = path.join(process.cwd(), "backups");

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

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
  // Setup session middleware
  setupSession(app);
  
  // Seed default admin user
  await seedDefaultAdmin();

  // ========== AUTHENTICATION ROUTES ==========
  
  // Login
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
      }
      
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: 'Invalid username or password' });
      }
      
      const isValid = await verifyPassword(password, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({ message: 'Invalid username or password' });
      }
      
      // Update last login
      await storage.updateUserLastLogin(user.id);
      
      // Set session
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.role = user.role;
      
      res.json({ user: getUserSafeData(user) });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ message: 'Login failed' });
    }
  });
  
  // Logout
  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({ message: 'Logout failed' });
      }
      res.clearCookie('connect.sid');
      res.json({ message: 'Logged out successfully' });
    });
  });
  
  // Get current session
  app.get("/api/auth/session", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ message: 'User not found' });
    }
    
    res.json({ user: getUserSafeData(user) });
  });

  // ========== USER MANAGEMENT ROUTES (Admin only) ==========
  
  // Get all users
  app.get("/api/users", requireAdmin as any, async (_req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users.map(getUserSafeData));
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({ message: 'Failed to fetch users' });
    }
  });
  
  // Create user
  app.post("/api/users", requireAdmin as any, async (req, res) => {
    try {
      const { password, ...userData } = req.body;
      
      if (!password || password.length < 4) {
        return res.status(400).json({ message: 'Password must be at least 4 characters' });
      }
      
      const existingUser = await storage.getUserByUsername(userData.username);
      if (existingUser) {
        return res.status(400).json({ message: 'Username already exists' });
      }
      
      const passwordHash = await hashPassword(password);
      const user = await storage.createUser({
        ...userData,
        passwordHash,
      });
      
      res.status(201).json(getUserSafeData(user));
    } catch (error) {
      console.error('Error creating user:', error);
      res.status(500).json({ message: 'Failed to create user' });
    }
  });
  
  // Update user
  app.patch("/api/users/:id", requireAdmin as any, async (req: AuthenticatedRequest, res) => {
    try {
      const { password, ...updateData } = req.body;
      
      // Prevent deleting the last admin
      if (updateData.role && updateData.role !== 'admin') {
        const users = await storage.getAllUsers();
        const admins = users.filter(u => u.role === 'admin');
        const targetUser = await storage.getUser(req.params.id);
        if (targetUser?.role === 'admin' && admins.length <= 1) {
          return res.status(400).json({ message: 'Cannot remove the last admin' });
        }
      }
      
      // If password provided, hash it
      if (password) {
        if (password.length < 4) {
          return res.status(400).json({ message: 'Password must be at least 4 characters' });
        }
        updateData.passwordHash = await hashPassword(password);
      }
      
      const user = await storage.updateUser(req.params.id, updateData);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      res.json(getUserSafeData(user));
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({ message: 'Failed to update user' });
    }
  });
  
  // Delete user
  app.delete("/api/users/:id", requireAdmin as any, async (req: AuthenticatedRequest, res) => {
    try {
      // Prevent deleting yourself
      if (req.user?.id === req.params.id) {
        return res.status(400).json({ message: 'Cannot delete your own account' });
      }
      
      // Prevent deleting the last admin
      const users = await storage.getAllUsers();
      const targetUser = await storage.getUser(req.params.id);
      if (targetUser?.role === 'admin') {
        const admins = users.filter(u => u.role === 'admin');
        if (admins.length <= 1) {
          return res.status(400).json({ message: 'Cannot delete the last admin' });
        }
      }
      
      await storage.deleteUser(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({ message: 'Failed to delete user' });
    }
  });
  
  // Change own password
  app.post("/api/auth/change-password", requireAuth as any, async (req: AuthenticatedRequest, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'Current and new password are required' });
      }
      
      if (newPassword.length < 4) {
        return res.status(400).json({ message: 'New password must be at least 4 characters' });
      }
      
      const user = await storage.getUser(req.user!.id);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      const isValid = await verifyPassword(currentPassword, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({ message: 'Current password is incorrect' });
      }
      
      const passwordHash = await hashPassword(newPassword);
      await storage.updateUser(user.id, { passwordHash });
      
      res.json({ message: 'Password changed successfully' });
    } catch (error) {
      console.error('Error changing password:', error);
      res.status(500).json({ message: 'Failed to change password' });
    }
  });

  // ========== MAP ROUTES ==========

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
      const mapId = req.params.id;
      // Clean up traffic history for all connections on this map before deleting
      const mapConnections = await storage.getConnectionsByMapId(mapId);
      for (const conn of mapConnections) {
        trafficHistory.delete(conn.id);
      }
      await storage.deleteMap(mapId);
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
        // Clean up traffic history for this connection
        trafficHistory.delete(conn.id);
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
      // Add 20-second timeout to prevent hanging forever when SNMP doesn't respond
      const previousPorts = device.deviceData?.ports;
      const MANUAL_PROBE_TIMEOUT = 20000; // 20 seconds for manual probe
      
      let probeResult: { success: boolean; data?: any; error?: string };
      try {
        const probePromise = probeDevice(
          device.type, 
          device.ipAddress || undefined, 
          credentials,
          true, // detailedProbe - user explicitly requested probe
          previousPorts,
          true  // needsSnmpIndexing - always get indices on manual probe
        );
        
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Probe timed out after 20 seconds')), MANUAL_PROBE_TIMEOUT);
        });
        
        probeResult = await Promise.race([probePromise, timeoutPromise]);
      } catch (timeoutError: any) {
        console.warn(`[Probe] Manual probe timeout for ${device.name}: ${timeoutError.message}`);
        probeResult = { success: false, error: timeoutError.message };
      }
      
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
            const port = probeResult.data.ports.find((p: any) => p.name === portName);
            
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
      
      // If monitorInterface is being set/changed, CLEAR the cached SNMP index 
      // to force a fresh SNMP walk on next traffic probe. This is necessary because:
      // 1. Mikrotik ifindex != SNMP ifIndex (they are separate numbering schemes)
      // 2. The stored portName uses defaultName, not custom name
      // 3. The SNMP walk will find the correct ifIndex by matching interface name
      if (data.monitorInterface && (data.monitorInterface !== existingConn.monitorInterface || 
          data.sourcePort !== existingConn.sourcePort || data.targetPort !== existingConn.targetPort)) {
        data.monitorSnmpIndex = null; // Clear cached index to force fresh walk
        const isSource = data.monitorInterface === 'source';
        const portName = isSource ? (data.sourcePort || existingConn.sourcePort) : (data.targetPort || existingConn.targetPort);
        console.log(`[Connection] Cleared SNMP index for ${portName} on connection ${req.params.id} (interface changed)`);
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
      const connectionId = req.params.id;
      await storage.deleteConnection(connectionId);
      // Clean up traffic history for this connection
      trafficHistory.delete(connectionId);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting connection:', error);
      res.status(500).json({ error: 'Failed to delete connection' });
    }
  });

  // Reset SNMP index to force a fresh walk on next traffic probe
  app.post("/api/connections/:id/reset-snmp-index", async (req, res) => {
    try {
      const connection = await storage.getConnection(req.params.id);
      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }
      
      // Clear the cached SNMP index and link stats
      const updated = await storage.updateConnection(req.params.id, { 
        monitorSnmpIndex: null,
        linkStats: undefined 
      });
      
      console.log(`[Connection] Reset SNMP index for connection ${req.params.id} (manual refresh)`);
      res.json(updated);
    } catch (error) {
      console.error('Error resetting SNMP index:', error);
      res.status(500).json({ error: 'Failed to reset SNMP index' });
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
    
    // Look up the port in device data to get stored snmpIndex (from SNMP walk during device probe)
    // Port lookup needs to handle both name (custom name) and defaultName (original name like sfp28-1)
    const port = device.deviceData?.ports?.find(p => 
      p.name === portName || p.defaultName === portName
    );
    
    // Get stored snmpIndex for direct OID construction (preferred method)
    const storedSnmpIndex = port?.snmpIndex;
    
    // Log what we're about to probe for debugging
    const hasIndex = storedSnmpIndex !== undefined;
    console.log(`[Traffic] PROBE conn=${conn.id.slice(0,8)} monitorIface=${conn.monitorInterface} -> ${portName}@${device.ipAddress} (${device.name}) ${hasIndex ? `idx=${storedSnmpIndex}` : 'walk'}`);
    
    // Probe interface traffic using stored snmpIndex (fast) or SNMP walk (slow fallback)
    let result = await probeInterfaceTraffic(
      device.ipAddress, 
      portName, 
      credentials, 
      conn.monitorSnmpIndex ?? undefined, // Use cached connection index as secondary option
      hasIndex ? { snmpIndex: storedSnmpIndex } : undefined
    );
    
    // If probe was successful and returned an ifIndex, cache it on the connection for future use
    // This helps when device ports don't have stored indexes (e.g., non-Mikrotik devices)
    if (result.success && result.data?.ifIndex !== undefined) {
      const newIfIndex = result.data.ifIndex;
      if (conn.monitorSnmpIndex !== newIfIndex) {
        // Update the connection's cached SNMP index
        await storage.updateConnection(conn.id, { monitorSnmpIndex: newIfIndex });
        console.log(`[Traffic] Cached SNMP index ${newIfIndex} for connection ${conn.id.slice(0,8)}`);
      }
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
      
      // Debug: Check why we might skip rate calculation
      const hasPrevIn = previousStats?.previousInOctets !== undefined;
      const hasPrevOut = previousStats?.previousOutOctets !== undefined;
      const hasPrevAt = !!previousStats?.previousSampleAt;
      
      // Remove verbose debug logging - keep only rate calculations
      
      if (currentInValid && currentOutValid && hasPrevIn && hasPrevOut && hasPrevAt &&
          typeof previousStats.previousInOctets === 'number' && !isNaN(previousStats.previousInOctets) &&
          typeof previousStats.previousOutOctets === 'number' && !isNaN(previousStats.previousOutOctets)) {
        const prevTimestamp = new Date(previousStats.previousSampleAt!).getTime();
        const timeDeltaSec = (counters.timestamp - prevTimestamp) / 1000;
        
        // Debug: log raw calculation values with device IP for identification
        const inDeltaDebug = counters.inOctets - previousStats.previousInOctets;
        const outDeltaDebug = counters.outOctets - previousStats.previousOutOctets;
        console.log(`[Traffic] DEBUG ${portName}@${device.ipAddress}: timeDelta=${timeDeltaSec.toFixed(2)}s, inDelta=${inDeltaDebug}, outDelta=${outDeltaDebug}, inRate=${(inDeltaDebug/timeDeltaSec*8/1000000).toFixed(2)}Mbps, outRate=${(outDeltaDebug/timeDeltaSec*8/1000000).toFixed(2)}Mbps`);
        
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
      console.log(`[Traffic] SAVE ${portName}: in=${updatedStats.inBitsPerSec}, out=${updatedStats.outBitsPerSec}, util=${updatedStats.utilizationPct}%`);
      const updated = await storage.updateConnection(conn.id, { linkStats: updatedStats });
      if (!updated) {
        console.error(`[Traffic] FAILED to update connection ${conn.id} linkStats!`);
      } else {
        // Record to history for bandwidth graphs (always record successful samples for consistent graphing)
        addTrafficHistoryPoint(conn.id, {
          timestamp: Date.now(),
          inBitsPerSec: updatedStats.inBitsPerSec,
          outBitsPerSec: updatedStats.outBitsPerSec,
          utilizationPct: updatedStats.utilizationPct,
        });
      }
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
  
  // Traffic history storage for bandwidth graphs
  // Stores last 5 minutes of traffic data per connection (30 samples at 10s intervals)
  interface TrafficHistoryPoint {
    timestamp: number;
    inBitsPerSec: number;
    outBitsPerSec: number;
    utilizationPct: number;
  }
  
  const TRAFFIC_HISTORY_MAX_POINTS = 30; // 5 minutes of data at 10s intervals
  const trafficHistory: Map<string, TrafficHistoryPoint[]> = new Map();
  
  // Helper to add a data point to traffic history
  function addTrafficHistoryPoint(connectionId: string, point: TrafficHistoryPoint) {
    let history = trafficHistory.get(connectionId);
    if (!history) {
      history = [];
      trafficHistory.set(connectionId, history);
    }
    history.push(point);
    // Keep only the last N points
    while (history.length > TRAFFIC_HISTORY_MAX_POINTS) {
      history.shift();
    }
  }
  
  // API endpoint to get traffic history for a connection
  app.get("/api/connections/:id/traffic-history", async (req, res) => {
    try {
      const connectionId = req.params.id;
      const history = trafficHistory.get(connectionId) || [];
      res.json(history);
    } catch (error) {
      console.error('Error fetching traffic history:', error);
      res.status(500).json({ error: 'Failed to fetch traffic history' });
    }
  });
  
  // Start separate traffic polling loop (10s interval, independent of device probing)
  let isPollingTraffic = false;
  let trafficCycleCompleted = 0; // Tracks completed cycles (not started)
  let trafficCycle = 0;
  const TRAFFIC_POLLING_INTERVAL = 10000; // 10 seconds
  
  async function runTrafficCycle() {
    if (isPollingTraffic) {
      // Only log skip warning after first cycle has completed (not during initial slow SNMP walk)
      if (trafficCycleCompleted > 0) {
        console.warn('[Traffic] Previous cycle still running, skipping');
      }
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
      trafficCycleCompleted++;
    }
  }
  
  async function startTrafficPolling() {
    console.log(`[Traffic] Starting traffic polling service (${TRAFFIC_POLLING_INTERVAL / 1000}s interval, ${TRAFFIC_CONCURRENT_PROBES} concurrent)`);
    
    // Run first cycle immediately, then schedule subsequent cycles
    runTrafficCycle();
    setInterval(runTrafficCycle, TRAFFIC_POLLING_INTERVAL);
  }
  
  // ============ BACKUP/RESTORE ROUTES ============
  
  // Create a backup of all data
  app.post("/api/backups", async (req, res) => {
    try {
      const type = req.body.type || 'manual';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `backup-${timestamp}.json`;
      const filePath = path.join(BACKUP_DIR, filename);
      
      // Gather all data
      const [
        maps,
        devices,
        allPlacements,
        allConnections,
        credentialProfiles,
        notifications,
        scanProfiles,
        settingsData,
      ] = await Promise.all([
        storage.getAllMaps(),
        storage.getAllDevices(),
        // Get placements for all maps
        storage.getAllMaps().then(async maps => {
          const placements = [];
          for (const map of maps) {
            const mapPlacements = await storage.getPlacementsByMapId(map.id);
            placements.push(...mapPlacements);
          }
          return placements;
        }),
        // Get connections for all maps
        storage.getAllMaps().then(async maps => {
          const connections = [];
          for (const map of maps) {
            const mapConnections = await storage.getConnectionsByMapId(map.id);
            connections.push(...mapConnections);
          }
          return connections;
        }),
        storage.getAllCredentialProfiles(),
        storage.getAllNotifications(),
        storage.getAllScanProfiles(),
        // Get all settings
        Promise.all([
          storage.getSetting('polling_interval'),
          storage.getSetting('backup_schedule'),
          storage.getSetting('backup_retention'),
        ]).then(([polling, schedule, retention]) => ({
          polling_interval: polling,
          backup_schedule: schedule,
          backup_retention: retention,
        })),
      ]);
      
      // Get device notifications for each device
      const deviceNotifications = [];
      for (const device of devices) {
        const dn = await storage.getDeviceNotifications(device.id);
        deviceNotifications.push(...dn);
      }
      
      const backupData = {
        version: '1.0',
        createdAt: new Date().toISOString(),
        data: {
          maps,
          devices,
          placements: allPlacements,
          connections: allConnections,
          credentialProfiles,
          notifications,
          deviceNotifications,
          scanProfiles,
          settings: settingsData,
        },
      };
      
      // Write to file
      const jsonContent = JSON.stringify(backupData, null, 2);
      fs.writeFileSync(filePath, jsonContent, 'utf8');
      
      const sizeBytes = Buffer.byteLength(jsonContent, 'utf8');
      
      // Create backup record
      const backup = await storage.createBackup({
        filename,
        filePath,
        sizeBytes,
        type: type as 'manual' | 'scheduled',
        status: 'completed',
        metadata: {
          deviceCount: devices.length,
          mapCount: maps.length,
          connectionCount: allConnections.length,
          credentialProfileCount: credentialProfiles.length,
          version: '1.0',
        },
      });
      
      console.log(`[Backup] Created ${type} backup: ${filename} (${(sizeBytes / 1024).toFixed(1)} KB)`);
      
      // Log the backup
      await storage.createLog({
        eventType: 'backup_created',
        severity: 'info',
        message: `${type === 'manual' ? 'Manual' : 'Scheduled'} backup created: ${filename}`,
        metadata: { backupId: backup.id, sizeBytes },
      });
      
      res.json(backup);
    } catch (error: any) {
      console.error('Error creating backup:', error);
      res.status(500).json({ error: 'Failed to create backup', details: error.message });
    }
  });
  
  // List all backups
  app.get("/api/backups", async (_req, res) => {
    try {
      const backups = await storage.getAllBackups();
      res.json(backups);
    } catch (error) {
      console.error('Error fetching backups:', error);
      res.status(500).json({ error: 'Failed to fetch backups' });
    }
  });
  
  // Download a backup file
  app.get("/api/backups/:id/download", async (req, res) => {
    try {
      const backup = await storage.getBackup(req.params.id);
      if (!backup) {
        return res.status(404).json({ error: 'Backup not found' });
      }
      
      if (!fs.existsSync(backup.filePath)) {
        return res.status(404).json({ error: 'Backup file not found on disk' });
      }
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${backup.filename}"`);
      res.sendFile(backup.filePath);
    } catch (error) {
      console.error('Error downloading backup:', error);
      res.status(500).json({ error: 'Failed to download backup' });
    }
  });
  
  // Delete a backup
  app.delete("/api/backups/:id", async (req, res) => {
    try {
      const backup = await storage.getBackup(req.params.id);
      if (!backup) {
        return res.status(404).json({ error: 'Backup not found' });
      }
      
      // Delete the file if it exists
      if (fs.existsSync(backup.filePath)) {
        fs.unlinkSync(backup.filePath);
      }
      
      // Delete the database record
      await storage.deleteBackup(req.params.id);
      
      console.log(`[Backup] Deleted backup: ${backup.filename}`);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting backup:', error);
      res.status(500).json({ error: 'Failed to delete backup' });
    }
  });
  
  // Restore from a backup (by ID)
  app.post("/api/backups/:id/restore", async (req, res) => {
    try {
      const backup = await storage.getBackup(req.params.id);
      if (!backup) {
        return res.status(404).json({ error: 'Backup not found' });
      }
      
      if (!fs.existsSync(backup.filePath)) {
        return res.status(404).json({ error: 'Backup file not found on disk' });
      }
      
      const fileContent = fs.readFileSync(backup.filePath, 'utf8');
      const backupData = JSON.parse(fileContent);
      
      await performRestore(backupData);
      
      console.log(`[Backup] Restored from backup: ${backup.filename}`);
      
      await storage.createLog({
        eventType: 'backup_restored',
        severity: 'info',
        message: `Restored from backup: ${backup.filename}`,
        metadata: { backupId: backup.id },
      });
      
      res.json({ success: true, message: 'Backup restored successfully' });
    } catch (error: any) {
      console.error('Error restoring backup:', error);
      res.status(500).json({ error: 'Failed to restore backup', details: error.message });
    }
  });
  
  // Restore from uploaded file
  app.post("/api/restore", async (req, res) => {
    try {
      const backupData = req.body;
      
      if (!backupData || !backupData.data) {
        return res.status(400).json({ error: 'Invalid backup data format' });
      }
      
      await performRestore(backupData);
      
      console.log(`[Backup] Restored from uploaded file`);
      
      await storage.createLog({
        eventType: 'backup_restored',
        severity: 'info',
        message: 'Restored from uploaded backup file',
      });
      
      res.json({ success: true, message: 'Backup restored successfully' });
    } catch (error: any) {
      console.error('Error restoring backup:', error);
      res.status(500).json({ error: 'Failed to restore backup', details: error.message });
    }
  });
  
  // Helper function to perform restore with full data integrity
  async function performRestore(backupData: any) {
    const { data, version } = backupData;
    
    // Basic validation
    if (!data) {
      throw new Error('Invalid backup: missing data field');
    }
    
    // Clear traffic history before restore
    trafficHistory.clear();
    
    // Clear existing data in reverse dependency order
    // 1. Clear connections (depends on placements)
    // 2. Clear placements (depends on devices, maps)
    // 3. Clear device notifications (depends on devices, notifications)
    // 4. Clear devices (depends on credential profiles)
    // 5. Clear maps
    // 6. Clear notifications
    // 7. Clear scan profiles
    // 8. Clear credential profiles
    
    console.log('[Restore] Clearing existing data...');
    
    // We need to clear data - use storage methods to get and delete each
    const existingMaps = await storage.getAllMaps();
    for (const map of existingMaps) {
      // Clear connections and placements for this map
      const connections = await storage.getConnectionsByMapId(map.id);
      for (const conn of connections) {
        await storage.deleteConnection(conn.id);
      }
      const placements = await storage.getPlacementsByMapId(map.id);
      for (const placement of placements) {
        await storage.deletePlacement(placement.id);
      }
      await storage.deleteMap(map.id);
    }
    
    const existingDevices = await storage.getAllDevices();
    for (const device of existingDevices) {
      // Clear device notifications
      const deviceNotifs = await storage.getDeviceNotifications(device.id);
      for (const dn of deviceNotifs) {
        await storage.removeDeviceNotification(dn.deviceId, dn.notificationId);
      }
      await storage.deleteDevice(device.id);
    }
    
    const existingNotifications = await storage.getAllNotifications();
    for (const notif of existingNotifications) {
      await storage.deleteNotification(notif.id);
    }
    
    const existingScanProfiles = await storage.getAllScanProfiles();
    for (const profile of existingScanProfiles) {
      await storage.deleteScanProfile(profile.id);
    }
    
    const existingCredentialProfiles = await storage.getAllCredentialProfiles();
    for (const profile of existingCredentialProfiles) {
      await storage.deleteCredentialProfile(profile.id);
    }
    
    console.log('[Restore] Restoring data...');
    
    // Create ID mapping tables
    const credentialProfileIdMap = new Map<string, string>(); // old ID -> new ID
    const mapIdMap = new Map<string, string>();
    const deviceIdMap = new Map<string, string>();
    const notificationIdMap = new Map<string, string>();
    
    // 1. Credential profiles first (referenced by devices)
    if (data.credentialProfiles) {
      for (const profile of data.credentialProfiles) {
        const newProfile = await storage.createCredentialProfile({
          name: profile.name,
          type: profile.type,
          credentials: profile.credentials,
        });
        credentialProfileIdMap.set(profile.id, newProfile.id);
      }
    }
    
    // 2. Maps
    if (data.maps) {
      for (const map of data.maps) {
        const newMap = await storage.createMap({
          name: map.name,
          description: map.description,
          isDefault: map.isDefault,
        });
        mapIdMap.set(map.id, newMap.id);
      }
    }
    
    // 3. Notifications
    if (data.notifications) {
      for (const notif of data.notifications) {
        const newNotif = await storage.createNotification({
          name: notif.name,
          url: notif.url,
          method: notif.method,
          messageTemplate: notif.messageTemplate,
          enabled: notif.enabled,
        });
        notificationIdMap.set(notif.id, newNotif.id);
      }
    }
    
    // 4. Devices (with credential profile ID mapping)
    if (data.devices) {
      for (const device of data.devices) {
        const newDevice = await storage.createDevice({
          name: device.name,
          type: device.type,
          ipAddress: device.ipAddress,
          status: device.status || 'unknown',
          deviceData: device.deviceData,
          customCredentials: device.customCredentials,
          credentialProfileId: device.credentialProfileId 
            ? credentialProfileIdMap.get(device.credentialProfileId) 
            : undefined,
        });
        deviceIdMap.set(device.id, newDevice.id);
      }
    }
    
    // 5. Placements (with device and map ID mapping)
    if (data.placements) {
      for (const placement of data.placements) {
        const newDeviceId = deviceIdMap.get(placement.deviceId);
        const newMapId = mapIdMap.get(placement.mapId);
        if (newDeviceId && newMapId) {
          // Handle both old format (x, y) and new format (position: {x, y})
          const x = placement.position?.x ?? placement.x ?? 0;
          const y = placement.position?.y ?? placement.y ?? 0;
          await storage.createPlacement({
            deviceId: newDeviceId,
            mapId: newMapId,
            position: { x, y },
          });
        }
      }
    }
    
    // 6. Connections (with device and map ID mapping)
    if (data.connections) {
      for (const conn of data.connections) {
        const newMapId = mapIdMap.get(conn.mapId);
        const newSourceDeviceId = deviceIdMap.get(conn.sourceDeviceId);
        const newTargetDeviceId = deviceIdMap.get(conn.targetDeviceId);
        
        if (newMapId && newSourceDeviceId && newTargetDeviceId) {
          await storage.createConnection({
            mapId: newMapId,
            sourceDeviceId: newSourceDeviceId,
            targetDeviceId: newTargetDeviceId,
            sourcePort: conn.sourcePort || conn.sourceInterface,
            targetPort: conn.targetPort || conn.targetInterface,
            connectionType: conn.connectionType,
            monitorInterface: conn.monitorInterface,
            monitorSnmpIndex: conn.monitorSnmpIndex,
            linkSpeed: conn.linkSpeed,
          });
        }
      }
    }
    
    // 7. Device notifications (with device and notification ID mapping)
    if (data.deviceNotifications) {
      for (const dn of data.deviceNotifications) {
        const newDeviceId = deviceIdMap.get(dn.deviceId);
        const newNotificationId = notificationIdMap.get(dn.notificationId);
        if (newDeviceId && newNotificationId) {
          await storage.addDeviceNotification({
            deviceId: newDeviceId,
            notificationId: newNotificationId,
          });
        }
      }
    }
    
    // 8. Scan profiles
    if (data.scanProfiles) {
      for (const profile of data.scanProfiles) {
        // Map credential profile IDs
        const mappedCredentialIds = (profile.credentialProfileIds || [])
          .map((id: string) => credentialProfileIdMap.get(id))
          .filter(Boolean);
        
        await storage.createScanProfile({
          name: profile.name,
          ipRange: profile.ipRange,
          credentialProfileIds: mappedCredentialIds,
          probeTypes: profile.probeTypes,
          isDefault: profile.isDefault,
        });
      }
    }
    
    // 9. Settings
    if (data.settings) {
      for (const [key, value] of Object.entries(data.settings)) {
        if (value !== undefined && value !== null) {
          await storage.setSetting(key, value);
        }
      }
      
      // Restart scheduled backups with restored settings
      if (data.settings.backup_schedule) {
        rescheduleBackups(data.settings.backup_schedule);
      }
    }
    
    console.log('[Restore] Restore completed successfully');
    console.log(`[Restore] Restored: ${data.devices?.length || 0} devices, ${data.maps?.length || 0} maps, ${data.connections?.length || 0} connections`);
  }
  
  // Get backup settings
  app.get("/api/backup-settings", async (_req, res) => {
    try {
      const schedule = await storage.getSetting('backup_schedule') || { enabled: false, intervalHours: 24 };
      const retention = await storage.getSetting('backup_retention') || { maxBackups: 10 };
      res.json({ schedule, retention });
    } catch (error) {
      console.error('Error fetching backup settings:', error);
      res.status(500).json({ error: 'Failed to fetch backup settings' });
    }
  });
  
  // Update backup settings
  app.patch("/api/backup-settings", async (req, res) => {
    try {
      const { schedule, retention } = req.body;
      
      if (schedule) {
        await storage.setSetting('backup_schedule', schedule);
        // Restart scheduled backup timer
        rescheduleBackups(schedule);
      }
      
      if (retention) {
        await storage.setSetting('backup_retention', retention);
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating backup settings:', error);
      res.status(500).json({ error: 'Failed to update backup settings' });
    }
  });
  
  // Scheduled backup timer
  let scheduledBackupTimer: NodeJS.Timeout | null = null;
  
  async function performScheduledBackup() {
    console.log('[Backup] Running scheduled backup...');
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `backup-${timestamp}.json`;
      const filePath = path.join(BACKUP_DIR, filename);
      
      // Gather all data (same as manual backup)
      const [maps, devices, credentialProfiles, notifications, scanProfiles] = await Promise.all([
        storage.getAllMaps(),
        storage.getAllDevices(),
        storage.getAllCredentialProfiles(),
        storage.getAllNotifications(),
        storage.getAllScanProfiles(),
      ]);
      
      const allPlacements = [];
      const allConnections = [];
      for (const map of maps) {
        const mapPlacements = await storage.getPlacementsByMapId(map.id);
        const mapConnections = await storage.getConnectionsByMapId(map.id);
        allPlacements.push(...mapPlacements);
        allConnections.push(...mapConnections);
      }
      
      const deviceNotifications = [];
      for (const device of devices) {
        const dn = await storage.getDeviceNotifications(device.id);
        deviceNotifications.push(...dn);
      }
      
      const backupData = {
        version: '1.0',
        createdAt: new Date().toISOString(),
        data: {
          maps,
          devices,
          placements: allPlacements,
          connections: allConnections,
          credentialProfiles,
          notifications,
          deviceNotifications,
          scanProfiles,
        },
      };
      
      const jsonContent = JSON.stringify(backupData, null, 2);
      fs.writeFileSync(filePath, jsonContent, 'utf8');
      
      const sizeBytes = Buffer.byteLength(jsonContent, 'utf8');
      
      await storage.createBackup({
        filename,
        filePath,
        sizeBytes,
        type: 'scheduled',
        status: 'completed',
        metadata: {
          deviceCount: devices.length,
          mapCount: maps.length,
          connectionCount: allConnections.length,
          credentialProfileCount: credentialProfiles.length,
          version: '1.0',
        },
      });
      
      console.log(`[Backup] Scheduled backup created: ${filename} (${(sizeBytes / 1024).toFixed(1)} KB)`);
      
      // Apply retention policy
      const retentionSettings = await storage.getSetting('backup_retention') || { maxBackups: 10 };
      const allBackups = await storage.getAllBackups();
      const scheduledBackups = allBackups.filter(b => b.type === 'scheduled');
      
      if (scheduledBackups.length > retentionSettings.maxBackups) {
        // Delete oldest scheduled backups
        const toDelete = scheduledBackups.slice(retentionSettings.maxBackups);
        for (const backup of toDelete) {
          if (fs.existsSync(backup.filePath)) {
            fs.unlinkSync(backup.filePath);
          }
          await storage.deleteBackup(backup.id);
          console.log(`[Backup] Deleted old scheduled backup: ${backup.filename}`);
        }
      }
      
    } catch (error: any) {
      console.error('[Backup] Scheduled backup failed:', error.message);
    }
  }
  
  function rescheduleBackups(schedule: { enabled: boolean; intervalHours: number }) {
    if (scheduledBackupTimer) {
      clearInterval(scheduledBackupTimer);
      scheduledBackupTimer = null;
    }
    
    if (schedule.enabled && schedule.intervalHours > 0) {
      const intervalMs = schedule.intervalHours * 60 * 60 * 1000;
      console.log(`[Backup] Scheduling backups every ${schedule.intervalHours} hours`);
      scheduledBackupTimer = setInterval(performScheduledBackup, intervalMs);
    } else {
      console.log('[Backup] Scheduled backups disabled');
    }
  }
  
  // Initialize scheduled backups on startup
  async function initializeScheduledBackups() {
    const schedule = await storage.getSetting('backup_schedule');
    if (schedule) {
      rescheduleBackups(schedule);
    }
  }
  
  initializeScheduledBackups();
  
  startPeriodicProbing();
  startTrafficPolling();

  const httpServer = createServer(app);
  return httpServer;
}

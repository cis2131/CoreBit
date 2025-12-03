import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { probeDevice, determineDeviceStatus, probeInterfaceTraffic, probeMikrotikWithPool, pingDevice } from "./deviceProbe";
import { mikrotikPool } from "./mikrotikConnectionPool";
import { insertMapSchema, insertDeviceSchema, insertDevicePlacementSchema, insertConnectionSchema, insertCredentialProfileSchema, insertNotificationSchema, insertDeviceNotificationSchema, insertScanProfileSchema, insertUserSchema, insertUserNotificationChannelSchema, insertDutyUserScheduleSchema, insertDutyShiftConfigSchema, type Device, type Connection, type UserNotificationChannel } from "@shared/schema";
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
import { mapSyncServer } from "./wsServer";

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
    return;
  }

  const message = renderMessageTemplate(notification.messageTemplate, device, newStatus, oldStatus);
  
  try {
    const url = notification.url;
    const method = notification.method.toUpperCase();
    
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
    }
  } catch (error: any) {
    console.error(`[Notification] Failed to send to ${notification.url}:`, error.message);
  }
}

// Helper function to send notification to a user's channel
async function sendUserNotification(channel: UserNotificationChannel, device: any, newStatus: string, oldStatus?: string) {
  if (!channel.enabled) {
    return;
  }

  const config = channel.config;
  
  try {
    if (channel.type === 'webhook' && config.url) {
      const message = renderMessageTemplate(config.messageTemplate || '[Device.Name] is now [Service.Status]', device, newStatus, oldStatus);
      const method = (config.method || 'POST').toUpperCase();
      
      let finalUrl = config.url;
      let fetchOptions: RequestInit = { method };
      
      if (method === 'GET') {
        finalUrl = `${config.url}${encodeURIComponent(message)}`;
      } else {
        fetchOptions.headers = { 'Content-Type': 'text/plain' };
        fetchOptions.body = message;
      }
      
      const response = await fetch(finalUrl, fetchOptions);
      if (!response.ok) {
        console.error(`[UserNotification] HTTP ${response.status} from ${finalUrl}`);
      }
    }
    // Future: Add email and telegram support here
  } catch (error: any) {
    console.error(`[UserNotification] Failed to send to ${channel.name}:`, error.message);
  }
}

// Helper function to determine the currently active shift and get users assigned to it
async function getCurrentOnDutyUsers(): Promise<{ shift: 'day' | 'night'; users: any[] } | null> {
  const config = await storage.getDutyShiftConfig();
  if (!config) {
    return null;
  }

  const now = new Date();
  
  // Parse shift times
  const [dayStartHour, dayStartMin] = config.dayShiftStart.split(':').map(Number);
  const [dayEndHour, dayEndMin] = config.dayShiftEnd.split(':').map(Number);
  
  // Get current hour and minute (respecting timezone if configured)
  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();
  const currentTime = currentHour * 60 + currentMinute;
  const dayStart = dayStartHour * 60 + dayStartMin;
  const dayEnd = dayEndHour * 60 + dayEndMin;
  
  // Determine current shift
  let shift: 'day' | 'night';
  if (dayStart <= dayEnd) {
    // Normal case: day shift doesn't cross midnight
    shift = (currentTime >= dayStart && currentTime < dayEnd) ? 'day' : 'night';
  } else {
    // Edge case: day shift crosses midnight (unlikely but handle it)
    shift = (currentTime >= dayStart || currentTime < dayEnd) ? 'day' : 'night';
  }
  
  // Get users assigned to the current shift
  const dutySchedules = await storage.getDutyUserSchedulesByShift(shift);
  
  if (dutySchedules.length === 0) {
    return { shift, users: [] };
  }
  
  // Get user details and their notification channels
  const users = await Promise.all(dutySchedules.map(async (schedule) => {
    const user = await storage.getUser(schedule.userId);
    if (!user) return null;
    const channels = await storage.getUserNotificationChannels(user.id);
    return { 
      id: user.id, 
      username: user.username, 
      displayName: user.displayName,
      channels: channels.filter(c => c.enabled)
    };
  }));
  
  return {
    shift,
    users: users.filter(Boolean),
  };
}

// Helper function to send notifications for a device
// Both global channels AND on-duty users can be notified simultaneously
async function sendDeviceNotifications(device: Device, newStatus: string, oldStatus?: string) {
  // 1. Always send to global channels (device's assigned notification channels)
  const deviceNotifications = await storage.getDeviceNotifications(device.id);
  for (const dn of deviceNotifications) {
    const notification = await storage.getNotification(dn.notificationId);
    if (notification) {
      await sendNotification(notification, device, newStatus, oldStatus);
    }
  }
  
  // 2. If useOnDuty is enabled, ALSO notify on-duty users
  if (device.useOnDuty) {
    const onDuty = await getCurrentOnDutyUsers();
    if (onDuty && onDuty.users.length > 0) {
      for (const user of onDuty.users) {
        for (const channel of user.channels || []) {
          await sendUserNotification(channel, device, newStatus, oldStatus);
        }
      }
    }
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
      
      // Explicitly save session before responding
      req.session.save((err) => {
        if (err) {
          console.error('[Auth] Session save error:', err);
          return res.status(500).json({ message: 'Failed to create session' });
        }
        res.json({ user: getUserSafeData(user) });
      });
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

  app.post("/api/maps", canModify as any, async (req, res) => {
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

  app.patch("/api/maps/:id", canModify as any, async (req, res) => {
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

  app.delete("/api/maps/:id", canModify as any, async (req, res) => {
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

  app.post("/api/devices", canModify as any, async (req, res) => {
    try {
      const data = insertDeviceSchema.parse(req.body);
      
      // Resolve credentials from profile or custom
      const credentials = await resolveCredentials({
        credentialProfileId: data.credentialProfileId || null,
        customCredentials: data.customCredentials || null,
      });
      
      // Probe device for additional information
      const probeResult = await probeDevice(data.type, data.ipAddress || undefined, credentials);
      const status = determineDeviceStatus(probeResult.data, probeResult.success, probeResult.pingOnly, data.type);

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

  app.patch("/api/devices/:id", canModify as any, async (req, res) => {
    try {
      const updateData = insertDeviceSchema.partial().parse(req.body);
      
      // Re-probe device if IP, type, or credentials changed
      let finalUpdateData = { ...updateData };
      if (updateData.type || updateData.ipAddress || updateData.credentialProfileId !== undefined || updateData.customCredentials !== undefined) {
        const existingDevice = await storage.getDevice(req.params.id);
        if (existingDevice) {
          const mergedDevice = { ...existingDevice, ...updateData };
          const credentials = await resolveCredentials(mergedDevice);
          
          const deviceTypeToProbe = updateData.type || existingDevice.type;
          const probeResult = await probeDevice(
            deviceTypeToProbe, 
            (updateData.ipAddress !== undefined ? updateData.ipAddress : existingDevice.ipAddress) || undefined,
            credentials
          );
          const status = determineDeviceStatus(probeResult.data, probeResult.success, probeResult.pingOnly, deviceTypeToProbe);
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

  app.delete("/api/devices/:id", canModify as any, async (req, res) => {
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

  app.delete("/api/logs", requireAdmin as any, async (req, res) => {
    try {
      await storage.deleteAllLogs();
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting logs:', error);
      res.status(500).json({ error: 'Failed to delete logs' });
    }
  });

  app.delete("/api/logs/device/:deviceId", requireAdmin as any, async (req, res) => {
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

  app.post("/api/placements", canModify as any, async (req: AuthenticatedRequest, res) => {
    try {
      const data = insertDevicePlacementSchema.parse(req.body);
      
      // Check for duplicate placement (same device on same map)
      const existingPlacements = await storage.getPlacementsByMapId(data.mapId);
      const duplicatePlacement = existingPlacements.find(p => p.deviceId === data.deviceId);
      if (duplicatePlacement) {
        return res.status(400).json({ error: 'Device is already placed on this map' });
      }
      
      const placement = await storage.createPlacement(data);
      
      // Broadcast change to other users viewing this map
      mapSyncServer.broadcastMapChange(data.mapId, 'placement', 'create', req.user?.id);
      
      res.status(201).json(placement);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid placement data', details: error.errors });
      }
      console.error('Error creating placement:', error);
      res.status(500).json({ error: 'Failed to create placement' });
    }
  });

  app.patch("/api/placements/:id", canModify as any, async (req: AuthenticatedRequest, res) => {
    try {
      const data = insertDevicePlacementSchema.partial().parse(req.body);
      
      // Get the placement first to know which map to broadcast to
      const existingPlacement = await storage.getPlacement(req.params.id);
      if (!existingPlacement) {
        return res.status(404).json({ error: 'Placement not found' });
      }
      
      const placement = await storage.updatePlacement(req.params.id, data);
      if (!placement) {
        return res.status(404).json({ error: 'Placement not found' });
      }
      
      // Broadcast change to other users viewing this map
      mapSyncServer.broadcastMapChange(existingPlacement.mapId, 'placement', 'update', req.user?.id);
      
      // If mapId changed (placement moved to different map), also broadcast to the new map
      if (data.mapId && data.mapId !== existingPlacement.mapId) {
        mapSyncServer.broadcastMapChange(data.mapId, 'placement', 'create', req.user?.id);
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

  app.delete("/api/placements/:id", canModify as any, async (req: AuthenticatedRequest, res) => {
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
      
      // Broadcast change to other users viewing this map
      mapSyncServer.broadcastMapChange(placement.mapId, 'placement', 'delete', req.user?.id);
      
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
      // Use device's probeTimeout (min 20s for manual probe to allow SNMP walks)
      const previousPorts = device.deviceData?.ports;
      const deviceTimeoutSeconds = Math.max(device.probeTimeout || 20, 20); // Min 20s for manual
      const MANUAL_PROBE_TIMEOUT = deviceTimeoutSeconds * 1000;
      
      let probeResult: { success: boolean; data?: any; error?: string };
      try {
        const probePromise = probeDevice(
          device.type, 
          device.ipAddress || undefined, 
          credentials,
          true, // detailedProbe - user explicitly requested probe
          previousPorts,
          true,  // needsSnmpIndexing - always get indices on manual probe
          deviceTimeoutSeconds
        );
        
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Probe timed out after ${deviceTimeoutSeconds} seconds`)), MANUAL_PROBE_TIMEOUT);
        });
        
        probeResult = await Promise.race([probePromise, timeoutPromise]);
      } catch (timeoutError: any) {
        console.warn(`[Probe] Manual probe timeout for ${device.name}: ${timeoutError.message}`);
        probeResult = { success: false, error: timeoutError.message };
      }
      
      const status = determineDeviceStatus(probeResult.data, probeResult.success, (probeResult as any).pingOnly, device.type);

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

  app.post("/api/connections", canModify as any, async (req: AuthenticatedRequest, res) => {
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
            }
          }
        }
      }
      
      const connection = await storage.createConnection(data);
      
      // Broadcast change to other users viewing this map
      mapSyncServer.broadcastMapChange(data.mapId, 'connection', 'create', req.user?.id);
      
      res.status(201).json(connection);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid connection data', details: error.errors });
      }
      console.error('Error creating connection:', error);
      res.status(500).json({ error: 'Failed to create connection' });
    }
  });

  app.patch("/api/connections/:id", canModify as any, async (req: AuthenticatedRequest, res) => {
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
      }
      
      // If monitorInterface is being cleared, also clear the cached index
      if (data.monitorInterface === null) {
        data.monitorSnmpIndex = null;
      }
      
      const connection = await storage.updateConnection(req.params.id, data);
      
      // Broadcast change to other users viewing this map
      mapSyncServer.broadcastMapChange(existingConn.mapId, 'connection', 'update', req.user?.id);
      
      res.json(connection);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid connection data', details: error.errors });
      }
      console.error('Error updating connection:', error);
      res.status(500).json({ error: 'Failed to update connection' });
    }
  });

  app.delete("/api/connections/:id", canModify as any, async (req: AuthenticatedRequest, res) => {
    try {
      const connectionId = req.params.id;
      
      // Get the connection first to know which map to broadcast to
      const connection = await storage.getConnection(connectionId);
      
      await storage.deleteConnection(connectionId);
      // Clean up traffic history for this connection
      trafficHistory.delete(connectionId);
      
      // Broadcast change to other users viewing this map
      if (connection) {
        mapSyncServer.broadcastMapChange(connection.mapId, 'connection', 'delete', req.user?.id);
      }
      
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting connection:', error);
      res.status(500).json({ error: 'Failed to delete connection' });
    }
  });

  // Reset SNMP index to force a fresh walk on next traffic probe
  app.post("/api/connections/:id/reset-snmp-index", canModify as any, async (req, res) => {
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

  app.post("/api/credential-profiles", requireAdmin as any, async (req, res) => {
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

  app.patch("/api/credential-profiles/:id", requireAdmin as any, async (req, res) => {
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

  app.delete("/api/credential-profiles/:id", requireAdmin as any, async (req, res) => {
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

  app.post("/api/notifications", requireAdmin as any, async (req, res) => {
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

  app.patch("/api/notifications/:id", requireAdmin as any, async (req, res) => {
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

  app.delete("/api/notifications/:id", requireAdmin as any, async (req, res) => {
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

  app.post("/api/devices/:deviceId/notifications", requireAdmin as any, async (req, res) => {
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

  app.delete("/api/devices/:deviceId/notifications/:notificationId", requireAdmin as any, async (req, res) => {
    try {
      await storage.removeDeviceNotification(req.params.deviceId, req.params.notificationId);
      res.status(204).send();
    } catch (error) {
      console.error('Error removing device notification:', error);
      res.status(500).json({ error: 'Failed to remove device notification' });
    }
  });

  // =============================================
  // User Notification Channels Routes
  // =============================================
  
  // Get all user notification channels (admin only) or filter by userId
  app.get("/api/user-notification-channels", requireAdmin as any, async (req, res) => {
    try {
      const userId = req.query.userId as string | undefined;
      if (userId) {
        const channels = await storage.getUserNotificationChannels(userId);
        res.json(channels);
      } else {
        const channels = await storage.getAllUserNotificationChannels();
        res.json(channels);
      }
    } catch (error) {
      console.error('Error fetching user notification channels:', error);
      res.status(500).json({ error: 'Failed to fetch user notification channels' });
    }
  });

  // Get notification channels for a specific user
  app.get("/api/users/:userId/notification-channels", requireAuth as any, async (req, res) => {
    try {
      const channels = await storage.getUserNotificationChannels(req.params.userId);
      res.json(channels);
    } catch (error) {
      console.error('Error fetching user notification channels:', error);
      res.status(500).json({ error: 'Failed to fetch user notification channels' });
    }
  });

  // Get current user's notification channels
  app.get("/api/my-notification-channels", requireAuth as any, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const channels = await storage.getUserNotificationChannels(userId);
      res.json(channels);
    } catch (error) {
      console.error('Error fetching user notification channels:', error);
      res.status(500).json({ error: 'Failed to fetch user notification channels' });
    }
  });

  // Create notification channel for current user
  app.post("/api/my-notification-channels", requireAuth as any, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const data = insertUserNotificationChannelSchema.parse({
        ...req.body,
        userId,
      });
      const channel = await storage.createUserNotificationChannel(data);
      res.status(201).json(channel);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid channel data', details: error.errors });
      }
      console.error('Error creating user notification channel:', error);
      res.status(500).json({ error: 'Failed to create user notification channel' });
    }
  });

  // Update notification channel
  app.patch("/api/user-notification-channels/:id", requireAuth as any, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.id;
      const channel = await storage.getUserNotificationChannel(req.params.id);
      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      // Only allow updating own channels unless admin
      if (channel.userId !== userId && req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Not authorized' });
      }
      const data = insertUserNotificationChannelSchema.partial().parse(req.body);
      const updated = await storage.updateUserNotificationChannel(req.params.id, data);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid channel data', details: error.errors });
      }
      console.error('Error updating user notification channel:', error);
      res.status(500).json({ error: 'Failed to update user notification channel' });
    }
  });

  // Delete notification channel
  app.delete("/api/user-notification-channels/:id", requireAuth as any, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.id;
      const channel = await storage.getUserNotificationChannel(req.params.id);
      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      // Only allow deleting own channels unless admin
      if (channel.userId !== userId && req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Not authorized' });
      }
      await storage.deleteUserNotificationChannel(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting user notification channel:', error);
      res.status(500).json({ error: 'Failed to delete user notification channel' });
    }
  });

  // =============================================
  // Duty User Schedules Routes (simplified: assign users to shifts)
  // =============================================

  // Get all duty user schedules with user details
  app.get("/api/duty-user-schedules", requireAuth as any, async (_req, res) => {
    try {
      const schedules = await storage.getAllDutyUserSchedules();
      // Get user details for each schedule
      const schedulesWithUsers = await Promise.all(schedules.map(async (schedule) => {
        const user = await storage.getUser(schedule.userId);
        return {
          ...schedule,
          user: user ? { id: user.id, username: user.username, displayName: user.displayName } : null,
        };
      }));
      res.json(schedulesWithUsers);
    } catch (error) {
      console.error('Error fetching duty user schedules:', error);
      res.status(500).json({ error: 'Failed to fetch duty user schedules' });
    }
  });

  // Get users assigned to a specific shift
  app.get("/api/duty-user-schedules/:shift", requireAuth as any, async (req, res) => {
    try {
      const shift = req.params.shift as 'day' | 'night';
      if (shift !== 'day' && shift !== 'night') {
        return res.status(400).json({ error: 'Shift must be "day" or "night"' });
      }
      const schedules = await storage.getDutyUserSchedulesByShift(shift);
      const schedulesWithUsers = await Promise.all(schedules.map(async (schedule) => {
        const user = await storage.getUser(schedule.userId);
        return {
          ...schedule,
          user: user ? { id: user.id, username: user.username, displayName: user.displayName } : null,
        };
      }));
      res.json(schedulesWithUsers);
    } catch (error) {
      console.error('Error fetching duty user schedules by shift:', error);
      res.status(500).json({ error: 'Failed to fetch duty user schedules' });
    }
  });

  // Add user to a shift
  app.post("/api/duty-user-schedules", requireAdmin as any, async (req, res) => {
    try {
      const data = insertDutyUserScheduleSchema.parse(req.body);
      const schedule = await storage.addDutyUserSchedule(data);
      res.status(201).json(schedule);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid schedule data', details: error.errors });
      }
      console.error('Error adding duty user schedule:', error);
      res.status(500).json({ error: 'Failed to add duty user schedule' });
    }
  });

  // Remove user from a shift by schedule ID
  app.delete("/api/duty-user-schedules/:scheduleId", requireAdmin as any, async (req, res) => {
    try {
      await storage.removeDutyUserScheduleById(req.params.scheduleId);
      res.status(204).send();
    } catch (error) {
      console.error('Error removing duty user schedule:', error);
      res.status(500).json({ error: 'Failed to remove duty user schedule' });
    }
  });

  // =============================================
  // Duty Shift Config Routes
  // =============================================

  // Get shift configuration
  app.get("/api/duty-shift-config", requireAuth as any, async (_req, res) => {
    try {
      let config = await storage.getDutyShiftConfig();
      if (!config) {
        // Return default config if none exists
        config = await storage.updateDutyShiftConfig({
          dayShiftStart: "07:00",
          dayShiftEnd: "19:00",
          nightShiftStart: "19:00",
          nightShiftEnd: "07:00",
          timezone: "UTC",
          rotationWeeks: 4,
        });
      }
      res.json(config);
    } catch (error) {
      console.error('Error fetching duty shift config:', error);
      res.status(500).json({ error: 'Failed to fetch duty shift config' });
    }
  });

  // Update shift configuration (PATCH)
  app.patch("/api/duty-shift-config", requireAdmin as any, async (req, res) => {
    try {
      const data = insertDutyShiftConfigSchema.partial().parse(req.body);
      const config = await storage.updateDutyShiftConfig(data);
      res.json(config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid config data', details: error.errors });
      }
      console.error('Error updating duty shift config:', error);
      res.status(500).json({ error: 'Failed to update duty shift config' });
    }
  });

  // Update shift configuration (PUT)
  app.put("/api/duty-shift-config", requireAdmin as any, async (req, res) => {
    try {
      const data = insertDutyShiftConfigSchema.partial().parse(req.body);
      const config = await storage.updateDutyShiftConfig(data);
      res.json(config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid config data', details: error.errors });
      }
      console.error('Error updating duty shift config:', error);
      res.status(500).json({ error: 'Failed to update duty shift config' });
    }
  });

  // =============================================
  // Get Currently On-Duty Users
  // =============================================

  // Get users that are currently on duty based on shift configuration
  app.get("/api/duty-on-call", requireAuth as any, async (_req, res) => {
    try {
      const onDuty = await getCurrentOnDutyUsers();
      if (!onDuty) {
        return res.json({ shift: null, users: [], message: 'No shift configuration' });
      }
      res.json(onDuty);
    } catch (error) {
      console.error('Error getting on-duty users:', error);
      res.status(500).json({ error: 'Failed to get on-duty users' });
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

  app.post("/api/scan-profiles", canModify as any, async (req, res) => {
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

  app.patch("/api/scan-profiles/:id", canModify as any, async (req, res) => {
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

  app.delete("/api/scan-profiles/:id", canModify as any, async (req, res) => {
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

  app.post("/api/network-scan", canModify as any, async (req, res) => {
    try {
      const { ipRange, credentialProfileIds, probeTypes } = scanRequestSchema.parse(req.body);
      
      // Expand IP range
      const ips = expandCidr(ipRange);
      if (ips.length === 0) {
        return res.status(400).json({ error: 'Invalid IP range' });
      }
      
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

  app.post("/api/devices/batch", canModify as any, async (req, res) => {
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

  app.put("/api/settings/:key", requireAdmin as any, async (req, res) => {
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
  const DEFAULT_CONCURRENT_PROBES = 80; // Default, can be overridden by settings
  
  // Global probing defaults (fetched from settings before each probe cycle)
  interface ProbingDefaults {
    defaultProbeTimeout: number;  // seconds
    defaultOfflineThreshold: number;  // cycles
    concurrentProbeThreads: number;  // number of concurrent probes
    mikrotikKeepConnections: boolean;  // use persistent connections for Mikrotik devices
    pingFallbackEnabled: boolean;  // if true, ping device when API fails - if ping succeeds, mark as 'stale' instead of 'offline'
  }
  
  interface ProbeResult {
    device: any;
    success: boolean;
    timeout: boolean;
    error?: string;
  }
  
  async function probeDeviceWithTimeout(device: any, credentials: any, isDetailedCycle: boolean = false, needsSnmpIndexing: boolean = false, defaults?: ProbingDefaults): Promise<ProbeResult> {
    // Use per-device timeout if set, otherwise use global default, then fallback to 6 seconds
    const globalDefaultTimeout = defaults?.defaultProbeTimeout || 6;
    const deviceTimeoutSeconds = device.probeTimeout || globalDefaultTimeout;
    const deviceTimeoutMs = deviceTimeoutSeconds * 1000;
    
    // Use per-device offline threshold if set, otherwise use global default, then fallback to 1
    const globalDefaultThreshold = defaults?.defaultOfflineThreshold || 1;
    const effectiveOfflineThreshold = device.offlineThreshold || globalDefaultThreshold;
    
    // Try probe with retry on timeout
    const maxAttempts = 2;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let timeoutId: NodeJS.Timeout;
      let timedOut = false;
      let probeCompleted = false; // Track if probe completed before timeout
      
      // Create AbortController for this attempt - used to release connection immediately on timeout
      const abortController = new AbortController();
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          if (!probeCompleted) {
            timedOut = true;
            // Abort the probe to release connection immediately
            abortController.abort();
            reject(new Error('Probe timeout'));
          }
        }, deviceTimeoutMs);
      });
      
      const probePromise = (async () => {
      // Detect link state changes for Mikrotik devices
      const previousPorts = device.deviceData?.ports || [];
      let needsDetailedProbe = isDetailedCycle;
      
      // Helper function to safely update device - skips if timed out
      const safeUpdateDevice = async (updates: any) => {
        if (timedOut) return false;
        try {
          await storage.updateDevice(device.id, updates);
          return true;
        } catch (error: any) {
          console.error(`[Probing] DB update failed for ${device.name}:`, error.message);
          return false;
        }
      };
      
      // For Mikrotik devices, check if any ports transitioned from down to up
      if (device.type.startsWith('mikrotik_') && previousPorts.length > 0 && !isDetailedCycle) {
        const quickProbe = await probeDevice(device.type, device.ipAddress, credentials, false, previousPorts, needsSnmpIndexing, deviceTimeoutSeconds, abortController.signal);
        
        // Check timeout immediately after probe returns
        if (timedOut) {
          return { device, success: false, timeout: true };
        }
        
        if (quickProbe.success && quickProbe.data.ports) {
          // Check for down→up transitions
          // Match by defaultName first (stable identifier), then fall back to name
          for (const currentPort of quickProbe.data.ports as any[]) {
            const prevPort = previousPorts.find((p: any) => 
              (currentPort.defaultName && p.defaultName === currentPort.defaultName) || p.name === currentPort.name
            );
            if (prevPort && prevPort.status === 'down' && currentPort.status === 'up') {
              needsDetailedProbe = true;
              break;
            }
          }
        }
        
        // If we don't need detailed probe, use the quick probe result and return early
        if (!needsDetailedProbe && quickProbe.success) {
          const status = determineDeviceStatus(quickProbe.data, quickProbe.success, quickProbe.pingOnly, device.type);
          const oldStatus = device.status;
          const statusChanged = status !== oldStatus;
          
          if (status !== device.status || quickProbe.success) {
            const updated = await safeUpdateDevice({
              status,
              deviceData: quickProbe.data,
              failureCount: 0, // Reset failure count on successful probe
              lastSeen: new Date(), // Update last seen timestamp on successful probe
            });
            if (!updated && timedOut) {
              return { device, success: false, timeout: true };
            }
          }
          
          if (statusChanged && !timedOut) {
            // Log status change to console with timestamp
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] [Probing] ${device.name} (${device.ipAddress}): ${oldStatus} → ${status}`);
            
            // Create log entry for status change
            try {
              await storage.createLog({
                deviceId: device.id,
                eventType: 'status_change',
                severity: status === 'offline' ? 'error' : status === 'warning' ? 'warning' : 'info',
                message: `Device ${device.name} (${device.ipAddress}) status changed from ${oldStatus} to ${status}`,
                oldStatus,
                newStatus: status,
                metadata: { ipAddress: device.ipAddress },
              });
            } catch (error: any) {
              console.error(`[Logging] Error creating log for ${device.name}:`, error.message);
            }

            // Send notifications (global channels + on-duty users if enabled)
            try {
              await sendDeviceNotifications(device, status, oldStatus);
            } catch (error: any) {
              console.error(`[Notification] Error sending notifications for ${device.name}:`, error.message);
            }
          }
          
          // Mark probe as completed before returning
          probeCompleted = true;
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
        needsSnmpIndexing,
        deviceTimeoutSeconds,
        abortController.signal
      );
      
      // Check timeout immediately after probe returns
      if (timedOut) {
        return { device, success: false, timeout: true };
      }
      
      // For non-Mikrotik devices, ping fallback is now built into probeDevice
      // For Mikrotik devices, still use the explicit ping fallback setting
      let status = determineDeviceStatus(probeResult.data, probeResult.success, probeResult.pingOnly, device.type);
      const oldStatus = device.status;
      
      // Log when ping was used for probing
      if (probeResult.pingOnly) {
        const timestamp = new Date().toISOString();
        if (device.type === 'generic_ping') {
          // Ping-only device - this is expected behavior
          if (probeResult.success) {
            console.log(`[${timestamp}] [Probing] ${device.name} (${device.ipAddress}): Ping probe successful (RTT: ${probeResult.pingRtt?.toFixed(2) || 'n/a'}ms)`);
          } else {
            console.log(`[${timestamp}] [Probing] ${device.name} (${device.ipAddress}): Ping probe failed - device unreachable`);
          }
        } else {
          // SNMP device with ping fallback - mark as stale
          console.log(`[${timestamp}] [Probing] ${device.name} (${device.ipAddress}): SNMP failed but ping succeeded (RTT: ${probeResult.pingRtt || 'n/a'}ms) - marking as stale`);
        }
      }
      
      // Ping fallback for Mikrotik devices: if probe failed and status would be offline, try ping
      // (Non-Mikrotik devices already have ping fallback built into probeDevice)
      if (status === 'offline' && defaults?.pingFallbackEnabled && device.ipAddress && device.type.startsWith('mikrotik_')) {
        try {
          const pingResult = await pingDevice(device.ipAddress, 3);
          if (pingResult.success) {
            status = 'stale';
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] [Probing] ${device.name} (${device.ipAddress}): Mikrotik API failed but ping succeeded (RTT: ${pingResult.rtt || 'n/a'}ms) - marking as stale`);
          }
        } catch (pingError: any) {
          console.warn(`[Probing] Ping fallback failed for ${device.name}:`, pingError.message);
        }
      }
      
      // For failed probes, respect offline threshold before changing status
      // This prevents immediate offline on single failures for ping-only and other devices
      if (!probeResult.success && status === 'offline') {
        // Fetch fresh device data to get current failureCount from database
        const freshDevice = await storage.getDevice(device.id);
        if (!freshDevice) {
          return { device, success: false, timeout: false };
        }
        
        const currentFailureCount = (freshDevice.failureCount || 0) + 1;
        const offlineThreshold = freshDevice.offlineThreshold || defaults?.defaultOfflineThreshold || 3;
        const timestamp = new Date().toISOString();
        
        if (currentFailureCount < offlineThreshold) {
          // Haven't reached threshold yet - keep current status but increment failure count
          await safeUpdateDevice({ failureCount: currentFailureCount });
          console.log(`[${timestamp}] [Probing] ${device.name}: probe failed (${currentFailureCount}/${offlineThreshold}) - keeping status as ${oldStatus}`);
          // Don't change status to offline yet
          status = oldStatus === 'online' ? 'online' : oldStatus; // Keep previous status
        } else {
          // Reached threshold - allow offline status and update device
          console.log(`[${timestamp}] [Probing] ${device.name}: probe failed (${currentFailureCount}/${offlineThreshold}) - threshold reached, marking offline`);
          await safeUpdateDevice({
            status: 'offline',
            failureCount: currentFailureCount,
          });
        }
      }
      
      const statusChanged = status !== oldStatus;
      
      if ((status !== device.status || probeResult.success) && probeResult.success) {
        // Only update device data on successful probe
        const updated = await safeUpdateDevice({
          status,
          deviceData: probeResult.data,
          failureCount: 0, // Reset failure count on successful probe
          lastSeen: new Date(), // Update last seen timestamp on successful probe
        });
        if (!updated && timedOut) {
          return { device, success: false, timeout: true };
        }
      }
      
      // Trigger notifications and logging on status change
      if (statusChanged && !timedOut) {
        // Log status change to console with timestamp
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [Probing] ${device.name} (${device.ipAddress}): ${oldStatus} → ${status}`);
        
        // Create log entry for status change
        try {
          const getProbeTypeDescription = () => {
            if (device.type === 'generic_ping') return 'ping probe';
            if (device.type.startsWith('mikrotik_')) return 'Mikrotik API';
            return 'SNMP';
          };
          await storage.createLog({
            deviceId: device.id,
            eventType: 'status_change',
            severity: status === 'offline' ? 'error' : status === 'stale' ? 'warning' : status === 'warning' ? 'warning' : 'info',
            message: status === 'stale' 
              ? `Device ${device.name} (${device.ipAddress}) status changed from ${oldStatus} to stale (${getProbeTypeDescription()} unreachable but responds to ping)`
              : `Device ${device.name} (${device.ipAddress}) status changed from ${oldStatus} to ${status}`,
            oldStatus,
            newStatus: status,
            metadata: { ipAddress: device.ipAddress },
          });
        } catch (error: any) {
          console.error(`[Logging] Error creating log for ${device.name}:`, error.message);
        }

        // Send notifications only for offline status (not stale - that's the point of ping fallback)
        if (status !== 'stale') {
          try {
            await sendDeviceNotifications(device, status, oldStatus);
          } catch (error: any) {
            console.error(`[Notification] Error sending notifications for ${device.name}:`, error.message);
          }
        }
      }
      
      // Mark probe as completed before returning
      probeCompleted = true;
      return { device, success: probeResult.success, timeout: false };
    })();
    
      try {
        const result = await Promise.race([probePromise, timeoutPromise]);
        clearTimeout(timeoutId!);
        return result;
      } catch (error: any) {
        clearTimeout(timeoutId!);
        
        if (error.message === 'Probe timeout') {
          // If this was the first attempt, retry once
          if (attempt < maxAttempts) {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] [Probing] ${device.name} (${device.ipAddress}): timeout on attempt ${attempt}, retrying...`);
            continue; // Try again
          }
          
          // Final attempt also timed out - check offline threshold
          // Fetch current device status from DB to avoid stale data
          const currentDevice = await storage.getDevice(device.id);
          
          // Device was deleted during probe cycle - bail out
          if (!currentDevice) {
            return { device, success: false, timeout: true };
          }
          
          const oldStatus = currentDevice.status;
          const currentFailureCount = (currentDevice.failureCount || 0) + 1;
          
          // Increment failure count
          await storage.updateDevice(device.id, { failureCount: currentFailureCount });
          
          // Check if we've reached the offline threshold (use effectiveOfflineThreshold from function start)
          if (currentFailureCount >= effectiveOfflineThreshold) {
            // Ping fallback: if enabled, ping the device before marking offline
            // If ping succeeds, mark as 'stale' instead of 'offline' (no alarm)
            let useStaleStatus = false;
            if (defaults?.pingFallbackEnabled && device.ipAddress) {
              try {
                const pingResult = await pingDevice(device.ipAddress, 3);
                if (pingResult.success) {
                  useStaleStatus = true;
                  const timestamp = new Date().toISOString();
                  const probeType = device.type.startsWith('mikrotik_') ? 'Mikrotik API' : 'SNMP';
                  console.log(`[${timestamp}] [Probing] ${device.name} (${device.ipAddress}): ${probeType} timed out but ping succeeded (RTT: ${pingResult.rtt || 'n/a'}ms) - marking as stale`);
                }
              } catch (pingError: any) {
                console.warn(`[Probing] Ping fallback failed for ${device.name}:`, pingError.message);
              }
            }
            
            const targetStatus = useStaleStatus ? 'stale' : 'offline';
            
            // Only update and log if status is actually changing
            if (oldStatus !== targetStatus) {
              await storage.updateDevice(device.id, { status: targetStatus, failureCount: currentFailureCount });
              
              // IMPORTANT: Update the device object so downstream code doesn't overwrite with stale status
              device.status = targetStatus;
              
              // Log status change to console with timestamp
              const timestamp = new Date().toISOString();
              const probeTypeLabel = device.type.startsWith('mikrotik_') ? 'Mikrotik API' : 'SNMP probe';
              if (useStaleStatus) {
                console.log(`[${timestamp}] [Probing] ${device.name} (${device.ipAddress}): ${oldStatus} → stale (${probeTypeLabel} unreachable but device responds to ping)`);
              } else {
                console.warn(`[${timestamp}] [Probing] ${device.name} (${device.ipAddress}): ${oldStatus} → offline (timeout after ${currentFailureCount}/${effectiveOfflineThreshold} failed cycles)`);
              }
              
              // Create log entry for status change
              try {
                await storage.createLog({
                  deviceId: device.id,
                  eventType: 'status_change',
                  severity: useStaleStatus ? 'warning' : 'error',
                  message: useStaleStatus 
                    ? `Device ${device.name} (${device.ipAddress}) status changed from ${oldStatus} to stale (${probeTypeLabel} unreachable but responds to ping)`
                    : `Device ${device.name} (${device.ipAddress}) status changed from ${oldStatus} to offline (probe timeout after ${currentFailureCount} failed cycles)`,
                  oldStatus,
                  newStatus: targetStatus,
                  metadata: { ipAddress: device.ipAddress },
                });
              } catch (logError: any) {
                console.error(`[Logging] Error creating timeout log for ${device.name}:`, logError.message);
              }
              
              // Only send notifications for offline status (not stale - that's the whole point of ping fallback)
              if (!useStaleStatus) {
                try {
                  await sendDeviceNotifications(device, 'offline', oldStatus);
                } catch (notifError: any) {
                  console.error(`[Notification] Error sending timeout notifications for ${device.name}:`, notifError.message);
                }
              }
            } else {
              // Device is already in target status - just update the local object to match DB
              device.status = targetStatus;
            }
          } else {
            // Not yet reached threshold - log the failure count
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] [Probing] ${device.name} (${device.ipAddress}): timeout (${currentFailureCount}/${effectiveOfflineThreshold} failures, not yet offline)`);
          }
          
          return { device, success: false, timeout: true };
        }
        
        // Non-timeout error - don't retry
        console.error(`[Probing] Failed to probe ${device.name}:`, error.message);
        return { device, success: false, timeout: false, error: error.message };
      }
    }
    
    // Should never reach here, but TypeScript needs a return
    return { device, success: false, timeout: true };
  }
  
  async function processConcurrentQueue(devices: any[], concurrency: number, isDetailedCycle: boolean = false, devicesNeedingSnmp: Set<string> = new Set(), defaults?: ProbingDefaults): Promise<ProbeResult[]> {
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
            const result = await probeDeviceWithTimeout(device, credentials, isDetailedCycle, needsSnmpIndexing, defaults);
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
  let currentPhase = ''; // Track what phase we're in for debugging
  let probeCycle = 0; // Track probe cycles for detailed probing
  const DETAILED_PROBE_INTERVAL = 10; // Run detailed probe every 10 cycles (~5 minutes with 30s polling)
  
  async function startPeriodicProbing() {
    // Use a completion-aware loop instead of setInterval to prevent skipped cycles
    // This ensures the next cycle starts immediately after the previous one completes
    // (with appropriate delay to respect the polling interval)
    
    async function runProbeCycle() {
      // Fetch polling interval at start of each cycle (allows runtime changes)
      const pollingInterval = await storage.getSetting('polling_interval') || 30;
      const intervalMs = parseInt(pollingInterval) * 1000;
      
      currentPhase = 'init';
      probeCycle++;
      const startTime = Date.now();
      const isDetailedCycle = probeCycle % DETAILED_PROBE_INTERVAL === 0;
      
      try {
        // Fetch global probing defaults at start of each cycle
        const defaultTimeoutSetting = await storage.getSetting('default_probe_timeout');
        const defaultThresholdSetting = await storage.getSetting('default_offline_threshold');
        const concurrentThreadsSetting = await storage.getSetting('concurrent_probe_threads');
        const keepConnectionsSetting = await storage.getSetting('mikrotik_keep_connections');
        const pingFallbackSetting = await storage.getSetting('ping_fallback_enabled');
        
        const probingDefaults: ProbingDefaults = {
          defaultProbeTimeout: typeof defaultTimeoutSetting === 'number' ? defaultTimeoutSetting : 6,
          defaultOfflineThreshold: typeof defaultThresholdSetting === 'number' ? defaultThresholdSetting : 1,
          concurrentProbeThreads: typeof concurrentThreadsSetting === 'number' ? concurrentThreadsSetting : DEFAULT_CONCURRENT_PROBES,
          mikrotikKeepConnections: typeof keepConnectionsSetting === 'boolean' ? keepConnectionsSetting : false,
          pingFallbackEnabled: typeof pingFallbackSetting === 'boolean' ? pingFallbackSetting : false,
        };
        
        // Update connection pool enabled state and staleness threshold
        mikrotikPool.setEnabled(probingDefaults.mikrotikKeepConnections);
        mikrotikPool.setStalenessThreshold(intervalMs);
        
        currentPhase = 'fetching devices';
        const allDevices = await storage.getAllDevices();
        const devicesWithIp = allDevices.filter(d => d.ipAddress);
        
        // Check for stale devices - only mark offline if BOTH stale threshold exceeded AND ping fails
        const stalenessThresholdMs = intervalMs * 2;
        const now = Date.now();
        let staleCount = 0;
        let staleStillPingableCount = 0;
        
        for (const device of devicesWithIp) {
          if (device.lastSeen && device.status !== 'offline') {
            const lastSeenTime = new Date(device.lastSeen).getTime();
            const timeSinceLastSeen = now - lastSeenTime;
            
            if (timeSinceLastSeen > stalenessThresholdMs) {
              // Device hasn't been seen for too long - verify ping before marking offline
              const pingResult = await pingDevice(device.ipAddress!);
              
              if (pingResult.success) {
                // Ping still succeeds - keep in stale state, don't mark offline
                staleStillPingableCount++;
                console.log(`[${new Date().toISOString()}] [Probing] ${device.name} (${device.ipAddress}): stale threshold exceeded (${Math.round(timeSinceLastSeen / 1000)}s) but ping succeeded (RTT: ${pingResult.rtt}ms) - staying stale`);
                continue; // Skip marking offline
              }
              
              // Ping failed - now mark as truly offline
              const oldStatus = device.status;
              await storage.updateDevice(device.id, { status: 'offline' });
              device.status = 'offline'; // Update local copy too
              staleCount++;
              
              console.log(`[${new Date().toISOString()}] [Probing] ${device.name} (${device.ipAddress}): marked offline (stale ${Math.round(timeSinceLastSeen / 1000)}s, ping failed)`);
              
              // Log status change
              try {
                await storage.createLog({
                  deviceId: device.id,
                  eventType: 'status_change',
                  severity: 'error',
                  message: `Device ${device.name} (${device.ipAddress}) marked offline (stale ${Math.round(timeSinceLastSeen / 1000)}s and ping failed)`,
                  oldStatus,
                  newStatus: 'offline',
                  metadata: { ipAddress: device.ipAddress },
                });
              } catch (error: any) {
                console.error(`[Logging] Error creating stale log for ${device.name}:`, error.message);
              }
              
              // Send notifications for stale device going offline (only when ping also failed)
              try {
                await sendDeviceNotifications(device, 'offline', oldStatus);
              } catch (error: any) {
                console.error(`[Notification] Error sending stale notifications for ${device.name}:`, error.message);
              }
            }
          }
        }
        
        if (staleCount > 0 || staleStillPingableCount > 0) {
          if (staleCount > 0 && staleStillPingableCount > 0) {
            console.log(`[Probing] Stale check before cycle #${probeCycle}: ${staleCount} marked offline (ping failed), ${staleStillPingableCount} still pingable (staying stale)`);
          } else if (staleCount > 0) {
            console.log(`[Probing] Marked ${staleCount} stale device(s) as offline (ping failed) before cycle #${probeCycle}`);
          } else {
            console.log(`[Probing] ${staleStillPingableCount} stale device(s) still pingable before cycle #${probeCycle} - not marking offline`);
          }
        }
        
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
        
        currentPhase = 'device probing';
        const results = await processConcurrentQueue(devicesWithIp, probingDefaults.concurrentProbeThreads, isDetailedCycle, devicesNeedingSnmp, probingDefaults);
        
        // Analyze probe results to detect mass failures
        const totalProbed = results.length;
        const successCount = results.filter(r => r.success).length;
        const timeoutCount = results.filter(r => r.timeout).length;
        const errorCount = results.filter(r => !r.success && !r.timeout && r.error).length;
        const failureRate = totalProbed > 0 ? ((totalProbed - successCount) / totalProbed * 100).toFixed(1) : '0';
        
        const elapsed = Date.now() - startTime;
        
        // Log summary if there were any failures
        if (totalProbed > 0 && successCount < totalProbed) {
          // Log warning if more than 50% of devices failed - indicates potential systemic issue
          if (successCount < totalProbed * 0.5) {
            console.warn(`[Probing] MASS FAILURE DETECTED - Cycle #${probeCycle}: ${successCount}/${totalProbed} succeeded (${failureRate}% failure rate), ${timeoutCount} timeouts, ${errorCount} errors, took ${elapsed}ms`);
            
            // Log sample of failed devices for debugging
            const failedDevices = results.filter(r => !r.success).slice(0, 5);
            for (const fd of failedDevices) {
              console.warn(`[Probing]   - ${fd.device.name} (${fd.device.ipAddress}): ${fd.timeout ? 'timeout' : fd.error || 'unknown error'}`);
            }
          } else {
            // Normal failure logging
            console.log(`[Probing] Cycle #${probeCycle}: ${successCount}/${totalProbed} devices online, ${timeoutCount} timeouts, took ${elapsed}ms`);
          }
        }
        // Log cycle completion with timing info
        if (elapsed > intervalMs) {
          console.warn(`[Probing] Cycle #${probeCycle} overran interval: took ${elapsed}ms vs ${intervalMs}ms target`);
        }
      } catch (error) {
        console.error('[Probing] Error in periodic probing:', error);
      } finally {
        currentPhase = '';
        
        // Schedule next cycle: wait remaining time if cycle was fast, or start immediately if it was slow
        const elapsed = Date.now() - startTime;
        const waitTime = Math.max(0, intervalMs - elapsed);
        
        if (waitTime > 0) {
          setTimeout(runProbeCycle, waitTime);
        } else {
          // Cycle took longer than interval - start next one immediately
          // Use setImmediate to prevent stack overflow on very fast cycles
          setImmediate(runProbeCycle);
        }
      }
    }
    
    // Initialize all devices to "online" status on server startup (without notifications)
    // This prevents false "device offline" notifications when the server restarts
    async function initializeDeviceStatus() {
      try {
        const allDevices = await storage.getAllDevices();
        const devicesWithIp = allDevices.filter(d => d.ipAddress);
        let initializedCount = 0;
        
        for (const device of devicesWithIp) {
          // Set device to online and clear lastSeen so staleness check doesn't trigger immediately
          // The first probe cycle will establish the actual status and lastSeen
          await storage.updateDevice(device.id, { 
            status: 'online',
            lastSeen: null  // Clear lastSeen so staleness check is skipped until first successful probe
          });
          initializedCount++;
        }
        
        if (initializedCount > 0) {
          console.log(`[Probing] Server startup: initialized ${initializedCount} device(s) to online status (no notifications)`);
        }
        console.log(`[Probing] Ready to probe ${devicesWithIp.length} device(s)`);
      } catch (error) {
        console.error('[Probing] Error initializing device status:', error);
      }
    }
    
    // Initialize devices, then start the first probe cycle
    initializeDeviceStatus().then(() => {
      setTimeout(runProbeCycle, 5000);
    });
  }
  
  // Traffic monitoring for connections with monitorInterface set
  const TRAFFIC_CONCURRENT_PROBES = 40; // Parallel traffic probes
  const TRAFFIC_PROBE_TIMEOUT = 30000; // 30 second timeout per traffic probe (must be > 25s SNMP walk timeout)
  
  async function probeConnectionTraffic(allDevices: Device[]) {
    try {
      const monitoredConnections = await storage.getMonitoredConnections();
      if (monitoredConnections.length === 0) return;
      
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
    const hasIndex = storedSnmpIndex !== undefined;
    
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
      
      const hasPrevIn = previousStats?.previousInOctets !== undefined;
      const hasPrevOut = previousStats?.previousOutOctets !== undefined;
      const hasPrevAt = !!previousStats?.previousSampleAt;
      
      if (currentInValid && currentOutValid && hasPrevIn && hasPrevOut && hasPrevAt &&
          typeof previousStats.previousInOctets === 'number' && !isNaN(previousStats.previousInOctets) &&
          typeof previousStats.previousOutOctets === 'number' && !isNaN(previousStats.previousOutOctets)) {
        const prevTimestamp = new Date(previousStats.previousSampleAt!).getTime();
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
      return;
    }
    
    isPollingTraffic = true;
    trafficCycle++;
    
    try {
      const allDevices = await storage.getAllDevices();
      await probeConnectionTraffic(allDevices);
    } catch (error: any) {
      console.error('[Traffic] Error in traffic polling:', error.message);
    } finally {
      isPollingTraffic = false;
      trafficCycleCompleted++;
    }
  }
  
  async function startTrafficPolling() {
    // Run first cycle immediately, then schedule subsequent cycles
    runTrafficCycle();
    setInterval(runTrafficCycle, TRAFFIC_POLLING_INTERVAL);
  }
  
  // ============ BACKUP/RESTORE ROUTES ============
  
  // Create a backup of all data
  app.post("/api/backups", requireAdmin as any, async (req, res) => {
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
  app.delete("/api/backups/:id", requireAdmin as any, async (req, res) => {
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
      
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting backup:', error);
      res.status(500).json({ error: 'Failed to delete backup' });
    }
  });
  
  // Restore from a backup (by ID)
  app.post("/api/backups/:id/restore", requireAdmin as any, async (req, res) => {
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
  app.post("/api/restore", requireAdmin as any, async (req, res) => {
    try {
      const backupData = req.body;
      
      if (!backupData || !backupData.data) {
        return res.status(400).json({ error: 'Invalid backup data format' });
      }
      
      await performRestore(backupData);
      
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
  app.patch("/api/backup-settings", requireAdmin as any, async (req, res) => {
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
      scheduledBackupTimer = setInterval(performScheduledBackup, intervalMs);
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

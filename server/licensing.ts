import { createHash } from 'crypto';
import { networkInterfaces, hostname } from 'os';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { db } from './db';
import { licenses, devices } from '@shared/schema';
import { eq, count } from 'drizzle-orm';

const LICENSE_FILE_PATH = './license.json';
const BUILD_DATE = process.env.BUILD_DATE || new Date().toISOString().split('T')[0];
const FREE_DEVICE_LIMIT = 10;

export interface LicenseInfo {
  tier: 'free' | 'pro';
  deviceLimit: number | null;
  currentDeviceCount: number;
  canAddDevice: boolean;
  purchaseDate: string | null;
  updatesValidUntil: string | null;
  isUpdateEntitled: boolean;
  fingerprint: string;
  isActivated: boolean;
}

export interface StoredLicense {
  licenseKey: string;
  tier: 'free' | 'pro';
  deviceLimit: number | null;
  fingerprint: string;
  purchaseDate: string | null;
  updatesValidUntil: string | null;
  signature: string;
}

export function generateFingerprint(): string {
  const parts: string[] = [];
  
  parts.push(hostname());
  
  const nets = networkInterfaces();
  const macs: string[] = [];
  for (const name of Object.keys(nets)) {
    const netInterface = nets[name];
    if (netInterface) {
      for (const net of netInterface) {
        if (net.mac && net.mac !== '00:00:00:00:00:00' && !net.internal) {
          macs.push(net.mac);
        }
      }
    }
  }
  macs.sort();
  if (macs.length > 0) {
    parts.push(macs[0]);
  }
  
  try {
    if (existsSync('/etc/machine-id')) {
      const machineId = readFileSync('/etc/machine-id', 'utf-8').trim();
      parts.push(machineId);
    }
  } catch {
  }
  
  const combined = parts.join('|');
  return createHash('sha256').update(combined).digest('hex').substring(0, 32);
}

export function getStoredLicense(): StoredLicense | null {
  try {
    if (existsSync(LICENSE_FILE_PATH)) {
      const content = readFileSync(LICENSE_FILE_PATH, 'utf-8');
      return JSON.parse(content) as StoredLicense;
    }
  } catch {
  }
  return null;
}

export function storeLicense(license: StoredLicense): void {
  writeFileSync(LICENSE_FILE_PATH, JSON.stringify(license, null, 2));
}

export function validateLicense(license: StoredLicense): boolean {
  const currentFingerprint = generateFingerprint();
  if (license.fingerprint !== currentFingerprint) {
    return false;
  }
  return true;
}

export function isUpdateEntitled(license: StoredLicense | null): boolean {
  if (!license || license.tier === 'free') {
    return false;
  }
  
  if (!license.updatesValidUntil) {
    return true;
  }
  
  const expiryDate = new Date(license.updatesValidUntil);
  const buildDate = new Date(BUILD_DATE);
  
  return buildDate <= expiryDate;
}

export async function getDeviceCount(): Promise<number> {
  const result = await db.select({ count: count() }).from(devices);
  return result[0]?.count || 0;
}

export async function getLicenseInfo(): Promise<LicenseInfo> {
  const fingerprint = generateFingerprint();
  const storedLicense = getStoredLicense();
  const deviceCount = await getDeviceCount();
  
  if (storedLicense && validateLicense(storedLicense)) {
    const deviceLimit = storedLicense.deviceLimit;
    const canAdd = deviceLimit === null || deviceCount < deviceLimit;
    
    return {
      tier: storedLicense.tier,
      deviceLimit: storedLicense.deviceLimit,
      currentDeviceCount: deviceCount,
      canAddDevice: canAdd,
      purchaseDate: storedLicense.purchaseDate,
      updatesValidUntil: storedLicense.updatesValidUntil,
      isUpdateEntitled: isUpdateEntitled(storedLicense),
      fingerprint,
      isActivated: true,
    };
  }
  
  return {
    tier: 'free',
    deviceLimit: FREE_DEVICE_LIMIT,
    currentDeviceCount: deviceCount,
    canAddDevice: deviceCount < FREE_DEVICE_LIMIT,
    purchaseDate: null,
    updatesValidUntil: null,
    isUpdateEntitled: false,
    fingerprint,
    isActivated: false,
  };
}

export async function canAddDevice(): Promise<{ allowed: boolean; reason?: string }> {
  const info = await getLicenseInfo();
  
  if (!info.canAddDevice) {
    if (info.tier === 'free') {
      return {
        allowed: false,
        reason: `Free tier is limited to ${FREE_DEVICE_LIMIT} devices. Upgrade to Pro for unlimited devices.`,
      };
    }
    return {
      allowed: false,
      reason: `Device limit of ${info.deviceLimit} reached. Contact support to increase your limit.`,
    };
  }
  
  return { allowed: true };
}

export async function canModifyDevices(): Promise<{ allowed: boolean; reason?: string; readOnly: boolean }> {
  const info = await getLicenseInfo();
  
  // If we have a valid Pro license, all modifications are allowed
  if (info.isActivated && info.tier === 'pro') {
    return { allowed: true, readOnly: false };
  }
  
  // If device count is within free tier limit, modifications are allowed
  if (info.currentDeviceCount <= FREE_DEVICE_LIMIT) {
    return { allowed: true, readOnly: false };
  }
  
  // Over free tier limit without valid license = read-only mode
  return {
    allowed: false,
    readOnly: true,
    reason: `Read-only mode: You have ${info.currentDeviceCount} devices but no Pro license. Existing devices continue working, but editing connection-critical fields (IP, credentials, type) is disabled. Upgrade to Pro to unlock full editing.`,
  };
}

export async function canDeleteDevices(): Promise<{ allowed: boolean; reason?: string }> {
  const info = await getLicenseInfo();
  
  // If we have a valid Pro license, deletion is allowed
  if (info.isActivated && info.tier === 'pro') {
    return { allowed: true };
  }
  
  // If device count is within free tier limit, deletion is allowed
  if (info.currentDeviceCount <= FREE_DEVICE_LIMIT) {
    return { allowed: true };
  }
  
  // Over free tier limit without valid license = no deletion (prevents gaming the limit)
  return {
    allowed: false,
    reason: `Read-only mode: Deleting devices is disabled when over the free tier limit without a Pro license. This prevents circumventing the device limit.`,
  };
}

export async function activateLicense(
  licenseKey: string,
  tier: 'free' | 'pro',
  deviceLimit: number | null,
  purchaseDate: string,
  updatesValidUntil: string,
  signature: string
): Promise<{ success: boolean; error?: string }> {
  const fingerprint = generateFingerprint();
  
  const license: StoredLicense = {
    licenseKey,
    tier,
    deviceLimit,
    fingerprint,
    purchaseDate,
    updatesValidUntil,
    signature,
  };
  
  storeLicense(license);
  
  try {
    const existing = await db.select().from(licenses).where(eq(licenses.licenseKey, licenseKey));
    
    if (existing.length === 0) {
      await db.insert(licenses).values({
        licenseKey,
        tier,
        fingerprint,
        deviceLimit,
        purchaseDate: new Date(purchaseDate),
        updatesValidUntil: new Date(updatesValidUntil),
        activatedAt: new Date(),
      });
    } else {
      await db.update(licenses)
        .set({
          tier,
          fingerprint,
          deviceLimit,
          purchaseDate: new Date(purchaseDate),
          updatesValidUntil: new Date(updatesValidUntil),
          activatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(licenses.licenseKey, licenseKey));
    }
  } catch (error) {
    console.error('Failed to save license to database:', error);
  }
  
  return { success: true };
}

export function getBuildDate(): string {
  return BUILD_DATE;
}

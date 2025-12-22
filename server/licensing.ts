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
  try {
    writeFileSync(LICENSE_FILE_PATH, JSON.stringify(license, null, 2));
    console.log('[License] Saved license to', LICENSE_FILE_PATH);
  } catch (error) {
    console.error('[License] Failed to save license file:', error);
    throw error;
  }
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
  console.log('[License] Activating license:', licenseKey, 'tier:', tier, 'fingerprint:', fingerprint);
  
  const license: StoredLicense = {
    licenseKey,
    tier,
    deviceLimit,
    fingerprint,
    purchaseDate,
    updatesValidUntil,
    signature,
  };
  
  // Store to local file first (primary storage)
  try {
    storeLicense(license);
  } catch (error) {
    console.error('[License] Failed to store license to file:', error);
    return { success: false, error: 'Failed to save license file. Check file permissions.' };
  }
  
  // Also try to store in database (optional, for backup/tracking)
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
      console.log('[License] License saved to database');
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
      console.log('[License] License updated in database');
    }
  } catch (error) {
    // Database storage is optional - license.json is the primary storage
    console.warn('[License] Failed to save license to database (non-fatal):', error);
  }
  
  console.log('[License] Activation successful');
  return { success: true };
}

export function getBuildDate(): string {
  return BUILD_DATE;
}

// App version from package.json (or env)
const APP_VERSION = process.env.APP_VERSION || '1.0.0';

export function getAppVersion(): string {
  return APP_VERSION;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  buildDate?: string;
  changelog?: string;
  fileSize?: number;
  sha256?: string;
  status: 'allowed' | 'warning' | 'error';
  reason?: string;
  downloadUrl?: string;
  downloadToken?: string;
}

/**
 * Check for updates from the licensing server
 * @param licensingServerUrl Base URL of the licensing server (e.g., https://license.example.com)
 */
export async function checkForUpdates(licensingServerUrl?: string): Promise<UpdateCheckResult> {
  // Default to localhost for development, should be configured in production
  const baseUrl = licensingServerUrl || process.env.LICENSING_SERVER_URL || 'http://localhost:3001';
  
  const storedLicense = getStoredLicense();
  const fingerprint = generateFingerprint();
  
  try {
    const response = await fetch(`${baseUrl}/api/releases/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        licenseKey: storedLicense?.licenseKey,
        fingerprint: storedLicense ? fingerprint : undefined,
        currentVersion: APP_VERSION,
        channel: 'stable',
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('[License] Update check failed:', error);
      return {
        updateAvailable: false,
        currentVersion: APP_VERSION,
        status: 'error',
        reason: 'Failed to check for updates',
      };
    }
    
    const data = await response.json();
    
    return {
      updateAvailable: data.updateAvailable,
      currentVersion: APP_VERSION,
      latestVersion: data.latestVersion,
      buildDate: data.buildDate,
      changelog: data.changelog,
      fileSize: data.fileSize,
      sha256: data.sha256,
      status: data.status || 'allowed',
      reason: data.reason,
      downloadUrl: data.downloadUrl,
      downloadToken: data.downloadToken,
    };
  } catch (error) {
    console.error('[License] Update check error:', error);
    return {
      updateAvailable: false,
      currentVersion: APP_VERSION,
      status: 'error',
      reason: 'Unable to connect to licensing server',
    };
  }
}

/**
 * Get latest release info from the licensing server
 */
export async function getLatestRelease(licensingServerUrl?: string): Promise<{
  version: string;
  channel: string;
  buildDate: string;
  changelog?: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  downloadUrl: string;
} | null> {
  const baseUrl = licensingServerUrl || process.env.LICENSING_SERVER_URL || 'http://localhost:3001';
  
  try {
    const response = await fetch(`${baseUrl}/api/releases/latest`);
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    
    return {
      version: data.version,
      channel: data.channel,
      buildDate: data.build_date,
      changelog: data.changelog,
      fileName: data.file_name,
      fileSize: data.file_size_bytes,
      sha256: data.sha256,
      downloadUrl: data.downloadUrl,
    };
  } catch (error) {
    console.error('[License] Failed to get latest release:', error);
    return null;
  }
}

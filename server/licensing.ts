import { createHash } from 'crypto';
import { networkInterfaces, hostname } from 'os';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { db } from './db';
import { licenses, devices } from '@shared/schema';
import { eq, count, sql, ne } from 'drizzle-orm';

const LICENSE_FILE_PATH = './license.json';
const BUILD_DATE = process.env.BUILD_DATE || new Date().toISOString().split('T')[0];
const FREE_DEVICE_LIMIT = 10;
const DEVICE_PACK_SIZE = 10; // Each device pack license adds 10 devices

export type LicenseTier = 'free' | 'pro' | 'device_pack';

export interface LicenseInfo {
  tier: LicenseTier;
  effectiveTier: 'free' | 'pro' | 'device_pack'; // The tier used for display
  deviceLimit: number | null;
  currentDeviceCount: number;
  canAddDevice: boolean;
  purchaseDate: string | null;
  updatesValidUntil: string | null;
  isUpdateEntitled: boolean;
  fingerprint: string;
  isActivated: boolean;
  licenses: StoredLicense[]; // All activated licenses
  totalPackDevices: number; // Total devices from all device packs
}

export interface StoredLicense {
  licenseKey: string;
  tier: LicenseTier;
  deviceLimit: number | null; // For device_pack, this is typically 10
  fingerprint: string;
  purchaseDate: string | null;
  updatesValidUntil: string | null;
  signature: string;
}

// Storage format that supports multiple licenses
export interface LicenseStorage {
  licenses: StoredLicense[];
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

// Get all stored licenses (supports both old single-license and new multi-license format)
export function getStoredLicenses(): StoredLicense[] {
  try {
    if (existsSync(LICENSE_FILE_PATH)) {
      const content = readFileSync(LICENSE_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(content);
      
      // Check if it's the new multi-license format
      if (parsed.licenses && Array.isArray(parsed.licenses)) {
        return parsed.licenses as StoredLicense[];
      }
      
      // Old single-license format - convert to array
      if (parsed.licenseKey) {
        return [parsed as StoredLicense];
      }
    }
  } catch {
  }
  return [];
}

// Legacy function for backward compatibility
export function getStoredLicense(): StoredLicense | null {
  const licenses = getStoredLicenses();
  // Return the "primary" license (pro > device_pack > first)
  const proLicense = licenses.find(l => l.tier === 'pro');
  if (proLicense) return proLicense;
  
  return licenses.length > 0 ? licenses[0] : null;
}

// Store all licenses
export function storeLicenses(licenses: StoredLicense[]): void {
  try {
    const storage: LicenseStorage = { licenses };
    writeFileSync(LICENSE_FILE_PATH, JSON.stringify(storage, null, 2));
    console.log('[License] Saved', licenses.length, 'license(s) to', LICENSE_FILE_PATH);
  } catch (error) {
    console.error('[License] Failed to save license file:', error);
    throw error;
  }
}

// Legacy function - adds or updates a single license
export function storeLicense(license: StoredLicense): void {
  const existing = getStoredLicenses();
  const index = existing.findIndex(l => l.licenseKey === license.licenseKey);
  
  if (index >= 0) {
    existing[index] = license;
  } else {
    existing.push(license);
  }
  
  storeLicenses(existing);
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

// Get device count excluding placeholder devices (placeholders don't count toward license)
export async function getDeviceCount(): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(devices)
    .where(sql`${devices.type} != 'placeholder'`);
  return result[0]?.count || 0;
}

export async function getLicenseInfo(): Promise<LicenseInfo> {
  const fingerprint = generateFingerprint();
  const allLicenses = getStoredLicenses();
  const deviceCount = await getDeviceCount();
  
  // Filter to only valid licenses (matching fingerprint)
  const validLicenses = allLicenses.filter(l => validateLicense(l));
  
  // Check for a pro license (unlimited)
  const proLicense = validLicenses.find(l => l.tier === 'pro');
  if (proLicense) {
    return {
      tier: 'pro',
      effectiveTier: 'pro',
      deviceLimit: null, // Unlimited
      currentDeviceCount: deviceCount,
      canAddDevice: true,
      purchaseDate: proLicense.purchaseDate,
      updatesValidUntil: proLicense.updatesValidUntil,
      isUpdateEntitled: isUpdateEntitled(proLicense),
      fingerprint,
      isActivated: true,
      licenses: validLicenses,
      totalPackDevices: 0,
    };
  }
  
  // Calculate total devices from device_pack licenses
  const packLicenses = validLicenses.filter(l => l.tier === 'device_pack');
  const totalPackDevices = packLicenses.reduce((sum, l) => sum + (l.deviceLimit || DEVICE_PACK_SIZE), 0);
  
  // Total device limit = free tier + all pack licenses
  const totalDeviceLimit = FREE_DEVICE_LIMIT + totalPackDevices;
  
  if (packLicenses.length > 0) {
    // Find most recent purchase date and latest update entitlement
    const sortedByDate = [...packLicenses].sort((a, b) => 
      new Date(b.purchaseDate || 0).getTime() - new Date(a.purchaseDate || 0).getTime()
    );
    const latestLicense = sortedByDate[0];
    
    // Check if any license has update entitlement
    const hasUpdateEntitlement = packLicenses.some(l => isUpdateEntitled(l));
    
    return {
      tier: 'device_pack',
      effectiveTier: 'device_pack',
      deviceLimit: totalDeviceLimit,
      currentDeviceCount: deviceCount,
      canAddDevice: deviceCount < totalDeviceLimit,
      purchaseDate: latestLicense?.purchaseDate || null,
      updatesValidUntil: latestLicense?.updatesValidUntil || null,
      isUpdateEntitled: hasUpdateEntitlement,
      fingerprint,
      isActivated: true,
      licenses: validLicenses,
      totalPackDevices,
    };
  }
  
  // No paid licenses - free tier
  return {
    tier: 'free',
    effectiveTier: 'free',
    deviceLimit: FREE_DEVICE_LIMIT,
    currentDeviceCount: deviceCount,
    canAddDevice: deviceCount < FREE_DEVICE_LIMIT,
    purchaseDate: null,
    updatesValidUntil: null,
    isUpdateEntitled: false,
    fingerprint,
    isActivated: false,
    licenses: [],
    totalPackDevices: 0,
  };
}

export async function canAddDevice(): Promise<{ allowed: boolean; reason?: string }> {
  const info = await getLicenseInfo();
  
  if (!info.canAddDevice) {
    if (info.tier === 'free') {
      return {
        allowed: false,
        reason: `Free tier is limited to ${FREE_DEVICE_LIMIT} devices. Purchase a Device Pack (+10 devices) or upgrade to Pro for unlimited devices.`,
      };
    }
    if (info.tier === 'device_pack') {
      return {
        allowed: false,
        reason: `Device limit of ${info.deviceLimit} reached (${FREE_DEVICE_LIMIT} free + ${info.totalPackDevices} from packs). Add another Device Pack or upgrade to Pro.`,
      };
    }
    return {
      allowed: false,
      reason: `Device limit of ${info.deviceLimit} reached. Add a Device Pack or contact support.`,
    };
  }
  
  return { allowed: true };
}

export async function canModifyDevices(): Promise<{ allowed: boolean; reason?: string; readOnly: boolean }> {
  const info = await getLicenseInfo();
  
  // If we have a valid Pro or device_pack license, all modifications are allowed
  if (info.isActivated && (info.tier === 'pro' || info.tier === 'device_pack')) {
    return { allowed: true, readOnly: false };
  }
  
  // If device count is within device limit (free or licensed), modifications are allowed
  if (info.deviceLimit && info.currentDeviceCount <= info.deviceLimit) {
    return { allowed: true, readOnly: false };
  }
  
  // Over device limit without valid license = read-only mode
  return {
    allowed: false,
    readOnly: true,
    reason: `Read-only mode: You have ${info.currentDeviceCount} devices but your license only allows ${info.deviceLimit}. Existing devices continue working, but editing connection-critical fields is disabled. Add a Device Pack or upgrade to Pro.`,
  };
}

export async function canDeleteDevices(): Promise<{ allowed: boolean; reason?: string }> {
  const info = await getLicenseInfo();
  
  // If we have a valid Pro or device_pack license, deletion is allowed
  if (info.isActivated && (info.tier === 'pro' || info.tier === 'device_pack')) {
    return { allowed: true };
  }
  
  // If device count is within device limit, deletion is allowed
  if (info.deviceLimit && info.currentDeviceCount <= info.deviceLimit) {
    return { allowed: true };
  }
  
  // Over device limit without valid license = no deletion
  return {
    allowed: false,
    reason: `Deleting devices is disabled when over your device limit. Add a Device Pack or upgrade to Pro.`,
  };
}

export async function activateLicense(
  licenseKey: string,
  tier: LicenseTier,
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

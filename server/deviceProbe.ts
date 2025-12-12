import { RouterOSAPI } from 'node-routeros';
import * as snmp from 'net-snmp';
import { execFile } from 'child_process';
import { isIP, Socket } from 'net';
import * as https from 'https';
import * as http from 'http';

// Sanitize SNMP string values - removes invalid Unicode, control chars, and null bytes
// This prevents "unsupported Unicode escape sequence" errors in PostgreSQL JSON columns
function sanitizeSnmpString(value: any): string {
  if (value === null || value === undefined) return '';
  let str = value.toString();
  // Remove null bytes and other control characters (except newline, tab)
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Replace invalid UTF-8 sequences
  str = str.replace(/[\uFFFD\uFFFE\uFFFF]/g, '');
  // Remove any remaining non-printable characters
  str = str.replace(/[^\x20-\x7E\xA0-\xFF\u0100-\uFFFF]/g, '');
  return str.trim();
}

// Interface cache: stores port data with TTL to avoid slow SNMP walks during fast probe cycles
// Key: IP address, Value: { ports, timestamp, collecting }
const interfaceCache: Map<string, { 
  ports: any[]; 
  timestamp: number; 
  collecting: boolean;  // Prevents concurrent collection
}> = new Map();

const INTERFACE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const INTERFACE_COLLECT_TIMEOUT_MS = 60000; // 60 seconds for background collection

// Check if cached interface data is fresh
function getCachedInterfaces(ipAddress: string): any[] | null {
  const cached = interfaceCache.get(ipAddress);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > INTERFACE_CACHE_TTL_MS) return null;
  return cached.ports;
}

// Mark device as collecting interfaces (to prevent concurrent collections)
function isCollectingInterfaces(ipAddress: string): boolean {
  return interfaceCache.get(ipAddress)?.collecting || false;
}

function setCollectingInterfaces(ipAddress: string, collecting: boolean): void {
  const cached = interfaceCache.get(ipAddress);
  if (cached) {
    cached.collecting = collecting;
  } else {
    interfaceCache.set(ipAddress, { ports: [], timestamp: 0, collecting });
  }
}

function setCachedInterfaces(ipAddress: string, ports: any[]): void {
  interfaceCache.set(ipAddress, { ports, timestamp: Date.now(), collecting: false });
}

// Background interface collection - runs with longer timeouts, one OID at a time
export async function collectInterfacesBackground(
  ipAddress: string,
  community: string,
  snmpVersion: string = '2c',
  credentials?: any
): Promise<any[]> {
  if (isCollectingInterfaces(ipAddress)) {
    console.log(`[SNMP] Already collecting interfaces for ${ipAddress}, skipping`);
    return getCachedInterfaces(ipAddress) || [];
  }
  
  setCollectingInterfaces(ipAddress, true);
  console.log(`[SNMP] Starting background interface collection for ${ipAddress}`);
  
  try {
    const portMap: { [key: string]: any } = {};
    
    // Walk each OID using subtree with duplicate detection
    // Some switches (Brocade) return duplicate OIDs instead of endOfMibView, causing walk() to loop forever
    const walkOid = async (oid: string, oidName: string): Promise<any[]> => {
      const startTime = Date.now();
      return new Promise((resolve) => {
        const allVarbinds: any[] = [];
        const seenOids = new Set<string>();
        const version = snmpVersion === '1' ? snmp.Version1 : snmp.Version2c;
        let resolved = false;
        let lastOid = '';
        
        // Compare OIDs numerically (string comparison fails: "1.10" < "1.9" because "1" < "9")
        const compareOids = (oid1: string, oid2: string): number => {
          const parts1 = oid1.split('.').map(Number);
          const parts2 = oid2.split('.').map(Number);
          for (let i = 0; i < Math.min(parts1.length, parts2.length); i++) {
            if (parts1[i] < parts2[i]) return -1;
            if (parts1[i] > parts2[i]) return 1;
          }
          return parts1.length - parts2.length;
        };
        
        const session = snmp.createSession(ipAddress, community, {
          port: 161,
          retries: 1,
          timeout: 10000,
          version,
        });
        
        const cleanup = (reason: string) => {
          if (resolved) return;
          resolved = true;
          const elapsed = Date.now() - startTime;
          // De-duplicate final results by OID
          const uniqueVarbinds = allVarbinds.filter((vb, idx) => {
            const oidStr = vb.oid;
            return allVarbinds.findIndex(v => v.oid === oidStr) === idx;
          });
          console.log(`[SNMP] ${ipAddress} ${oidName}: ${uniqueVarbinds.length} values in ${elapsed}ms (${reason})`);
          try { session.close(); } catch (e) {}
          resolve(uniqueVarbinds);
        };
        
        session.on('error', (err: any) => {
          cleanup(`error: ${err?.message || 'unknown'}`);
        });
        
        // Use subtree instead of walk - more predictable behavior
        session.subtree(oid, (varbinds: any[]) => {
          for (const vb of varbinds) {
            if (snmp.isVarbindError(vb)) continue;
            
            const vbOid = vb.oid;
            
            // Detect duplicate OID (Brocade bug: agent sends same OIDs repeatedly)
            if (seenOids.has(vbOid)) {
              cleanup('duplicate OID detected');
              return;
            }
            
            // Detect non-increasing OID using numeric comparison (walk going backwards = end of table)
            if (lastOid && compareOids(vbOid, lastOid) <= 0) {
              cleanup('non-increasing OID');
              return;
            }
            
            seenOids.add(vbOid);
            lastOid = vbOid;
            allVarbinds.push(vb);
          }
        }, (error: any) => {
          cleanup(error ? `subtree error: ${error.message}` : 'complete');
        });
        
        // Hard timeout - 30 seconds max
        setTimeout(() => {
          cleanup('timeout');
        }, 30000);
      });
    };
    
    // Sequential walks - slower but reliable
    console.log(`[SNMP] ${ipAddress}: Starting 6 sequential OID walks...`);
    const ifDescrVbs = await walkOid('1.3.6.1.2.1.2.2.1.2', 'ifDescr');
    const ifSpeedVbs = await walkOid('1.3.6.1.2.1.2.2.1.5', 'ifSpeed');
    const ifOperStatusVbs = await walkOid('1.3.6.1.2.1.2.2.1.8', 'ifOperStatus');
    const ifNameVbs = await walkOid('1.3.6.1.2.1.31.1.1.1.1', 'ifName');
    const ifHighSpeedVbs = await walkOid('1.3.6.1.2.1.31.1.1.1.15', 'ifHighSpeed');
    const ifAliasVbs = await walkOid('1.3.6.1.2.1.31.1.1.1.18', 'ifAlias');
    console.log(`[SNMP] ${ipAddress}: All 6 walks completed`);
    
    // Process results - use sanitizeSnmpString to prevent DB Unicode errors
    ifDescrVbs.forEach((vb: any) => {
      const parts = vb.oid.split('.');
      const ifIndex = parts[parts.length - 1];
      if (!portMap[ifIndex]) portMap[ifIndex] = { ifIndex };
      portMap[ifIndex].ifDescr = sanitizeSnmpString(vb.value);
    });
    
    ifSpeedVbs.forEach((vb: any) => {
      const parts = vb.oid.split('.');
      const ifIndex = parts[parts.length - 1];
      if (!portMap[ifIndex]) portMap[ifIndex] = { ifIndex };
      const speedBps = parseInt(sanitizeSnmpString(vb.value)) || 0;
      portMap[ifIndex].speedBps = speedBps;
      // Mark if ifSpeed is at/near 32-bit max (gauge overflow for 10G+ interfaces)
      portMap[ifIndex].speedGaugeOverflow = speedBps >= 4000000000;
    });
    
    ifOperStatusVbs.forEach((vb: any) => {
      const parts = vb.oid.split('.');
      const ifIndex = parts[parts.length - 1];
      if (!portMap[ifIndex]) portMap[ifIndex] = { ifIndex };
      const statusCode = parseInt(sanitizeSnmpString(vb.value)) || 0;
      portMap[ifIndex].operStatus = statusCode === 1 ? 'up' : statusCode === 2 ? 'down' : 'unknown';
    });
    
    ifNameVbs.forEach((vb: any) => {
      const parts = vb.oid.split('.');
      const ifIndex = parts[parts.length - 1];
      if (portMap[ifIndex]) {
        portMap[ifIndex].ifName = sanitizeSnmpString(vb.value);
      }
    });
    
    ifHighSpeedVbs.forEach((vb: any) => {
      const parts = vb.oid.split('.');
      const ifIndex = parts[parts.length - 1];
      if (portMap[ifIndex]) {
        const highSpeedMbps = parseInt(sanitizeSnmpString(vb.value)) || 0;
        portMap[ifIndex].highSpeedMbps = highSpeedMbps;
        // ifHighSpeed is in Mbps, always prefer it over ifSpeed when available
        if (highSpeedMbps > 0) {
          portMap[ifIndex].speedBps = highSpeedMbps * 1000000;
          portMap[ifIndex].speedGaugeOverflow = false; // Fixed by ifHighSpeed
        }
      }
    });
    
    ifAliasVbs.forEach((vb: any) => {
      const parts = vb.oid.split('.');
      const ifIndex = parts[parts.length - 1];
      if (portMap[ifIndex]) {
        const alias = sanitizeSnmpString(vb.value);
        if (alias && alias.length > 0) {
          portMap[ifIndex].ifAlias = alias;
        }
      }
    });
    
    const formatSpeed = (bps: number, gaugeOverflow?: boolean): string => {
      // If gauge overflow and no ifHighSpeed fix, show as 10G+ (common for VMware/hypervisors)
      if (gaugeOverflow) return '10Gbps+';
      // Cap at reasonable max speed (400Gbps) - higher values are likely gauge overflow
      if (bps > 400000000000) return undefined as any; // Will be filtered out
      if (bps >= 1000000000000) return `${(bps / 1000000000000).toFixed(1)}Tbps`;
      if (bps >= 1000000000) return `${(bps / 1000000000).toFixed(0)}Gbps`;
      if (bps >= 1000000) return `${(bps / 1000000).toFixed(0)}Mbps`;
      if (bps >= 1000) return `${(bps / 1000).toFixed(0)}Kbps`;
      return `${bps}bps`;
    };
    
    // Validate port name - reject numeric-only names, very short names, or obvious garbage
    const isValidPortName = (name: string): boolean => {
      if (!name || name.length < 2) return false;
      if (name === 'unknown') return false;
      // Reject pure numeric names (like "1", "65535", etc.)
      if (/^\d+$/.test(name)) return false;
      // Reject names that are just status codes or garbage
      if (['up', 'down', 'ok', 'error'].includes(name.toLowerCase())) return false;
      return true;
    };
    
    const ports = Object.values(portMap)
      .filter((p: any) => {
        // Must have ifDescr from the walk (not just entries created by other OID walks)
        if (!p.ifDescr) return false;
        
        const name = (p.ifName || p.ifDescr || '').toLowerCase();
        // Filter out loopback, null, and other system interfaces
        if (name.includes('loopback') || name.includes('null') || name === 'lo') return false;
        
        // Validate the port name
        const portName = p.ifName || p.ifDescr;
        if (!isValidPortName(portName)) return false;
        
        return true;
      })
      .map((p: any) => {
        const speed = p.speedBps ? formatSpeed(p.speedBps, p.speedGaugeOverflow) : undefined;
        return {
          name: p.ifName || p.ifDescr,
          defaultName: p.ifDescr,
          description: p.ifAlias || undefined,
          status: p.operStatus || 'unknown',
          speed: speed || undefined, // Filter out invalid speeds
          snmpIndex: parseInt(p.ifIndex) || undefined,
        };
      });
    
    console.log(`[SNMP] Background collection complete for ${ipAddress}: ${ports.length} interfaces`);
    setCachedInterfaces(ipAddress, ports);
    setCollectingInterfaces(ipAddress, false);
    return ports;
    
  } catch (error: any) {
    console.error(`[SNMP] Background collection failed for ${ipAddress}: ${error.message}`);
    setCollectingInterfaces(ipAddress, false);
    return getCachedInterfaces(ipAddress) || [];
  } finally {
    // Ensure collecting flag is always cleared
    setCollectingInterfaces(ipAddress, false);
  }
}

// Export for API to trigger manual refresh
export function clearInterfaceCache(ipAddress?: string): void {
  if (ipAddress) {
    interfaceCache.delete(ipAddress);
  } else {
    interfaceCache.clear();
  }
}

// Helper function to walk an SNMP table and return OID → value mapping
// Uses subtree() with maxRepetitions=1 for compatibility with various devices
async function walkSnmpTable(
  ipAddress: string, 
  community: string, 
  oid: string
): Promise<{ success: boolean; data?: { [oid: string]: string }; error?: string }> {
  return new Promise((resolve) => {
    let resolved = false;
    let sessionClosed = false;
    
    const session = snmp.createSession(ipAddress, community, {
      version: snmp.Version2c,
      timeout: 5000,
      retries: 1,
      port: 161,
      transport: 'udp4',
    });
    
    // Handle session errors to prevent crashes
    session.on('error', (err: any) => {
      if (!resolved) {
        cleanup(false, `Session error: ${err.message || err}`);
      }
    });
    
    const results: { [oid: string]: string } = {};
    
    const cleanup = (success: boolean, errorMsg?: string) => {
      if (resolved) return;
      resolved = true;
      if (!sessionClosed) {
        sessionClosed = true;
        try { session.close(); } catch (e) { /* ignore */ }
      }
      if (success) {
        resolve({ success: true, data: results });
      } else {
        resolve({ success: false, error: errorMsg });
      }
    };
    
    // Use subtree() with maxRepetitions=1 for maximum compatibility
    // Some devices don't handle GETBULK well
    session.subtree(oid, 1, (varbinds: any[]) => {
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) continue;
        results[vb.oid] = sanitizeSnmpString(vb.value);
      }
    }, (error: any) => {
      if (error) {
        // "End of MIB" is not really an error, it just means we've walked the whole subtree
        const errMsg = error.message || String(error);
        if (errMsg.includes('End of MIB') || errMsg.includes('endOfMibView')) {
          cleanup(true);
        } else {
          cleanup(false, `Subtree error: ${errMsg}`);
        }
      } else {
        cleanup(true);
      }
    });
    
    // Timeout protection
    setTimeout(() => {
      if (!resolved) {
        console.warn(`[SNMP] Timeout on ${ipAddress} after 10s`);
        cleanup(false, 'Timeout after 10s');
      }
    }, 10000);
  });
}

// Get SNMP system info (sysDescr and sysName) for better device identification
async function getSnmpSystemInfo(
  ipAddress: string,
  community: string
): Promise<{ success: boolean; sysDescr?: string; sysName?: string; error?: string }> {
  return new Promise((resolve) => {
    let resolved = false;
    
    const session = snmp.createSession(ipAddress, community, {
      version: snmp.Version2c,
      timeout: 5000,  // 5 seconds - some enterprise switches respond slowly
      retries: 2,
      port: 161,
      transport: 'udp4',
    });
    
    session.on('error', (err: any) => {
      if (!resolved) {
        resolved = true;
        try { session.close(); } catch (e) { /* ignore */ }
        resolve({ success: false, error: `Session error: ${err.message || err}` });
      }
    });
    
    // Get sysDescr.0 and sysName.0
    const oids = ['1.3.6.1.2.1.1.1.0', '1.3.6.1.2.1.1.5.0'];
    session.get(oids, (error: any, varbinds?: any[]) => {
      if (resolved) return;
      resolved = true;
      
      try { session.close(); } catch (e) { /* ignore */ }
      
      if (error) {
        resolve({ success: false, error: `GET error: ${error.message || error}` });
        return;
      }
      
      if (!varbinds || varbinds.length === 0) {
        resolve({ success: false, error: 'No varbinds returned' });
        return;
      }
      
      let sysDescr: string | undefined;
      let sysName: string | undefined;
      
      for (const vb of varbinds) {
        if (!snmp.isVarbindError(vb)) {
          const oid = vb.oid;
          const value = sanitizeSnmpString(vb.value);
          if (oid === '1.3.6.1.2.1.1.1.0') sysDescr = value;
          if (oid === '1.3.6.1.2.1.1.5.0') sysName = value;
        }
      }
      
      if (!sysDescr) {
        resolve({ success: false, error: 'No sysDescr returned' });
        return;
      }
      
      resolve({ success: true, sysDescr, sysName });
    });
    
    // Timeout protection - allow for retries
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { session.close(); } catch (e) { /* ignore */ }
        resolve({ success: false, error: 'Timeout after 12s' });
      }
    }, 12000);
  });
}

// Simple SNMP test function - tries a basic sysDescr GET to verify SNMP connectivity
async function testSnmpConnectivity(
  ipAddress: string,
  community: string
): Promise<{ success: boolean; sysDescr?: string; error?: string }> {
  return new Promise((resolve) => {
    let resolved = false;
    
    const session = snmp.createSession(ipAddress, community, {
      version: snmp.Version2c,
      timeout: 3000,
      retries: 1,
      port: 161,
      transport: 'udp4',
    });
    
    session.on('error', (err: any) => {
      if (!resolved) {
        resolved = true;
        try { session.close(); } catch (e) { /* ignore */ }
        resolve({ success: false, error: `Session error: ${err.message || err}` });
      }
    });
    
    // Try to get sysDescr.0 (1.3.6.1.2.1.1.1.0) - most basic SNMP test
    session.get(['1.3.6.1.2.1.1.1.0'], (error: any, varbinds?: any[]) => {
      if (resolved) return;
      resolved = true;
      
      try { session.close(); } catch (e) { /* ignore */ }
      
      if (error) {
        resolve({ success: false, error: `GET error: ${error.message || error}` });
        return;
      }
      
      if (!varbinds || varbinds.length === 0) {
        resolve({ success: false, error: 'No varbinds returned' });
        return;
      }
      
      if (snmp.isVarbindError(varbinds[0])) {
        resolve({ success: false, error: `Varbind error: ${snmp.varbindError(varbinds[0])}` });
        return;
      }
      
      resolve({ success: true, sysDescr: sanitizeSnmpString(varbinds[0].value) });
    });
    
    // Timeout protection
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { session.close(); } catch (e) { /* ignore */ }
        resolve({ success: false, error: 'Timeout after 4s' });
      }
    }, 4000);
  });
}

// Fetch SNMP interface indexes by walking ifDescr and building name→ifIndex map
// Uses EXACT string matching to avoid partial matches (e.g., "1" matching "sfp28-1")
// Supports both SNMPv2c and SNMPv3 based on credentials
async function fetchSnmpInterfaceIndexes(
  ipAddress: string,
  credentials?: any
): Promise<{ success: boolean; data?: { [interfaceName: string]: number }; error?: string }> {
  const snmpVersion = credentials?.snmpVersion || '2c';
  const community = credentials?.snmpCommunity || 'public';
  
  // For SNMPv2c, use the simpler walkSnmpTable function
  if (snmpVersion !== '3') {
    const walkResult = await walkSnmpTable(ipAddress, community, '1.3.6.1.2.1.2.2.1.2');
    
    if (!walkResult.success || !walkResult.data) {
      return { success: false, error: walkResult.error || 'No data returned' };
    }
    
    const indexMap: { [interfaceName: string]: number } = {};
    
    for (const [oid, ifDescr] of Object.entries(walkResult.data)) {
      const oidParts = oid.split('.');
      const ifIndex = parseInt(oidParts[oidParts.length - 1], 10);
      
      if (!isNaN(ifIndex) && ifDescr) {
        indexMap[ifDescr] = ifIndex;
      }
    }
    
    return { success: true, data: indexMap };
  }
  
  // For SNMPv3, create a v3 session and walk
  return new Promise((resolve) => {
    let resolved = false;
    let sessionClosed = false;
    
    const user = {
      name: credentials?.snmpUsername || 'snmpuser',
      level: snmp.SecurityLevel.authPriv,
      authProtocol: credentials?.snmpAuthProtocol === 'MD5' ? snmp.AuthProtocols.md5 : snmp.AuthProtocols.sha,
      authKey: credentials?.snmpAuthKey || '',
      privProtocol: credentials?.snmpPrivProtocol === 'DES' ? snmp.PrivProtocols.des : snmp.PrivProtocols.aes,
      privKey: credentials?.snmpPrivKey || '',
    };
    
    const session = snmp.createV3Session(ipAddress, user, {
      port: 161,
      retries: 1,
      timeout: 5000,
    });
    
    session.on('error', (err: any) => {
      if (!resolved) {
        resolved = true;
        try { session.close(); } catch (e) { /* ignore */ }
        resolve({ success: false, error: `SNMPv3 session error: ${err.message || err}` });
      }
    });
    
    const indexMap: { [interfaceName: string]: number } = {};
    
    session.subtree('1.3.6.1.2.1.2.2.1.2', 1, (varbinds: any[]) => {
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) continue;
        
        const oidParts = vb.oid.split('.');
        const ifIndex = parseInt(oidParts[oidParts.length - 1], 10);
        const ifDescr = sanitizeSnmpString(vb.value);
        
        if (!isNaN(ifIndex) && ifDescr) {
          indexMap[ifDescr] = ifIndex;
        }
      }
    }, (error: any) => {
      if (resolved) return;
      resolved = true;
      
      if (!sessionClosed) {
        sessionClosed = true;
        try { session.close(); } catch (e) { /* ignore */ }
      }
      
      if (error) {
        const errMsg = error.message || String(error);
        if (errMsg.includes('End of MIB') || errMsg.includes('endOfMibView')) {
          resolve({ success: true, data: indexMap });
        } else {
          resolve({ success: false, error: `SNMPv3 walk error: ${errMsg}` });
        }
      } else {
        resolve({ success: true, data: indexMap });
      }
    });
    
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (!sessionClosed) {
          sessionClosed = true;
          try { session.close(); } catch (e) { /* ignore */ }
        }
        resolve({ success: false, error: 'SNMPv3 walk timeout after 10s' });
      }
    }, 10000);
  });
}

export interface DeviceProbeData {
  uptime?: string;
  model?: string;
  version?: string;
  systemIdentity?: string;
  ports?: Array<{
    name: string;
    defaultName?: string;
    status: string;
    speed?: string;
    description?: string;
    snmpIndex?: number; // SNMP ifIndex for this interface - allows direct OID construction for traffic monitoring
  }>;
  cpuUsagePct?: number;
  memoryUsagePct?: number;
  diskUsagePct?: number;
}

async function probeMikrotikDevice(
  ipAddress: string,
  credentials?: any,
  detailedProbe: boolean = false,
  previousPorts?: Array<{ name: string; defaultName?: string; status: string; speed?: string }>,
  needsSnmpIndexing: boolean = false,  // Only do SNMP walks when device has monitored connections
  timeoutSeconds: number = 5  // Connection timeout in seconds
): Promise<DeviceProbeData> {
  const username = credentials?.username || 'admin';
  const password = credentials?.password || '';
  const port = credentials?.apiPort || 8728;

  const conn = new RouterOSAPI({
    host: ipAddress,
    user: username,
    password: password,
    port: port,
    timeout: timeoutSeconds,
  });

  // Attach error handler to prevent unhandled 'error' event crashes
  // This handles timeout errors and connection failures that emit events
  (conn as any).on('error', (err: any) => {
    // Silent handler - errors are handled in catch block
  });

  try {
    await conn.connect();

    // Fetch basic info and interfaces in parallel
    const [identity, resources, interfaces] = await Promise.all([
      conn.write('/system/identity/print').catch(() => []),
      conn.write('/system/resource/print').catch(() => []),
      conn.write('/interface/print').catch(() => []),
    ]);

    const identityName = identity[0]?.name || 'Unknown';
    const board = resources[0]?.['board-name'] || 'Unknown Model';
    const version = resources[0]?.version || 'Unknown';
    const uptime = resources[0]?.uptime || '0s';
    
    const interfacesList = interfaces as any[];
    
    // Build a map from .id to interface name from the regular print
    const idToName: { [id: string]: string } = {};
    for (const iface of interfacesList) {
      if (iface['.id'] && iface.name) {
        idToName[iface['.id']] = iface.name;
      }
    }
    
    // Fetch SNMP ifIndex for each interface via SNMP walk (only if device needs SNMP indexing)
    // This allows traffic monitoring to use direct SNMP GET instead of slow walks
    // NOTE: Mikrotik API's /interface/print oid doesn't work correctly via API since RouterOS 3.22
    interface SnmpIndexMap {
      [interfaceName: string]: number;
    }
    const snmpIndexMap: SnmpIndexMap = {};
    
    // Only fetch SNMP indexes if this device has monitored connections (needsSnmpIndexing flag)
    if (needsSnmpIndexing) {
      const hasSnmpCredentials = credentials?.snmpCommunity || credentials?.snmpVersion === '3';
      if (hasSnmpCredentials && ipAddress) {
        try {
          const indexResult = await fetchSnmpInterfaceIndexes(ipAddress, credentials);
          if (indexResult.success && indexResult.data) {
            Object.assign(snmpIndexMap, indexResult.data);
          }
        } catch (e) {
          // SNMP index fetch failed - traffic monitoring will use slower walks
        }
      }
    }
    
    // Extract real CPU and memory usage from Mikrotik resources
    const cpuLoad = resources[0]?.['cpu-load'];
    const totalMemory = parseInt(resources[0]?.['total-memory'] || '0');
    const freeMemory = parseInt(resources[0]?.['free-memory'] || '0');
    
    let cpuUsagePct: number | undefined;
    let memoryUsagePct: number | undefined;
    
    if (cpuLoad !== undefined) {
      cpuUsagePct = parseInt(cpuLoad.toString());
    }
    
    if (totalMemory > 0 && freeMemory >= 0) {
      const usedMemory = totalMemory - freeMemory;
      memoryUsagePct = Math.round((usedMemory / totalMemory) * 100);
    }

    // Get actual link speeds if doing detailed probe
    let speedMap: { [name: string]: string } = {};
    if (detailedProbe) {
      try {
        // Get list of ethernet interfaces
        const etherInterfaces = await conn.write('/interface/ethernet/print').catch(() => []);
        
        // Monitor each interface to get actual speed
        for (const ethIface of etherInterfaces as any[]) {
          try {
            const monitorResult = await conn.write('/interface/ethernet/monitor', [
              '=numbers=' + ethIface.name,
              '=once='
            ]).catch(() => []);
            
            // RouterOS returns speed under 'speed' property, not 'rate'
            if (monitorResult[0]?.speed) {
              speedMap[ethIface.name] = monitorResult[0].speed;
            } else if (monitorResult[0]?.rate) {
              // Fallback to 'rate' if 'speed' not found
              speedMap[ethIface.name] = monitorResult[0].rate;
            }
          } catch (err: any) {
            // Individual interface monitoring failure - continue with others
          }
        }
      } catch (err: any) {
        // Detailed monitoring failed - ports will use cached speeds
      }
    }

    const ports = (interfaces as any[]).map((iface: any) => {
      const ifaceName = iface.name || 'unknown';
      const defaultName = iface['default-name'] || undefined;
      const currentStatus = iface.running === 'true' || iface.running === true ? 'up' : 'down';
      
      // Determine speed:
      // 1. If we got actual speed from monitor, use it
      // 2. Else if state changed from down to up, we need detailed probe (will be triggered next cycle)
      // 3. Else use cached speed from previous probe
      // 4. Else use undefined (will show as unknown in UI)
      let speed: string | undefined;
      
      if (speedMap[ifaceName]) {
        // We just probed it
        speed = speedMap[ifaceName];
      } else if (previousPorts) {
        // Use cached speed from previous probe
        // Match by defaultName first (stable identifier), then fall back to name
        const prevPort = previousPorts.find(p => 
          (defaultName && p.defaultName === defaultName) || p.name === ifaceName
        );
        if (prevPort?.speed) {
          speed = prevPort.speed;
        }
      }
      
      // Get SNMP ifIndex for this interface (from SNMP walk)
      // Try matching by both name and defaultName (Mikrotik uses defaultName in SNMP)
      let snmpIndex: number | undefined;
      if (snmpIndexMap[ifaceName]) {
        snmpIndex = snmpIndexMap[ifaceName];
      } else if (defaultName && snmpIndexMap[defaultName]) {
        snmpIndex = snmpIndexMap[defaultName];
      }
      
      return {
        name: ifaceName,
        defaultName,
        status: currentStatus,
        speed,
        description: iface.comment || undefined,
        snmpIndex,
      };
    });

    conn.close();

    return {
      model: board,
      version: `RouterOS ${version}`,
      systemIdentity: identityName,
      uptime,
      ports,
      cpuUsagePct,
      memoryUsagePct,
    };
  } catch (error: any) {
    console.error(`[Mikrotik] Failed to connect to ${ipAddress}:`, error.message);
    conn.close();
    throw new Error(`Cannot connect to Mikrotik device: ${error.message}`);
  }
}

// Import for pool-based probing
import { mikrotikPool } from './mikrotikConnectionPool';

// Probe Mikrotik device using the connection pool (for persistent connections)
export async function probeMikrotikWithPool(
  ipAddress: string,
  credentials?: any,
  detailedProbe: boolean = false,
  previousPorts?: Array<{ name: string; defaultName?: string; status: string; speed?: string }>,
  needsSnmpIndexing: boolean = false,
  timeoutSeconds: number = 5,
  abortSignal?: AbortSignal
): Promise<DeviceProbeData> {
  const username = credentials?.username || 'admin';
  const password = credentials?.password || '';
  const port = credentials?.apiPort || 8728;
  
  let conn: any = null;
  let fromPool = false;
  let aborted = false;
  let wasSuccessful = false;
  
  // Set up abort handler to immediately release connection when caller times out
  const onAbort = () => {
    aborted = true;
    if (conn && fromPool) {
      // Immediately release the connection when aborted
      mikrotikPool.releaseConnection(ipAddress, { username, password, apiPort: port }, conn, fromPool);
      conn = null; // Prevent double-release in finally
    }
  };
  
  if (abortSignal) {
    if (abortSignal.aborted) {
      throw new Error('Probe aborted');
    }
    abortSignal.addEventListener('abort', onAbort, { once: true });
  }
  
  try {
    const poolResult = await mikrotikPool.getConnection(ipAddress, {
      username,
      password,
      apiPort: port,
    }, timeoutSeconds);
    
    conn = poolResult.conn;
    fromPool = poolResult.fromPool;
    
    // Fetch basic info and interfaces in parallel
    const [identity, resources, interfaces] = await Promise.all([
      conn.write('/system/identity/print').catch(() => []),
      conn.write('/system/resource/print').catch(() => []),
      conn.write('/interface/print').catch(() => []),
    ]);

    const identityName = identity[0]?.name || 'Unknown';
    const board = resources[0]?.['board-name'] || 'Unknown Model';
    const version = resources[0]?.version || 'Unknown';
    const uptime = resources[0]?.uptime || '0s';
    
    const interfacesList = interfaces as any[];
    
    // Build a map from .id to interface name from the regular print
    const idToName: { [id: string]: string } = {};
    for (const iface of interfacesList) {
      if (iface['.id'] && iface.name) {
        idToName[iface['.id']] = iface.name;
      }
    }
    
    // Fetch SNMP ifIndex for each interface via SNMP walk (only if device needs SNMP indexing)
    interface SnmpIndexMap {
      [interfaceName: string]: number;
    }
    const snmpIndexMap: SnmpIndexMap = {};
    
    if (needsSnmpIndexing) {
      const hasSnmpCredentials = credentials?.snmpCommunity || credentials?.snmpVersion === '3';
      if (hasSnmpCredentials && ipAddress) {
        try {
          const indexResult = await fetchSnmpInterfaceIndexes(ipAddress, credentials);
          if (indexResult.success && indexResult.data) {
            Object.assign(snmpIndexMap, indexResult.data);
          }
        } catch (e) {
          // SNMP index fetch failed - traffic monitoring will use slower walks
        }
      }
    }
    
    // Extract real CPU and memory usage from Mikrotik resources
    const cpuLoad = resources[0]?.['cpu-load'];
    const totalMemory = parseInt(resources[0]?.['total-memory'] || '0');
    const freeMemory = parseInt(resources[0]?.['free-memory'] || '0');
    
    let cpuUsagePct: number | undefined;
    let memoryUsagePct: number | undefined;
    
    if (cpuLoad !== undefined) {
      cpuUsagePct = parseInt(cpuLoad.toString());
    }
    
    if (totalMemory > 0 && freeMemory >= 0) {
      const usedMemory = totalMemory - freeMemory;
      memoryUsagePct = Math.round((usedMemory / totalMemory) * 100);
    }

    // Get actual link speeds if doing detailed probe
    let speedMap: { [name: string]: string } = {};
    if (detailedProbe) {
      try {
        const etherInterfaces = await conn.write('/interface/ethernet/print').catch(() => []);
        
        for (const ethIface of etherInterfaces as any[]) {
          try {
            const monitorResult = await conn.write('/interface/ethernet/monitor', [
              '=numbers=' + ethIface.name,
              '=once='
            ]).catch(() => []);
            
            if (monitorResult[0]?.speed) {
              speedMap[ethIface.name] = monitorResult[0].speed;
            } else if (monitorResult[0]?.rate) {
              speedMap[ethIface.name] = monitorResult[0].rate;
            }
          } catch (err: any) {
            // Individual interface monitoring failure - continue with others
          }
        }
      } catch (err: any) {
        // Detailed monitoring failed - ports will use cached speeds
      }
    }

    const ports = (interfaces as any[]).map((iface: any) => {
      const ifaceName = iface.name || 'unknown';
      const defaultName = iface['default-name'] || undefined;
      const currentStatus = iface.running === 'true' || iface.running === true ? 'up' : 'down';
      
      let speed: string | undefined;
      
      if (speedMap[ifaceName]) {
        speed = speedMap[ifaceName];
      } else if (previousPorts) {
        const prevPort = previousPorts.find(p => 
          (defaultName && p.defaultName === defaultName) || p.name === ifaceName
        );
        if (prevPort?.speed) {
          speed = prevPort.speed;
        }
      }
      
      let snmpIndex: number | undefined;
      if (snmpIndexMap[ifaceName]) {
        snmpIndex = snmpIndexMap[ifaceName];
      } else if (defaultName && snmpIndexMap[defaultName]) {
        snmpIndex = snmpIndexMap[defaultName];
      }
      
      return {
        name: ifaceName,
        defaultName,
        status: currentStatus,
        speed,
        description: iface.comment || undefined,
        snmpIndex,
      };
    });

    const result: DeviceProbeData = {
      model: board,
      version: `RouterOS ${version}`,
      systemIdentity: identityName,
      uptime,
      ports,
      cpuUsagePct,
      memoryUsagePct,
    };
    wasSuccessful = true;
    return result;
  } catch (error: any) {
    // Check if this was an abort - don't log as error
    if (aborted || error.message === 'Probe aborted') {
      throw error;
    }
    console.error(`[Mikrotik Pool] Failed to connect to ${ipAddress}:`, error.message);
    throw new Error(`Cannot connect to Mikrotik device: ${error.message}`);
  } finally {
    // Remove abort listener if set
    if (abortSignal) {
      abortSignal.removeEventListener('abort', onAbort);
    }
    
    // Release connection in finally block (if not already released by abort handler)
    if (conn) {
      if (fromPool) {
        // Release pooled connection back to pool, indicating if probe was successful
        mikrotikPool.releaseConnection(ipAddress, { username, password, apiPort: port }, conn, fromPool, wasSuccessful);
      } else {
        // Close non-pooled connection
        try {
          conn.close();
        } catch (e) {
          // Ignore close errors
        }
      }
    }
  }
}

async function probeSnmpDevice(
  ipAddress: string,
  credentials?: any
): Promise<DeviceProbeData> {
  const snmpVersion = credentials?.snmpVersion || '2c';
  const community = credentials?.snmpCommunity || 'public';

  const basicOids = [
    '1.3.6.1.2.1.1.1.0',       // sysDescr
    '1.3.6.1.2.1.1.3.0',       // sysUpTime
    '1.3.6.1.2.1.1.5.0',       // sysName
  ];

  return new Promise((resolve, reject) => {
    let session: any;
    let sessionClosed = false;

    const closeSession = () => {
      if (!sessionClosed && session) {
        sessionClosed = true;
        try {
          session.close();
        } catch (err: any) {
          // Session close error - ignore
        }
      }
    };

    if (snmpVersion === '3') {
      const user = {
        name: credentials?.snmpUsername || 'snmpuser',
        level: snmp.SecurityLevel.authPriv,
        authProtocol: credentials?.snmpAuthProtocol === 'MD5' ? snmp.AuthProtocols.md5 : snmp.AuthProtocols.sha,
        authKey: credentials?.snmpAuthKey || '',
        privProtocol: credentials?.snmpPrivProtocol === 'DES' ? snmp.PrivProtocols.des : snmp.PrivProtocols.aes,
        privKey: credentials?.snmpPrivKey || '',
      };

      session = snmp.createV3Session(ipAddress, user, {
        port: 161,
        retries: 0,
        timeout: 4000,
      });
    } else {
      const version = snmpVersion === '1' ? snmp.Version1 : snmp.Version2c;
      session = snmp.createSession(ipAddress, community, {
        port: 161,
        retries: 0,
        timeout: 4000,
        version,
      });
    }

    session.get(basicOids, (error: any, varbinds: any[]) => {
      if (error) {
        closeSession();
        return reject(new Error(`SNMP probe failed: ${error.message}`));
      }

      let sysDescr = 'Unknown Device';
      let sysUpTime = '0';
      let sysName = 'Unknown';

      varbinds.forEach((vb, idx) => {
        if (!snmp.isVarbindError(vb)) {
          if (idx === 0) sysDescr = sanitizeSnmpString(vb.value);
          if (idx === 1) sysUpTime = formatUptime(parseInt(sanitizeSnmpString(vb.value)) / 100);
          if (idx === 2) sysName = sanitizeSnmpString(vb.value);
        }
      });

      // Fetch CPU usage by walking hrProcessorTable and averaging all CPUs
      const cpuLoads: number[] = [];
      session.table('1.3.6.1.2.1.25.3.3.1.2', { maxRepetitions: 20 }, (error: any, table: any) => {
        if (!error && table) {
          Object.values(table).forEach((row: any) => {
            const loadValue = row['2'];
            if (loadValue && loadValue.value !== undefined) {
              const load = parseInt(loadValue.value.toString());
              if (!isNaN(load) && load >= 0 && load <= 100) {
                cpuLoads.push(load);
              }
            }
          });
        }
        
        const cpuUsagePct = cpuLoads.length > 0 
          ? Math.round(cpuLoads.reduce((a, b) => a + b, 0) / cpuLoads.length)
          : undefined;

        // Fetch memory and disk usage from hrStorageTable
        session.table('1.3.6.1.2.1.25.2.3.1', { maxRepetitions: 20 }, (error: any, table: any) => {
          let memoryUsagePct: number | undefined;
          let diskUsagePct: number | undefined;
          
          if (!error && table) {
            // Iterate through storage entries to find memory and disk
            for (const [index, row] of Object.entries(table)) {
              const storageTypeVb = (row as any)['2'];
              const allocationUnitsVb = (row as any)['4'];
              const totalUnitsVb = (row as any)['5'];
              const usedUnitsVb = (row as any)['6'];
              
              if (storageTypeVb && storageTypeVb.value && allocationUnitsVb && totalUnitsVb && usedUnitsVb) {
                const storageType = storageTypeVb.value.toString();
                const allocationUnits = parseInt(allocationUnitsVb.value?.toString() || '1');
                const totalUnits = parseInt(totalUnitsVb.value?.toString() || '0');
                const usedUnits = parseInt(usedUnitsVb.value?.toString() || '0');
                
                if (totalUnits > 0 && allocationUnits > 0) {
                  const usagePercent = Math.round((usedUnits / totalUnits) * 100);
                  
                  // Check if this is physical memory (RAM) - type 1.3.6.1.2.1.25.2.1.2
                  if (storageType.includes('1.3.6.1.2.1.25.2.1.2') && !memoryUsagePct) {
                    memoryUsagePct = usagePercent;
                  }
                  // Check if this is fixed disk - type 1.3.6.1.2.1.25.2.1.4
                  else if (storageType.includes('1.3.6.1.2.1.25.2.1.4') && !diskUsagePct) {
                    diskUsagePct = usagePercent;
                  }
                }
              }
            }
          }

          // Use cached interface data for fast probes - interface collection is slow
          // If cache is stale/empty, trigger background collection (non-blocking)
          const cachedPorts = getCachedInterfaces(ipAddress);
          let ports: any[] = cachedPorts || [];
          
          if (!cachedPorts) {
            // No cache - trigger background collection (fire and forget)
            // Use setTimeout to ensure this doesn't block the current probe
            setTimeout(() => {
              collectInterfacesBackground(ipAddress, community, snmpVersion, credentials)
                .catch(err => console.error(`[SNMP] Background collection error: ${err.message}`));
            }, 100);
            
            // Return minimal port info for now
            ports = [{ name: 'eth0', status: 'up', speed: undefined }];
          }

          closeSession();
          
          resolve({
            model: sysDescr.substring(0, 100),
            systemIdentity: sysName,
            version: 'SNMP',
            uptime: sysUpTime,
            ports: ports.length > 0 ? ports : [{
              name: 'eth0',
              status: 'up',
              speed: '1Gbps',
            }],
            cpuUsagePct,
            memoryUsagePct,
            diskUsagePct,
          });
        });
      });
    });
  });
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) {
    return `${days} days, ${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Parse Prometheus text exposition format
// Returns a map of metric names to their values and labels
function parsePrometheusMetrics(text: string): Map<string, { value: number; labels: Record<string, string> }[]> {
  const metrics = new Map<string, { value: number; labels: Record<string, string> }[]>();
  const lines = text.split('\n');
  
  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith('#') || line.trim() === '') continue;
    
    // Parse metric line: metric_name{label="value"} value
    // Or simple: metric_name value
    const labelMatch = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{([^}]*)\}\s+([\d.eE+-]+|NaN|[+-]?Inf)$/);
    const simpleMatch = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\s+([\d.eE+-]+|NaN|[+-]?Inf)$/);
    
    if (labelMatch) {
      const [, name, labelsStr, valueStr] = labelMatch;
      const value = parseFloat(valueStr);
      if (isNaN(value)) continue;
      
      // Parse labels: key="value",key2="value2"
      const labels: Record<string, string> = {};
      const labelParts = labelsStr.match(/([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"/g);
      if (labelParts) {
        for (const part of labelParts) {
          const [key, val] = part.split('=');
          labels[key] = val.replace(/^"|"$/g, '');
        }
      }
      
      if (!metrics.has(name)) metrics.set(name, []);
      metrics.get(name)!.push({ value, labels });
    } else if (simpleMatch) {
      const [, name, valueStr] = simpleMatch;
      const value = parseFloat(valueStr);
      if (isNaN(value)) continue;
      
      if (!metrics.has(name)) metrics.set(name, []);
      metrics.get(name)!.push({ value, labels: {} });
    }
  }
  
  return metrics;
}

// Probe device via Prometheus node_exporter endpoint
export async function probePrometheusDevice(
  ipAddress: string,
  credentials?: any,
  timeoutMs: number = 5000
): Promise<DeviceProbeData> {
  const port = credentials?.prometheusPort || 9100;
  const path = credentials?.prometheusPath || '/metrics';
  const scheme = credentials?.prometheusScheme || 'http';
  const url = `${scheme}://${ipAddress}:${port}${path}`;
  
  return new Promise((resolve, reject) => {
    const httpModule = scheme === 'https' ? https : http;
    
    const req = httpModule.get(url, {
      timeout: timeoutMs,
      headers: {
        'Accept': 'text/plain',
        'User-Agent': 'CoreBit/1.0'
      },
      // For https, allow self-signed certs (common on internal servers)
      ...(scheme === 'https' ? { rejectUnauthorized: false } : {})
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const metrics = parsePrometheusMetrics(data);
          
          // Extract system info from node_uname_info
          let systemIdentity = '';
          let model = 'Linux Server';
          let version = '';
          
          const unameInfo = metrics.get('node_uname_info');
          if (unameInfo && unameInfo.length > 0) {
            const labels = unameInfo[0].labels;
            systemIdentity = labels.nodename || '';
            model = `${labels.sysname || 'Linux'} ${labels.machine || ''}`.trim();
            version = labels.release || '';
          }
          
          // Calculate uptime from node_boot_time_seconds
          let uptime = '';
          const bootTime = metrics.get('node_boot_time_seconds');
          if (bootTime && bootTime.length > 0) {
            const bootSeconds = bootTime[0].value;
            const uptimeSeconds = Math.floor(Date.now() / 1000 - bootSeconds);
            uptime = formatUptime(uptimeSeconds);
          }
          
          // CPU usage from node_cpu_seconds_total
          // Sum idle time across all CPUs and calculate percentage
          let cpuUsagePct: number | undefined;
          const cpuSeconds = metrics.get('node_cpu_seconds_total');
          if (cpuSeconds) {
            const idleSeconds = cpuSeconds
              .filter(m => m.labels.mode === 'idle')
              .reduce((sum, m) => sum + m.value, 0);
            const totalSeconds = cpuSeconds.reduce((sum, m) => sum + m.value, 0);
            if (totalSeconds > 0) {
              cpuUsagePct = Math.round((1 - idleSeconds / totalSeconds) * 100);
            }
          }
          
          // Memory usage from node_memory_*
          let memoryUsagePct: number | undefined;
          const memTotal = metrics.get('node_memory_MemTotal_bytes');
          const memAvailable = metrics.get('node_memory_MemAvailable_bytes');
          if (memTotal && memAvailable && memTotal.length > 0 && memAvailable.length > 0) {
            const total = memTotal[0].value;
            const available = memAvailable[0].value;
            if (total > 0) {
              memoryUsagePct = Math.round((1 - available / total) * 100);
            }
          }
          
          // Disk usage from node_filesystem_*
          // Sum across all filesystems (excluding tmpfs, etc)
          let diskUsagePct: number | undefined;
          const fsSize = metrics.get('node_filesystem_size_bytes');
          const fsAvail = metrics.get('node_filesystem_avail_bytes');
          if (fsSize && fsAvail) {
            // Filter to real filesystems (ext4, xfs, etc)
            const realFs = fsSize.filter(m => 
              m.labels.fstype && 
              !['tmpfs', 'devtmpfs', 'squashfs', 'overlay'].includes(m.labels.fstype)
            );
            
            let totalSize = 0;
            let totalAvail = 0;
            for (const fs of realFs) {
              const mountpoint = fs.labels.mountpoint;
              totalSize += fs.value;
              const avail = fsAvail.find(a => a.labels.mountpoint === mountpoint);
              if (avail) totalAvail += avail.value;
            }
            if (totalSize > 0) {
              diskUsagePct = Math.round((1 - totalAvail / totalSize) * 100);
            }
          }
          
          // Network interfaces from node_network_*
          const ports: Array<{ name: string; status: string; speed?: string }> = [];
          const netUp = metrics.get('node_network_up');
          const netSpeed = metrics.get('node_network_speed_bytes');
          
          if (netUp) {
            for (const iface of netUp) {
              const name = iface.labels.device;
              if (!name || name === 'lo') continue; // Skip loopback
              
              const status = iface.value === 1 ? 'up' : 'down';
              let speed: string | undefined;
              
              // Find speed for this interface
              if (netSpeed) {
                const speedEntry = netSpeed.find(s => s.labels.device === name);
                if (speedEntry && speedEntry.value > 0) {
                  const bytesPerSec = speedEntry.value;
                  const bitsPerSec = bytesPerSec * 8;
                  if (bitsPerSec >= 10e9) {
                    speed = `${Math.round(bitsPerSec / 1e9)}Gbps`;
                  } else if (bitsPerSec >= 1e9) {
                    speed = '1Gbps';
                  } else if (bitsPerSec >= 100e6) {
                    speed = '100Mbps';
                  } else if (bitsPerSec >= 10e6) {
                    speed = '10Mbps';
                  }
                }
              }
              
              ports.push({ name, status, speed });
            }
          }
          
          resolve({
            model,
            systemIdentity,
            version: `Prometheus | ${version}`,
            uptime,
            ports: ports.length > 0 ? ports : [{ name: 'eth0', status: 'up', speed: '1Gbps' }],
            cpuUsagePct,
            memoryUsagePct,
            diskUsagePct,
          });
        } catch (parseError: any) {
          reject(new Error(`Parse error: ${parseError.message}`));
        }
      });
    });
    
    req.on('error', (err) => {
      reject(err);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

// Import Proxmox API client
import { ProxmoxApi, detectProxmox, ProxmoxVMInfo } from './proxmoxApi';

// Probe Proxmox VE host - fetches host info and VM list
// Returns device data with Proxmox version, node stats, and VM summary
export async function probeProxmoxDevice(
  ipAddress: string,
  credentials?: any,
  timeoutMs: number = 10000
): Promise<{ hostData: DeviceProbeData; vms: ProxmoxVMInfo[]; clusterName?: string }> {
  const port = credentials?.proxmoxPort || 8006;
  const apiTokenId = credentials?.proxmoxApiTokenId;
  const apiTokenSecret = credentials?.proxmoxApiTokenSecret;
  const username = credentials?.username;
  const password = credentials?.password;
  const realm = credentials?.proxmoxRealm || 'pam';
  const verifySsl = credentials?.proxmoxVerifySsl ?? false;

  const api = new ProxmoxApi({
    host: ipAddress,
    port,
    apiTokenId,
    apiTokenSecret,
    username,
    password,
    realm,
    verifySsl
  });

  const hostInfo = await api.getHostInfo();
  if (!hostInfo) {
    throw new Error('Failed to authenticate or connect to Proxmox API');
  }

  // Aggregate node stats for host info
  let totalCpu = 0;
  let usedCpu = 0;
  let totalMem = 0;
  let usedMem = 0;
  let totalDisk = 0;
  let usedDisk = 0;
  let maxUptime = 0;

  for (const node of hostInfo.nodes) {
    totalCpu += node.maxcpu || 0;
    usedCpu += (node.cpu || 0) * (node.maxcpu || 1);
    totalMem += node.maxmem || 0;
    usedMem += node.mem || 0;
    totalDisk += node.maxdisk || 0;
    usedDisk += node.disk || 0;
    maxUptime = Math.max(maxUptime, node.uptime || 0);
  }

  const cpuUsagePct = totalCpu > 0 ? Math.round((usedCpu / totalCpu) * 100) : undefined;
  const memoryUsagePct = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : undefined;
  const diskUsagePct = totalDisk > 0 ? Math.round((usedDisk / totalDisk) * 100) : undefined;

  // Get all VMs for storage update
  const allVMs = await api.getAllVMs();
  console.log(`[Proxmox] ${ipAddress}: getAllVMs returned ${allVMs.length} VMs`);
  
  // Fetch network info (IP/MAC) for each running VM in parallel
  // Only probe running VMs to avoid unnecessary API calls
  const vmNetworkInfoPromises = allVMs
    .filter(vm => vm.status === 'running')
    .map(async (vm) => {
      try {
        const networkInfo = await api.getVMNetworkInfo(vm.node, vm.vmid, vm.type);
        return { vmid: vm.vmid, ...networkInfo };
      } catch {
        return { vmid: vm.vmid, ipAddresses: [], macAddresses: [] };
      }
    });
  
  const vmNetworkInfoResults = await Promise.all(vmNetworkInfoPromises);
  const vmNetworkMap = new Map(vmNetworkInfoResults.map(r => [r.vmid, r]));
  
  // Attach network info to VMs
  for (const vm of allVMs) {
    const networkInfo = vmNetworkMap.get(vm.vmid);
    if (networkInfo) {
      vm.ipAddresses = networkInfo.ipAddresses;
      vm.macAddresses = networkInfo.macAddresses;
    } else {
      vm.ipAddresses = [];
      vm.macAddresses = [];
    }
  }

  const hostData: DeviceProbeData = {
    model: `Proxmox VE ${hostInfo.version || ''}`.trim(),
    version: hostInfo.version || 'Unknown',
    systemIdentity: hostInfo.clusterName || hostInfo.nodes[0]?.node || 'Proxmox Host',
    uptime: maxUptime > 0 ? formatUptime(maxUptime) : undefined,
    cpuUsagePct,
    memoryUsagePct,
    diskUsagePct,
    // Store VM summary in ports array for display
    ports: hostInfo.nodes.map(node => ({
      name: node.node,
      status: node.status === 'online' ? 'up' : 'down',
      speed: `${hostInfo.runningVMs}/${hostInfo.totalVMs} VMs`
    }))
  };

  return {
    hostData,
    vms: allVMs,
    clusterName: hostInfo.clusterName
  };
}

// Quick check if Proxmox VE is available on a host
export async function checkProxmoxAvailable(
  ipAddress: string,
  port: number = 8006,
  timeoutMs: number = 5000
): Promise<boolean> {
  return detectProxmox(ipAddress, port, timeoutMs);
}

// Quick check if Prometheus node_exporter is available on a host
export async function checkPrometheusAvailable(
  ipAddress: string,
  port: number = 9100,
  timeoutMs: number = 3000
): Promise<boolean> {
  return new Promise((resolve) => {
    const url = `http://${ipAddress}:${port}/metrics`;
    
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      // Just check if we get a response with metrics
      if (res.statusCode === 200) {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
          // Check for node_exporter signature early
          if (data.includes('node_uname_info') || data.includes('node_cpu_seconds_total')) {
            req.destroy();
            resolve(true);
          }
        });
        res.on('end', () => {
          resolve(data.includes('node_') || data.includes('process_'));
        });
      } else {
        resolve(false);
      }
    });
    
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function probeDevice(
  deviceType: string,
  ipAddress?: string,
  credentials?: any,
  detailedProbe: boolean = false,
  previousPorts?: Array<{ name: string; defaultName?: string; status: string; speed?: string }>,
  needsSnmpIndexing: boolean = false,  // Only true when device has monitored connections
  timeoutSeconds: number = 5,  // Device probe timeout in seconds
  abortSignal?: AbortSignal
): Promise<{ data: DeviceProbeData; success: boolean; pingOnly?: boolean; pingRtt?: number; proxmoxVms?: ProxmoxVMInfo[] }> {
  if (!ipAddress) {
    return { data: {}, success: false };
  }

  // Handle ping-only devices - no SNMP/API, just multi-ping for reliability
  if (deviceType === 'generic_ping') {
    return await probePingOnlyDevice(ipAddress, Math.min(timeoutSeconds, 3));
  }

  // Check if Prometheus is configured (either dedicated prometheus credentials or prometheus settings in mixed credentials)
  const hasPrometheusCredentials = credentials?.prometheusPort !== undefined || 
    (deviceType === 'generic_server' && !credentials?.snmpCommunity && !credentials?.snmpVersion);

  try {
    let data: DeviceProbeData;
    if (deviceType.startsWith('mikrotik_')) {
      // Use connection pool when enabled, otherwise use standard per-probe connection
      if (mikrotikPool.isEnabled()) {
        data = await probeMikrotikWithPool(ipAddress, credentials, detailedProbe, previousPorts, needsSnmpIndexing, timeoutSeconds, abortSignal);
      } else {
        data = await probeMikrotikDevice(ipAddress, credentials, detailedProbe, previousPorts, needsSnmpIndexing, timeoutSeconds);
      }
    } else if (deviceType === 'generic_prometheus') {
      // Prometheus-only device type
      data = await probePrometheusDevice(ipAddress, credentials, timeoutSeconds * 1000);
    } else if (deviceType === 'proxmox') {
      // Proxmox VE hypervisor - returns host data and VM list
      const proxmoxResult = await probeProxmoxDevice(ipAddress, credentials, timeoutSeconds * 1000);
      data = proxmoxResult.hostData;
      // Return VMs for storage persistence by caller
      return { data, success: true, proxmoxVms: proxmoxResult.vms };
    } else {
      // Non-Mikrotik devices: try SNMP first, then Prometheus fallback
      try {
        data = await probeSnmpDevice(ipAddress, credentials);
      } catch (snmpError: any) {
        // SNMP failed - try Prometheus if available
        if (hasPrometheusCredentials || deviceType === 'generic_server') {
          try {
            data = await probePrometheusDevice(ipAddress, credentials, timeoutSeconds * 1000);
          } catch (promError: any) {
            // Both SNMP and Prometheus failed, rethrow to trigger ping fallback
            throw snmpError;
          }
        } else {
          throw snmpError;
        }
      }
    }
    return { data, success: true };
  } catch (error: any) {
    // For non-Mikrotik devices, if SNMP/Prometheus fails, try ping as fallback
    // This allows devices without SNMP to still show as reachable
    if (!deviceType.startsWith('mikrotik_')) {
      try {
        const pingResult = await pingDevice(ipAddress, Math.min(timeoutSeconds, 3));
        if (pingResult.success) {
          // Device responds to ping but not SNMP/Prometheus
          // Return success=false to preserve existing deviceData, but set pingOnly=true
          // so the caller knows to mark as "stale" instead of "offline"
          return { 
            data: {}, 
            success: false,
            pingOnly: true,  // Flag to indicate ping succeeded but SNMP/Prometheus failed
            pingRtt: pingResult.rtt
          };
        }
      } catch (pingError: any) {
        // Ping also failed - device is truly offline
      }
    }
    return { data: {}, success: false };
  }
}

// Probe ping-only devices using concurrent pings for reliability
// Best practice: Run 2 pings in parallel, succeed if ANY returns
// This reduces false positives from packet loss without slowing the probe cycle
async function probePingOnlyDevice(
  ipAddress: string,
  timeoutSeconds: number = 3
): Promise<{ data: DeviceProbeData; success: boolean; pingOnly?: boolean; pingRtt?: number }> {
  const PING_COUNT = 2;  // Number of concurrent pings (2 is sufficient for reliability)
  
  try {
    // Fire pings in parallel - device is online if ANY succeeds
    const pingPromises = Array.from({ length: PING_COUNT }, () => 
      pingDevice(ipAddress, timeoutSeconds).catch(() => ({ success: false, rtt: undefined }))
    );
    
    const results = await Promise.all(pingPromises);
    const successfulPings = results.filter(r => r.success);
    
    if (successfulPings.length > 0) {
      // Use best (lowest) RTT from successful pings
      const bestRtt = Math.min(...successfulPings.map(r => r.rtt || Infinity));
      
      return {
        data: {
          model: 'Ping Only',
          version: `RTT: ${bestRtt.toFixed(2)}ms`,
        },
        success: true,
        pingOnly: true,
        pingRtt: bestRtt
      };
    }
    
    // All pings failed - still set pingOnly=true so caller knows this is a ping-only device
    // determineDeviceStatus will correctly return 'offline' when success=false and pingOnly=true
    return { data: {}, success: false, pingOnly: true };
  } catch (error: any) {
    return { data: {}, success: false, pingOnly: true };
  }
}

export function determineDeviceStatus(
  probeData: DeviceProbeData, 
  probeSucceeded: boolean, 
  pingOnly?: boolean,
  deviceType?: string
): string {
  // For ping-only devices (generic_ping), pingOnly flag is always set
  // - success=true, pingOnly=true: device is online (ping responded)
  // - success=false, pingOnly=true: device is offline (ping failed)
  // For SNMP/API devices with ping fallback:
  // - success=false, pingOnly=true: device is stale (SNMP/API failed but ping worked)
  if (pingOnly) {
    if (deviceType === 'generic_ping') {
      // Ping-only device: online if ping works, offline if it doesn't
      return probeSucceeded ? 'online' : 'offline';
    }
    // SNMP/API device with ping fallback: mark as stale (can reach device but not query it)
    return probeSucceeded ? 'online' : 'stale';
  }
  if (!probeSucceeded) return 'offline';
  if (probeData.model || probeData.uptime || probeData.version) return 'online';
  return 'unknown';
}

export interface TrafficCounters {
  inOctets: number;
  outOctets: number;
  ifIndex: number;
  timestamp: number;
}

// Options for traffic probing - prefer stored snmpIndex for direct OID construction
export interface TrafficProbeOptions {
  snmpIndex?: number;  // SNMP ifIndex for this interface (from device probe)
}

export async function probeInterfaceTraffic(
  ipAddress: string,
  interfaceName: string,
  credentials?: any,
  knownSnmpIndex?: number,
  options?: TrafficProbeOptions
): Promise<{ data: TrafficCounters | null; success: boolean; error?: string }> {
  const snmpVersion = credentials?.snmpVersion || '2c';
  const community = credentials?.snmpCommunity || 'public';

  return new Promise((resolve) => {
    let session: any;
    let sessionClosed = false;

    const closeSession = () => {
      if (!sessionClosed && session) {
        sessionClosed = true;
        try {
          session.close();
        } catch (err: any) {
          // Ignore close errors
        }
      }
    };

    const cleanup = (result: { data: TrafficCounters | null; success: boolean; error?: string }) => {
      closeSession();
      resolve(result);
    };

    // Fetch counters using ifIndex (builds OIDs from index)
    const fetchCountersByIndex = (targetIfIndex: number) => {
      // Get the counters using the known interface index
      // Use 64-bit counters (ifHCInOctets/ifHCOutOctets) if available, fall back to 32-bit
      const ifHCInOctets = `1.3.6.1.2.1.31.1.1.1.6.${targetIfIndex}`;  // 64-bit in
      const ifHCOutOctets = `1.3.6.1.2.1.31.1.1.1.10.${targetIfIndex}`; // 64-bit out
      const ifInOctets = `1.3.6.1.2.1.2.2.1.10.${targetIfIndex}`;      // 32-bit in
      const ifOutOctets = `1.3.6.1.2.1.2.2.1.16.${targetIfIndex}`;     // 32-bit out
      
      // Try 64-bit counters first
      session.get([ifHCInOctets, ifHCOutOctets], (error: any, varbinds: any[]) => {
        if (!error && varbinds && varbinds.length === 2 && 
            !snmp.isVarbindError(varbinds[0]) && !snmp.isVarbindError(varbinds[1])) {
          const inOctets = parseCounter(varbinds[0].value);
          const outOctets = parseCounter(varbinds[1].value);
          
          if (inOctets !== null && outOctets !== null) {
            cleanup({
              data: {
                inOctets,
                outOctets,
                ifIndex: targetIfIndex,
                timestamp: Date.now(),
              },
              success: true,
            });
            return;
          }
        }

        // Fall back to 32-bit counters
        session.get([ifInOctets, ifOutOctets], (error: any, varbinds: any[]) => {
          if (error || !varbinds || varbinds.length !== 2) {
            const errorMsg = error?.message || error?.toString() || 'Unknown error';
            cleanup({ data: null, success: false, error: errorMsg });
            return;
          }

          if (snmp.isVarbindError(varbinds[0]) || snmp.isVarbindError(varbinds[1])) {
            const errorType = varbinds[0]?.type || varbinds[1]?.type;
            const errorMsg = `noSuchName (type=${errorType})`;
            cleanup({ data: null, success: false, error: errorMsg });
            return;
          }

          const inOctets = parseCounter(varbinds[0].value);
          const outOctets = parseCounter(varbinds[1].value);

          if (inOctets === null || outOctets === null) {
            cleanup({ data: null, success: false, error: 'Parse error' });
            return;
          }

          cleanup({
            data: {
              inOctets,
              outOctets,
              ifIndex: targetIfIndex,
              timestamp: Date.now(),
            },
            success: true,
          });
        });
      });
    };

    try {
      // Determine the best probing method:
      // 1. If we have stored snmpIndex from device port (from SNMP walk during device probe), use direct GET - fastest
      // 2. If we have a known SNMP index from connection cache, use direct GET - fast
      // 3. Otherwise, do SNMP walk to find interface - slow, only for devices without stored indexes
      const hasStoredIndex = options?.snmpIndex !== undefined;
      const needsWalk = !hasStoredIndex && knownSnmpIndex === undefined;
      const sessionTimeout = needsWalk ? 25000 : 4000; // 25s for walks on large routers, 4s for GETs
      
      if (snmpVersion === '3') {
        const user = {
          name: credentials?.snmpUsername || 'snmpuser',
          level: snmp.SecurityLevel.authPriv,
          authProtocol: credentials?.snmpAuthProtocol === 'MD5' ? snmp.AuthProtocols.md5 : snmp.AuthProtocols.sha,
          authKey: credentials?.snmpAuthKey || '',
          privProtocol: credentials?.snmpPrivProtocol === 'DES' ? snmp.PrivProtocols.des : snmp.PrivProtocols.aes,
          privKey: credentials?.snmpPrivKey || '',
        };

        session = snmp.createV3Session(ipAddress, user, {
          port: 161,
          retries: 0,
          timeout: sessionTimeout,
        });
      } else {
        const version = snmpVersion === '1' ? snmp.Version1 : snmp.Version2c;
        session = snmp.createSession(ipAddress, community, {
          port: 161,
          retries: 0,
          timeout: sessionTimeout,
          version,
        });
      }
      
      // Priority: stored snmpIndex from device port > known index from connection > SNMP walk
      // Note: We no longer use bytesInOid/bytesOutOid since Mikrotik API OID fetching is broken since RouterOS 3.22
      const storedSnmpIndex = options?.snmpIndex;
      
      if (storedSnmpIndex !== undefined) {
        // Best case: use snmpIndex stored on the device port (from SNMP walk during device probe)
        fetchCountersByIndex(storedSnmpIndex);
      } else if (knownSnmpIndex !== undefined) {
        // Good case: use index cached on the connection record
        fetchCountersByIndex(knownSnmpIndex);
      } else {
        // Fallback: walk ifDescr to find the interface (non-Mikrotik devices only)
        // Use exact matching only - no partial matches which caused wrong interface selection
        const ifDescrOid = '1.3.6.1.2.1.2.2.1.2'; // ifDescr
        let targetIfIndex: number | null = null;

        const foundInterfaces: string[] = [];
        session.walk(ifDescrOid, (varbinds: any[]) => {
          for (const vb of varbinds) {
            if (snmp.isVarbindError(vb)) continue;
            
            const name = sanitizeSnmpString(vb.value);
            const oid = vb.oid;
            const parts = oid.split('.');
            const ifIndex = parseInt(parts[parts.length - 1]);
            foundInterfaces.push(`${name}(${ifIndex})`);
            
            // EXACT match only - no partial matching to avoid wrong interface selection
            if (name.toLowerCase() === interfaceName.toLowerCase()) {
              targetIfIndex = ifIndex;
              break;
            }
          }
        }, (error: any) => {
          if (error || targetIfIndex === null) {
            const errorMsg = error ? (error.message || 'Walk failed') : `Interface '${interfaceName}' not found`;
            cleanup({ data: null, success: false, error: errorMsg });
            return;
          }

          // Found the interface, now get the counters
          fetchCountersByIndex(targetIfIndex);
        });
      }
    } catch (error: any) {
      cleanup({ data: null, success: false, error: error.message });
    }
  });
}

function parseCounter(value: any): number | null {
  if (value === undefined || value === null) return null;
  
  // Handle Buffer for 64-bit counters
  // SNMP library returns variable-length buffers with leading zeros stripped
  if (Buffer.isBuffer(value)) {
    if (value.length <= 8 && value.length > 0) {
      // Zero-pad to 8 bytes for consistent 64-bit reading
      const padded = Buffer.alloc(8, 0);
      value.copy(padded, 8 - value.length);
      const high = padded.readUInt32BE(0);
      const low = padded.readUInt32BE(4);
      return high * 0x100000000 + low;
    }
    // Fallback: try parsing as string
    const strVal = value.toString();
    const num = parseInt(strVal, 10);
    return isNaN(num) ? null : num;
  }
  
  // Handle BigInt
  if (typeof value === 'bigint') {
    return Number(value);
  }
  
  // Handle number or string
  const num = parseInt(value.toString(), 10);
  return isNaN(num) ? null : num;
}

// ============================================================================
// Device Fingerprinting Functions for "Find All" Discovery
// ============================================================================

export interface DeviceFingerprint {
  deviceType: string;
  confidence: 'high' | 'medium' | 'low';
  detectedName?: string;
  detectedModel?: string;
  detectedVia: string;
  sysDescr?: string;
  additionalInfo?: Record<string, any>;
}

// Fingerprint patterns for SNMP sysDescr analysis
const SYSDESCR_PATTERNS: Array<{
  pattern: RegExp;
  deviceType: string;
  confidence: 'high' | 'medium' | 'low';
  extractModel?: (match: RegExpMatchArray, full: string) => string | undefined;
}> = [
  // MikroTik - very distinctive
  { pattern: /RouterOS|MikroTik/i, deviceType: 'mikrotik_router', confidence: 'high',
    extractModel: (_, full) => {
      const boardMatch = full.match(/board\s+([^\s,]+)/i);
      return boardMatch ? boardMatch[1] : undefined;
    }
  },
  // Ubiquiti
  { pattern: /Ubiquiti|EdgeOS|UniFi|EdgeSwitch|AirOS/i, deviceType: 'ubiquiti', confidence: 'high',
    extractModel: (_, full) => {
      const modelMatch = full.match(/(EdgeRouter|EdgeSwitch|UniFi|UAP|USW)[^\s,]*/i);
      return modelMatch ? modelMatch[0] : undefined;
    }
  },
  // Cisco
  { pattern: /Cisco|IOS|NX-OS|Catalyst/i, deviceType: 'cisco', confidence: 'high',
    extractModel: (_, full) => {
      const modelMatch = full.match(/(Catalyst|ASR|ISR|Nexus|C\d{4})[^\s,]*/i);
      return modelMatch ? modelMatch[0] : undefined;
    }
  },
  // Juniper
  { pattern: /Juniper|JUNOS|SRX|EX\d+/i, deviceType: 'juniper', confidence: 'high' },
  // Fortinet
  { pattern: /FortiGate|FortiOS|Fortinet/i, deviceType: 'fortinet', confidence: 'high' },
  // VMware ESXi
  { pattern: /VMware ESXi|ESX Server/i, deviceType: 'vmware_esxi', confidence: 'high',
    extractModel: (_, full) => {
      const verMatch = full.match(/ESXi?\s*(\d+\.\d+)/i);
      return verMatch ? `ESXi ${verMatch[1]}` : 'VMware ESXi';
    }
  },
  // Proxmox VE
  { pattern: /Proxmox|pve-manager/i, deviceType: 'proxmox_ve', confidence: 'high' },
  // Windows
  { pattern: /Windows|Microsoft/i, deviceType: 'windows_server', confidence: 'high',
    extractModel: (_, full) => {
      const verMatch = full.match(/Windows\s+(Server\s+\d+|10|11|NT)/i);
      return verMatch ? `Windows ${verMatch[1]}` : 'Windows';
    }
  },
  // Linux distributions
  { pattern: /Linux|Ubuntu|Debian|CentOS|Red Hat|RHEL|Fedora|SUSE|Alma|Rocky/i, deviceType: 'linux_server', confidence: 'high',
    extractModel: (_, full) => {
      const distroMatch = full.match(/(Ubuntu|Debian|CentOS|Red Hat|RHEL|Fedora|SUSE|AlmaLinux|Rocky)/i);
      return distroMatch ? distroMatch[1] : 'Linux';
    }
  },
  // FreeBSD/Unix
  { pattern: /FreeBSD|OpenBSD|NetBSD|pfSense|OPNsense/i, deviceType: 'bsd_server', confidence: 'high' },
  // Synology NAS
  { pattern: /Synology|DiskStation|RackStation/i, deviceType: 'synology_nas', confidence: 'high' },
  // QNAP NAS
  { pattern: /QNAP/i, deviceType: 'qnap_nas', confidence: 'high' },
  // HP/HPE
  { pattern: /HP|Hewlett|ProCurve|Aruba|iLO/i, deviceType: 'hp_device', confidence: 'medium' },
  // Dell
  { pattern: /Dell|PowerEdge|iDRAC/i, deviceType: 'dell_device', confidence: 'medium' },
  // Printer patterns
  { pattern: /Printer|RICOH|Canon|Xerox|Epson|Brother|Kyocera|HP LaserJet|HP Color/i, deviceType: 'printer', confidence: 'high' },
  // UPS/APC
  { pattern: /APC|UPS|Smart-UPS|Symmetra|Eaton/i, deviceType: 'ups', confidence: 'high' },
  // Generic network device
  { pattern: /Switch|Router|Gateway|Firewall/i, deviceType: 'network_device', confidence: 'low' },
];

// Analyze SNMP sysDescr to fingerprint device type
export function fingerprintFromSysDescr(sysDescr: string): DeviceFingerprint | null {
  if (!sysDescr || sysDescr === 'Unknown Device') return null;
  
  for (const { pattern, deviceType, confidence, extractModel } of SYSDESCR_PATTERNS) {
    const match = sysDescr.match(pattern);
    if (match) {
      return {
        deviceType,
        confidence,
        detectedModel: extractModel ? extractModel(match, sysDescr) : undefined,
        detectedVia: 'snmp_sysdescr',
        sysDescr,
      };
    }
  }
  
  return null;
}

// SSH banner patterns for fingerprinting
const SSH_BANNER_PATTERNS: Array<{
  pattern: RegExp;
  deviceType: string;
  confidence: 'high' | 'medium' | 'low';
}> = [
  { pattern: /MikroTik/i, deviceType: 'mikrotik_router', confidence: 'high' },
  { pattern: /Cisco/i, deviceType: 'cisco', confidence: 'high' },
  { pattern: /Ubuntu/i, deviceType: 'linux_server', confidence: 'high' },
  { pattern: /Debian/i, deviceType: 'linux_server', confidence: 'high' },
  { pattern: /OpenSSH.*FreeBSD/i, deviceType: 'bsd_server', confidence: 'high' },
  { pattern: /OpenSSH/i, deviceType: 'linux_server', confidence: 'medium' }, // Could be any Unix-like
  { pattern: /dropbear/i, deviceType: 'embedded_linux', confidence: 'medium' },
  { pattern: /Windows/i, deviceType: 'windows_server', confidence: 'high' },
];

// Probe Mikrotik API port (8728) - most reliable way to detect Mikrotik devices
// Mikrotik API responds immediately on connection, so a simple TCP connect is enough
export async function probeMikrotikApiPort(ipAddress: string, port: number = 8728, timeoutMs: number = 2000): Promise<DeviceFingerprint | null> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let resolved = false;
    
    const cleanup = (result: DeviceFingerprint | null) => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(result);
      }
    };
    
    socket.setTimeout(timeoutMs);
    
    socket.on('connect', () => {
      // Mikrotik API port is open - this is very likely a Mikrotik device
      cleanup({
        deviceType: 'mikrotik_router',
        confidence: 'high',
        detectedVia: 'mikrotik_api',
        additionalInfo: { apiPort: port },
      });
    });
    
    socket.on('timeout', () => cleanup(null));
    socket.on('error', () => cleanup(null));
    
    // Hard timeout
    setTimeout(() => cleanup(null), timeoutMs + 200);
    
    socket.connect(port, ipAddress);
  });
}

// Probe SSH banner on port 22
export async function probeSSHBanner(ipAddress: string, timeoutMs: number = 3000): Promise<DeviceFingerprint | null> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let banner = '';
    let resolved = false;
    
    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
      }
    };
    
    socket.setTimeout(timeoutMs);
    
    socket.on('connect', () => {
      // SSH server sends banner on connect
    });
    
    socket.on('data', (data: Buffer) => {
      banner += data.toString();
      // SSH banner is typically in first line
      if (banner.includes('\n') || banner.length > 200) {
        cleanup();
        
        for (const { pattern, deviceType, confidence } of SSH_BANNER_PATTERNS) {
          if (pattern.test(banner)) {
            resolve({
              deviceType,
              confidence,
              detectedVia: 'ssh_banner',
              additionalInfo: { sshBanner: banner.trim().split('\n')[0] },
            });
            return;
          }
        }
        
        // SSH responded but no specific match
        resolve({
          deviceType: 'generic_ssh',
          confidence: 'low',
          detectedVia: 'ssh_banner',
          additionalInfo: { sshBanner: banner.trim().split('\n')[0] },
        });
      }
    });
    
    socket.on('timeout', () => {
      cleanup();
      resolve(null);
    });
    
    socket.on('error', () => {
      cleanup();
      resolve(null);
    });
    
    socket.on('close', () => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    });
    
    socket.connect(22, ipAddress);
    
    // Hard timeout
    setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs + 500);
  });
}

// HTTP fingerprint patterns
const HTTP_FINGERPRINT_PATTERNS: Array<{
  pattern: RegExp;
  headerPattern?: RegExp;
  deviceType: string;
  confidence: 'high' | 'medium' | 'low';
}> = [
  // VMware ESXi - check body or headers
  { pattern: /VMware ESXi|vSphere|hostd/i, deviceType: 'vmware_esxi', confidence: 'high' },
  // Proxmox VE - runs on port 8006
  { pattern: /Proxmox|pve-manager|PVE/i, deviceType: 'proxmox', confidence: 'high' },
  // MikroTik webfig
  { pattern: /webfig|RouterOS|mikrotik/i, deviceType: 'mikrotik_router', confidence: 'high' },
  // Synology DSM
  { pattern: /Synology|DiskStation|DSM/i, deviceType: 'synology_nas', confidence: 'high' },
  // QNAP
  { pattern: /QNAP|QTS/i, deviceType: 'qnap_nas', confidence: 'high' },
  // UniFi Controller
  { pattern: /UniFi|ubnt/i, deviceType: 'ubiquiti', confidence: 'high' },
  // iLO/iDRAC
  { pattern: /iLO|Integrated Lights-Out/i, deviceType: 'hp_device', confidence: 'high' },
  { pattern: /iDRAC|Dell Remote Access/i, deviceType: 'dell_device', confidence: 'high' },
  // Fortinet
  { pattern: /FortiGate|Fortinet/i, deviceType: 'fortinet', confidence: 'high' },
  // pfSense/OPNsense
  { pattern: /pfSense|OPNsense/i, deviceType: 'bsd_server', confidence: 'high' },
  // Windows IIS
  { pattern: /IIS|Microsoft-IIS/i, headerPattern: /Server:\s*Microsoft-IIS/i, deviceType: 'windows_server', confidence: 'medium' },
  // Apache on Linux
  { pattern: /Apache/i, headerPattern: /Server:\s*Apache/i, deviceType: 'linux_server', confidence: 'low' },
  // nginx
  { pattern: /nginx/i, headerPattern: /Server:\s*nginx/i, deviceType: 'linux_server', confidence: 'low' },
];

// Probe HTTP/HTTPS to fingerprint device
export async function probeHTTPFingerprint(
  ipAddress: string, 
  port: number = 443,
  timeoutMs: number = 3000
): Promise<DeviceFingerprint | null> {
  const useHttps = port === 443 || port === 8006 || port === 8443;
  const protocol = useHttps ? https : http;
  
  return new Promise((resolve) => {
    const req = protocol.get({
      hostname: ipAddress,
      port,
      path: '/',
      timeout: timeoutMs,
      rejectUnauthorized: false, // Accept self-signed certs
      headers: {
        'User-Agent': 'CoreBit-NetworkScanner/1.0',
      },
    }, (res: any) => {
      let body = '';
      
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
        // Only read first 4KB
        if (body.length > 4096) {
          req.destroy();
        }
      });
      
      res.on('end', () => {
        const headers = JSON.stringify(res.headers);
        const combined = body + headers;
        
        for (const { pattern, headerPattern, deviceType, confidence } of HTTP_FINGERPRINT_PATTERNS) {
          if (pattern.test(body) || pattern.test(combined)) {
            resolve({
              deviceType,
              confidence,
              detectedVia: `http_${port}`,
              additionalInfo: { httpServer: res.headers['server'] },
            });
            return;
          }
          if (headerPattern && headerPattern.test(headers)) {
            resolve({
              deviceType,
              confidence,
              detectedVia: `http_${port}`,
              additionalInfo: { httpServer: res.headers['server'] },
            });
            return;
          }
        }
        
        // HTTP responded but no specific match
        if (res.headers['server']) {
          resolve({
            deviceType: 'generic_http',
            confidence: 'low',
            detectedVia: `http_${port}`,
            additionalInfo: { httpServer: res.headers['server'] },
          });
        } else {
          resolve(null);
        }
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    
    req.on('error', () => {
      resolve(null);
    });
    
    // Hard timeout
    setTimeout(() => {
      req.destroy();
      resolve(null);
    }, timeoutMs + 500);
  });
}

// Credential profile interface for discovery
interface CredentialProfile {
  id: string;
  type: string;
  credentials: {
    username?: string;
    password?: string;
    snmpCommunity?: string;
    snmpVersion?: string;
    apiPort?: number;
    prometheusPort?: number;
    prometheusPath?: string;
    prometheusScheme?: 'http' | 'https';
    // Proxmox credentials
    proxmoxPort?: number;
    proxmoxApiTokenId?: string;
    proxmoxApiTokenSecret?: string;
    proxmoxVerifySsl?: boolean;
    proxmoxRealm?: string;
  };
}

// Main discovery function - pings first, then fingerprints with priority:
// 1. Mikrotik API with credentials (get identity)
// 2. SNMP (get sysName for device naming)
// 3. SSH/HTTP fingerprinting
// 4. Ping-only fallback
export async function discoverDevice(
  ipAddress: string,
  credentialProfiles: CredentialProfile[] = [],
  timeoutMs: number = 5000,
  enableLogging: boolean = false
): Promise<{
  reachable: boolean;
  fingerprint: DeviceFingerprint | null;
  pingRtt?: number;
  sysName?: string;
  identity?: string;
  workingCredentialProfileId?: string;
}> {
  const log = (msg: string) => {
    if (enableLogging) {
      console.log(`[Discovery] ${ipAddress}: ${msg}`);
    }
  };

  // Step 1: Ping check
  log('Checking reachability...');
  const pingResult = await pingDevice(ipAddress, Math.ceil(timeoutMs / 1000));
  if (!pingResult.success) {
    log('Not reachable (ping failed)');
    return { reachable: false, fingerprint: null };
  }
  log(`Reachable (RTT: ${pingResult.rtt?.toFixed(1) || '?'}ms)`);
  
  // Step 2: Try Mikrotik API LOGIN with credentials (priority #1)
  // Check if port 8728 is open first
  log('Probing Mikrotik API port 8728...');
  const mikrotikPortOpen = await probeMikrotikApiPort(ipAddress, 8728, 2000);
  
  if (mikrotikPortOpen) {
    log('Mikrotik API port open, trying credentials...');
    
    // Get Mikrotik credentials from profiles
    const mikrotikProfiles = credentialProfiles.filter(p => p.type === 'mikrotik');
    log(`Found ${mikrotikProfiles.length} Mikrotik credential profiles to try`);
    
    for (const profile of mikrotikProfiles) {
      const creds = profile.credentials || {};
      // Default to 'admin' username if not specified (matches probeMikrotikDevice behavior)
      const username = creds.username || 'admin';
      const password = creds.password || '';
      const apiPort = creds.apiPort || 8728;
      
      log(`Profile ${profile.id} credentials: username=${username}, password=${password ? 'SET' : 'EMPTY'}, port=${apiPort}`);
      
      if (!password) {
        log(`Skipping profile ${profile.id} - no password`);
        continue;
      }
      
      log(`Trying Mikrotik login with profile: ${profile.id} user=${username} port=${apiPort}`);
      
      try {
        const api = new RouterOSAPI({
          host: ipAddress,
          port: apiPort,
          user: username,
          password: password,
          timeout: 3000,
        });
        
        await api.connect();
        
        // Get identity
        const identityResult = await api.write('/system/identity/print');
        const identity = identityResult?.[0]?.name || 'Mikrotik';
        
        // Get model info
        const resourceResult = await api.write('/system/resource/print');
        const model = resourceResult?.[0]?.['board-name'] || 'RouterOS';
        const version = resourceResult?.[0]?.version || '';
        
        await api.close();
        
        log(`Mikrotik login SUCCESS with profile ${profile.id}, identity: ${identity}`);
        
        return {
          reachable: true,
          fingerprint: {
            deviceType: 'mikrotik_router',
            confidence: 'high',
            detectedVia: 'mikrotik_api',
            detectedModel: model,
            additionalInfo: { version, identity },
          },
          pingRtt: pingResult.rtt,
          identity,
          workingCredentialProfileId: profile.id,
        };
      } catch (err: any) {
        log(`Mikrotik login failed with profile ${profile.id}: ${err.message || err}`);
      }
    }
    
    // Mikrotik port is open but no credentials worked
    log('Mikrotik API port open but no working credentials');
    return {
      reachable: true,
      fingerprint: {
        deviceType: 'mikrotik_router',
        confidence: 'high',
        detectedVia: 'mikrotik_api_port',
        additionalInfo: { needsCredentials: true },
      },
      pingRtt: pingResult.rtt,
    };
  }
  
  // Step 3: Try SNMP (priority #2 - get sysName for device naming)
  const snmpProfiles = credentialProfiles.filter(p => p.type === 'snmp');
  const snmpCommunities = snmpProfiles.length > 0 
    ? snmpProfiles.map(p => ({ id: p.id, community: p.credentials.snmpCommunity || 'public' }))
    : [{ id: undefined, community: 'public' }];
  
  for (const { id: profileId, community } of snmpCommunities) {
    log(`Probing SNMP (community: ${community})...`);
    const snmpResult = await getSnmpSystemInfo(ipAddress, community);
    
    if (snmpResult.success && snmpResult.sysDescr) {
      log(`SNMP responded: ${snmpResult.sysDescr.substring(0, 60)}... sysName: ${snmpResult.sysName || 'N/A'}`);
      const fingerprint = fingerprintFromSysDescr(snmpResult.sysDescr);
      
      if (fingerprint) {
        log(`Identified via SNMP as: ${fingerprint.deviceType}`);
        return { 
          reachable: true, 
          fingerprint: {
            ...fingerprint,
            sysDescr: snmpResult.sysDescr,
          },
          pingRtt: pingResult.rtt,
          sysName: snmpResult.sysName,
          workingCredentialProfileId: profileId,
        };
      }
      
      // SNMP works but couldn't identify specific type - return as generic SNMP with sysName
      log('SNMP responded but could not identify device type');
      return {
        reachable: true,
        fingerprint: {
          deviceType: 'generic_snmp',
          confidence: 'low',
          detectedVia: 'snmp_sysdescr',
          sysDescr: snmpResult.sysDescr,
        },
        pingRtt: pingResult.rtt,
        sysName: snmpResult.sysName,
        workingCredentialProfileId: profileId,
      };
    }
  }
  log('SNMP not available or timed out');
  
  // Step 3.5: Try Prometheus node_exporter (common on Linux servers)
  log('Probing Prometheus node_exporter (port 9100)...');
  const prometheusAvailable = await checkPrometheusAvailable(ipAddress, 9100, 2000);
  if (prometheusAvailable) {
    log('Prometheus node_exporter detected');
    try {
      const promData = await probePrometheusDevice(ipAddress, {}, 3000);
      const hostname = promData.systemIdentity || '';
      return {
        reachable: true,
        fingerprint: {
          deviceType: 'generic_prometheus',
          confidence: 'high',
          detectedVia: 'prometheus_node_exporter',
          detectedModel: promData.model || 'Linux Server',
          additionalInfo: { 
            version: promData.version,
            cpuUsagePct: promData.cpuUsagePct,
            memoryUsagePct: promData.memoryUsagePct,
            diskUsagePct: promData.diskUsagePct,
          },
        },
        pingRtt: pingResult.rtt,
        sysName: hostname,
      };
    } catch (promErr: any) {
      log(`Prometheus probe failed: ${promErr.message}`);
    }
  }
  
  // Step 3.6: Try Proxmox VE detection (port 8006)
  log('Probing Proxmox VE (port 8006)...');
  const proxmoxAvailable = await checkProxmoxAvailable(ipAddress, 8006, 2000);
  if (proxmoxAvailable) {
    log('Proxmox VE detected on port 8006');
    
    // Try to get cluster info with Proxmox credentials
    const proxmoxProfiles = credentialProfiles.filter(p => p.type === 'proxmox');
    let clusterName: string | undefined;
    let workingProfileId: string | undefined;
    
    for (const profile of proxmoxProfiles) {
      const creds = profile.credentials || {};
      if (creds.proxmoxApiTokenId && creds.proxmoxApiTokenSecret) {
        try {
          const api = new ProxmoxApi({
            host: ipAddress,
            port: creds.proxmoxPort || 8006,
            apiTokenId: creds.proxmoxApiTokenId,
            apiTokenSecret: creds.proxmoxApiTokenSecret,
            verifySsl: creds.proxmoxVerifySsl !== false,
          });
          
          const hostInfo = await api.getHostInfo();
          clusterName = hostInfo?.clusterName;
          workingProfileId = profile.id;
          log(`Proxmox authenticated with profile ${profile.id}, cluster: ${clusterName || 'standalone'}`);
          break;
        } catch (proxErr: any) {
          log(`Proxmox auth failed with profile ${profile.id}: ${proxErr.message}`);
        }
      }
    }
    
    return {
      reachable: true,
      fingerprint: {
        deviceType: 'proxmox',
        confidence: 'high',
        detectedVia: 'proxmox_api',
        detectedModel: 'Proxmox VE',
        additionalInfo: { 
          clusterName,
          needsCredentials: !workingProfileId,
        },
      },
      pingRtt: pingResult.rtt,
      sysName: clusterName || `Proxmox-${ipAddress}`,
      workingCredentialProfileId: workingProfileId,
    };
  }
  
  // Step 4: Try SSH banner grab
  log('Probing SSH port 22...');
  const sshFingerprint = await probeSSHBanner(ipAddress, 2000);
  if (sshFingerprint) {
    log(`Identified via SSH as: ${sshFingerprint.deviceType}`);
    return { 
      reachable: true, 
      fingerprint: sshFingerprint, 
      pingRtt: pingResult.rtt 
    };
  }
  log('SSH not available or timed out');
  
  // Step 5: Try HTTP/HTTPS fingerprinting
  const httpPorts = [443, 80, 8006, 8443];
  for (const port of httpPorts) {
    log(`Probing HTTP port ${port}...`);
    const httpFingerprint = await probeHTTPFingerprint(ipAddress, port, 2000);
    if (httpFingerprint && httpFingerprint.confidence !== 'low') {
      log(`Identified via HTTP as: ${httpFingerprint.deviceType}`);
      return { 
        reachable: true, 
        fingerprint: httpFingerprint, 
        pingRtt: pingResult.rtt 
      };
    }
  }
  log('HTTP probes did not identify device');
  
  // Step 6: Device responds to ping but couldn't identify
  log('Classified as generic_ping (no identification possible)');
  return {
    reachable: true,
    fingerprint: {
      deviceType: 'generic_ping',
      confidence: 'low',
      detectedVia: 'ping_only',
    },
    pingRtt: pingResult.rtt,
  };
}

export async function pingDevice(ipAddress: string, timeoutSeconds: number = 3): Promise<{ success: boolean; rtt?: number }> {
  return new Promise((resolve) => {
    // Validate IP address to prevent command injection
    if (!isIP(ipAddress)) {
      console.warn(`[Ping] Invalid IP address format: ${ipAddress}`);
      resolve({ success: false });
      return;
    }
    
    // Use execFile with argument array for security (no shell interpolation)
    const isWindows = process.platform === 'win32';
    const pingPath = isWindows ? 'ping' : '/bin/ping';
    const pingArgs = isWindows
      ? ['-n', '1', '-w', String(timeoutSeconds * 1000), ipAddress]
      : ['-c', '1', '-W', String(timeoutSeconds), ipAddress];
    
    execFile(pingPath, pingArgs, { timeout: (timeoutSeconds + 1) * 1000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false });
        return;
      }
      
      const rttMatch = stdout.match(/time[=<](\d+(?:\.\d+)?)\s*ms/i);
      const rtt = rttMatch ? parseFloat(rttMatch[1]) : undefined;
      
      resolve({ success: true, rtt });
    });
  });
}

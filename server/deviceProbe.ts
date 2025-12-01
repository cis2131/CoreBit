import { RouterOSAPI } from 'node-routeros';
import * as snmp from 'net-snmp';
import { execFile } from 'child_process';
import { isIP } from 'net';

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
        results[vb.oid] = vb.value.toString();
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
      
      resolve({ success: true, sysDescr: varbinds[0].value.toString() });
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
        const ifDescr = vb.value.toString();
        
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
          if (idx === 0) sysDescr = vb.value.toString();
          if (idx === 1) sysUpTime = formatUptime(parseInt(vb.value.toString()) / 100);
          if (idx === 2) sysName = vb.value.toString();
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

          // Continue with interface walk to get names, speeds, and descriptions
          session.walk('1.3.6.1.2.1.2.2.1', (varbinds: any[]) => {
            const portMap: { [key: string]: any } = {};
            
            varbinds.forEach((vb) => {
              if (snmp.isVarbindError(vb)) return;
              
              const oid = vb.oid;
              const parts = oid.split('.');
              const ifIndex = parts[parts.length - 1];
              
              if (!portMap[ifIndex]) {
                portMap[ifIndex] = {};
              }
              
              // 1.3.6.1.2.1.2.2.1.2.X - ifDescr (description/name)
              if (oid.startsWith('1.3.6.1.2.1.2.2.1.2.')) {
                portMap[ifIndex].name = vb.value.toString();
              }
              // 1.3.6.1.2.1.2.2.1.5.X - ifSpeed (speed in bps)
              else if (oid.startsWith('1.3.6.1.2.1.2.2.1.5.')) {
                const speedBps = parseInt(vb.value.toString());
                portMap[ifIndex].speedBps = speedBps;
              }
              // 1.3.6.1.2.1.2.2.1.6.X - ifPhysAddress
              else if (oid.startsWith('1.3.6.1.2.1.2.2.1.6.')) {
                portMap[ifIndex].physAddress = vb.value.toString();
              }
            });
            
            // Convert speed in bps to human readable format
            const formatSpeed = (bps: number): string => {
              if (bps >= 1000000000000) return `${(bps / 1000000000000).toFixed(1)}Tbps`;
              if (bps >= 1000000000) return `${(bps / 1000000000).toFixed(0)}Gbps`;
              if (bps >= 1000000) return `${(bps / 1000000).toFixed(0)}Mbps`;
              if (bps >= 1000) return `${(bps / 1000).toFixed(0)}Kbps`;
              return `${bps}bps`;
            };
            
            const ports = Object.values(portMap).map((p: any) => ({
              name: p.name || 'unknown',
              status: 'unknown',
              speed: p.speedBps ? formatSpeed(p.speedBps) : '1Gbps',
              description: undefined,
            }));

            closeSession();
            
            resolve({
              model: sysDescr.substring(0, 100),
              systemIdentity: sysName,
              version: 'SNMP',
              uptime: sysUpTime,
              ports: ports.length > 0 ? ports.slice(0, 10) : [{
                name: 'eth0',
                status: 'up',
                speed: '1Gbps',
              }],
              cpuUsagePct,
              memoryUsagePct,
              diskUsagePct,
            });
          }, (error: any) => {
            closeSession();
            // Walk failed - use basic data
            resolve({
              model: sysDescr.substring(0, 100),
              systemIdentity: sysName,
              version: 'SNMP',
              uptime: sysUpTime,
              ports: [{
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

export async function probeDevice(
  deviceType: string,
  ipAddress?: string,
  credentials?: any,
  detailedProbe: boolean = false,
  previousPorts?: Array<{ name: string; defaultName?: string; status: string; speed?: string }>,
  needsSnmpIndexing: boolean = false,  // Only true when device has monitored connections
  timeoutSeconds: number = 5,  // Device probe timeout in seconds
  abortSignal?: AbortSignal
): Promise<{ data: DeviceProbeData; success: boolean }> {
  if (!ipAddress) {
    return { data: {}, success: false };
  }

  try {
    let data: DeviceProbeData;
    if (deviceType.startsWith('mikrotik_')) {
      // Use connection pool when enabled, otherwise use standard per-probe connection
      if (mikrotikPool.isEnabled()) {
        data = await probeMikrotikWithPool(ipAddress, credentials, detailedProbe, previousPorts, needsSnmpIndexing, timeoutSeconds, abortSignal);
      } else {
        data = await probeMikrotikDevice(ipAddress, credentials, detailedProbe, previousPorts, needsSnmpIndexing, timeoutSeconds);
      }
    } else {
      data = await probeSnmpDevice(ipAddress, credentials);
    }
    return { data, success: true };
  } catch (error: any) {
    return { data: {}, success: false };
  }
}

export function determineDeviceStatus(probeData: DeviceProbeData, probeSucceeded: boolean): string {
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
            
            const name = vb.value.toString();
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

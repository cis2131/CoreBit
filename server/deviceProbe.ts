import { RouterOSAPI } from 'node-routeros';
import * as snmp from 'net-snmp';

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
  }>;
  cpuUsagePct?: number;
  memoryUsagePct?: number;
  diskUsagePct?: number;
}

async function probeMikrotikDevice(
  ipAddress: string,
  credentials?: any,
  detailedProbe: boolean = false,
  previousPorts?: Array<{ name: string; defaultName?: string; status: string; speed?: string }>
): Promise<DeviceProbeData> {
  const username = credentials?.username || 'admin';
  const password = credentials?.password || '';
  const port = credentials?.apiPort || 8728;

  console.log(`[Mikrotik] Connecting to ${ipAddress}:${port} as ${username}${detailedProbe ? ' (detailed)' : ''}...`);

  const conn = new RouterOSAPI({
    host: ipAddress,
    user: username,
    password: password,
    port: port,
    timeout: 5,
  });

  try {
    await conn.connect();
    console.log(`[Mikrotik] Connected to ${ipAddress}`);

    const [identity, resources, interfaces] = await Promise.all([
      conn.write('/system/identity/print').catch(() => []),
      conn.write('/system/resource/print').catch(() => []),
      conn.write('/interface/print').catch(() => []),
    ]);

    const identityName = identity[0]?.name || 'Unknown';
    const board = resources[0]?.['board-name'] || 'Unknown Model';
    const version = resources[0]?.version || 'Unknown';
    const uptime = resources[0]?.uptime || '0s';
    
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
        console.log(`[Mikrotik] Running detailed ethernet monitoring on ${ipAddress}...`);
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
              console.log(`[Mikrotik] Interface ${ethIface.name} speed: ${monitorResult[0].speed}`);
            } else if (monitorResult[0]?.rate) {
              // Fallback to 'rate' if 'speed' not found
              speedMap[ethIface.name] = monitorResult[0].rate;
              console.log(`[Mikrotik] Interface ${ethIface.name} rate: ${monitorResult[0].rate}`);
            }
          } catch (err: any) {
            console.warn(`[Mikrotik] Failed to monitor ${ethIface.name}:`, err.message);
          }
        }
        console.log(`[Mikrotik] Detailed monitoring complete for ${ipAddress}, found ${Object.keys(speedMap).length} speeds`);
      } catch (err: any) {
        console.warn(`[Mikrotik] Detailed monitoring failed on ${ipAddress}:`, err.message);
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
      
      return {
        name: ifaceName,
        defaultName,
        status: currentStatus,
        speed,
        description: iface.comment || undefined,
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

async function probeSnmpDevice(
  ipAddress: string,
  credentials?: any
): Promise<DeviceProbeData> {
  const snmpVersion = credentials?.snmpVersion || '2c';
  const community = credentials?.snmpCommunity || 'public';

  console.log(`[SNMP] Probing ${ipAddress} with SNMPv${snmpVersion}...`);

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
          console.warn(`[SNMP] Error closing session:`, err.message);
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
        console.error(`[SNMP] Failed to probe ${ipAddress}:`, error.message);
        closeSession();
        return reject(new Error(`SNMP probe failed: ${error.message}`));
      }

      let sysDescr = 'Unknown Device';
      let sysUpTime = '0';
      let sysName = 'Unknown';

      varbinds.forEach((vb, idx) => {
        if (snmp.isVarbindError(vb)) {
          console.warn(`[SNMP] Error in varbind ${idx}:`, snmp.varbindError(vb));
        } else {
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
            
            if (error) {
              console.warn(`[SNMP] Walk failed, using basic data:`, error.message);
            }
            
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
  previousPorts?: Array<{ name: string; defaultName?: string; status: string; speed?: string }>
): Promise<{ data: DeviceProbeData; success: boolean }> {
  if (!ipAddress) {
    console.log(`[Probe] No IP address provided for ${deviceType}, returning empty data`);
    return { data: {}, success: false };
  }

  try {
    let data: DeviceProbeData;
    if (deviceType.startsWith('mikrotik_')) {
      data = await probeMikrotikDevice(ipAddress, credentials, detailedProbe, previousPorts);
    } else {
      data = await probeSnmpDevice(ipAddress, credentials);
    }
    return { data, success: true };
  } catch (error: any) {
    console.error(`[Probe] Error probing ${deviceType} at ${ipAddress}:`, error.message);
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

export async function probeInterfaceTraffic(
  ipAddress: string,
  interfaceName: string,
  credentials?: any
): Promise<{ data: TrafficCounters | null; success: boolean }> {
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

    const cleanup = (result: { data: TrafficCounters | null; success: boolean }) => {
      closeSession();
      resolve(result);
    };

    try {
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
          timeout: 3000,
        });
      } else {
        const version = snmpVersion === '1' ? snmp.Version1 : snmp.Version2c;
        session = snmp.createSession(ipAddress, community, {
          port: 161,
          retries: 0,
          timeout: 3000,
          version,
        });
      }

      // First, walk ifDescr to find the interface index
      const ifDescrOid = '1.3.6.1.2.1.2.2.1.2'; // ifDescr
      let targetIfIndex: number | null = null;

      session.walk(ifDescrOid, (varbinds: any[]) => {
        for (const vb of varbinds) {
          if (snmp.isVarbindError(vb)) continue;
          
          const name = vb.value.toString();
          const oid = vb.oid;
          const parts = oid.split('.');
          const ifIndex = parseInt(parts[parts.length - 1]);
          
          // Match interface name (case-insensitive, also check for partial match)
          if (name.toLowerCase() === interfaceName.toLowerCase() ||
              name.toLowerCase().includes(interfaceName.toLowerCase()) ||
              interfaceName.toLowerCase().includes(name.toLowerCase())) {
            targetIfIndex = ifIndex;
            break;
          }
        }
      }, (error: any) => {
        if (error || targetIfIndex === null) {
          console.warn(`[Traffic] Could not find interface ${interfaceName} on ${ipAddress}`);
          cleanup({ data: null, success: false });
          return;
        }

        // Found the interface, now get the counters
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
                  ifIndex: targetIfIndex!,
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
              console.warn(`[Traffic] Failed to get counters for ${interfaceName} on ${ipAddress}`);
              cleanup({ data: null, success: false });
              return;
            }

            if (snmp.isVarbindError(varbinds[0]) || snmp.isVarbindError(varbinds[1])) {
              console.warn(`[Traffic] Counter error for ${interfaceName} on ${ipAddress}`);
              cleanup({ data: null, success: false });
              return;
            }

            const inOctets = parseCounter(varbinds[0].value);
            const outOctets = parseCounter(varbinds[1].value);

            if (inOctets === null || outOctets === null) {
              cleanup({ data: null, success: false });
              return;
            }

            cleanup({
              data: {
                inOctets,
                outOctets,
                ifIndex: targetIfIndex!,
                timestamp: Date.now(),
              },
              success: true,
            });
          });
        });
      });
    } catch (error: any) {
      console.error(`[Traffic] Error probing ${interfaceName} on ${ipAddress}:`, error.message);
      cleanup({ data: null, success: false });
    }
  });
}

function parseCounter(value: any): number | null {
  if (value === undefined || value === null) return null;
  
  // Handle Buffer for 64-bit counters
  if (Buffer.isBuffer(value)) {
    if (value.length === 8) {
      // 64-bit counter
      const high = value.readUInt32BE(0);
      const low = value.readUInt32BE(4);
      return high * 0x100000000 + low;
    } else if (value.length === 4) {
      return value.readUInt32BE(0);
    }
    return parseInt(value.toString(), 10);
  }
  
  // Handle BigInt
  if (typeof value === 'bigint') {
    return Number(value);
  }
  
  // Handle number or string
  const num = parseInt(value.toString(), 10);
  return isNaN(num) ? null : num;
}

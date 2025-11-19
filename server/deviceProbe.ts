import { RouterOSAPI } from 'node-routeros';
import * as snmp from 'net-snmp';

export interface DeviceProbeData {
  uptime?: string;
  model?: string;
  version?: string;
  ports?: Array<{
    name: string;
    status: string;
    speed?: string;
  }>;
}

async function probeMikrotikDevice(
  ipAddress: string,
  credentials?: any
): Promise<DeviceProbeData> {
  const username = credentials?.username || 'admin';
  const password = credentials?.password || '';
  const port = credentials?.apiPort || 8728;

  console.log(`[Mikrotik] Connecting to ${ipAddress}:${port} as ${username}...`);

  const conn = new RouterOSAPI({
    host: ipAddress,
    user: username,
    password: password,
    port: port,
    timeout: 10,
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

    const ports = (interfaces as any[]).map((iface: any) => ({
      name: iface.name || 'unknown',
      status: iface.running === 'true' || iface.running === true ? 'up' : 'down',
      speed: iface.type?.includes('ether') ? '1Gbps' : undefined,
    }));

    conn.close();

    return {
      model: `${board} (${identityName})`,
      version: `RouterOS ${version}`,
      uptime,
      ports,
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

  const oids = [
    '1.3.6.1.2.1.1.1.0',  // sysDescr
    '1.3.6.1.2.1.1.3.0',  // sysUpTime
    '1.3.6.1.2.1.1.5.0',  // sysName
  ];

  return new Promise((resolve, reject) => {
    let session: any;

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
        retries: 1,
        timeout: 5000,
      });
    } else {
      const version = snmpVersion === '1' ? snmp.Version1 : snmp.Version2c;
      session = snmp.createSession(ipAddress, community, {
        port: 161,
        retries: 1,
        timeout: 5000,
        version,
      });
    }

    session.get(oids, (error: any, varbinds: any[]) => {
      if (error) {
        console.error(`[SNMP] Failed to probe ${ipAddress}:`, error.message);
        session.close();
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

      session.walk('1.3.6.1.2.1.2.2.1', (varbinds: any[]) => {
        const ports: Array<{ name: string; status: string; speed?: string }> = [];
        
        varbinds.forEach((vb) => {
          if (snmp.isVarbindError(vb)) return;
          
          const oid = vb.oid;
          if (oid.startsWith('1.3.6.1.2.1.2.2.1.2.')) {
            const ifIndex = oid.split('.').pop();
            ports.push({
              name: vb.value.toString(),
              status: 'unknown',
            });
          }
        });

        session.close();
        
        resolve({
          model: `${sysName}`,
          version: sysDescr.substring(0, 100),
          uptime: sysUpTime,
          ports: ports.length > 0 ? ports.slice(0, 10) : [{
            name: 'eth0',
            status: 'up',
            speed: '1Gbps',
          }],
        });
      }, (error: any) => {
        session.close();
        
        if (error) {
          console.warn(`[SNMP] Walk failed, using basic data:`, error.message);
        }
        
        resolve({
          model: sysName,
          version: sysDescr.substring(0, 100),
          uptime: sysUpTime,
          ports: [{
            name: 'eth0',
            status: 'up',
            speed: '1Gbps',
          }],
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
  credentials?: any
): Promise<DeviceProbeData> {
  if (!ipAddress) {
    console.log(`[Probe] No IP address provided for ${deviceType}, returning empty data`);
    return {};
  }

  try {
    if (deviceType.startsWith('mikrotik_')) {
      return await probeMikrotikDevice(ipAddress, credentials);
    } else {
      return await probeSnmpDevice(ipAddress, credentials);
    }
  } catch (error: any) {
    console.error(`[Probe] Error probing ${deviceType} at ${ipAddress}:`, error.message);
    return {};
  }
}

export function determineDeviceStatus(probeData: DeviceProbeData): string {
  if (!probeData.uptime && !probeData.model) return 'offline';
  if (!probeData.uptime) return 'unknown';
  
  const activePorts = probeData.ports?.filter(p => p.status === 'up').length || 0;
  const totalPorts = probeData.ports?.length || 0;

  if (totalPorts === 0) return 'online';
  if (activePorts === 0) return 'offline';
  if (activePorts < totalPorts * 0.5) return 'warning';
  
  return 'online';
}

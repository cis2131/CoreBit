// Mock device probing service for Mikrotik API and SNMP
// In production, this would connect to real devices using node-routeros and net-snmp

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

const mockMikrotikData: Record<string, DeviceProbeData> = {
  mikrotik_router: {
    uptime: '7 days, 14:32:15',
    model: 'RB4011iGS+',
    version: 'RouterOS 7.12',
    ports: [
      { name: 'ether1', status: 'up', speed: '1Gbps' },
      { name: 'ether2', status: 'up', speed: '1Gbps' },
      { name: 'ether3', status: 'down' },
      { name: 'ether4', status: 'up', speed: '1Gbps' },
      { name: 'sfp-sfpplus1', status: 'up', speed: '10Gbps' },
    ],
  },
  mikrotik_switch: {
    uptime: '15 days, 3:21:08',
    model: 'CRS326-24G-2S+',
    version: 'RouterOS 7.11',
    ports: [
      { name: 'ether1', status: 'up', speed: '1Gbps' },
      { name: 'ether2', status: 'up', speed: '1Gbps' },
      { name: 'ether3', status: 'up', speed: '1Gbps' },
      { name: 'ether4', status: 'down' },
      { name: 'ether5', status: 'up', speed: '1Gbps' },
      { name: 'sfp28-1', status: 'up', speed: '10Gbps' },
      { name: 'sfp28-2', status: 'down' },
    ],
  },
};

const mockSnmpData: Record<string, DeviceProbeData> = {
  generic_snmp: {
    uptime: '42 days, 8:15:32',
    model: 'Generic Switch',
    version: 'v2.1.4',
    ports: [
      { name: 'port1', status: 'up', speed: '1Gbps' },
      { name: 'port2', status: 'up', speed: '1Gbps' },
      { name: 'port3', status: 'down' },
      { name: 'port4', status: 'up', speed: '100Mbps' },
    ],
  },
  server: {
    uptime: '128 days, 16:42:11',
    model: 'Dell PowerEdge R740',
    version: 'ESXi 7.0',
    ports: [
      { name: 'eth0', status: 'up', speed: '10Gbps' },
      { name: 'eth1', status: 'up', speed: '10Gbps' },
    ],
  },
  access_point: {
    uptime: '21 days, 11:05:18',
    model: 'UniFi AP AC Pro',
    version: '5.60.9',
    ports: [
      { name: '2.4GHz', status: 'up', speed: '300Mbps' },
      { name: '5GHz', status: 'up', speed: '1.3Gbps' },
    ],
  },
};

export async function probeDevice(deviceType: string, ipAddress?: string): Promise<DeviceProbeData> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 100));

  // In production, this would:
  // 1. Connect to the device via Mikrotik API (for mikrotik_* types)
  // 2. Query SNMP for port information (for generic_snmp and other types)
  // 3. Parse and return real device data

  if (deviceType.startsWith('mikrotik_')) {
    return mockMikrotikData[deviceType] || {};
  }

  return mockSnmpData[deviceType] || {};
}

export function determineDeviceStatus(probeData: DeviceProbeData): string {
  if (!probeData.uptime) return 'unknown';
  
  const activePorts = probeData.ports?.filter(p => p.status === 'up').length || 0;
  const totalPorts = probeData.ports?.length || 0;

  if (totalPorts === 0) return 'online';
  if (activePorts === 0) return 'offline';
  if (activePorts < totalPorts * 0.5) return 'warning';
  
  return 'online';
}

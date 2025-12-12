import https from 'https';
import http from 'http';

export interface ProxmoxCredentials {
  host: string;
  port?: number;
  apiTokenId?: string;
  apiTokenSecret?: string;
  username?: string;
  password?: string;
  realm?: string;
  verifySsl?: boolean;
}

export interface ProxmoxNode {
  node: string;
  status: string;
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  uptime: number;
}

export interface ProxmoxVMInfo {
  vmid: number;
  name: string;
  status: string;
  type: 'qemu' | 'lxc';
  node: string;
  cpu: number;
  cpus: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  uptime: number;
  netin?: number;
  netout?: number;
  template?: boolean;
  ipAddresses?: string[];
  macAddresses?: string[];
}

export interface ProxmoxVMConfig {
  vmid: number;
  name: string;
  ipconfig?: Record<string, string>;
  net?: Record<string, string>;
  cores?: number;
  memory?: number;
}

export interface ProxmoxClusterStatus {
  name: string;
  version: number;
  nodelist?: string[];
  quorate?: boolean;
}

export interface ProxmoxVersion {
  version: string;
  release: string;
  repoid: string;
}

export interface ProxmoxApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export class ProxmoxApi {
  private credentials: ProxmoxCredentials;
  private ticket?: string;
  private csrfToken?: string;
  private ticketExpiry?: Date;

  constructor(credentials: ProxmoxCredentials) {
    this.credentials = {
      port: 8006,
      realm: 'pam',
      verifySsl: false,
      ...credentials
    };
  }

  private async makeRequest<T>(
    method: string,
    path: string,
    data?: Record<string, any>
  ): Promise<ProxmoxApiResult<T>> {
    const { host, port, apiTokenId, apiTokenSecret, verifySsl } = this.credentials;
    
    return new Promise((resolve) => {
      const url = new URL(`https://${host}:${port}/api2/json${path}`);
      
      let postData = '';
      if (data && method === 'POST') {
        postData = new URLSearchParams(data as Record<string, string>).toString();
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };

      if (apiTokenId && apiTokenSecret) {
        headers['Authorization'] = `PVEAPIToken=${apiTokenId}=${apiTokenSecret}`;
      } else if (this.ticket && this.csrfToken) {
        headers['Cookie'] = `PVEAuthCookie=${this.ticket}`;
        if (method !== 'GET') {
          headers['CSRFPreventionToken'] = this.csrfToken;
        }
      }

      const options: https.RequestOptions = {
        hostname: host,
        port: port,
        path: `/api2/json${path}`,
        method: method,
        headers: headers,
        rejectUnauthorized: verifySsl,
        timeout: 10000,
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              const parsed = JSON.parse(body);
              resolve({ success: true, data: parsed.data as T });
            } else {
              resolve({ success: false, error: `HTTP ${res.statusCode}: ${body}` });
            }
          } catch (e) {
            resolve({ success: false, error: `Parse error: ${e}` });
          }
        });
      });

      req.on('error', (e) => {
        resolve({ success: false, error: `Request error: ${e.message}` });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Request timeout' });
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }

  async authenticate(): Promise<boolean> {
    if (this.credentials.apiTokenId && this.credentials.apiTokenSecret) {
      return true;
    }

    if (this.ticket && this.ticketExpiry && this.ticketExpiry > new Date()) {
      return true;
    }

    const { username, password, realm } = this.credentials;
    if (!username || !password) {
      console.error('[Proxmox] No API token or username/password provided');
      return false;
    }

    const result = await this.makeRequest<{
      ticket: string;
      CSRFPreventionToken: string;
    }>('POST', '/access/ticket', {
      username: `${username}@${realm}`,
      password: password,
    });

    if (result.success && result.data) {
      this.ticket = result.data.ticket;
      this.csrfToken = result.data.CSRFPreventionToken;
      this.ticketExpiry = new Date(Date.now() + 7200 * 1000);
      return true;
    }

    console.error('[Proxmox] Authentication failed:', result.error);
    return false;
  }

  async getVersion(): Promise<ProxmoxApiResult<ProxmoxVersion>> {
    return this.makeRequest<ProxmoxVersion>('GET', '/version');
  }

  async getClusterStatus(): Promise<ProxmoxApiResult<ProxmoxClusterStatus[]>> {
    return this.makeRequest<ProxmoxClusterStatus[]>('GET', '/cluster/status');
  }

  async getNodes(): Promise<ProxmoxApiResult<ProxmoxNode[]>> {
    return this.makeRequest<ProxmoxNode[]>('GET', '/nodes');
  }

  async getNodeQemuVMs(node: string): Promise<ProxmoxApiResult<ProxmoxVMInfo[]>> {
    const result = await this.makeRequest<any[]>('GET', `/nodes/${node}/qemu`);
    if (result.success && result.data) {
      return {
        success: true,
        data: result.data.map(vm => ({ ...vm, type: 'qemu' as const, node }))
      };
    }
    return result as ProxmoxApiResult<ProxmoxVMInfo[]>;
  }

  async getNodeLxcContainers(node: string): Promise<ProxmoxApiResult<ProxmoxVMInfo[]>> {
    const result = await this.makeRequest<any[]>('GET', `/nodes/${node}/lxc`);
    if (result.success && result.data) {
      return {
        success: true,
        data: result.data.map(vm => ({ ...vm, type: 'lxc' as const, node }))
      };
    }
    return result as ProxmoxApiResult<ProxmoxVMInfo[]>;
  }

  async getVMConfig(node: string, vmid: number, vmType: 'qemu' | 'lxc'): Promise<ProxmoxApiResult<ProxmoxVMConfig>> {
    return this.makeRequest<ProxmoxVMConfig>('GET', `/nodes/${node}/${vmType}/${vmid}/config`);
  }

  async getVMAgentNetworkInterfaces(node: string, vmid: number): Promise<ProxmoxApiResult<any[]>> {
    return this.makeRequest<any[]>('GET', `/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`);
  }

  async getAllVMs(): Promise<ProxmoxVMInfo[]> {
    const authenticated = await this.authenticate();
    if (!authenticated) {
      console.log(`[Proxmox API] ${this.credentials.host}: Authentication failed`);
      return [];
    }

    const nodesResult = await this.getNodes();
    if (!nodesResult.success || !nodesResult.data) {
      console.log(`[Proxmox API] ${this.credentials.host}: getNodes failed: ${nodesResult.error || 'no data'}`);
      return [];
    }
    
    console.log(`[Proxmox API] ${this.credentials.host}: Found ${nodesResult.data.length} nodes: ${nodesResult.data.map(n => n.node).join(', ')}`);

    const allVMs: ProxmoxVMInfo[] = [];

    for (const node of nodesResult.data) {
      const [qemuResult, lxcResult] = await Promise.all([
        this.getNodeQemuVMs(node.node),
        this.getNodeLxcContainers(node.node)
      ]);

      console.log(`[Proxmox API] ${this.credentials.host}: Node ${node.node} - QEMU: ${qemuResult.success ? (qemuResult.data?.length || 0) : 'failed'}, LXC: ${lxcResult.success ? (lxcResult.data?.length || 0) : 'failed'}`);
      if (!qemuResult.success) console.log(`[Proxmox API] QEMU error: ${qemuResult.error}`);
      if (!lxcResult.success) console.log(`[Proxmox API] LXC error: ${lxcResult.error}`);

      if (qemuResult.success && qemuResult.data) {
        allVMs.push(...qemuResult.data.filter(vm => !vm.template));
      }
      if (lxcResult.success && lxcResult.data) {
        allVMs.push(...lxcResult.data.filter(vm => !vm.template));
      }
    }

    return allVMs;
  }

  async getVMNetworkInfo(node: string, vmid: number, vmType: 'qemu' | 'lxc'): Promise<{
    ipAddresses: string[];
    macAddresses: string[];
  }> {
    const ipAddresses: string[] = [];
    const macAddresses: string[] = [];

    const configResult = await this.getVMConfig(node, vmid, vmType);
    if (configResult.success && configResult.data) {
      const config = configResult.data as Record<string, any>;
      
      for (const key of Object.keys(config)) {
        if (key.startsWith('net') || key.startsWith('ipconfig')) {
          const value = config[key];
          if (typeof value === 'string') {
            const macMatch = value.match(/([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/);
            if (macMatch) {
              macAddresses.push(macMatch[0].toLowerCase());
            }
            
            const ipMatch = value.match(/ip=([^/,\s]+)/);
            if (ipMatch) {
              ipAddresses.push(ipMatch[1]);
            }
          }
        }
      }
    }

    if (vmType === 'qemu') {
      try {
        const agentResult = await this.getVMAgentNetworkInterfaces(node, vmid);
        if (agentResult.success && agentResult.data) {
          for (const iface of agentResult.data) {
            if (iface['hardware-address'] && !iface['hardware-address'].startsWith('00:00:00')) {
              const mac = iface['hardware-address'].toLowerCase();
              if (!macAddresses.includes(mac)) {
                macAddresses.push(mac);
              }
            }
            if (iface['ip-addresses']) {
              for (const addr of iface['ip-addresses']) {
                if (addr['ip-address'] && addr['ip-address-type'] === 'ipv4' && !addr['ip-address'].startsWith('127.')) {
                  if (!ipAddresses.includes(addr['ip-address'])) {
                    ipAddresses.push(addr['ip-address']);
                  }
                }
              }
            }
          }
        }
      } catch (e) {
      }
    }

    return { ipAddresses, macAddresses };
  }

  async getHostInfo(): Promise<{
    version?: string;
    nodes: ProxmoxNode[];
    clusterName?: string;
    totalVMs: number;
    runningVMs: number;
  } | null> {
    const authenticated = await this.authenticate();
    if (!authenticated) {
      return null;
    }

    const [versionResult, nodesResult, clusterResult] = await Promise.all([
      this.getVersion(),
      this.getNodes(),
      this.getClusterStatus()
    ]);

    let clusterName: string | undefined;
    if (clusterResult.success && clusterResult.data) {
      const clusterInfo = clusterResult.data.find((item: any) => item.type === 'cluster');
      clusterName = clusterInfo?.name;
    }

    const allVMs = await this.getAllVMs();
    const runningVMs = allVMs.filter(vm => vm.status === 'running').length;

    return {
      version: versionResult.success ? versionResult.data?.version : undefined,
      nodes: nodesResult.success ? nodesResult.data || [] : [],
      clusterName,
      totalVMs: allVMs.length,
      runningVMs
    };
  }
}

export async function detectProxmox(host: string, port: number = 8006, timeout: number = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const options: https.RequestOptions = {
      hostname: host,
      port: port,
      path: '/api2/json/version',
      method: 'GET',
      rejectUnauthorized: false,
      timeout: timeout,
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed.data && parsed.data.version && parsed.data.release);
        } catch {
          resolve(false);
        }
      });
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

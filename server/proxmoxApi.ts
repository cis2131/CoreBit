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

  async getClusterResources(type?: 'vm' | 'node' | 'storage'): Promise<ProxmoxApiResult<any[]>> {
    const path = type ? `/cluster/resources?type=${type}` : '/cluster/resources';
    return this.makeRequest<any[]>('GET', path);
  }

  async getAllVMs(filterByNode?: string): Promise<ProxmoxVMInfo[]> {
    const authenticated = await this.authenticate();
    if (!authenticated) {
      console.log(`[Proxmox API] ${this.credentials.host}: Authentication failed`);
      return [];
    }

    // Use cluster/resources endpoint for efficient single-call VM discovery
    const resourcesResult = await this.getClusterResources('vm');
    if (!resourcesResult.success || !resourcesResult.data) {
      console.log(`[Proxmox API] ${this.credentials.host}: cluster/resources failed: ${resourcesResult.error || 'no data'}`);
      return [];
    }

    let allVMs: ProxmoxVMInfo[] = resourcesResult.data
      .filter((vm: any) => !vm.template && (vm.type === 'qemu' || vm.type === 'lxc'))
      .map((vm: any) => ({
        vmid: vm.vmid,
        name: vm.name || `VM ${vm.vmid}`,
        status: vm.status,
        type: vm.type as 'qemu' | 'lxc',
        node: vm.node,
        cpu: vm.cpu || 0,
        cpus: vm.maxcpu || 1,
        mem: vm.mem || 0,
        maxmem: vm.maxmem || 0,
        disk: vm.disk || 0,
        maxdisk: vm.maxdisk || 0,
        uptime: vm.uptime || 0,
        netin: vm.netin,
        netout: vm.netout,
        template: vm.template === 1,
      }));

    // Filter by node if specified (only show VMs running on this specific node)
    if (filterByNode) {
      const beforeCount = allVMs.length;
      allVMs = allVMs.filter(vm => vm.node === filterByNode);
      console.log(`[Proxmox API] ${this.credentials.host}: Filtered ${beforeCount} -> ${allVMs.length} VMs for node '${filterByNode}'`);
    } else {
      console.log(`[Proxmox API] ${this.credentials.host}: Found ${allVMs.length} VMs via cluster/resources (no node filter)`);
    }
    
    // Fetch IP addresses for running VMs via guest agent (in parallel, with concurrency limit)
    const runningVMs = allVMs.filter(vm => vm.status === 'running');
    if (runningVMs.length > 0) {
      console.log(`[Proxmox API] ${this.credentials.host}: Fetching IPs for ${runningVMs.length} running VMs...`);
      const CONCURRENCY = 5; // Limit concurrent API calls
      const chunks: ProxmoxVMInfo[][] = [];
      for (let i = 0; i < runningVMs.length; i += CONCURRENCY) {
        chunks.push(runningVMs.slice(i, i + CONCURRENCY));
      }
      
      let vmsWithIps = 0;
      for (const chunk of chunks) {
        await Promise.all(chunk.map(async (vm) => {
          try {
            const networkInfo = await this.getVMNetworkInfo(vm.node, vm.vmid, vm.type);
            if (networkInfo.ipAddresses.length > 0) {
              vm.ipAddresses = networkInfo.ipAddresses;
              vmsWithIps++;
            }
            if (networkInfo.macAddresses.length > 0) {
              vm.macAddresses = networkInfo.macAddresses;
            }
          } catch (e: any) {
            console.log(`[Proxmox API] Failed to get network info for VM ${vm.vmid}: ${e.message}`);
          }
        }));
      }
      console.log(`[Proxmox API] ${this.credentials.host}: Found IPs for ${vmsWithIps}/${runningVMs.length} running VMs`);
    }
    
    return allVMs;
  }

  // Identify which node we're connected to by matching the host IP to node network info
  async identifyCurrentNode(): Promise<string | null> {
    const nodesResult = await this.getNodes();
    if (!nodesResult.success || !nodesResult.data) {
      return null;
    }

    // If only one node, that's clearly the one we're connected to
    if (nodesResult.data.length === 1) {
      return nodesResult.data[0].node;
    }

    // For multi-node clusters, try to identify which node has our target IP
    // Check each node's network configuration
    for (const node of nodesResult.data) {
      const networkResult = await this.makeRequest<any[]>('GET', `/nodes/${node.node}/network`);
      if (networkResult.success && networkResult.data) {
        for (const iface of networkResult.data) {
          // Check if any interface has our connection IP
          if (iface.address === this.credentials.host || 
              iface.address6 === this.credentials.host) {
            console.log(`[Proxmox API] Identified current node as '${node.node}' via IP match on ${iface.iface}`);
            return node.node;
          }
        }
      }
    }

    // Fallback: check cluster status for node with matching IP
    const statusResult = await this.getClusterStatus();
    if (statusResult.success && statusResult.data) {
      for (const item of statusResult.data) {
        const statusItem = item as any;
        if (statusItem.type === 'node' && statusItem.ip === this.credentials.host) {
          console.log(`[Proxmox API] Identified current node as '${statusItem.name}' via cluster status IP`);
          return statusItem.name;
        }
      }
    }

    console.log(`[Proxmox API] Could not identify specific node for ${this.credentials.host}, returning null`);
    return null;
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
          // API returns { result: [...interfaces...] } so we need to access the result array
          const interfaces = Array.isArray(agentResult.data) 
            ? agentResult.data 
            : (agentResult.data as any).result || [];
          
          for (const iface of interfaces) {
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
        } else if (!agentResult.success) {
          // Debug: log agent failures (guest agent might not be running)
          console.log(`[Proxmox API] Guest agent query failed for VM ${vmid}: ${agentResult.error || 'no data'}`);
        }
      } catch (e: any) {
        console.log(`[Proxmox API] Guest agent exception for VM ${vmid}: ${e.message}`);
      }
    } else if (vmType === 'lxc') {
      // For LXC containers, try to get network info from container interfaces endpoint
      try {
        const lxcIfaceResult = await this.makeRequest<any[]>('GET', `/nodes/${node}/lxc/${vmid}/interfaces`);
        if (lxcIfaceResult.success && lxcIfaceResult.data) {
          for (const iface of lxcIfaceResult.data) {
            if (iface.hwaddr && !iface.hwaddr.startsWith('00:00:00')) {
              const mac = iface.hwaddr.toLowerCase();
              if (!macAddresses.includes(mac)) {
                macAddresses.push(mac);
              }
            }
            // LXC interfaces use 'inet' for IPv4 addresses
            if (iface.inet && !iface.inet.startsWith('127.')) {
              const ip = iface.inet.split('/')[0]; // Remove CIDR notation
              if (!ipAddresses.includes(ip)) {
                ipAddresses.push(ip);
              }
            }
          }
        }
      } catch (e: any) {
        // LXC interface endpoint may not be available
      }
    }

    return { ipAddresses, macAddresses };
  }

  async getHostInfo(filterByCurrentNode: boolean = true): Promise<{
    version?: string;
    nodes: ProxmoxNode[];
    clusterName?: string;
    totalVMs: number;
    runningVMs: number;
    currentNode?: string;
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

    // Identify which node we're connected to for VM filtering
    let currentNode: string | undefined;
    if (filterByCurrentNode) {
      currentNode = await this.identifyCurrentNode() || undefined;
    }

    // Get VMs filtered by current node (if in a cluster and filtering is enabled)
    const allVMs = await this.getAllVMs(currentNode);
    const runningVMs = allVMs.filter(vm => vm.status === 'running').length;

    return {
      version: versionResult.success ? versionResult.data?.version : undefined,
      nodes: nodesResult.success ? nodesResult.data || [] : [],
      clusterName,
      totalVMs: allVMs.length,
      runningVMs,
      currentNode
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

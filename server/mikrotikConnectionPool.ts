import { RouterOSAPI } from 'node-routeros';

interface PooledConnection {
  conn: RouterOSAPI;
  ipAddress: string;
  port: number;
  username: string;
  password: string;
  lastUsed: number;
  lastError: number;
  errorCount: number;
  isConnected: boolean;
  isConnecting: boolean;
  connectionPromise: Promise<boolean> | null;
  inUse: boolean;
}

class MikrotikConnectionPool {
  private connections: Map<string, PooledConnection> = new Map();
  private enabled: boolean = false;
  private readonly maxIdleTime = 300000; // 5 minutes before cleanup
  private readonly maxErrorCount = 3;
  private readonly reconnectDelay = 5000;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupTimer();
  }

  private getConnectionKey(ipAddress: string, port: number, username: string): string {
    return `${ipAddress}:${port}:${username}`;
  }

  setEnabled(enabled: boolean) {
    const wasEnabled = this.enabled;
    this.enabled = enabled;
    
    if (wasEnabled && !enabled) {
      console.log('[MikrotikPool] Persistent connections disabled, closing all connections');
      this.closeAllConnections();
    } else if (!wasEnabled && enabled) {
      console.log('[MikrotikPool] Persistent connections enabled (closeOnDone:false, keepalive:true)');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private startCleanupTimer() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections();
    }, 60000);
  }

  private cleanupIdleConnections() {
    const now = Date.now();
    const toRemove: string[] = [];
    
    this.connections.forEach((pooled, key) => {
      if (now - pooled.lastUsed > this.maxIdleTime && !pooled.inUse) {
        console.log(`[MikrotikPool] Closing idle connection to ${pooled.ipAddress}`);
        this.closeConnection(pooled);
        toRemove.push(key);
      }
    });
    
    toRemove.forEach(key => this.connections.delete(key));
  }

  private setupConnectionHandlers(conn: RouterOSAPI, pooled: PooledConnection, key: string) {
    (conn as any).on('error', (err: any) => {
      const errMsg = err?.message || 'unknown';
      const isConnectionError = errMsg.includes('ECONNRESET') || 
                                errMsg.includes('ECONNREFUSED') || 
                                errMsg.includes('ETIMEDOUT') ||
                                errMsg.includes('socket') ||
                                errMsg.includes('closed') ||
                                errMsg.includes('EPIPE');
      
      if (isConnectionError) {
        pooled.isConnected = false;
        pooled.inUse = false;
        pooled.errorCount++;
        pooled.lastError = Date.now();
        console.warn(`[MikrotikPool] Connection lost for ${pooled.ipAddress}: ${errMsg}`);
      } else {
        console.log(`[MikrotikPool] Command error for ${pooled.ipAddress}: ${errMsg}`);
      }
    });
    
    (conn as any).on('close', () => {
      pooled.isConnected = false;
      pooled.inUse = false;
      console.log(`[MikrotikPool] Connection to ${pooled.ipAddress} closed`);
    });
  }

  private closeConnection(pooled: PooledConnection) {
    try {
      pooled.isConnected = false;
      pooled.conn.close();
    } catch (e) {
      // Ignore close errors
    }
  }

  async closeAllConnections() {
    console.log(`[MikrotikPool] Closing all ${this.connections.size} connections`);
    
    this.connections.forEach((pooled) => {
      this.closeConnection(pooled);
    });
    
    this.connections.clear();
  }

  async getConnection(
    ipAddress: string,
    credentials: { username?: string; password?: string; apiPort?: number },
    timeoutSeconds: number = 6
  ): Promise<{ conn: RouterOSAPI; isNewConnection: boolean; fromPool: boolean }> {
    const username = credentials?.username || 'admin';
    const password = credentials?.password || '';
    const port = credentials?.apiPort || 8728;
    const key = this.getConnectionKey(ipAddress, port, username);
    
    if (!this.enabled) {
      // Non-pooled connection - standard behavior
      const conn = new RouterOSAPI({
        host: ipAddress,
        user: username,
        password: password,
        port: port,
        timeout: timeoutSeconds,
      });
      
      (conn as any).on('error', () => {});
      
      await conn.connect();
      return { conn, isNewConnection: true, fromPool: false };
    }
    
    let pooled = this.connections.get(key);
    
    if (pooled) {
      // Wait for connection to be released if in use
      const maxWaitTime = 5000;
      const pollInterval = 50;
      const startWait = Date.now();
      
      while (pooled.inUse && (Date.now() - startWait) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
      
      if (pooled.inUse) {
        console.warn(`[MikrotikPool] Connection to ${ipAddress} stuck in use for ${maxWaitTime}ms, using temporary connection`);
        const conn = new RouterOSAPI({
          host: ipAddress,
          user: username,
          password: password,
          port: port,
          timeout: timeoutSeconds,
        });
        (conn as any).on('error', () => {});
        await conn.connect();
        return { conn, isNewConnection: true, fromPool: false };
      }
      
      pooled.lastUsed = Date.now();
      
      // Wait for ongoing connection attempt if any
      if (pooled.isConnecting && pooled.connectionPromise) {
        try {
          await pooled.connectionPromise;
        } catch (e) {
          // Connection attempt failed, will try to reconnect below
        }
      }
      
      // Check if connection is healthy with a quick test
      if (pooled.isConnected) {
        try {
          const testPromise = pooled.conn.write('/system/identity/print');
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), 3000)
          );
          await Promise.race([testPromise, timeoutPromise]);
          
          pooled.inUse = true;
          pooled.lastUsed = Date.now();
          return { conn: pooled.conn, isNewConnection: false, fromPool: true };
        } catch (e) {
          console.log(`[MikrotikPool] Connection to ${ipAddress} stale, reconnecting...`);
          pooled.isConnected = false;
          try {
            pooled.conn.close();
          } catch (closeErr) {}
        }
      }
      
      // Check if in error cooldown
      const now = Date.now();
      if (pooled.errorCount >= this.maxErrorCount && (now - pooled.lastError) < this.reconnectDelay) {
        throw new Error(`Connection to ${ipAddress} in cooldown after ${pooled.errorCount} errors`);
      }
    }
    
    // Create new persistent connection with keepalive enabled
    const conn = new RouterOSAPI({
      host: ipAddress,
      user: username,
      password: password,
      port: port,
      timeout: timeoutSeconds,
      keepalive: true,      // Enable built-in keepalive pings
      closeOnDone: false,   // Keep connection open after commands
    } as any);
    
    const newPooled: PooledConnection = {
      conn,
      ipAddress,
      port,
      username,
      password,
      lastUsed: Date.now(),
      lastError: 0,
      errorCount: 0,
      isConnected: false,
      isConnecting: true,
      connectionPromise: null,
      inUse: true,
    };
    
    this.setupConnectionHandlers(conn, newPooled, key);
    
    const connectPromise = (async () => {
      try {
        console.log(`[MikrotikPool] Connecting to ${ipAddress}:${port}...`);
        await conn.connect();
        newPooled.isConnected = true;
        newPooled.isConnecting = false;
        newPooled.errorCount = 0;
        
        console.log(`[MikrotikPool] Connected to ${ipAddress}:${port} (persistent, keepalive enabled)`);
        return true;
      } catch (e: any) {
        newPooled.isConnecting = false;
        newPooled.isConnected = false;
        newPooled.inUse = false;
        newPooled.errorCount++;
        newPooled.lastError = Date.now();
        console.error(`[MikrotikPool] Failed to connect to ${ipAddress}:${port}: ${e.message}`);
        throw e;
      }
    })();
    
    newPooled.connectionPromise = connectPromise;
    this.connections.set(key, newPooled);
    
    await connectPromise;
    return { conn, isNewConnection: true, fromPool: true };
  }

  releaseConnection(
    ipAddress: string,
    credentials: { username?: string; password?: string; apiPort?: number },
    conn: RouterOSAPI,
    fromPool: boolean
  ) {
    if (!fromPool || !this.enabled) {
      // Non-pooled connections should be closed
      try {
        conn.close();
      } catch (e) {
        // Ignore close errors
      }
      return;
    }
    
    // For pooled connections: mark as not in use but DO NOT close
    const username = credentials?.username || 'admin';
    const port = credentials?.apiPort || 8728;
    const key = this.getConnectionKey(ipAddress, port, username);
    const pooled = this.connections.get(key);
    
    if (pooled && pooled.conn === conn) {
      pooled.inUse = false;
      pooled.lastUsed = Date.now();
      // Connection stays open with keepalive maintaining it
    }
  }

  markConnectionFailed(
    ipAddress: string,
    credentials: { username?: string; password?: string; apiPort?: number }
  ) {
    const username = credentials?.username || 'admin';
    const port = credentials?.apiPort || 8728;
    const key = this.getConnectionKey(ipAddress, port, username);
    
    const pooled = this.connections.get(key);
    if (pooled) {
      pooled.isConnected = false;
      pooled.inUse = false;
      pooled.errorCount++;
      pooled.lastError = Date.now();
      
      if (pooled.errorCount >= this.maxErrorCount) {
        console.warn(`[MikrotikPool] Too many errors for ${ipAddress}, removing from pool`);
        this.closeConnection(pooled);
        this.connections.delete(key);
      }
    }
  }

  getStats(): { totalConnections: number; activeConnections: number; enabled: boolean } {
    let active = 0;
    this.connections.forEach((pooled) => {
      if (pooled.isConnected) active++;
    });
    
    return {
      totalConnections: this.connections.size,
      activeConnections: active,
      enabled: this.enabled,
    };
  }
}

export const mikrotikPool = new MikrotikConnectionPool();

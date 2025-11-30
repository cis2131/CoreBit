import { RouterOSAPI } from 'node-routeros';

// Waiter for connection availability
interface ConnectionWaiter {
  resolve: () => void;
  reject: (err: Error) => void;
  abortSignal?: AbortSignal;
}

interface PooledConnection {
  conn: RouterOSAPI;
  ipAddress: string;
  port: number;
  username: string;
  lastUsed: number;
  lastError: number;
  errorCount: number;
  isConnected: boolean;
  isConnecting: boolean;
  connectionPromise: Promise<boolean> | null;
  inUse: boolean;  // Track if connection is currently being used for a probe
  waiters: ConnectionWaiter[];  // Queue of waiters for this connection
}

class MikrotikConnectionPool {
  private connections: Map<string, PooledConnection> = new Map();
  private enabled: boolean = false;
  private readonly maxIdleTime = 120000;
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
      console.log('[MikrotikPool] Persistent connections enabled');
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
    }, 30000);
  }

  private cleanupIdleConnections() {
    const now = Date.now();
    const toRemove: string[] = [];
    
    this.connections.forEach((pooled, key) => {
      if (now - pooled.lastUsed > this.maxIdleTime) {
        console.log(`[MikrotikPool] Closing idle connection to ${pooled.ipAddress}`);
        this.closeConnection(pooled);
        toRemove.push(key);
      }
    });
    
    toRemove.forEach(key => this.connections.delete(key));
  }

  private closeConnection(pooled: PooledConnection) {
    try {
      pooled.isConnected = false;
      pooled.conn.close();
    } catch (e) {
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
    timeoutSeconds: number = 6,
    abortSignal?: AbortSignal
  ): Promise<{ conn: RouterOSAPI; isNewConnection: boolean; fromPool: boolean }> {
    const username = credentials?.username || 'admin';
    const password = credentials?.password || '';
    const port = credentials?.apiPort || 8728;
    const key = this.getConnectionKey(ipAddress, port, username);
    
    // Check if already aborted
    if (abortSignal?.aborted) {
      throw new Error('Connection aborted');
    }
    
    if (!this.enabled) {
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
      pooled.lastUsed = Date.now();
      
      // If connection is currently in use by another probe, wait for it to be released
      // Uses promise-based waiting instead of polling for efficiency
      if (pooled.inUse) {
        const waitStartTime = Date.now();
        
        // Create a promise that resolves when connection becomes available
        await new Promise<void>((resolve, reject) => {
          const waiter: ConnectionWaiter = { resolve, reject, abortSignal };
          pooled!.waiters.push(waiter);
          
          // Set up abort handling
          if (abortSignal) {
            const onAbort = () => {
              // Remove this waiter from the queue
              const idx = pooled!.waiters.indexOf(waiter);
              if (idx >= 0) {
                pooled!.waiters.splice(idx, 1);
              }
              reject(new Error('Connection wait aborted'));
            };
            
            if (abortSignal.aborted) {
              onAbort();
            } else {
              abortSignal.addEventListener('abort', onAbort, { once: true });
            }
          }
          
          // Also set a maximum wait time as fallback (10 seconds)
          setTimeout(() => {
            const idx = pooled!.waiters.indexOf(waiter);
            if (idx >= 0) {
              pooled!.waiters.splice(idx, 1);
              reject(new Error('Connection wait timeout'));
            }
          }, 10000);
        });
        
        const waitedMs = Date.now() - waitStartTime;
        
        // Connection became available - check if it's still healthy
        if (pooled.isConnected && !pooled.inUse) {
          console.log(`[MikrotikPool] Connection to ${ipAddress} became available after ${waitedMs}ms, reusing`);
          pooled.inUse = true;
          pooled.lastUsed = Date.now();
          return { conn: pooled.conn, isNewConnection: false, fromPool: true };
        } else {
          // Connection was released but is now disconnected, will reconnect below
          console.log(`[MikrotikPool] Connection to ${ipAddress} released but disconnected, reconnecting...`);
        }
      }
      
      if (pooled.isConnecting && pooled.connectionPromise) {
        const success = await pooled.connectionPromise;
        if (success && pooled.isConnected && !pooled.inUse) {
          pooled.inUse = true;
          return { conn: pooled.conn, isNewConnection: false, fromPool: true };
        }
      }
      
      if (pooled.isConnected && !pooled.inUse) {
        // Skip health check if connection was used recently (within 60 seconds)
        // This reduces overhead and avoids unnecessary reconnects
        const recentlyUsed = (Date.now() - pooled.lastUsed) < 60000;
        
        if (recentlyUsed) {
          // Trust recent connection, skip health check
          pooled.inUse = true;
          pooled.lastUsed = Date.now();
          return { conn: pooled.conn, isNewConnection: false, fromPool: true };
        }
        
        try {
          // Health check with timeout for idle connections
          const healthCheckPromise = pooled.conn.write('/system/identity/print');
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), 3000)
          );
          await Promise.race([healthCheckPromise, timeoutPromise]);
          pooled.inUse = true;
          pooled.lastUsed = Date.now();
          return { conn: pooled.conn, isNewConnection: false, fromPool: true };
        } catch (e) {
          console.log(`[MikrotikPool] Connection to ${ipAddress} stale, reconnecting...`);
          pooled.isConnected = false;
          pooled.inUse = false;
          // Close the stale connection
          try {
            pooled.conn.close();
          } catch (closeErr) {}
        }
      }
      
      const now = Date.now();
      if (pooled.errorCount >= this.maxErrorCount && (now - pooled.lastError) < this.reconnectDelay) {
        throw new Error(`Connection to ${ipAddress} in cooldown after ${pooled.errorCount} errors`);
      }
    }
    
    const conn = new RouterOSAPI({
      host: ipAddress,
      user: username,
      password: password,
      port: port,
      timeout: timeoutSeconds,
    });
    
    (conn as any).on('error', (err: any) => {
      const p = this.connections.get(key);
      if (p && p.conn === conn) {
        const errMsg = err?.message || 'unknown';
        // Only mark connection as disconnected for real connection errors, not command timeouts
        // Timeout errors are expected during probing and don't mean the connection is broken
        const isConnectionError = errMsg.includes('ECONNRESET') || 
                                  errMsg.includes('ECONNREFUSED') || 
                                  errMsg.includes('ETIMEDOUT') ||
                                  errMsg.includes('socket') ||
                                  errMsg.includes('closed');
        
        if (isConnectionError) {
          p.isConnected = false;
          p.errorCount++;
          p.lastError = Date.now();
          console.warn(`[MikrotikPool] Connection lost for ${ipAddress}: ${errMsg}`);
        } else {
          // Command timeout or other non-fatal error - log but don't disconnect
          console.log(`[MikrotikPool] Command error for ${ipAddress}: ${errMsg}`);
        }
      }
    });
    
    (conn as any).on('close', () => {
      const p = this.connections.get(key);
      if (p && p.conn === conn) {
        p.isConnected = false;
        console.log(`[MikrotikPool] Connection to ${ipAddress} closed`);
      }
    });
    
    const newPooled: PooledConnection = {
      conn,
      ipAddress,
      port,
      username,
      lastUsed: Date.now(),
      lastError: 0,
      errorCount: 0,
      isConnected: false,
      isConnecting: true,
      connectionPromise: null,
      inUse: true,  // Mark as in use immediately since we're about to return it
      waiters: [],  // Initialize empty waiter queue
    };
    
    const connectPromise = (async () => {
      try {
        console.log(`[MikrotikPool] Connecting to ${ipAddress}:${port}...`);
        await conn.connect();
        newPooled.isConnected = true;
        newPooled.isConnecting = false;
        newPooled.errorCount = 0;
        console.log(`[MikrotikPool] Connected to ${ipAddress}:${port} (persistent)`);
        return true;
      } catch (e: any) {
        newPooled.isConnecting = false;
        newPooled.isConnected = false;
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
      try {
        conn.close();
      } catch (e) {
      }
      return;
    }
    
    // Mark the pooled connection as no longer in use
    const username = credentials?.username || 'admin';
    const port = credentials?.apiPort || 8728;
    const key = this.getConnectionKey(ipAddress, port, username);
    const pooled = this.connections.get(key);
    
    if (pooled && pooled.conn === conn) {
      pooled.inUse = false;
      pooled.lastUsed = Date.now();
      
      // Notify the next waiter that the connection is available
      if (pooled.waiters.length > 0) {
        const waiter = pooled.waiters.shift()!;
        waiter.resolve();
      }
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
      pooled.inUse = false;  // Clear the in-use flag on failure
      pooled.errorCount++;
      pooled.lastError = Date.now();
      
      // Notify the next waiter that the connection is available (even though it's disconnected)
      // They will handle reconnection if needed
      if (pooled.waiters.length > 0) {
        const waiter = pooled.waiters.shift()!;
        waiter.resolve();
      }
      
      if (pooled.errorCount >= this.maxErrorCount) {
        console.warn(`[MikrotikPool] Too many errors for ${ipAddress}, removing from pool`);
        // Reject all remaining waiters
        while (pooled.waiters.length > 0) {
          const waiter = pooled.waiters.shift()!;
          waiter.reject(new Error('Connection removed from pool due to errors'));
        }
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

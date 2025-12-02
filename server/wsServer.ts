import { WebSocketServer, WebSocket } from 'ws';
import { Server, IncomingMessage } from 'http';
import { Socket } from 'net';

interface MapChangeEvent {
  type: 'map:change';
  mapId: string;
  changeType: 'placement' | 'connection' | 'map';
  action: 'create' | 'update' | 'delete';
  timestamp: number;
  userId?: string;
}

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

class MapSyncServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, { subscribedMaps: Set<string>; userId?: string }> = new Map();

  initialize(server: Server) {
    // Use noServer mode to avoid conflicting with Vite's WebSocket upgrade handler
    this.wss = new WebSocketServer({ noServer: true });

    // Handle WebSocket upgrade requests only for our /ws path
    server.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
      const pathname = request.url;
      
      // Only handle our /ws path - let Vite handle other WebSocket paths
      if (pathname === '/ws') {
        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit('connection', ws, request);
        });
      }
      // Don't close socket for other paths - Vite will handle them
    });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[WebSocket] Client connected');
      this.clients.set(ws, { subscribedMaps: new Set() });

      ws.on('message', (data: Buffer) => {
        try {
          const message: WebSocketMessage = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('[WebSocket] Error parsing message:', error);
        }
      });

      ws.on('close', () => {
        console.log('[WebSocket] Client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('[WebSocket] Client error:', error);
        this.clients.delete(ws);
      });

      // Send welcome message
      ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
    });

    console.log('[WebSocket] Server initialized on /ws');
  }

  private handleMessage(ws: WebSocket, message: WebSocketMessage) {
    const client = this.clients.get(ws);
    if (!client) return;

    switch (message.type) {
      case 'subscribe':
        // Subscribe to map changes
        if (message.mapId) {
          client.subscribedMaps.add(message.mapId);
          console.log(`[WebSocket] Client subscribed to map: ${message.mapId}`);
        }
        break;

      case 'unsubscribe':
        // Unsubscribe from map changes
        if (message.mapId) {
          client.subscribedMaps.delete(message.mapId);
          console.log(`[WebSocket] Client unsubscribed from map: ${message.mapId}`);
        }
        break;

      case 'identify':
        // Set user ID for this connection
        if (message.userId) {
          client.userId = message.userId;
        }
        break;

      default:
        console.log('[WebSocket] Unknown message type:', message.type);
    }
  }

  // Broadcast a map change event to all clients subscribed to that map
  broadcastMapChange(
    mapId: string,
    changeType: 'placement' | 'connection' | 'map',
    action: 'create' | 'update' | 'delete',
    userId?: string
  ) {
    if (!this.wss) return;

    const event: MapChangeEvent = {
      type: 'map:change',
      mapId,
      changeType,
      action,
      timestamp: Date.now(),
      userId,
    };

    const message = JSON.stringify(event);
    let notifiedCount = 0;

    this.clients.forEach((client, ws) => {
      // Only notify clients subscribed to this map
      // Skip the client that made the change (if userId matches)
      if (client.subscribedMaps.has(mapId)) {
        // Skip notifying the user who made the change
        if (userId && client.userId === userId) {
          return;
        }
        
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
          notifiedCount++;
        }
      }
    });

    if (notifiedCount > 0) {
      console.log(`[WebSocket] Broadcast ${changeType}:${action} on map ${mapId} to ${notifiedCount} client(s)`);
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

export const mapSyncServer = new MapSyncServer();

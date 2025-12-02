import { useEffect, useRef, useState, useCallback } from 'react';

interface MapChangeEvent {
  type: 'map:change';
  mapId: string;
  changeType: 'placement' | 'connection' | 'map';
  action: 'create' | 'update' | 'delete';
  timestamp: number;
  userId?: string;
}

interface UseMapSyncOptions {
  mapId: string | null;
  userId?: string;
  onRemoteChange?: (event: MapChangeEvent) => void;
}

export function useMapSync({ mapId, userId, onRemoteChange }: UseMapSyncOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [hasRemoteChanges, setHasRemoteChanges] = useState(false);
  const [lastChangeEvent, setLastChangeEvent] = useState<MapChangeEvent | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const currentMapIdRef = useRef<string | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[MapSync] Connected to WebSocket');
        setIsConnected(true);

        // Identify this client
        if (userId) {
          ws.send(JSON.stringify({ type: 'identify', userId }));
        }

        // Subscribe to current map if we have one
        if (currentMapIdRef.current) {
          ws.send(JSON.stringify({ type: 'subscribe', mapId: currentMapIdRef.current }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'map:change') {
            const changeEvent = data as MapChangeEvent;
            console.log('[MapSync] Received map change:', changeEvent);
            
            setHasRemoteChanges(true);
            setLastChangeEvent(changeEvent);
            
            if (onRemoteChange) {
              onRemoteChange(changeEvent);
            }
          }
        } catch (error) {
          console.error('[MapSync] Error parsing message:', error);
        }
      };

      ws.onclose = () => {
        console.log('[MapSync] Disconnected from WebSocket');
        setIsConnected(false);
        wsRef.current = null;

        // Attempt to reconnect after a delay
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };

      ws.onerror = (error) => {
        console.error('[MapSync] WebSocket error:', error);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('[MapSync] Failed to connect:', error);
    }
  }, [userId, onRemoteChange]);

  // Initial connection
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  // Subscribe/unsubscribe when map changes
  useEffect(() => {
    const ws = wsRef.current;
    
    // Unsubscribe from previous map
    if (currentMapIdRef.current && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'unsubscribe', mapId: currentMapIdRef.current }));
    }

    // Subscribe to new map
    if (mapId && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', mapId }));
    }

    currentMapIdRef.current = mapId;
    
    // Clear remote changes indicator when switching maps
    setHasRemoteChanges(false);
    setLastChangeEvent(null);
  }, [mapId]);

  // Update userId when it changes
  useEffect(() => {
    const ws = wsRef.current;
    if (userId && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'identify', userId }));
    }
  }, [userId]);

  const clearRemoteChanges = useCallback(() => {
    setHasRemoteChanges(false);
    setLastChangeEvent(null);
  }, []);

  return {
    isConnected,
    hasRemoteChanges,
    lastChangeEvent,
    clearRemoteChanges,
  };
}

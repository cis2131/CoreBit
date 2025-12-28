import { useRef, useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Device, Connection, ProxmoxVm } from '@shared/schema';
import { DeviceNode } from './DeviceNode';
import { ProxmoxHostNode } from './ProxmoxHostNode';
import { ProxmoxVMModal } from './ProxmoxVMModal';
import { ConnectionLine } from './ConnectionLine';
import { Plus, Minus, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Type for packet loss status: deviceId -> { interfaceName -> hasPacketLoss }
type PacketLossStatus = Record<string, Record<string, boolean>>;

interface MapHealthSummary {
  mapId: string;
  hasOffline: boolean;
}

interface NetworkCanvasProps {
  mapId: string;
  devices: (Device & { placementId: string; position: { x: number; y: number }; placementLinkedMapId?: string | null })[];
  connections: Connection[];
  selectedDeviceId: string | null;
  selectedConnectionId: string | null;
  onDeviceClick: (deviceId: string) => void;
  onDeviceMove: (deviceId: string, position: { x: number; y: number }) => void;
  onConnectionClick: (connectionId: string) => void;
  onCanvasClick: () => void;
  searchQuery: string;
  draggingDeviceId: string | null;
  onDeviceDropFromSidebar?: (deviceId: string, position: { x: number; y: number }) => void;
  onDraggingComplete: () => void;
  focusDeviceId?: string | null;
  onFocusComplete?: () => void;
  onMapLinkClick?: (mapId: string) => void;
  mapHealthSummary?: MapHealthSummary[];
  deviceNotificationMap?: Record<string, boolean>; // deviceId -> hasGlobalNotifications
}

export function NetworkCanvas({
  mapId,
  devices,
  connections,
  selectedDeviceId,
  selectedConnectionId,
  onDeviceClick,
  onDeviceMove,
  onConnectionClick,
  onCanvasClick,
  searchQuery,
  draggingDeviceId,
  onDeviceDropFromSidebar,
  onDraggingComplete,
  focusDeviceId,
  onFocusComplete,
  onMapLinkClick,
  mapHealthSummary = [],
  deviceNotificationMap = {},
}: NetworkCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [draggedDevice, setDraggedDevice] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [tempPosition, setTempPosition] = useState<{ x: number; y: number } | null>(null);
  const pendingPositionRef = useRef<{ x: number; y: number } | null>(null);
  
  // Fetch packet loss status for connection visualization
  const { data: packetLossStatus = {} } = useQuery<PacketLossStatus>({
    queryKey: ['/api/ping-targets/packet-loss-status'],
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 10000,
  });
  
  // Helper to check if a connection has packet loss on either endpoint
  const connectionHasPacketLoss = useCallback((conn: Connection): boolean => {
    // Check source device/port
    if (conn.sourcePort && conn.sourcePort !== 'none') {
      const deviceStatus = packetLossStatus[conn.sourceDeviceId];
      if (deviceStatus) {
        // Check by port name (interface name)
        if (deviceStatus[conn.sourcePort]) return true;
      }
    }
    
    // Check target device/port
    if (conn.targetPort && conn.targetPort !== 'none') {
      const deviceStatus = packetLossStatus[conn.targetDeviceId];
      if (deviceStatus) {
        // Check by port name (interface name)
        if (deviceStatus[conn.targetPort]) return true;
      }
    }
    
    return false;
  }, [packetLossStatus]);
  const [deviceWasDragged, setDeviceWasDragged] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [vmModalDevice, setVmModalDevice] = useState<Device | null>(null);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    // Calculate zoom delta - smaller multiplier for smoother, more controlled zoom
    const delta = e.deltaY > 0 ? 0.95 : 1.05;
    
    // Get mouse position relative to canvas
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Use functional setState to avoid dependency on zoom/pan state
    setZoom(prevZoom => {
      const newZoom = Math.max(0.1, Math.min(2, prevZoom * delta));
      
      // Update pan in the same render cycle
      setPan(prevPan => {
        // Calculate the canvas point under the mouse before zoom
        const canvasPointX = (mouseX - prevPan.x) / prevZoom;
        const canvasPointY = (mouseY - prevPan.y) / prevZoom;
        
        // Calculate new pan to keep the same canvas point under the mouse
        const newPanX = mouseX - canvasPointX * newZoom;
        const newPanY = mouseY - canvasPointY * newZoom;
        
        return { x: newPanX, y: newPanY };
      });
      
      return newZoom;
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener('wheel', handleWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel]);

  // Center on focused device when focusDeviceId changes
  useEffect(() => {
    if (!focusDeviceId) return;
    
    const device = devices.find(d => d.id === focusDeviceId);
    if (!device) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    // Calculate pan to center the device in the viewport
    // Device position is its center (due to translate(-50%, -50%) in DeviceNode)
    const viewportCenterX = rect.width / 2;
    const viewportCenterY = rect.height / 2;
    
    // Pan formula: to put device at screen position S, we need pan = S - pos * zoom
    // To center device: pan = viewportCenter - devicePos * zoom
    const newPanX = viewportCenterX - device.position.x * zoom;
    const newPanY = viewportCenterY - device.position.y * zoom;
    
    setPan({ x: newPanX, y: newPanY });
    
    // Mark as initialized to prevent auto-fit from overriding our pan
    setIsInitialized(true);
    
    // Notify parent that focus is complete
    onFocusComplete?.();
  }, [focusDeviceId, devices, zoom, onFocusComplete]);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Allow panning with left button on canvas background or middle button anywhere
    if (e.button === 0 && (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('canvas-grid'))) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.preventDefault();
    } else if (e.button === 1) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  
  const handleDeviceDragStart = (deviceId: string, e: React.MouseEvent) => {
    const device = devices.find(d => d.id === deviceId);
    if (!device) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    setDraggedDevice(deviceId);
    setDeviceWasDragged(false);
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    setDragOffset({
      x: e.clientX - (device.position.x * zoom + pan.x + rect.left),
      y: e.clientY - (device.position.y * zoom + pan.y + rect.top),
    });
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    handleMouseMove(e);
    
    if (draggedDevice) {
      // Only mark as dragged if moved more than 5 pixels (prevents accidental drag on click)
      if (dragStartPosRef.current) {
        const dx = Math.abs(e.clientX - dragStartPosRef.current.x);
        const dy = Math.abs(e.clientY - dragStartPosRef.current.y);
        if (dx > 5 || dy > 5) {
          setDeviceWasDragged(true);
        }
      }
      
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      let newX = (e.clientX - rect.left - pan.x - dragOffset.x) / zoom;
      let newY = (e.clientY - rect.top - pan.y - dragOffset.y) / zoom;

      // Snap to grid by default, hold Shift for free placement
      if (!e.shiftKey) {
        newX = snapToGrid(newX);
        newY = snapToGrid(newY);
      }

      const newPosition = { x: newX, y: newY };
      pendingPositionRef.current = newPosition;

      // Use requestAnimationFrame for smooth updates
      if (animationFrameRef.current === null) {
        animationFrameRef.current = requestAnimationFrame(() => {
          if (pendingPositionRef.current) {
            setTempPosition(pendingPositionRef.current);
          }
          animationFrameRef.current = null;
        });
      }
    }
  };

  const handleCanvasMouseUp = (e: React.MouseEvent) => {
    handleMouseUp();
    
    // Cancel any pending animation frame
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    if (draggedDevice && (tempPosition || pendingPositionRef.current)) {
      const finalPosition = pendingPositionRef.current || tempPosition;
      if (finalPosition) {
        onDeviceMove(draggedDevice, finalPosition);
      }
      setDraggedDevice(null);
      setTempPosition(null);
      pendingPositionRef.current = null;
      dragStartPosRef.current = null;
    } else if (draggedDevice) {
      setDraggedDevice(null);
      dragStartPosRef.current = null;
    }

    if (draggingDeviceId && onDeviceDropFromSidebar) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      let x = (e.clientX - rect.left - pan.x) / zoom;
      let y = (e.clientY - rect.top - pan.y) / zoom;

      // Snap to grid by default, hold Shift for free placement
      if (!e.shiftKey) {
        x = snapToGrid(x);
        y = snapToGrid(y);
      }

      onDeviceDropFromSidebar(draggingDeviceId, { x, y });
      onDraggingComplete();
    }
  };

  const handleCanvasClickLocal = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('canvas-grid')) {
      onCanvasClick();
    }
  };

  // HTML5 Drag and Drop handlers for sidebar device drops
  const handleDragOver = (e: React.DragEvent) => {
    if (draggingDeviceId) {
      e.preventDefault(); // Allow drop
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    
    if (draggingDeviceId && onDeviceDropFromSidebar) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      let x = (e.clientX - rect.left - pan.x) / zoom;
      let y = (e.clientY - rect.top - pan.y) / zoom;

      // Snap to grid by default, hold Shift for free placement
      if (!e.shiftKey) {
        x = snapToGrid(x);
        y = snapToGrid(y);
      }

      onDeviceDropFromSidebar(draggingDeviceId, { x, y });
      onDraggingComplete();
    }
  };

  const snapToGrid = (value: number, gridSize: number = 20): number => {
    return Math.round(value / gridSize) * gridSize;
  };

  const matchesSearch = (device: Device) => {
    if (!searchQuery) return false;
    const query = searchQuery.toLowerCase();
    return (
      device.name.toLowerCase().includes(query) ||
      device.ipAddress?.toLowerCase().includes(query) ||
      device.type.toLowerCase().includes(query)
    );
  };

  const zoomToPoint = useCallback((targetX: number, targetY: number, zoomFactor: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    setZoom(prevZoom => {
      const newZoom = Math.max(0.1, Math.min(2, prevZoom * zoomFactor));
      
      setPan(prevPan => {
        // Calculate the canvas point at the target screen position before zoom
        const canvasPointX = (targetX - prevPan.x) / prevZoom;
        const canvasPointY = (targetY - prevPan.y) / prevZoom;
        
        // Calculate new pan to keep the same canvas point at the target position
        const newPanX = targetX - canvasPointX * newZoom;
        const newPanY = targetY - canvasPointY * newZoom;
        
        return { x: newPanX, y: newPanY };
      });
      
      return newZoom;
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    zoomToPoint(centerX, centerY, 1.2);
  }, [zoomToPoint]);

  const handleZoomOut = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    zoomToPoint(centerX, centerY, 0.8);
  }, [zoomToPoint]);

  const fitToCanvas = useCallback(() => {
    if (devices.length === 0) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Device size is 80x80 (from DeviceNode)
    const deviceSize = 80;
    
    // Find bounding box of all devices
    const minX = Math.min(...devices.map(d => d.position.x));
    const maxX = Math.max(...devices.map(d => d.position.x + deviceSize));
    const minY = Math.min(...devices.map(d => d.position.y));
    const maxY = Math.max(...devices.map(d => d.position.y + deviceSize));
    
    // Dynamic padding: use 50px but ensure it doesn't exceed 20% of viewport dimensions
    const maxPadding = 50;
    const padding = Math.min(maxPadding, rect.width * 0.2, rect.height * 0.2);

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    // Guard against zero-size bounds (overlapping devices)
    const effectiveWidth = Math.max(contentWidth, deviceSize);
    const effectiveHeight = Math.max(contentHeight, deviceSize);

    // Calculate zoom to fit all devices with padding
    const zoomX = (rect.width - padding * 2) / effectiveWidth;
    const zoomY = (rect.height - padding * 2) / effectiveHeight;
    const newZoom = Math.max(0.1, Math.min(2, Math.min(zoomX, zoomY)));

    // Calculate pan to center the content with equal padding on all sides
    // Center of bounding box in device coordinates
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    // Center of viewport in screen coordinates
    const viewportCenterX = rect.width / 2;
    const viewportCenterY = rect.height / 2;
    
    // Calculate pan to align centers
    const newPanX = viewportCenterX - centerX * newZoom;
    const newPanY = viewportCenterY - centerY * newZoom;

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }, [devices]);

  // Restore zoom/pan from localStorage or fit to canvas on mount/map change
  useEffect(() => {
    const storageKey = `canvas-view-${mapId}`;
    const savedView = localStorage.getItem(storageKey);
    
    if (savedView) {
      try {
        const { zoom: savedZoom, pan: savedPan } = JSON.parse(savedView);
        setZoom(savedZoom);
        setPan(savedPan);
        setIsInitialized(true);
      } catch (e) {
        console.error('Failed to parse saved canvas view:', e);
        setIsInitialized(false);
      }
    } else {
      setIsInitialized(false);
    }
  }, [mapId]);

  // Auto-fit to canvas when devices load if no saved view state
  useEffect(() => {
    if (!isInitialized && devices.length > 0 && canvasRef.current) {
      // Small delay to ensure canvas is fully rendered
      const timeout = setTimeout(() => {
        fitToCanvas();
        setIsInitialized(true);
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [isInitialized, devices.length, fitToCanvas]);

  // Save zoom/pan to localStorage whenever they change
  useEffect(() => {
    if (isInitialized) {
      const storageKey = `canvas-view-${mapId}`;
      localStorage.setItem(storageKey, JSON.stringify({ zoom, pan }));
    }
  }, [zoom, pan, mapId, isInitialized]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-white dark:bg-gray-950">
      <div
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        style={{
          backgroundImage: `
            radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)
          `,
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onClick={handleCanvasClickLocal}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        data-testid="canvas-workspace"
      >
        <div
          className="canvas-grid relative"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            minWidth: '100%',
            minHeight: '100%',
          }}
        >
          <svg
            className="absolute inset-0 pointer-events-none"
            style={{ width: '100%', height: '100%', overflow: 'visible' }}
          >
            {connections.map(conn => {
              const source = devices.find(d => d.id === conn.sourceDeviceId);
              const target = devices.find(d => d.id === conn.targetDeviceId);
              if (!source || !target) return null;

              const sourcePosition = draggedDevice === source.id && tempPosition 
                ? tempPosition 
                : source.position;
              const targetPosition = draggedDevice === target.id && tempPosition 
                ? tempPosition 
                : target.position;

              // Calculate auto-offset for parallel connections between same device pair
              // Create a normalized key for the device pair (smaller ID first for consistency)
              const pairKey = [conn.sourceDeviceId, conn.targetDeviceId].sort().join('-');
              const parallelConnections = connections.filter(c => {
                const key = [c.sourceDeviceId, c.targetDeviceId].sort().join('-');
                return key === pairKey;
              });
              
              // Only apply auto-offset if there are multiple connections and mode is 'auto'
              let autoOffset = 0;
              if (parallelConnections.length > 1 && conn.curveMode === 'auto') {
                // Sort by ID for stable ordering
                const sortedParallel = [...parallelConnections].sort((a, b) => a.id.localeCompare(b.id));
                const index = sortedParallel.findIndex(c => c.id === conn.id);
                const baseOffset = 50; // Base spacing between parallel lines
                // Distribute connections symmetrically around center
                // e.g., 2 connections: -25, +25
                // e.g., 3 connections: -50, 0, +50
                const mid = (parallelConnections.length - 1) / 2;
                autoOffset = (index - mid) * baseOffset;
                
                // Apply direction correction: if this connection's source/target order differs
                // from the normalized pair order, flip the offset sign
                const normalizedFirst = [conn.sourceDeviceId, conn.targetDeviceId].sort()[0];
                if (conn.sourceDeviceId !== normalizedFirst) {
                  autoOffset = -autoOffset;
                }
              }

              return (
                <ConnectionLine
                  key={conn.id}
                  connection={conn}
                  sourcePosition={sourcePosition}
                  targetPosition={targetPosition}
                  isSelected={selectedConnectionId === conn.id}
                  onClick={() => onConnectionClick(conn.id)}
                  sourceDevice={source}
                  targetDevice={target}
                  autoOffset={autoOffset}
                  hasPacketLoss={connectionHasPacketLoss(conn)}
                />
              );
            })}
          </svg>

          {devices.map(device => {
            const isDragging = draggedDevice === device.id;
            const displayDevice = isDragging && tempPosition 
              ? { ...device, position: tempPosition }
              : device;
            
            // Use placement's linkedMapId (per-placement link) instead of device's global linkedMapId
            const placementLinkedMapId = device.placementLinkedMapId;
            
            // Check if the linked map has offline devices
            const linkedMapHealth = placementLinkedMapId 
              ? mapHealthSummary.find(m => m.mapId === placementLinkedMapId)
              : undefined;
            
            const commonProps = {
              device: displayDevice,
              isSelected: selectedDeviceId === device.id,
              isHighlighted: matchesSearch(device),
              isOffline: device.status === 'offline',
              linkedMapId: placementLinkedMapId,
              linkedMapHasOffline: linkedMapHealth?.hasOffline,
              hasGlobalNotifications: deviceNotificationMap[device.id] || false,
              isMuted: device.mutedUntil ? new Date(device.mutedUntil) > new Date() : false,
              onClick: () => {
                if (!deviceWasDragged) {
                  onDeviceClick(device.id);
                }
                setDeviceWasDragged(false);
              },
              onDragStart: (e: React.MouseEvent) => handleDeviceDragStart(device.id, e),
              onMapLinkClick,
            };
            
            // Use ProxmoxHostNode for Proxmox devices
            if (device.type === 'proxmox') {
              return (
                <ProxmoxHostNode
                  key={device.id}
                  {...commonProps}
                  onVmClick={() => setVmModalDevice(device)}
                />
              );
            }
            
            return (
              <DeviceNode
                key={device.id}
                {...commonProps}
              />
            );
          })}

          {devices.length === 0 && !draggingDeviceId && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center space-y-4 max-w-md p-8">
                <div className="text-muted-foreground">
                  <svg
                    className="mx-auto h-32 w-32 opacity-20"
                    viewBox="0 0 200 200"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <circle cx="50" cy="50" r="15" stroke="currentColor" strokeWidth="2" />
                    <circle cx="150" cy="50" r="15" stroke="currentColor" strokeWidth="2" />
                    <circle cx="100" cy="120" r="15" stroke="currentColor" strokeWidth="2" />
                    <line x1="65" y1="50" x2="135" y2="50" stroke="currentColor" strokeWidth="2" />
                    <line x1="60" y1="60" x2="95" y2="110" stroke="currentColor" strokeWidth="2" />
                    <line x1="140" y1="60" x2="105" y2="110" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-foreground">No Devices Yet</h3>
                <p className="text-sm text-muted-foreground">
                  Drag devices from the library to get started building your network topology
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="absolute bottom-4 right-4 flex flex-col gap-2" data-testid="zoom-controls">
        <Button
          size="icon"
          variant="secondary"
          onClick={handleZoomIn}
          data-testid="button-zoom-in"
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="secondary"
          onClick={handleZoomOut}
          data-testid="button-zoom-out"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="secondary"
          onClick={fitToCanvas}
          data-testid="button-zoom-reset"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="absolute bottom-4 left-4 space-y-2">
        <div className="px-3 py-2 bg-card border border-card-border rounded-md text-sm text-muted-foreground">
          Zoom: {Math.round(zoom * 100)}%
        </div>
        <div className="px-3 py-2 bg-card border border-card-border rounded-md text-xs text-muted-foreground">
          Hold <kbd className="px-1.5 py-0.5 bg-muted rounded text-foreground font-mono">Shift</kbd> for free placement
        </div>
      </div>

      <ProxmoxVMModal
        device={vmModalDevice}
        isOpen={!!vmModalDevice}
        onClose={() => setVmModalDevice(null)}
        onDeviceClick={onDeviceClick}
      />
    </div>
  );
}

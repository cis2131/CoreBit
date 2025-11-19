import { useRef, useState, useCallback, useEffect } from 'react';
import { Device, Connection } from '@shared/schema';
import { DeviceNode } from './DeviceNode';
import { ConnectionLine } from './ConnectionLine';
import { Plus, Minus, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface NetworkCanvasProps {
  devices: Device[];
  connections: Connection[];
  selectedDeviceId: string | null;
  selectedConnectionId: string | null;
  onDeviceClick: (deviceId: string) => void;
  onDeviceMove: (deviceId: string, position: { x: number; y: number }) => void;
  onConnectionClick: (connectionId: string) => void;
  onCanvasClick: () => void;
  searchQuery: string;
  onDeviceAdd?: (position: { x: number; y: number }, type: string) => void;
  draggingDeviceType: string | null;
  onDraggingComplete: () => void;
}

export function NetworkCanvas({
  devices,
  connections,
  selectedDeviceId,
  selectedConnectionId,
  onDeviceClick,
  onDeviceMove,
  onConnectionClick,
  onCanvasClick,
  searchQuery,
  onDeviceAdd,
  draggingDeviceType,
  onDraggingComplete,
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
  const [deviceWasDragged, setDeviceWasDragged] = useState(false);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.max(0.1, Math.min(2, prev * delta)));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener('wheel', handleWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel]);

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

  const handleDeviceDragStart = (deviceId: string, e: React.MouseEvent) => {
    const device = devices.find(d => d.id === deviceId);
    if (!device) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    setDraggedDevice(deviceId);
    setDeviceWasDragged(false);
    setDragOffset({
      x: e.clientX - (device.position.x * zoom + pan.x + rect.left),
      y: e.clientY - (device.position.y * zoom + pan.y + rect.top),
    });
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    handleMouseMove(e);
    
    if (draggedDevice) {
      setDeviceWasDragged(true);
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const newX = (e.clientX - rect.left - pan.x - dragOffset.x) / zoom;
      const newY = (e.clientY - rect.top - pan.y - dragOffset.y) / zoom;

      const newPosition = { x: Math.max(0, newX), y: Math.max(0, newY) };
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
    } else if (draggedDevice) {
      setDraggedDevice(null);
    }

    if (draggingDeviceType && onDeviceAdd) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = (e.clientX - rect.left - pan.x) / zoom;
      const y = (e.clientY - rect.top - pan.y) / zoom;

      onDeviceAdd({ x: Math.max(0, x), y: Math.max(0, y) }, draggingDeviceType);
      onDraggingComplete();
    }
  };

  const handleCanvasClickLocal = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('canvas-grid')) {
      onCanvasClick();
    }
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

              return (
                <ConnectionLine
                  key={conn.id}
                  connection={conn}
                  sourcePosition={sourcePosition}
                  targetPosition={targetPosition}
                  isSelected={selectedConnectionId === conn.id}
                  onClick={() => onConnectionClick(conn.id)}
                />
              );
            })}
          </svg>

          {devices.map(device => {
            const isDragging = draggedDevice === device.id;
            const displayDevice = isDragging && tempPosition 
              ? { ...device, position: tempPosition }
              : device;
            
            return (
              <DeviceNode
                key={device.id}
                device={displayDevice}
                isSelected={selectedDeviceId === device.id}
                isHighlighted={matchesSearch(device)}
                onClick={() => {
                  if (!deviceWasDragged) {
                    onDeviceClick(device.id);
                  }
                  setDeviceWasDragged(false);
                }}
                onDragStart={(e) => handleDeviceDragStart(device.id, e)}
              />
            );
          })}

          {devices.length === 0 && !draggingDeviceType && (
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
          onClick={() => setZoom(prev => Math.min(2, prev * 1.2))}
          data-testid="button-zoom-in"
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="secondary"
          onClick={() => setZoom(prev => Math.max(0.1, prev * 0.8))}
          data-testid="button-zoom-out"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="secondary"
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
          data-testid="button-zoom-reset"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="absolute bottom-4 left-4 px-3 py-2 bg-card border border-card-border rounded-md text-sm text-muted-foreground">
        Zoom: {Math.round(zoom * 100)}%
      </div>
    </div>
  );
}

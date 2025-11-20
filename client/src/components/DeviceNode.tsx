import { Device } from '@shared/schema';
import { Server, Router, Wifi, HardDrive, Activity, Cpu, MemoryStick } from 'lucide-react';

interface DeviceNodeProps {
  device: Device;
  isSelected: boolean;
  isHighlighted: boolean;
  onClick: () => void;
  onDragStart: (e: React.MouseEvent) => void;
}

const deviceIcons = {
  mikrotik_router: Router,
  mikrotik_switch: Server,
  generic_snmp: Server,
  server: HardDrive,
  access_point: Wifi,
};

const statusColors = {
  online: 'bg-green-500',
  warning: 'bg-yellow-500',
  offline: 'bg-red-500',
  unknown: 'bg-gray-400',
};

export function DeviceNode({ device, isSelected, isHighlighted, onClick, onDragStart }: DeviceNodeProps) {
  const Icon = deviceIcons[device.type as keyof typeof deviceIcons] || Activity;

  // Calculate port status counts
  const ports = device.deviceData?.ports || [];
  const onlinePorts = ports.filter(p => p.status === 'up').length;
  const offlinePorts = ports.filter(p => p.status === 'down').length;
  const unknownPorts = ports.filter(p => p.status !== 'up' && p.status !== 'down').length;

  // Extract model or use type as fallback
  const subtitle = device.deviceData?.model || device.type.replace(/_/g, ' ').toUpperCase();

  return (
    <div
      className={`absolute cursor-move select-none ${
        isHighlighted ? 'animate-pulse' : ''
      }`}
      style={{
        left: `${device.position.x}px`,
        top: `${device.position.y}px`,
        transform: 'translate(-50%, -50%)',
        willChange: 'left, top',
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={onDragStart}
      data-testid={`device-node-${device.id}`}
    >
      <div
        className={`relative bg-white dark:bg-gray-800 rounded-lg border-2 transition-all hover-elevate ${
          isSelected
            ? 'border-primary shadow-lg'
            : isHighlighted
            ? 'border-yellow-400 shadow-md'
            : 'border-border'
        }`}
        style={{ width: '320px' }}
      >
        {/* Status indicator dot */}
        <div
          className={`absolute top-3 right-3 w-3 h-3 rounded-full ${
            statusColors[device.status as keyof typeof statusColors] || statusColors.unknown
          }`}
          data-testid={`status-indicator-${device.status}`}
        />

        {/* Main content */}
        <div className="p-3">
          {/* Top row: Icon + Name + CPU/MEM/UP */}
          <div className="flex items-start gap-3 mb-2">
            {/* Icon */}
            <div className="flex-shrink-0 mt-0.5">
              <Icon className="h-6 w-6 text-foreground" />
            </div>

            {/* Device name */}
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-foreground truncate" data-testid={`text-device-name-${device.id}`}>
                {device.name}
              </h3>
            </div>

            {/* CPU/MEM/UP stats (top right) */}
            {device.deviceData?.cpuUsagePct !== undefined && device.deviceData?.memoryUsagePct !== undefined && (
              <div className="flex-shrink-0 flex flex-col items-end gap-0.5" data-testid={`vitals-${device.id}`}>
                <div className="flex items-baseline gap-1 text-sm font-bold">
                  <span className="font-mono text-foreground">{device.deviceData.cpuUsagePct}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="font-mono text-foreground">{device.deviceData.memoryUsagePct}</span>
                </div>
                <div className="text-[9px] text-muted-foreground font-medium">
                  CPU/MEM/UP
                </div>
              </div>
            )}
          </div>

          {/* Subtitle (model) */}
          <div className="mb-3 ml-9">
            <p className="text-xs text-muted-foreground truncate">
              {subtitle}
            </p>
          </div>

          {/* Bottom status bar */}
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-border ml-9">
            {/* IP address */}
            <div className="flex-1 min-w-0">
              {device.ipAddress && (
                <p className="text-sm text-muted-foreground font-medium truncate" data-testid={`text-ip-${device.id}`}>
                  {device.ipAddress}
                </p>
              )}
            </div>

            {/* Port status indicators */}
            {ports.length > 0 && (
              <div className="flex items-center gap-3 text-sm font-bold">
                {onlinePorts > 0 && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                    <span className="text-foreground">{onlinePorts}</span>
                  </div>
                )}
                {offlinePorts > 0 && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    <span className="text-foreground">{offlinePorts}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

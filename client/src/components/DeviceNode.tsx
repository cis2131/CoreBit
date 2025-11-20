import { Device } from '@shared/schema';
import { Server, Router, Wifi, HardDrive, Activity } from 'lucide-react';

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
        style={{ width: '300px', height: '110px' }}
      >
        {/* Status indicator dot */}
        <div
          className={`absolute top-3 right-3 w-3 h-3 rounded-full ${
            statusColors[device.status as keyof typeof statusColors] || statusColors.unknown
          }`}
          data-testid={`status-indicator-${device.status}`}
        />

        {/* Main content */}
        <div className="flex items-start gap-3 p-3 h-full">
          {/* Left: Icon */}
          <div className="flex-shrink-0 mt-0.5">
            <Icon className="h-6 w-6 text-foreground" />
          </div>

          {/* Center: Device info */}
          <div className="flex-1 min-w-0">
            {/* Device name and subtitle */}
            <div className="mb-2">
              <h3 className="text-base font-bold text-foreground truncate" data-testid={`text-device-name-${device.id}`}>
                {device.name}
              </h3>
              <p className="text-xs text-muted-foreground truncate">
                {subtitle}
              </p>
            </div>

            {/* Bottom row: Model/IP and port status */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                {device.ipAddress && (
                  <p className="text-xs text-muted-foreground font-medium truncate" data-testid={`text-ip-${device.id}`}>
                    {device.ipAddress}
                  </p>
                )}
              </div>

              {/* Port status indicators */}
              {ports.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  {onlinePorts > 0 && (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="font-medium text-foreground">{onlinePorts}</span>
                    </div>
                  )}
                  {unknownPorts > 0 && (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-gray-400" />
                      <span className="font-medium text-foreground">{unknownPorts}</span>
                    </div>
                  )}
                  {offlinePorts > 0 && (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="font-medium text-foreground">{offlinePorts}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: CPU/Memory stats */}
          {device.deviceData?.cpuUsagePct !== undefined && device.deviceData?.memoryUsagePct !== undefined && (
            <div className="flex-shrink-0 flex flex-col items-end gap-0.5 text-xs font-medium" data-testid={`vitals-${device.id}`}>
              <div className="flex items-baseline gap-1">
                <span className="font-mono font-bold text-foreground">{device.deviceData.cpuUsagePct}</span>
                <span className="text-muted-foreground">/</span>
                <span className="font-mono font-bold text-foreground">{device.deviceData.memoryUsagePct}</span>
                <span className="text-muted-foreground">/</span>
                <span className="font-mono font-bold text-foreground">
                  {device.deviceData.uptime ? Math.floor(parseInt(device.deviceData.uptime) / 86400) : 0}
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                CPU/MEM/UP
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

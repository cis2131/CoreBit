import { Device } from '@shared/schema';
import { Server, Router, Wifi, HardDrive, Activity, Cpu, MemoryStick, Clock, ExternalLink } from 'lucide-react';

interface DeviceNodeProps {
  device: Device & { position: { x: number; y: number } };
  isSelected: boolean;
  isHighlighted: boolean;
  onClick: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onMapLinkClick?: (mapId: string) => void;
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
  stale: 'bg-orange-500',
  offline: 'bg-red-500',
  unknown: 'bg-gray-400',
};

// Parse uptime from various formats
function parseUptime(uptime: string | undefined): { value: number; unit: string } {
  if (!uptime) return { value: 0, unit: 'h' };

  // Mikrotik format: "9w4d17h40m8s"
  const mikrotikMatch = uptime.match(/(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (mikrotikMatch) {
    const weeks = parseInt(mikrotikMatch[1] || '0');
    const days = parseInt(mikrotikMatch[2] || '0');
    const hours = parseInt(mikrotikMatch[3] || '0');
    const totalDays = weeks * 7 + days;
    
    if (totalDays >= 1) {
      return { value: totalDays, unit: 'd' };
    } else {
      return { value: hours, unit: 'h' };
    }
  }

  // SNMP format: "X days, HH:MM:SS" or "HH:MM:SS"
  const snmpDaysMatch = uptime.match(/(\d+)\s+days/);
  if (snmpDaysMatch) {
    return { value: parseInt(snmpDaysMatch[1]), unit: 'd' };
  }

  const snmpHoursMatch = uptime.match(/^(\d+):/);
  if (snmpHoursMatch) {
    const hours = parseInt(snmpHoursMatch[1]);
    return { value: hours, unit: 'h' };
  }

  return { value: 0, unit: 'h' };
}

export function DeviceNode({ device, isSelected, isHighlighted, onClick, onDragStart, onMapLinkClick }: DeviceNodeProps) {
  const Icon = deviceIcons[device.type as keyof typeof deviceIcons] || Activity;

  // Calculate port status counts
  const ports = device.deviceData?.ports || [];
  const onlinePorts = ports.filter(p => p.status === 'up').length;
  const offlinePorts = ports.filter(p => p.status === 'down').length;

  // Extract model or use type as fallback
  const subtitle = device.deviceData?.model || device.type.replace(/_/g, ' ').toUpperCase();

  // Parse uptime
  const uptime = parseUptime(device.deviceData?.uptime);

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

        {/* Map link icon - shows when device has a linked map */}
        {device.linkedMapId && onMapLinkClick && (
          <button
            className="absolute top-2 right-8 p-1 rounded hover-elevate transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onMapLinkClick(device.linkedMapId!);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Go to linked map"
            data-testid={`button-go-linked-map-${device.id}`}
          >
            <ExternalLink className="h-4 w-4 text-primary" />
          </button>
        )}

        {/* Main content */}
        <div className="p-3">
          {/* Top row: Icon + Name */}
          <div className="flex items-start gap-3 mb-2">
            {/* Icon */}
            <div className="flex-shrink-0 mt-0.5">
              <Icon className="h-6 w-6 text-foreground" />
            </div>

            {/* Device name */}
            <div className="flex-1 min-w-0 pr-6">
              <h3 className="text-lg font-bold text-foreground truncate" data-testid={`text-device-name-${device.id}`}>
                {device.name}
              </h3>
            </div>
          </div>

          {/* Subtitle (model) */}
          <div className="mb-3 ml-9">
            <p className="text-xs text-muted-foreground truncate">
              {subtitle}
            </p>
          </div>

          {/* Bottom status bar */}
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
            {/* Left: IP address */}
            <div className="flex-1 min-w-0">
              {device.ipAddress && (
                <p className="text-sm text-muted-foreground font-medium truncate" data-testid={`text-ip-${device.id}`}>
                  {device.ipAddress}
                </p>
              )}
            </div>

            {/* Right: CPU, MEM, UP, and Port status */}
            <div className="flex items-center gap-3">
              {/* CPU/MEM/UP with icons */}
              {device.deviceData?.cpuUsagePct !== undefined && device.deviceData?.memoryUsagePct !== undefined && (
                <div 
                  className={`flex items-center gap-2 text-xs ${
                    device.status === 'online' ? '' : 'opacity-40'
                  }`} 
                  data-testid={`vitals-${device.id}`}
                >
                  <div className="flex items-center gap-1">
                    <Cpu className="h-3 w-3 text-muted-foreground" />
                    <span className={`font-bold ${
                      device.status === 'online' ? 'text-foreground' : 'text-muted-foreground'
                    }`}>{device.deviceData.cpuUsagePct}%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <MemoryStick className="h-3 w-3 text-muted-foreground" />
                    <span className={`font-bold ${
                      device.status === 'online' ? 'text-foreground' : 'text-muted-foreground'
                    }`}>{device.deviceData.memoryUsagePct}%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <span className={`font-bold ${
                      device.status === 'online' ? 'text-foreground' : 'text-muted-foreground'
                    }`}>{uptime.value}{uptime.unit}</span>
                  </div>
                </div>
              )}

              {/* Port status indicators */}
              {ports.length > 0 && (
                <div className={`flex items-center gap-2 text-sm font-bold ${
                  device.status === 'online' ? '' : 'opacity-40'
                }`}>
                  {onlinePorts > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2.5 h-2.5 rounded-full ${
                        device.status === 'online' ? 'bg-green-500' : 'bg-gray-400'
                      }`} />
                      <span className={device.status === 'online' ? 'text-foreground' : 'text-muted-foreground'}>{onlinePorts}</span>
                    </div>
                  )}
                  {offlinePorts > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2.5 h-2.5 rounded-full ${
                        device.status === 'online' ? 'bg-red-500' : 'bg-gray-400'
                      }`} />
                      <span className={device.status === 'online' ? 'text-foreground' : 'text-muted-foreground'}>{offlinePorts}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

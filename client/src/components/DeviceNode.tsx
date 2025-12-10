import { Device } from '@shared/schema';
import { Server, Router, Wifi, HardDrive, Activity, Cpu, MemoryStick, Clock, ExternalLink, Bell, BellOff, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface DeviceNodeProps {
  device: Device & { position: { x: number; y: number } };
  isSelected: boolean;
  isHighlighted: boolean;
  isOffline: boolean;
  linkedMapId?: string | null;
  linkedMapHasOffline?: boolean;
  hasGlobalNotifications?: boolean;
  isMuted?: boolean;
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

export function DeviceNode({ device, isSelected, isHighlighted, isOffline, linkedMapId, linkedMapHasOffline, hasGlobalNotifications, isMuted, onClick, onDragStart, onMapLinkClick }: DeviceNodeProps) {
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
        isHighlighted || isOffline ? 'animate-pulse' : ''
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
        className={`relative bg-slate-50 dark:bg-gray-800 rounded-lg border-2 shadow-sm transition-all hover-elevate ${
          isSelected
            ? 'border-primary shadow-lg'
            : isOffline
            ? 'border-red-500 shadow-md'
            : isHighlighted
            ? 'border-yellow-400 shadow-md'
            : 'border-slate-200 dark:border-border'
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

        {/* Notification indicators - bottom right */}
        {(hasGlobalNotifications || device.useOnDuty || isMuted) && (
          <div className="absolute bottom-2 right-2">
            {isMuted ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="p-1 rounded bg-orange-100 dark:bg-orange-900/30 mt-[33px] mb-[33px]">
                    <BellOff className="h-4 w-4 text-orange-500" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs">Notifications muted</p>
                </TooltipContent>
              </Tooltip>
            ) : hasGlobalNotifications && device.useOnDuty ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="p-1 rounded bg-blue-100 dark:bg-blue-900/30 flex items-center gap-0.5 mt-[34px] mb-[34px]">
                    <Bell className="h-4 w-4 text-blue-500" />
                    <Users className="h-4 w-4 text-blue-500" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs">Global + On-duty notifications</p>
                </TooltipContent>
              </Tooltip>
            ) : hasGlobalNotifications ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="p-1 rounded bg-blue-100 dark:bg-blue-900/30 mt-[36px] mb-[36px]">
                    <Bell className="h-4 w-4 text-blue-500" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs">Global notifications enabled</p>
                </TooltipContent>
              </Tooltip>
            ) : device.useOnDuty ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="p-1 rounded bg-blue-100 dark:bg-blue-900/30 mt-[35px] mb-[35px]">
                    <Users className="h-4 w-4 text-blue-500" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs">On-duty notifications enabled</p>
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        )}


        {/* Main content */}
        <div className="p-3">
          {/* Top row: Icon + Name + Map Link */}
          <div className="flex items-center gap-3 mb-2">
            {/* Icon */}
            <div className="flex-shrink-0">
              <Icon className="h-6 w-6 text-foreground" />
            </div>

            {/* Device name */}
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-foreground truncate" data-testid={`text-device-name-${device.id}`}>
                {device.name}
              </h3>
            </div>

            {/* Map link button - shows when placement has a linked map */}
            {linkedMapId && onMapLinkClick && (
              <Button
                size="icon"
                variant="ghost"
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover-elevate active-elevate-2 border border-transparent h-7 w-7 flex-shrink-0 text-red-500 animate-pulse shadow-[0_0_8px_2px_rgba(239,68,68,0.6)] rounded-md mt-[0px] mb-[0px] pt-[0px] pb-[0px] pl-[0px] pr-[0px] ml-[14px] mr-[14px]"
                onClick={(e) => {
                  e.stopPropagation();
                  onMapLinkClick(linkedMapId);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                title={linkedMapHasOffline ? "Go to linked map (has offline devices)" : "Go to linked map"}
                data-testid={`button-go-linked-map-${device.id}`}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            )}

            {/* Spacer for status indicator */}
            <div className="w-4 flex-shrink-0" />
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

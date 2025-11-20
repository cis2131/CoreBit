import { useState } from 'react';
import { Device } from '@shared/schema';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Server, Router, Wifi, HardDrive, Settings } from 'lucide-react';

interface DeviceListSidebarProps {
  devices: Device[];
  onDeviceDragStart?: (deviceId: string) => void;
  onEditDevice?: (device: Device) => void;
  onDeviceClick?: (deviceId: string) => void;
}

const deviceTypeIcons: Record<string, React.ElementType> = {
  'mikrotik_router': Router,
  'mikrotik_switch': Server,
  'generic_snmp': Server,
  'server': HardDrive,
  'access_point': Wifi,
};

function getStatusColor(status: string): string {
  switch (status) {
    case 'online':
      return 'bg-green-500';
    case 'warning':
      return 'bg-yellow-500';
    case 'offline':
      return 'bg-red-500';
    default:
      return 'bg-gray-400';
  }
}

export function DeviceListSidebar({ devices, onDeviceDragStart, onEditDevice, onDeviceClick }: DeviceListSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className={`h-full bg-background border-r border-border transition-all duration-300 ${isCollapsed ? 'w-12' : 'w-64'} flex flex-col`}>
      <div className="h-14 flex items-center justify-between px-4 border-b border-border">
        {!isCollapsed && (
          <h2 className="text-sm font-semibold text-foreground">Devices</h2>
        )}
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setIsCollapsed(!isCollapsed)}
          data-testid="button-collapse-sidebar"
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      {!isCollapsed && (
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {devices.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No devices yet
              </p>
            ) : (
              devices.map((device) => {
                const Icon = deviceTypeIcons[device.type] || Server;
                return (
                  <div
                    key={device.id}
                    className="p-2 rounded-md cursor-grab active:cursor-grabbing hover-elevate border border-border"
                    draggable
                    onDragStart={() => onDeviceDragStart?.(device.id)}
                    onClick={() => onDeviceClick?.(device.id)}
                    data-testid={`device-list-item-${device.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${getStatusColor(device.status)}`} />
                      <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {device.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {device.ipAddress || 'No IP'}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditDevice?.(device);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        draggable={false}
                        data-testid={`button-edit-device-${device.id}`}
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

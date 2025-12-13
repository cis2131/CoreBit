import { useState, useEffect, useRef } from 'react';
import { Device } from '@shared/schema';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronLeft, ChevronRight, Server, Router, Wifi, HardDrive, Settings, Eye, EyeOff } from 'lucide-react';
import { OnDutyPanel } from './OnDutyPanel';
import { IpamPanel } from './IpamPanel';

interface DeviceListSidebarProps {
  devices: Device[];
  placedDeviceIds?: string[];
  onDeviceDragStart?: (deviceId: string) => void;
  onDeviceDragEnd?: () => void;
  onEditDevice?: (device: Device) => void;
  onDeviceClick?: (deviceId: string) => void;
  canModify?: boolean;
  highlightedDeviceId?: string | null;
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
    case 'stale':
      return 'bg-orange-500';
    case 'offline':
      return 'bg-red-500';
    default:
      return 'bg-gray-400';
  }
}

export function DeviceListSidebar({ devices, placedDeviceIds = [], onDeviceDragStart, onDeviceDragEnd, onEditDevice, onDeviceClick, canModify = true, highlightedDeviceId }: DeviceListSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [hideUnplaced, setHideUnplaced] = useState(false);
  const highlightedDeviceRef = useRef<HTMLDivElement>(null);
  
  // Scroll to highlighted device when it changes
  useEffect(() => {
    if (highlightedDeviceId && highlightedDeviceRef.current) {
      // Expand sidebar if collapsed
      if (isCollapsed) {
        setIsCollapsed(false);
      }
      // Scroll into view with smooth animation
      setTimeout(() => {
        highlightedDeviceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [highlightedDeviceId, isCollapsed]);

  // Filter devices based on search query and placement status
  const filteredDevices = devices.filter(device => {
    const matchesSearch = searchQuery === '' || 
      device.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      device.ipAddress?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      device.type.toLowerCase().includes(searchQuery.toLowerCase());
    
    const isPlaced = placedDeviceIds.includes(device.id);
    const shouldShow = hideUnplaced ? !isPlaced : true;
    
    return matchesSearch && shouldShow;
  });

  return (
    <div className={`h-full bg-background border-r border-border transition-all duration-300 ${isCollapsed ? 'w-12' : 'w-64'} flex flex-col`}>
      <div className="h-14 flex items-center justify-end px-4 border-b border-border">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setIsCollapsed(!isCollapsed)}
          data-testid="button-collapse-sidebar"
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      <div className="flex-shrink-0">
        <OnDutyPanel isCollapsed={isCollapsed} />
      </div>
      <div className="flex-shrink-0 max-h-64 overflow-y-auto">
        <IpamPanel isCollapsed={isCollapsed} />
      </div>

      {!isCollapsed && (
        <>
          <div className="px-4 py-2 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Devices</h2>
          </div>
          <div className="px-2 pt-2 space-y-2 border-b border-border pb-2">
            <Input
              placeholder="Search devices..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8"
              data-testid="input-device-search"
            />
            <Button
              variant={hideUnplaced ? 'default' : 'outline'}
              size="sm"
              onClick={() => setHideUnplaced(!hideUnplaced)}
              className="w-full gap-2 text-xs"
              data-testid="button-filter-placed"
            >
              {hideUnplaced ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              {hideUnplaced ? 'Show placed' : 'Hide placed'}
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {filteredDevices.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {devices.length === 0 ? 'No devices yet' : 'No matching devices'}
                </p>
              ) : (
                filteredDevices.map((device) => {
                  const Icon = deviceTypeIcons[device.type] || Server;
                  const isPlaced = placedDeviceIds.includes(device.id);
                  const isHighlighted = highlightedDeviceId === device.id;
                  return (
                    <div
                      key={device.id}
                      ref={isHighlighted ? highlightedDeviceRef : undefined}
                      className={`p-2 rounded-md cursor-grab active:cursor-grabbing hover-elevate border ${
                        isHighlighted 
                          ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 animate-pulse' 
                          : 'border-border'
                      } ${isPlaced ? 'opacity-60' : ''}`}
                      draggable={!isPlaced}
                      onDragStart={() => onDeviceDragStart?.(device.id)}
                      onDragEnd={() => onDeviceDragEnd?.()}
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
                            {device.ipAddress || 'No IP'} {isPlaced && '(placed)'}
                          </p>
                        </div>
                        {canModify && (
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
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}

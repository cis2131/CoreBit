import { Server, Router, Wifi, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface DeviceTemplate {
  type: string;
  name: string;
  icon: React.ElementType;
}

const deviceTemplates: DeviceTemplate[] = [
  { type: 'mikrotik_router', name: 'Mikrotik Router', icon: Router },
  { type: 'mikrotik_switch', name: 'Mikrotik Switch', icon: Server },
  { type: 'generic_snmp', name: 'SNMP Device', icon: Server },
  { type: 'server', name: 'Server', icon: HardDrive },
  { type: 'access_point', name: 'Access Point', icon: Wifi },
];

interface CompactDevicePaletteProps {
  onDeviceDragStart: (deviceType: string) => void;
  disabled?: boolean;
}

export function CompactDevicePalette({ onDeviceDragStart, disabled }: CompactDevicePaletteProps) {
  return (
    <TooltipProvider>
      <div className="flex items-center gap-1 px-3 py-1 border-r border-border">
        {deviceTemplates.map(device => {
          const Icon = device.icon;
          return (
            <Tooltip key={device.type}>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="cursor-grab active:cursor-grabbing h-8 w-8"
                  draggable={!disabled}
                  onDragStart={() => !disabled && onDeviceDragStart(device.type)}
                  disabled={disabled}
                  data-testid={`device-palette-${device.type}`}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">{device.name}</p>
                <p className="text-[10px] text-muted-foreground">Drag to canvas</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

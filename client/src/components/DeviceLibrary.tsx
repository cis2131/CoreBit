import { Server, Router, Wifi, HardDrive } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface DeviceTemplate {
  type: string;
  name: string;
  icon: React.ElementType;
  category: string;
}

const deviceTemplates: DeviceTemplate[] = [
  { type: 'mikrotik_router', name: 'Mikrotik Router', icon: Router, category: 'Mikrotik' },
  { type: 'mikrotik_switch', name: 'Mikrotik Switch', icon: Server, category: 'Mikrotik' },
  { type: 'generic_snmp', name: 'SNMP Device', icon: Server, category: 'Generic' },
  { type: 'server', name: 'Server', icon: HardDrive, category: 'Generic' },
  { type: 'access_point', name: 'Access Point', icon: Wifi, category: 'Generic' },
];

interface DeviceLibraryProps {
  onDeviceDragStart: (deviceType: string) => void;
}

export function DeviceLibrary({ onDeviceDragStart }: DeviceLibraryProps) {
  const categories = Array.from(new Set(deviceTemplates.map(d => d.category)));

  return (
    <div className="h-full flex flex-col bg-background border-r border-border">
      <div className="p-4 border-b border-border">
        <h2 className="text-base font-semibold text-foreground">Device Library</h2>
        <p className="text-xs text-muted-foreground mt-1">Drag to add devices</p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {categories.map(category => (
            <div key={category} className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">{category}</h3>
              <div className="space-y-2">
                {deviceTemplates
                  .filter(d => d.category === category)
                  .map(device => {
                    const Icon = device.icon;
                    return (
                      <Card
                        key={device.type}
                        className="p-3 cursor-grab active:cursor-grabbing hover-elevate"
                        draggable
                        onDragStart={() => onDeviceDragStart(device.type)}
                        data-testid={`device-template-${device.type}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-primary/10 rounded-md">
                            <Icon className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {device.name}
                            </p>
                            <Badge variant="secondary" className="mt-1 text-xs">
                              {device.type}
                            </Badge>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

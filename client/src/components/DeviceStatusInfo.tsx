import { useState } from 'react';
import { Device, Map } from '@shared/schema';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

interface DeviceStatusInfoProps {
  devices?: Device[];
  maps: Map[];
  onDeviceSelect: (deviceId: string) => void;
}

export function DeviceStatusInfo({ devices = [], maps, onDeviceSelect }: DeviceStatusInfoProps) {
  const [showDownDevices, setShowDownDevices] = useState(false);

  const upDevices = devices.filter(d => d.status === 'online').length;
  const downDevices = devices.filter(d => d.status !== 'online').length;
  const totalDevices = devices.length;

  if (totalDevices === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 px-2">
      <div className="flex items-center gap-2 text-sm">
        <div className="flex items-center gap-1">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-foreground">{upDevices}</span>
        </div>
        <span className="text-muted-foreground">/</span>
        
        {downDevices > 0 ? (
          <DropdownMenu open={showDownDevices} onOpenChange={setShowDownDevices}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto p-0 gap-1 text-destructive hover:text-destructive"
                data-testid="button-down-devices"
              >
                <AlertCircle className="h-4 w-4" />
                <span>{downDevices}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {devices
                .filter(d => d.status !== 'online')
                .map(device => (
                  <DropdownMenuItem
                    key={device.id}
                    onClick={() => {
                      onDeviceSelect(device.id);
                      setShowDownDevices(false);
                    }}
                    data-testid={`down-device-${device.id}`}
                    className="flex items-center justify-between"
                  >
                    <span className="truncate">{device.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {device.status || 'unknown'}
                    </span>
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex items-center gap-1 text-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span>0</span>
          </div>
        )}
      </div>
    </div>
  );
}

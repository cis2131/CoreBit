import { useState } from 'react';
import { Device, Map } from '@shared/schema';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';

interface DeviceStatusInfoProps {
  devices?: Device[];
  maps: Map[];
  onDeviceSelect: (deviceId: string) => void;
}

export function DeviceStatusInfo({ devices = [], maps, onDeviceSelect }: DeviceStatusInfoProps) {
  const [showDownDevices, setShowDownDevices] = useState(false);

  const onlineDevices = devices.filter(d => d.status === 'online').length;
  const staleDevices = devices.filter(d => d.status === 'stale');
  const offlineDevices = devices.filter(d => d.status === 'offline' || (d.status !== 'online' && d.status !== 'stale'));
  const problemDevices = [...staleDevices, ...offlineDevices];
  const totalDevices = devices.length;

  if (totalDevices === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 px-2">
      <div className="flex items-center gap-2 text-sm">
        <div className="flex items-center gap-1">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-foreground">{onlineDevices}</span>
        </div>
        
        {staleDevices.length > 0 && (
          <>
            <span className="text-muted-foreground">/</span>
            <div className="flex items-center gap-1 text-orange-500">
              <Clock className="h-4 w-4" />
              <span>{staleDevices.length}</span>
            </div>
          </>
        )}
        
        <span className="text-muted-foreground">/</span>
        
        {problemDevices.length > 0 ? (
          <DropdownMenu open={showDownDevices} onOpenChange={setShowDownDevices}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto p-0 gap-1 text-destructive hover:text-destructive"
                data-testid="button-down-devices"
              >
                <AlertCircle className="h-4 w-4" />
                <span>{offlineDevices.length}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {staleDevices.length > 0 && (
                <>
                  <DropdownMenuLabel className="flex items-center gap-2 text-orange-500">
                    <Clock className="h-3 w-3" />
                    Stale (Ping Response)
                  </DropdownMenuLabel>
                  {staleDevices.map(device => (
                    <DropdownMenuItem
                      key={device.id}
                      onClick={() => {
                        onDeviceSelect(device.id);
                        setShowDownDevices(false);
                      }}
                      data-testid={`stale-device-${device.id}`}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-orange-500" />
                        <span className="truncate">{device.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground ml-2">
                        {device.ipAddress}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {staleDevices.length > 0 && offlineDevices.length > 0 && (
                <DropdownMenuSeparator />
              )}
              {offlineDevices.length > 0 && (
                <>
                  <DropdownMenuLabel className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    Offline
                  </DropdownMenuLabel>
                  {offlineDevices.map(device => (
                    <DropdownMenuItem
                      key={device.id}
                      onClick={() => {
                        onDeviceSelect(device.id);
                        setShowDownDevices(false);
                      }}
                      data-testid={`down-device-${device.id}`}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                        <span className="truncate">{device.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground ml-2">
                        {device.ipAddress}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
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

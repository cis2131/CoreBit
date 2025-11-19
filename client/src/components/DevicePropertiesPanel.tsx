import { Device } from '@shared/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { X, Trash2, Edit } from 'lucide-react';

interface DevicePropertiesPanelProps {
  device: Device;
  onClose: () => void;
  onDelete: (deviceId: string) => void;
  onEdit: (device: Device) => void;
}

const statusLabels = {
  online: { label: 'Online', color: 'bg-green-500' },
  warning: { label: 'Warning', color: 'bg-yellow-500' },
  offline: { label: 'Offline', color: 'bg-red-500' },
  unknown: { label: 'Unknown', color: 'bg-gray-400' },
};

export function DevicePropertiesPanel({ device, onClose, onDelete, onEdit }: DevicePropertiesPanelProps) {
  const status = statusLabels[device.status as keyof typeof statusLabels] || statusLabels.unknown;

  return (
    <div className="h-full w-80 bg-background border-l border-border flex flex-col">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Device Properties</h2>
        <Button
          size="icon"
          variant="ghost"
          onClick={onClose}
          data-testid="button-close-properties"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Name</p>
                <p className="font-medium text-foreground" data-testid="text-property-name">
                  {device.name}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Type</p>
                <Badge variant="secondary" className="mt-1" data-testid="badge-property-type">
                  {device.type.replace(/_/g, ' ')}
                </Badge>
              </div>
              {device.ipAddress && (
                <div>
                  <p className="text-muted-foreground text-xs">IP Address</p>
                  <p className="font-medium font-mono text-foreground" data-testid="text-property-ip">
                    {device.ipAddress}
                  </p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground text-xs">Status</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className={`w-2 h-2 rounded-full ${status.color}`} />
                  <span className="font-medium text-foreground" data-testid="text-property-status">
                    {status.label}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {device.deviceData && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Device Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {device.deviceData.model && (
                  <div>
                    <p className="text-muted-foreground text-xs">Model</p>
                    <p className="font-medium text-foreground">{device.deviceData.model}</p>
                  </div>
                )}
                {device.deviceData.version && (
                  <div>
                    <p className="text-muted-foreground text-xs">Version</p>
                    <p className="font-medium text-foreground">{device.deviceData.version}</p>
                  </div>
                )}
                {device.deviceData.uptime && (
                  <div>
                    <p className="text-muted-foreground text-xs">Uptime</p>
                    <p className="font-medium text-foreground">{device.deviceData.uptime}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {device.deviceData?.ports && device.deviceData.ports.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Network Ports</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {device.deviceData.ports.map((port, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            port.status === 'up' ? 'bg-green-500' : 'bg-gray-400'
                          }`}
                        />
                        <span className="font-medium text-foreground">{port.name}</span>
                      </div>
                      {port.speed && (
                        <Badge variant="outline" className="text-xs">
                          {port.speed}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div>
            <p className="text-xs text-muted-foreground mb-2">Position</p>
            <div className="flex gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">X:</span>{' '}
                <span className="font-mono font-medium text-foreground">
                  {Math.round(device.position.x)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Y:</span>{' '}
                <span className="font-mono font-medium text-foreground">
                  {Math.round(device.position.y)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      <Separator />

      <div className="p-4 space-y-2">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={() => onEdit(device)}
          data-testid="button-edit-device"
        >
          <Edit className="h-4 w-4" />
          Edit Device
        </Button>
        <Button
          variant="destructive"
          className="w-full justify-start gap-2"
          onClick={() => onDelete(device.id)}
          data-testid="button-delete-device"
        >
          <Trash2 className="h-4 w-4" />
          Delete Device
        </Button>
      </div>
    </div>
  );
}

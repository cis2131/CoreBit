import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Device, type CredentialProfile } from '@shared/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { X, Trash2, Edit, RefreshCw, Key, Cpu, MemoryStick } from 'lucide-react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

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
  const { toast } = useToast();
  const [probing, setProbing] = useState(false);
  const status = statusLabels[device.status as keyof typeof statusLabels] || statusLabels.unknown;

  const { data: credentialProfile } = useQuery<CredentialProfile>({
    queryKey: ['/api/credential-profiles', device.credentialProfileId],
    queryFn: async () => {
      if (!device.credentialProfileId) return null;
      const response = await fetch(`/api/credential-profiles/${device.credentialProfileId}`);
      if (!response.ok) throw new Error('Failed to fetch credential profile');
      return response.json();
    },
    enabled: !!device.credentialProfileId,
  });

  const handleProbeNow = async () => {
    setProbing(true);
    try {
      await apiRequest('POST', `/api/devices/${device.id}/probe`, {});
      queryClient.invalidateQueries({ queryKey: [`/api/devices?mapId=${device.mapId}`] });
      toast({ title: 'Device probed', description: 'Device information has been updated.' });
    } catch (error) {
      toast({
        title: 'Probe failed',
        description: 'Could not connect to device. Check credentials and IP address.',
        variant: 'destructive',
      });
    } finally {
      setProbing(false);
    }
  };

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
                {device.deviceData.systemIdentity && (
                  <div>
                    <p className="text-muted-foreground text-xs">System Identity</p>
                    <p className="font-medium text-foreground">{device.deviceData.systemIdentity}</p>
                  </div>
                )}
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
                    <div key={idx} className="flex flex-col gap-1 text-sm">
                      <div className="flex items-center justify-between">
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
                      {port.description && (
                        <p className="text-xs text-muted-foreground ml-5">{port.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {device.deviceData?.cpuUsagePct !== undefined && device.deviceData?.memoryUsagePct !== undefined && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">System Vitals</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-muted-foreground" />
                      <span className="text-foreground font-medium">CPU Usage</span>
                    </div>
                    <span className="font-mono font-semibold text-foreground" data-testid="text-cpu-usage">
                      {device.deviceData.cpuUsagePct}%
                    </span>
                  </div>
                  <Progress 
                    value={device.deviceData.cpuUsagePct} 
                    className="h-2"
                    data-testid="progress-cpu"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <MemoryStick className="h-4 w-4 text-muted-foreground" />
                      <span className="text-foreground font-medium">Memory Usage</span>
                    </div>
                    <span className="font-mono font-semibold text-foreground" data-testid="text-memory-usage">
                      {device.deviceData.memoryUsagePct}%
                    </span>
                  </div>
                  <Progress 
                    value={device.deviceData.memoryUsagePct} 
                    className="h-2"
                    data-testid="progress-memory"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm">Credentials</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {device.credentialProfileId && credentialProfile ? (
                <div className="space-y-1">
                  <div className="text-sm text-foreground font-medium">{credentialProfile.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {credentialProfile.type === 'mikrotik' ? 'Mikrotik Device' : 'SNMP Device'}
                  </div>
                  <Badge variant="outline" className="text-xs mt-2">Profile</Badge>
                </div>
              ) : device.customCredentials ? (
                <div className="space-y-1">
                  <div className="text-sm text-foreground font-medium">Custom Credentials</div>
                  <div className="text-xs text-muted-foreground">
                    Device-specific credentials configured
                  </div>
                  <Badge variant="outline" className="text-xs mt-2">Custom</Badge>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No credentials configured
                </div>
              )}
            </CardContent>
          </Card>

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
          onClick={handleProbeNow}
          disabled={probing}
          data-testid="button-probe-device"
        >
          <RefreshCw className={`h-4 w-4 ${probing ? 'animate-spin' : ''}`} />
          {probing ? 'Probing...' : 'Probe Now'}
        </Button>
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

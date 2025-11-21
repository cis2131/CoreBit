import { useState } from 'react';
import { Connection, Device } from '@shared/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { X, Trash2, Save, Activity, ArrowDown, ArrowUp } from 'lucide-react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface ConnectionPropertiesPanelProps {
  connection: Connection;
  sourceDevice: Device;
  targetDevice: Device;
  onClose: () => void;
  onDelete: (connectionId: string) => void;
}

const linkSpeeds = ['1G', '10G', '25G', '40G', '100G'] as const;

export function ConnectionPropertiesPanel({ 
  connection, 
  sourceDevice,
  targetDevice,
  onClose, 
  onDelete 
}: ConnectionPropertiesPanelProps) {
  const { toast } = useToast();
  const [linkSpeed, setLinkSpeed] = useState(connection.linkSpeed || '1G');
  const [sourcePort, setSourcePort] = useState(connection.sourcePort || 'none');
  const [targetPort, setTargetPort] = useState(connection.targetPort || 'none');
  const [saving, setSaving] = useState(false);

  const sourcePorts = sourceDevice.deviceData?.ports || [];
  const targetPorts = targetDevice.deviceData?.ports || [];

  const hasChanges = 
    linkSpeed !== (connection.linkSpeed || '1G') ||
    sourcePort !== (connection.sourcePort || 'none') ||
    targetPort !== (connection.targetPort || 'none');

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiRequest('PATCH', `/api/connections/${connection.id}`, {
        linkSpeed,
        sourcePort: sourcePort === 'none' ? '' : sourcePort,
        targetPort: targetPort === 'none' ? '' : targetPort,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/connections', connection.mapId] });
      toast({ title: 'Connection updated', description: 'Connection properties have been saved.' });
    } catch (error) {
      toast({
        title: 'Update failed',
        description: 'Could not update connection properties.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="h-full w-80 bg-background border-l border-border flex flex-col">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Connection Properties</h2>
        <Button
          size="icon"
          variant="ghost"
          onClick={onClose}
          data-testid="button-close-connection-properties"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Link Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="link-speed">Link Speed</Label>
                <Select value={linkSpeed} onValueChange={setLinkSpeed}>
                  <SelectTrigger id="link-speed" data-testid="select-link-speed">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {linkSpeeds.map(speed => (
                      <SelectItem key={speed} value={speed}>
                        {speed}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {sourcePorts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <Label htmlFor="source-port" className="text-xs text-muted-foreground">Source</Label>
                    <span className="text-xs font-medium text-foreground">{sourceDevice.name}</span>
                  </div>
                  <Select value={sourcePort} onValueChange={setSourcePort}>
                    <SelectTrigger id="source-port" data-testid="select-source-port">
                      <SelectValue placeholder="Select port" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {sourcePorts.map((port, idx) => (
                        <SelectItem key={idx} value={port.name}>
                          <div className="flex items-start gap-2">
                            <div
                              className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${
                                sourceDevice.status === 'online' && port.status === 'up' ? 'bg-green-500' : sourceDevice.status === 'online' && port.status === 'down' ? 'bg-red-500' : 'bg-gray-400'
                              }`}
                            />
                            <div className="flex flex-col">
                              <span>{port.name} {port.speed && `(${port.speed})`}</span>
                              {port.description && (
                                <span className="text-xs text-muted-foreground">{port.description}</span>
                              )}
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {targetPorts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <Label htmlFor="target-port" className="text-xs text-muted-foreground">Target</Label>
                    <span className="text-xs font-medium text-foreground">{targetDevice.name}</span>
                  </div>
                  <Select value={targetPort} onValueChange={setTargetPort}>
                    <SelectTrigger id="target-port" data-testid="select-target-port">
                      <SelectValue placeholder="Select port" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {targetPorts.map((port, idx) => (
                        <SelectItem key={idx} value={port.name}>
                          <div className="flex items-start gap-2">
                            <div
                              className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${
                                targetDevice.status === 'online' && port.status === 'up' ? 'bg-green-500' : targetDevice.status === 'online' && port.status === 'down' ? 'bg-red-500' : 'bg-gray-400'
                              }`}
                            />
                            <div className="flex flex-col">
                              <span>{port.name} {port.speed && `(${port.speed})`}</span>
                              {port.description && (
                                <span className="text-xs text-muted-foreground">{port.description}</span>
                              )}
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>

          {connection.linkStats && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-sm">Traffic Statistics</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {connection.linkStats.inBytesPerSec !== undefined && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <ArrowDown className="h-4 w-4 text-blue-500" />
                        <span className="text-foreground font-medium">Inbound</span>
                      </div>
                      <span className="font-mono font-semibold text-foreground" data-testid="text-inbound-traffic">
                        {formatBytes(connection.linkStats.inBytesPerSec)}/s
                      </span>
                    </div>
                  </div>
                )}
                {connection.linkStats.outBytesPerSec !== undefined && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <ArrowUp className="h-4 w-4 text-green-500" />
                        <span className="text-foreground font-medium">Outbound</span>
                      </div>
                      <span className="font-mono font-semibold text-foreground" data-testid="text-outbound-traffic">
                        {formatBytes(connection.linkStats.outBytesPerSec)}/s
                      </span>
                    </div>
                  </div>
                )}
                {connection.linkStats.utilizationPct !== undefined && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground font-medium">Utilization</span>
                      <span className="font-mono font-semibold text-foreground" data-testid="text-utilization">
                        {connection.linkStats.utilizationPct}%
                      </span>
                    </div>
                    <Progress 
                      value={connection.linkStats.utilizationPct} 
                      className="h-2"
                      data-testid="progress-utilization"
                    />
                  </div>
                )}
                {connection.linkStats.lastSampleAt && (
                  <div className="text-xs text-muted-foreground">
                    Last updated: {new Date(connection.linkStats.lastSampleAt).toLocaleString()}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>

      <Separator />

      <div className="p-4 space-y-2">
        <Button
          variant="default"
          className="w-full justify-start gap-2"
          onClick={handleSave}
          disabled={!hasChanges || saving}
          data-testid="button-save-connection"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
        <Button
          variant="destructive"
          className="w-full justify-start gap-2"
          onClick={() => onDelete(connection.id)}
          data-testid="button-delete-connection"
        >
          <Trash2 className="h-4 w-4" />
          Delete Connection
        </Button>
      </div>
    </div>
  );
}

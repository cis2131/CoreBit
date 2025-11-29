import { useState, useEffect } from 'react';
import { Device, Connection } from '@shared/schema';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Link2 } from 'lucide-react';

interface CreateConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceDevice: Device | null;
  targetDevice: Device | null;
  onConfirm: (sourcePort: string, targetPort: string) => void;
  initialSourcePort?: string;
  connections?: Connection[];
  allDevices?: Device[];
}

export function CreateConnectionDialog({
  open,
  onOpenChange,
  sourceDevice,
  targetDevice,
  onConfirm,
  initialSourcePort,
  connections = [],
  allDevices = [],
}: CreateConnectionDialogProps) {
  const [sourcePort, setSourcePort] = useState('');
  const [targetPort, setTargetPort] = useState('');

  // Prefill source port when dialog opens with initialSourcePort, or reset if none provided
  useEffect(() => {
    if (open) {
      setSourcePort(initialSourcePort ?? '');
    }
  }, [open, initialSourcePort]);

  const handleConfirm = () => {
    if (sourcePort && targetPort) {
      onConfirm(sourcePort, targetPort);
      setSourcePort('');
      setTargetPort('');
      onOpenChange(false);
    }
  };

  const sourcePorts = (sourceDevice?.deviceData?.ports as any[]) || [];
  const targetPorts = (targetDevice?.deviceData?.ports as any[]) || [];

  // Find existing connection for a port on a device
  const findConnectionForPort = (deviceId: string, portName: string): { connection: Connection; otherDeviceName: string; otherPortName: string } | null => {
    for (const conn of connections) {
      if (conn.sourceDeviceId === deviceId && conn.sourcePort === portName) {
        const otherDevice = allDevices.find(d => d.id === conn.targetDeviceId);
        return {
          connection: conn,
          otherDeviceName: otherDevice?.name || 'Unknown',
          otherPortName: conn.targetPort || 'Unknown',
        };
      }
      if (conn.targetDeviceId === deviceId && conn.targetPort === portName) {
        const otherDevice = allDevices.find(d => d.id === conn.sourceDeviceId);
        return {
          connection: conn,
          otherDeviceName: otherDevice?.name || 'Unknown',
          otherPortName: conn.sourcePort || 'Unknown',
        };
      }
    }
    return null;
  };

  // Status dot component
  const StatusDot = ({ status }: { status: string }) => {
    const isUp = status?.toLowerCase() === 'up';
    return (
      <span
        className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
          isUp ? 'bg-green-500' : 'bg-muted-foreground/50'
        }`}
      />
    );
  };

  // Port item renderer
  const renderPortItem = (port: any, deviceId: string, showInDropdown: boolean) => {
    const portName = port.defaultName || port.name;
    const connectionInfo = findConnectionForPort(deviceId, portName);
    
    return (
      <div className="flex flex-col items-start gap-0.5">
        <div className="flex items-center gap-2">
          <StatusDot status={port.status} />
          <span className="font-medium">
            {port.name}
            {port.speed ? ` (${port.speed})` : ''}
          </span>
        </div>
        {port.description && (
          <div className="text-xs text-muted-foreground ml-4">
            {port.description}
          </div>
        )}
        {connectionInfo && showInDropdown && (
          <div className="flex items-center gap-1 text-xs text-blue-500 ml-4">
            <Link2 className="h-3 w-3" />
            <span>→ {connectionInfo.otherDeviceName} ({connectionInfo.otherPortName})</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-create-connection">
        <DialogHeader>
          <DialogTitle>Create Connection</DialogTitle>
          <DialogDescription>
            Select the ports to connect between the two devices
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Source Device</Label>
            <div className="text-sm text-muted-foreground">
              {sourceDevice?.name} ({sourceDevice?.ipAddress || 'No IP'})
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="source-port">Source Port</Label>
            <Select value={sourcePort} onValueChange={setSourcePort}>
              <SelectTrigger id="source-port" data-testid="select-source-port" className="h-auto min-h-10">
                <SelectValue placeholder="Select port">
                  {sourcePort && (() => {
                    const port = sourcePorts.find((p: any) => (p.defaultName || p.name) === sourcePort);
                    if (!port) return sourcePort;
                    return (
                      <div className="flex items-center gap-2 py-1">
                        <StatusDot status={port.status} />
                        <span className="font-medium">
                          {port.name} {port.speed ? `(${port.speed})` : ''}
                        </span>
                      </div>
                    );
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {sourcePorts.length > 0 ? (
                  sourcePorts.map((port: any) => (
                    <SelectItem 
                      key={port.defaultName || port.name} 
                      value={port.defaultName || port.name}
                      className="h-auto py-2"
                    >
                      {renderPortItem(port, sourceDevice?.id || '', true)}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="default">Default Port</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Target Device</Label>
            <div className="text-sm text-muted-foreground">
              {targetDevice?.name} ({targetDevice?.ipAddress || 'No IP'})
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="target-port">Target Port</Label>
            <Select value={targetPort} onValueChange={setTargetPort}>
              <SelectTrigger id="target-port" data-testid="select-target-port" className="h-auto min-h-10">
                <SelectValue placeholder="Select port">
                  {targetPort && (() => {
                    const port = targetPorts.find((p: any) => (p.defaultName || p.name) === targetPort);
                    if (!port) return targetPort;
                    return (
                      <div className="flex items-center gap-2 py-1">
                        <StatusDot status={port.status} />
                        <span className="font-medium">
                          {port.name} {port.speed ? `(${port.speed})` : ''}
                        </span>
                      </div>
                    );
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {targetPorts.length > 0 ? (
                  targetPorts.map((port: any) => (
                    <SelectItem 
                      key={port.defaultName || port.name} 
                      value={port.defaultName || port.name}
                      className="h-auto py-2"
                    >
                      {renderPortItem(port, targetDevice?.id || '', true)}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="default">Default Port</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-connection"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!sourcePort || !targetPort}
            data-testid="button-confirm-connection"
          >
            Create Connection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

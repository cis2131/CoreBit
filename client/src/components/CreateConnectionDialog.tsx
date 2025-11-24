import { useState, useEffect } from 'react';
import { Device } from '@shared/schema';
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

interface CreateConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceDevice: Device | null;
  targetDevice: Device | null;
  onConfirm: (sourcePort: string, targetPort: string) => void;
  initialSourcePort?: string;
}

export function CreateConnectionDialog({
  open,
  onOpenChange,
  sourceDevice,
  targetDevice,
  onConfirm,
  initialSourcePort,
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
                      <div className="flex flex-col items-start gap-0.5 py-1">
                        <div className="font-medium">
                          {port.name} {port.speed ? `(${port.speed})` : ''}
                        </div>
                        {port.description && (
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {port.description}
                          </div>
                        )}
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
                      <div className="flex flex-col items-start gap-0.5">
                        <div className="font-medium">
                          {port.name} - {port.status}{port.speed ? ` (${port.speed})` : ''}
                        </div>
                        {port.description && (
                          <div className="text-xs text-muted-foreground">
                            {port.description}
                          </div>
                        )}
                      </div>
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
                      <div className="flex flex-col items-start gap-0.5 py-1">
                        <div className="font-medium">
                          {port.name} {port.speed ? `(${port.speed})` : ''}
                        </div>
                        {port.description && (
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {port.description}
                          </div>
                        )}
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
                      <div className="flex flex-col items-start gap-0.5">
                        <div className="font-medium">
                          {port.name} - {port.status}{port.speed ? ` (${port.speed})` : ''}
                        </div>
                        {port.description && (
                          <div className="text-xs text-muted-foreground">
                            {port.description}
                          </div>
                        )}
                      </div>
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

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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AddDeviceDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (deviceData: {
    name: string;
    type: string;
    ipAddress: string;
    position: { x: number; y: number };
  }) => void;
  initialPosition: { x: number; y: number };
  initialType: string;
  editDevice?: Device | null;
}

const deviceTypes = [
  { value: 'mikrotik_router', label: 'Mikrotik Router' },
  { value: 'mikrotik_switch', label: 'Mikrotik Switch' },
  { value: 'generic_snmp', label: 'Generic SNMP Device' },
  { value: 'server', label: 'Server' },
  { value: 'access_point', label: 'Access Point' },
];

export function AddDeviceDialog({
  open,
  onClose,
  onSubmit,
  initialPosition,
  initialType,
  editDevice,
}: AddDeviceDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState(initialType);
  const [ipAddress, setIpAddress] = useState('');

  useEffect(() => {
    if (editDevice) {
      setName(editDevice.name);
      setType(editDevice.type);
      setIpAddress(editDevice.ipAddress || '');
    } else {
      setName('');
      setType(initialType);
      setIpAddress('');
    }
  }, [editDevice, initialType]);

  const handleSubmit = () => {
    if (name.trim()) {
      onSubmit({
        name: name.trim(),
        type,
        ipAddress: ipAddress.trim(),
        position: editDevice ? editDevice.position : initialPosition,
      });
      setName('');
      setType(initialType);
      setIpAddress('');
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editDevice ? 'Edit Device' : 'Add Device'}</DialogTitle>
          <DialogDescription>
            {editDevice
              ? 'Update device properties'
              : 'Configure the network device properties'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="device-name">Device Name</Label>
            <Input
              id="device-name"
              placeholder="e.g., Main Router"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-device-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="device-type">Device Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="device-type" data-testid="select-device-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {deviceTypes.map(dt => (
                  <SelectItem key={dt.value} value={dt.value}>
                    {dt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="device-ip">IP Address</Label>
            <Input
              id="device-ip"
              placeholder="e.g., 192.168.1.1"
              value={ipAddress}
              onChange={(e) => setIpAddress(e.target.value)}
              data-testid="input-device-ip"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-device">
            Cancel
          </Button>
          <Button onClick={handleSubmit} data-testid="button-submit-device">
            {editDevice ? 'Update' : 'Add'} Device
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

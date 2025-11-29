import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Device, type CredentialProfile } from '@shared/schema';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';

interface AddDeviceDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (deviceData: {
    name: string;
    type: string;
    ipAddress: string;
    position: { x: number; y: number };
    credentialProfileId?: string;
    customCredentials?: any;
  }) => void;
  onDelete?: (deviceId: string) => void;
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
  onDelete,
  initialPosition,
  initialType,
  editDevice,
}: AddDeviceDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState(initialType);
  const [ipAddress, setIpAddress] = useState('');
  const [credMode, setCredMode] = useState<'profile' | 'custom' | 'none'>('none');
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  
  // Custom Mikrotik credentials
  const [mikrotikUsername, setMikrotikUsername] = useState('');
  const [mikrotikPassword, setMikrotikPassword] = useState('');
  const [mikrotikPort, setMikrotikPort] = useState('8728');
  
  // Custom SNMP credentials
  const [snmpVersion, setSnmpVersion] = useState<'1' | '2c' | '3'>('2c');
  const [snmpCommunity, setSnmpCommunity] = useState('public');
  const [snmpUsername, setSnmpUsername] = useState('');
  const [snmpAuthProtocol, setSnmpAuthProtocol] = useState<'MD5' | 'SHA'>('MD5');
  const [snmpAuthKey, setSnmpAuthKey] = useState('');
  const [snmpPrivProtocol, setSnmpPrivProtocol] = useState<'DES' | 'AES'>('DES');
  const [snmpPrivKey, setSnmpPrivKey] = useState('');

  const { data: profiles = [] } = useQuery<CredentialProfile[]>({
    queryKey: ['/api/credential-profiles'],
    enabled: open,
  });

  const deviceCategory = type.startsWith('mikrotik') ? 'mikrotik' : 
                        (type === 'generic_snmp' || type === 'server' || type === 'access_point') ? 'snmp' : 
                        'none';

  const availableProfiles = profiles.filter(p => 
    p.type === deviceCategory || deviceCategory === 'none'
  );

  useEffect(() => {
    if (editDevice) {
      setName(editDevice.name);
      setType(editDevice.type);
      setIpAddress(editDevice.ipAddress || '');
      
      if (editDevice.credentialProfileId) {
        setCredMode('profile');
        setSelectedProfileId(editDevice.credentialProfileId);
      } else if (editDevice.customCredentials) {
        setCredMode('custom');
        const creds = editDevice.customCredentials;
        
        if (creds.username) setMikrotikUsername(creds.username);
        if (creds.password) setMikrotikPassword(creds.password);
        if (creds.apiPort) setMikrotikPort(creds.apiPort.toString());
        if (creds.snmpVersion) setSnmpVersion(creds.snmpVersion);
        if (creds.snmpCommunity) setSnmpCommunity(creds.snmpCommunity);
        if (creds.snmpUsername) setSnmpUsername(creds.snmpUsername);
        if (creds.snmpAuthProtocol) setSnmpAuthProtocol(creds.snmpAuthProtocol);
        if (creds.snmpAuthKey) setSnmpAuthKey(creds.snmpAuthKey);
        if (creds.snmpPrivProtocol) setSnmpPrivProtocol(creds.snmpPrivProtocol);
        if (creds.snmpPrivKey) setSnmpPrivKey(creds.snmpPrivKey);
      } else {
        setCredMode('none');
      }
    } else {
      setName('');
      setType(initialType);
      setIpAddress('');
      setCredMode('none');
      setSelectedProfileId('');
    }
  }, [editDevice, initialType, open]);

  const handleSubmit = () => {
    if (name.trim()) {
      const baseData = {
        name: name.trim(),
        type,
        ipAddress: ipAddress.trim(),
        position: initialPosition,
      };

      let credentialData = {};

      if (credMode === 'profile' && selectedProfileId) {
        credentialData = { credentialProfileId: selectedProfileId };
      } else if (credMode === 'custom') {
        if (deviceCategory === 'mikrotik') {
          credentialData = {
            customCredentials: {
              username: mikrotikUsername,
              password: mikrotikPassword,
              apiPort: parseInt(mikrotikPort) || 8728,
            },
          };
        } else if (deviceCategory === 'snmp') {
          const snmpCreds: any = {
            snmpVersion,
          };
          
          if (snmpVersion === '1' || snmpVersion === '2c') {
            snmpCreds.snmpCommunity = snmpCommunity;
          } else if (snmpVersion === '3') {
            snmpCreds.snmpUsername = snmpUsername;
            snmpCreds.snmpAuthProtocol = snmpAuthProtocol;
            snmpCreds.snmpAuthKey = snmpAuthKey;
            snmpCreds.snmpPrivProtocol = snmpPrivProtocol;
            snmpCreds.snmpPrivKey = snmpPrivKey;
          }
          
          credentialData = { customCredentials: snmpCreds };
        }
      }

      onSubmit({ ...baseData, ...credentialData });
      
      // Reset form
      setName('');
      setType(initialType);
      setIpAddress('');
      setCredMode('none');
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="dialog-add-device">
        <DialogHeader>
          <DialogTitle>{editDevice ? 'Edit Device' : 'Add Device'}</DialogTitle>
          <DialogDescription>
            {editDevice
              ? 'Update device properties and credentials'
              : 'Configure the network device properties and credentials'}
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

          {deviceCategory !== 'none' && (
            <>
              <Separator />
              <div className="space-y-4">
                <Label>Credentials</Label>
                <RadioGroup value={credMode} onValueChange={(v) => setCredMode(v as any)} data-testid="radio-cred-mode">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="none" id="cred-none" data-testid="radio-cred-none" />
                    <Label htmlFor="cred-none" className="font-normal">No credentials (device won't be probed)</Label>
                  </div>
                  {availableProfiles.length > 0 && (
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="profile" id="cred-profile" data-testid="radio-cred-profile" />
                      <Label htmlFor="cred-profile" className="font-normal">Use credential profile</Label>
                    </div>
                  )}
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="custom" id="cred-custom" data-testid="radio-cred-custom" />
                    <Label htmlFor="cred-custom" className="font-normal">Custom credentials</Label>
                  </div>
                </RadioGroup>

                {credMode === 'profile' && (
                  <div className="space-y-2">
                    <Label>Select Profile</Label>
                    <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                      <SelectTrigger data-testid="select-credential-profile">
                        <SelectValue placeholder="Choose a profile" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableProfiles.map(profile => (
                          <SelectItem key={profile.id} value={profile.id}>
                            {profile.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {credMode === 'custom' && deviceCategory === 'mikrotik' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Username</Label>
                      <Input
                        placeholder="admin"
                        value={mikrotikUsername}
                        onChange={(e) => setMikrotikUsername(e.target.value)}
                        autoComplete="off"
                        data-testid="input-custom-username"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Password</Label>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        value={mikrotikPassword}
                        onChange={(e) => setMikrotikPassword(e.target.value)}
                        autoComplete="new-password"
                        data-testid="input-custom-password"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>API Port</Label>
                      <Input
                        type="number"
                        placeholder="8728"
                        value={mikrotikPort}
                        onChange={(e) => setMikrotikPort(e.target.value)}
                        data-testid="input-custom-port"
                      />
                    </div>
                  </div>
                )}

                {credMode === 'custom' && deviceCategory === 'snmp' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>SNMP Version</Label>
                      <Select value={snmpVersion} onValueChange={(v) => setSnmpVersion(v as any)}>
                        <SelectTrigger data-testid="select-snmp-version">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">SNMP v1</SelectItem>
                          <SelectItem value="2c">SNMP v2c</SelectItem>
                          <SelectItem value="3">SNMP v3</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {(snmpVersion === '1' || snmpVersion === '2c') && (
                      <div className="space-y-2">
                        <Label>Community String</Label>
                        <Input
                          placeholder="public"
                          value={snmpCommunity}
                          onChange={(e) => setSnmpCommunity(e.target.value)}
                          data-testid="input-snmp-community"
                        />
                      </div>
                    )}

                    {snmpVersion === '3' && (
                      <>
                        <div className="space-y-2">
                          <Label>Username</Label>
                          <Input
                            placeholder="snmpuser"
                            value={snmpUsername}
                            onChange={(e) => setSnmpUsername(e.target.value)}
                            autoComplete="off"
                            data-testid="input-snmp-username"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Auth Protocol</Label>
                            <Select value={snmpAuthProtocol} onValueChange={(v) => setSnmpAuthProtocol(v as any)}>
                              <SelectTrigger data-testid="select-snmp-auth-protocol">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="MD5">MD5</SelectItem>
                                <SelectItem value="SHA">SHA</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Auth Key</Label>
                            <Input
                              type="password"
                              placeholder="••••••••"
                              value={snmpAuthKey}
                              onChange={(e) => setSnmpAuthKey(e.target.value)}
                              autoComplete="new-password"
                              data-testid="input-snmp-auth-key"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Privacy Protocol</Label>
                            <Select value={snmpPrivProtocol} onValueChange={(v) => setSnmpPrivProtocol(v as any)}>
                              <SelectTrigger data-testid="select-snmp-priv-protocol">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="DES">DES</SelectItem>
                                <SelectItem value="AES">AES</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Privacy Key</Label>
                            <Input
                              type="password"
                              placeholder="••••••••"
                              value={snmpPrivKey}
                              onChange={(e) => setSnmpPrivKey(e.target.value)}
                              autoComplete="new-password"
                              data-testid="input-snmp-priv-key"
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <DialogFooter className="flex items-center justify-between">
          {editDevice && onDelete && (
            <Button 
              variant="destructive" 
              onClick={() => {
                if (confirm('Are you sure you want to delete this device? It will be removed from all maps.')) {
                  onDelete(editDevice.id);
                  onClose();
                }
              }}
              data-testid="button-delete-device-dialog"
            >
              Delete Device
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" onClick={onClose} data-testid="button-cancel-device">
              Cancel
            </Button>
            <Button onClick={handleSubmit} data-testid="button-submit-device">
              {editDevice ? 'Update' : 'Add'} Device
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

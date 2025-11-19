import { useState } from 'react';
import { Device } from '@shared/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Eye, EyeOff, Save, Key } from 'lucide-react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface DeviceCredentialsCardProps {
  device: Device;
}

export function DeviceCredentialsCard({ device }: DeviceCredentialsCardProps) {
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const isMikrotik = device.type.startsWith('mikrotik_');
  const isSnmp = device.type === 'generic_snmp' || device.type === 'server' || device.type === 'access_point';

  // Mikrotik credentials
  const [username, setUsername] = useState(device.credentials?.username || 'admin');
  const [password, setPassword] = useState(device.credentials?.password || '');
  const [apiPort, setApiPort] = useState(device.credentials?.apiPort || 8728);

  // SNMP credentials
  const [snmpVersion, setSnmpVersion] = useState(device.credentials?.snmpVersion || '2c');
  const [snmpCommunity, setSnmpCommunity] = useState(device.credentials?.snmpCommunity || 'public');
  const [snmpUsername, setSnmpUsername] = useState(device.credentials?.snmpUsername || '');
  const [snmpAuthProtocol, setSnmpAuthProtocol] = useState(device.credentials?.snmpAuthProtocol || 'SHA');
  const [snmpAuthKey, setSnmpAuthKey] = useState(device.credentials?.snmpAuthKey || '');
  const [snmpPrivProtocol, setSnmpPrivProtocol] = useState(device.credentials?.snmpPrivProtocol || 'AES');
  const [snmpPrivKey, setSnmpPrivKey] = useState(device.credentials?.snmpPrivKey || '');

  const handleSave = async () => {
    setSaving(true);
    try {
      const credentials: any = {};

      if (isMikrotik) {
        credentials.username = username;
        credentials.password = password;
        credentials.apiPort = apiPort;
      } else if (isSnmp) {
        credentials.snmpVersion = snmpVersion;
        if (snmpVersion === '2c' || snmpVersion === '1') {
          credentials.snmpCommunity = snmpCommunity;
        } else if (snmpVersion === '3') {
          credentials.snmpUsername = snmpUsername;
          credentials.snmpAuthProtocol = snmpAuthProtocol;
          credentials.snmpAuthKey = snmpAuthKey;
          credentials.snmpPrivProtocol = snmpPrivProtocol;
          credentials.snmpPrivKey = snmpPrivKey;
        }
      }

      await apiRequest('PATCH', `/api/devices/${device.id}`, {
        credentials,
      });

      queryClient.invalidateQueries({ queryKey: [`/api/devices?mapId=${device.mapId}`] });
      toast({ title: 'Credentials saved', description: 'Device credentials have been updated.' });
      setEditing(false);
    } catch (error) {
      toast({
        title: 'Failed to save',
        description: 'Could not update device credentials.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const hasCredentials = isMikrotik
    ? !!(device.credentials?.username || device.credentials?.password)
    : !!(device.credentials?.snmpCommunity || device.credentials?.snmpUsername);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Key className="h-4 w-4" />
            Credentials
          </CardTitle>
          {!editing && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(true)}
              data-testid="button-edit-credentials"
            >
              {hasCredentials ? 'Edit' : 'Add'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!editing && !hasCredentials && (
          <p className="text-muted-foreground text-xs">
            No credentials configured. Click "Add" to set up authentication.
          </p>
        )}

        {!editing && hasCredentials && (
          <div className="text-xs text-muted-foreground">
            {isMikrotik && <p>✓ Mikrotik API credentials configured</p>}
            {isSnmp && <p>✓ SNMP credentials configured</p>}
          </div>
        )}

        {editing && isMikrotik && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="username" className="text-xs">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="mt-1"
                data-testid="input-mikrotik-username"
              />
            </div>
            <div>
              <Label htmlFor="password" className="text-xs">Password</Label>
              <div className="relative mt-1">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  data-testid="input-mikrotik-password"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute right-1 top-1 h-7 w-7"
                  onClick={() => setShowPassword(!showPassword)}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div>
              <Label htmlFor="api-port" className="text-xs">API Port</Label>
              <Input
                id="api-port"
                type="number"
                value={apiPort}
                onChange={(e) => setApiPort(parseInt(e.target.value) || 8728)}
                placeholder="8728"
                className="mt-1"
                data-testid="input-api-port"
              />
              <p className="text-xs text-muted-foreground mt-1">Default: 8728 (8729 for TLS)</p>
            </div>
          </div>
        )}

        {editing && isSnmp && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="snmp-version" className="text-xs">SNMP Version</Label>
              <Select value={snmpVersion} onValueChange={(v: any) => setSnmpVersion(v)}>
                <SelectTrigger id="snmp-version" className="mt-1" data-testid="select-snmp-version">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">v1</SelectItem>
                  <SelectItem value="2c">v2c</SelectItem>
                  <SelectItem value="3">v3</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(snmpVersion === '1' || snmpVersion === '2c') && (
              <div>
                <Label htmlFor="community" className="text-xs">Community String</Label>
                <Input
                  id="community"
                  value={snmpCommunity}
                  onChange={(e) => setSnmpCommunity(e.target.value)}
                  placeholder="public"
                  className="mt-1"
                  data-testid="input-snmp-community"
                />
              </div>
            )}

            {snmpVersion === '3' && (
              <>
                <div>
                  <Label htmlFor="snmp-username" className="text-xs">Username</Label>
                  <Input
                    id="snmp-username"
                    value={snmpUsername}
                    onChange={(e) => setSnmpUsername(e.target.value)}
                    placeholder="snmpuser"
                    className="mt-1"
                    data-testid="input-snmpv3-username"
                  />
                </div>
                <div>
                  <Label htmlFor="auth-protocol" className="text-xs">Auth Protocol</Label>
                  <Select value={snmpAuthProtocol} onValueChange={(v: any) => setSnmpAuthProtocol(v)}>
                    <SelectTrigger id="auth-protocol" className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MD5">MD5</SelectItem>
                      <SelectItem value="SHA">SHA</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="auth-key" className="text-xs">Auth Key</Label>
                  <div className="relative mt-1">
                    <Input
                      id="auth-key"
                      type={showPassword ? 'text' : 'password'}
                      value={snmpAuthKey}
                      onChange={(e) => setSnmpAuthKey(e.target.value)}
                      placeholder="Authentication password"
                      data-testid="input-snmpv3-auth-key"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="priv-protocol" className="text-xs">Privacy Protocol</Label>
                  <Select value={snmpPrivProtocol} onValueChange={(v: any) => setSnmpPrivProtocol(v)}>
                    <SelectTrigger id="priv-protocol" className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DES">DES</SelectItem>
                      <SelectItem value="AES">AES</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="priv-key" className="text-xs">Privacy Key</Label>
                  <div className="relative mt-1">
                    <Input
                      id="priv-key"
                      type={showPassword ? 'text' : 'password'}
                      value={snmpPrivKey}
                      onChange={(e) => setSnmpPrivKey(e.target.value)}
                      placeholder="Encryption password"
                      data-testid="input-snmpv3-priv-key"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {editing && (
          <div className="flex gap-2 pt-2">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="flex-1"
              data-testid="button-save-credentials"
            >
              <Save className="h-3 w-3 mr-1" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(false)}
              disabled={saving}
              data-testid="button-cancel-credentials"
            >
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

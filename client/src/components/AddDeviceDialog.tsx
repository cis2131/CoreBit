import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Device, type CredentialProfile, PROMETHEUS_METRIC_PRESETS, type PrometheusMetricConfig } from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';
import { Search, Loader2, Plus, ChevronDown, ChevronUp, ChevronRight, X } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import { Checkbox } from '@/components/ui/checkbox';

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
  { value: 'generic_ping', label: 'Ping Only Device' },
  { value: 'server', label: 'Server' },
  { value: 'access_point', label: 'Access Point' },
  { value: 'proxmox', label: 'Proxmox VE Host' },
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
  
  // Custom Proxmox credentials
  const [proxmoxAuthType, setProxmoxAuthType] = useState<'token' | 'password'>('token');
  const [proxmoxApiTokenId, setProxmoxApiTokenId] = useState('');
  const [proxmoxApiTokenSecret, setProxmoxApiTokenSecret] = useState('');
  const [proxmoxUsername, setProxmoxUsername] = useState('');
  const [proxmoxPassword, setProxmoxPassword] = useState('');
  const [proxmoxRealm, setProxmoxRealm] = useState('pam');
  const [proxmoxPort, setProxmoxPort] = useState('8006');
  
  // Custom Server credentials (can use SNMP or Prometheus)
  const [serverPollingType, setServerPollingType] = useState<'snmp' | 'prometheus'>('prometheus');
  const [prometheusPort, setPrometheusPort] = useState('9100');
  const [prometheusPath, setPrometheusPath] = useState('/metrics');
  const [prometheusMetrics, setPrometheusMetrics] = useState<PrometheusMetricConfig[]>([]);
  
  // Metric discovery state
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [discoveredMetrics, setDiscoveredMetrics] = useState<{
    metrics: string[];
    metricDetails: Record<string, { 
      type?: string; 
      help?: string; 
      sampleCount: number;
      samples?: { labels: Record<string, string>; labelString: string; value: number }[];
    }>;
  } | null>(null);
  const [metricSearch, setMetricSearch] = useState('');
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [expandedMetrics, setExpandedMetrics] = useState<Set<string>>(new Set());
  
  // State for adding a new discovered metric
  const [addingMetric, setAddingMetric] = useState<string | null>(null);
  const [addingLabelString, setAddingLabelString] = useState<string>('');
  const [newMetricLabel, setNewMetricLabel] = useState('');
  const [newMetricDisplayType, setNewMetricDisplayType] = useState<'number' | 'bytes' | 'percentage' | 'bar' | 'text' | 'boolean' | 'rate'>('number');
  const [newMetricUnit, setNewMetricUnit] = useState('');
  
  // State for editing an existing metric
  const [editingMetricId, setEditingMetricId] = useState<string | null>(null);
  const [editMetricLabel, setEditMetricLabel] = useState('');
  const [editMetricDisplayType, setEditMetricDisplayType] = useState<'number' | 'bytes' | 'percentage' | 'bar' | 'text' | 'boolean' | 'rate'>('number');
  const [editMetricUnit, setEditMetricUnit] = useState('');

  const { data: profiles = [] } = useQuery<CredentialProfile[]>({
    queryKey: ['/api/credential-profiles'],
    enabled: open,
  });

  const deviceCategory = type.startsWith('mikrotik') ? 'mikrotik' : 
                        (type === 'generic_snmp' || type === 'access_point') ? 'snmp' : 
                        type === 'server' ? 'server' :
                        type === 'generic_ping' ? 'ping' :
                        type === 'proxmox' ? 'proxmox' :
                        'none';

  // Server devices can use SNMP or Prometheus (node_exporter) profiles
  const availableProfiles = profiles.filter(p => 
    p.type === deviceCategory || 
    deviceCategory === 'none' ||
    (deviceCategory === 'server' && (p.type === 'snmp' || p.type === 'prometheus'))
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
        if (creds.proxmoxApiTokenId) {
          setProxmoxAuthType('token');
          setProxmoxApiTokenId(creds.proxmoxApiTokenId);
          setProxmoxApiTokenSecret(creds.proxmoxApiTokenSecret || '');
        } else if (creds.proxmoxRealm) {
          setProxmoxAuthType('password');
          setProxmoxUsername(creds.username || '');
          setProxmoxPassword(creds.password || '');
          setProxmoxRealm(creds.proxmoxRealm);
        }
        if (creds.proxmoxPort) setProxmoxPort(creds.proxmoxPort.toString());
        // Server/Prometheus credentials
        if (creds.usePrometheus || creds.prometheusPort || creds.prometheusPath) {
          setServerPollingType('prometheus');
          if (creds.prometheusPort) setPrometheusPort(creds.prometheusPort.toString());
          if (creds.prometheusPath) setPrometheusPath(creds.prometheusPath);
          if (creds.prometheusMetrics) setPrometheusMetrics(creds.prometheusMetrics);
        } else if (creds.snmpVersion) {
          setServerPollingType('snmp');
        }
      } else {
        setCredMode('none');
      }
    } else {
      setName('');
      setType(initialType);
      setIpAddress('');
      setCredMode('none');
      setSelectedProfileId('');
      setMikrotikUsername('');
      setMikrotikPassword('');
      setMikrotikPort('8728');
      setSnmpVersion('2c');
      setSnmpCommunity('public');
      setSnmpUsername('');
      setSnmpAuthProtocol('MD5');
      setSnmpAuthKey('');
      setSnmpPrivProtocol('DES');
      setSnmpPrivKey('');
      setProxmoxAuthType('token');
      setProxmoxApiTokenId('');
      setProxmoxApiTokenSecret('');
      setProxmoxUsername('');
      setProxmoxPassword('');
      setProxmoxRealm('pam');
      setProxmoxPort('8006');
      // Server/Prometheus defaults
      setServerPollingType('prometheus');
      setPrometheusPort('9100');
      setPrometheusPath('/metrics');
      setPrometheusMetrics([]);
      // Reset discovery state
      setDiscoveryOpen(false);
      setDiscoveredMetrics(null);
      setMetricSearch('');
      setDiscoveryError(null);
      setAddingMetric(null);
    }
  }, [editDevice, initialType, open]);

  // Discover metrics from a device (for edit mode) or via ad-hoc probe
  const handleDiscoverMetrics = async () => {
    if (!editDevice?.id && !ipAddress.trim()) {
      setDiscoveryError('Please enter an IP address first');
      return;
    }
    
    setIsDiscovering(true);
    setDiscoveryError(null);
    
    try {
      if (editDevice?.id) {
        // Use the existing device endpoint
        const response = await fetch(`/api/devices/${editDevice.id}/prometheus-metrics`);
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to discover metrics');
        }
        const data = await response.json();
        setDiscoveredMetrics(data);
      } else {
        // For new devices, use ad-hoc discovery endpoint
        const response = await fetch('/api/discover-prometheus-metrics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ipAddress: ipAddress.trim(),
            prometheusPort: parseInt(prometheusPort) || 9100,
            prometheusPath: prometheusPath || '/metrics'
          })
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to discover metrics');
        }
        const data = await response.json();
        setDiscoveredMetrics(data);
      }
      setDiscoveryOpen(true);
    } catch (error: any) {
      setDiscoveryError(error.message || 'Failed to discover metrics');
    } finally {
      setIsDiscovering(false);
    }
  };

  // Simple hash function for generating unique IDs
  const simpleHash = (str: string): string => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  };
  
  // Add a discovered metric to the list
  const handleAddDiscoveredMetric = (metricName: string, labelString?: string) => {
    // Full metric query is metricName + labelString (e.g., node_hwmon_temp_celsius{chip="..."})
    const fullMetricQuery = labelString ? `${metricName}${labelString}` : metricName;
    
    // Check if already added (by the full query)
    if (prometheusMetrics.some(m => {
      const existingQuery = m.labelSelector ? `${m.metricName}${m.labelSelector}` : m.metricName;
      return existingQuery === fullMetricQuery;
    })) {
      return; // Already added
    }
    
    // Generate a label from the metric + labels
    let defaultLabel = metricName.replace(/^node_/, '').replace(/_/g, ' ');
    if (labelString) {
      // Extract key values from labelString for display
      const labelParts = labelString.slice(1, -1).match(/([a-zA-Z_:][a-zA-Z0-9_:]*)="([^"]*)"/g);
      if (labelParts && labelParts.length > 0) {
        const labelValues = labelParts.map(p => p.split('=')[1].slice(1, -1)).join(', ');
        defaultLabel += ` (${labelValues})`;
      }
    }
    
    // Generate unique ID using metric name + hash of full query
    const uniqueId = `discovered_${metricName.replace(/[^a-zA-Z0-9]/g, '_')}_${simpleHash(fullMetricQuery)}`;
    
    const newMetric: PrometheusMetricConfig = {
      id: uniqueId,
      label: newMetricLabel || defaultLabel,
      metricName,
      labelSelector: labelString || undefined,
      displayType: newMetricDisplayType,
      unit: newMetricUnit || undefined
    };
    
    setPrometheusMetrics([...prometheusMetrics, newMetric]);
    setAddingMetric(null);
    setAddingLabelString('');
    setNewMetricLabel('');
    setNewMetricDisplayType('number');
    setNewMetricUnit('');
  };

  // Remove a metric from the list
  const handleRemoveMetric = (metricId: string) => {
    setPrometheusMetrics(prometheusMetrics.filter(m => m.id !== metricId));
    if (editingMetricId === metricId) {
      setEditingMetricId(null);
    }
  };
  
  // Start editing a metric
  const handleStartEditMetric = (metric: PrometheusMetricConfig) => {
    setEditingMetricId(metric.id);
    setEditMetricLabel(metric.label);
    // Handle gauge as number for editing purposes
    const displayType = metric.displayType === 'gauge' ? 'number' : (metric.displayType || 'number');
    setEditMetricDisplayType(displayType as 'number' | 'bytes' | 'percentage' | 'bar' | 'text' | 'boolean' | 'rate');
    setEditMetricUnit(metric.unit || '');
  };
  
  // Save edited metric
  const handleSaveEditMetric = () => {
    if (!editingMetricId) return;
    
    setPrometheusMetrics(prometheusMetrics.map(m => 
      m.id === editingMetricId 
        ? { ...m, label: editMetricLabel, displayType: editMetricDisplayType, unit: editMetricUnit || undefined }
        : m
    ));
    setEditingMetricId(null);
  };
  
  // Cancel editing
  const handleCancelEditMetric = () => {
    setEditingMetricId(null);
  };

  const handleSubmit = () => {
    if (name.trim()) {
      const baseData = {
        name: name.trim(),
        type,
        ipAddress: ipAddress.trim(),
        position: initialPosition,
      };

      let credentialData: any = {};

      if (credMode === 'profile' && selectedProfileId) {
        credentialData = { credentialProfileId: selectedProfileId, customCredentials: null };
      } else if (credMode === 'custom') {
        if (deviceCategory === 'mikrotik') {
          credentialData = {
            credentialProfileId: null,
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
          
          credentialData = { credentialProfileId: null, customCredentials: snmpCreds };
        } else if (deviceCategory === 'proxmox') {
          if (proxmoxAuthType === 'token') {
            credentialData = {
              credentialProfileId: null,
              customCredentials: {
                proxmoxApiTokenId,
                proxmoxApiTokenSecret,
                proxmoxPort: parseInt(proxmoxPort) || 8006,
              },
            };
          } else {
            credentialData = {
              credentialProfileId: null,
              customCredentials: {
                username: proxmoxUsername,
                password: proxmoxPassword,
                proxmoxRealm,
                proxmoxPort: parseInt(proxmoxPort) || 8006,
              },
            };
          }
        } else if (deviceCategory === 'server') {
          if (serverPollingType === 'prometheus') {
            credentialData = {
              credentialProfileId: null,
              customCredentials: {
                usePrometheus: true,
                prometheusPort: parseInt(prometheusPort) || 9100,
                prometheusPath: prometheusPath || '/metrics',
                prometheusMetrics: prometheusMetrics.length > 0 ? prometheusMetrics : undefined,
              },
            };
          } else {
            // SNMP polling for server
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
            
            credentialData = { credentialProfileId: null, customCredentials: snmpCreds };
          }
        }
      } else if (credMode === 'none') {
        // Clear both when no credentials are selected
        credentialData = { credentialProfileId: null, customCredentials: null };
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

          {deviceCategory === 'ping' && (
            <div className="text-sm text-muted-foreground p-3 rounded-md bg-muted/50">
              Ping-only devices are monitored using ICMP ping. No credentials required.
            </div>
          )}

          {deviceCategory !== 'none' && deviceCategory !== 'ping' && (
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

                {credMode === 'custom' && deviceCategory === 'proxmox' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Authentication Type</Label>
                      <RadioGroup value={proxmoxAuthType} onValueChange={(v) => setProxmoxAuthType(v as 'token' | 'password')} data-testid="radio-proxmox-auth-type">
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="token" id="proxmox-token" data-testid="radio-proxmox-token" />
                          <Label htmlFor="proxmox-token" className="font-normal">API Token (recommended)</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="password" id="proxmox-password" data-testid="radio-proxmox-password" />
                          <Label htmlFor="proxmox-password" className="font-normal">Username/Password</Label>
                        </div>
                      </RadioGroup>
                    </div>

                    {proxmoxAuthType === 'token' && (
                      <>
                        <div className="space-y-2">
                          <Label>API Token ID</Label>
                          <Input
                            placeholder="user@pam!tokenname"
                            value={proxmoxApiTokenId}
                            onChange={(e) => setProxmoxApiTokenId(e.target.value)}
                            autoComplete="off"
                            data-testid="input-proxmox-token-id"
                          />
                          <p className="text-xs text-muted-foreground">Format: user@realm!tokenname</p>
                        </div>
                        <div className="space-y-2">
                          <Label>API Token Secret</Label>
                          <Input
                            type="password"
                            placeholder="••••••••"
                            value={proxmoxApiTokenSecret}
                            onChange={(e) => setProxmoxApiTokenSecret(e.target.value)}
                            autoComplete="new-password"
                            data-testid="input-proxmox-token-secret"
                          />
                        </div>
                      </>
                    )}

                    {proxmoxAuthType === 'password' && (
                      <>
                        <div className="space-y-2">
                          <Label>Username</Label>
                          <Input
                            placeholder="root"
                            value={proxmoxUsername}
                            onChange={(e) => setProxmoxUsername(e.target.value)}
                            autoComplete="off"
                            data-testid="input-proxmox-username"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Password</Label>
                          <Input
                            type="password"
                            placeholder="••••••••"
                            value={proxmoxPassword}
                            onChange={(e) => setProxmoxPassword(e.target.value)}
                            autoComplete="new-password"
                            data-testid="input-proxmox-password"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Realm</Label>
                          <Select value={proxmoxRealm} onValueChange={setProxmoxRealm}>
                            <SelectTrigger data-testid="select-proxmox-realm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pam">PAM (Linux)</SelectItem>
                              <SelectItem value="pve">PVE (Proxmox)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    )}

                    <div className="space-y-2">
                      <Label>API Port</Label>
                      <Input
                        type="number"
                        placeholder="8006"
                        value={proxmoxPort}
                        onChange={(e) => setProxmoxPort(e.target.value)}
                        data-testid="input-proxmox-port"
                      />
                    </div>
                  </div>
                )}

                {credMode === 'custom' && deviceCategory === 'server' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Polling Method</Label>
                      <RadioGroup value={serverPollingType} onValueChange={(v) => setServerPollingType(v as 'snmp' | 'prometheus')} data-testid="radio-server-polling-type">
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="prometheus" id="server-prometheus" data-testid="radio-server-prometheus" />
                          <Label htmlFor="server-prometheus" className="font-normal">Prometheus (node_exporter)</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="snmp" id="server-snmp" data-testid="radio-server-snmp" />
                          <Label htmlFor="server-snmp" className="font-normal">SNMP</Label>
                        </div>
                      </RadioGroup>
                    </div>

                    {serverPollingType === 'prometheus' && (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Port</Label>
                            <Input
                              type="number"
                              placeholder="9100"
                              value={prometheusPort}
                              onChange={(e) => setPrometheusPort(e.target.value)}
                              data-testid="input-prometheus-port"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Metrics Path</Label>
                            <Input
                              placeholder="/metrics"
                              value={prometheusPath}
                              onChange={(e) => setPrometheusPath(e.target.value)}
                              data-testid="input-prometheus-path"
                            />
                          </div>
                        </div>
                        
                        <div className="space-y-3 p-4 border rounded-md">
                          <h4 className="text-sm font-medium">Extra Metrics to Monitor</h4>
                          <p className="text-xs text-muted-foreground mb-3">
                            Select additional metrics to collect (CPU, Memory, Disk are always collected)
                          </p>
                          
                          <div className="grid grid-cols-2 gap-2">
                            {PROMETHEUS_METRIC_PRESETS.map((preset) => {
                              const isChecked = prometheusMetrics.some(m => m.id === preset.id);
                              return (
                                <div key={preset.id} className="flex items-center space-x-2">
                                  <Checkbox
                                    id={`device-metric-${preset.id}`}
                                    checked={isChecked}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        const clonedPreset = JSON.parse(JSON.stringify(preset));
                                        setPrometheusMetrics([...prometheusMetrics, clonedPreset]);
                                      } else {
                                        setPrometheusMetrics(prometheusMetrics.filter(m => m.id !== preset.id));
                                      }
                                    }}
                                    data-testid={`checkbox-device-metric-${preset.id}`}
                                  />
                                  <label 
                                    htmlFor={`device-metric-${preset.id}`}
                                    className="text-sm cursor-pointer"
                                  >
                                    {preset.label}
                                  </label>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        
                        {/* Metric Discovery Section */}
                        <div className="space-y-3 p-4 border rounded-md">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-medium">Discover Custom Metrics</h4>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleDiscoverMetrics}
                              disabled={isDiscovering}
                              data-testid="button-discover-metrics"
                            >
                              {isDiscovering ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  Discovering...
                                </>
                              ) : (
                                <>
                                  <Search className="w-4 h-4 mr-2" />
                                  Discover Metrics
                                </>
                              )}
                            </Button>
                          </div>
                          
                          {discoveryError && (
                            <p className="text-sm text-destructive">{discoveryError}</p>
                          )}
                          
                          {discoveredMetrics && discoveryOpen && (
                            <Collapsible open={discoveryOpen} onOpenChange={setDiscoveryOpen}>
                              <CollapsibleTrigger asChild>
                                <Button variant="ghost" size="sm" className="w-full justify-between">
                                  <span>{discoveredMetrics.metrics.length} metrics available</span>
                                  {discoveryOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                </Button>
                              </CollapsibleTrigger>
                              <CollapsibleContent className="mt-2">
                                <div className="space-y-2">
                                  <div className="relative">
                                    <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
                                    <Input
                                      placeholder="Search metrics..."
                                      value={metricSearch}
                                      onChange={(e) => setMetricSearch(e.target.value)}
                                      className="pl-8"
                                      data-testid="input-metric-search"
                                    />
                                  </div>
                                  
                                  <ScrollArea className="h-64 border rounded-md p-2">
                                    {discoveredMetrics.metrics
                                      .filter(m => {
                                        const search = metricSearch.toLowerCase();
                                        // Search in metric name
                                        if (m.toLowerCase().includes(search)) return true;
                                        // Also search in sample labels
                                        const details = discoveredMetrics.metricDetails[m];
                                        if (details?.samples) {
                                          return details.samples.some(s => 
                                            s.labelString.toLowerCase().includes(search) ||
                                            Object.values(s.labels).some(v => v.toLowerCase().includes(search))
                                          );
                                        }
                                        return false;
                                      })
                                      .slice(0, 100)
                                      .map(metricName => {
                                        const details = discoveredMetrics.metricDetails[metricName];
                                        const hasSamples = details?.samples && details.samples.length > 1;
                                        const isExpanded = expandedMetrics.has(metricName);
                                        const isConfiguringBase = addingMetric === metricName && addingLabelString === '';
                                        
                                        const toggleExpand = () => {
                                          const newSet = new Set(expandedMetrics);
                                          if (isExpanded) {
                                            newSet.delete(metricName);
                                          } else {
                                            newSet.add(metricName);
                                          }
                                          setExpandedMetrics(newSet);
                                        };
                                        
                                        // Check if metric (without labels) is already added
                                        const isBaseAdded = prometheusMetrics.some(m => m.metricName === metricName && !m.labelSelector);
                                        
                                        return (
                                          <div key={metricName} className="mb-2">
                                            <div className="flex items-start justify-between gap-2 p-2 hover-elevate rounded-md">
                                              <div className="flex-1 min-w-0 overflow-hidden">
                                                <div className="flex items-center gap-1">
                                                  {hasSamples && (
                                                    <Button
                                                      type="button"
                                                      size="sm"
                                                      variant="ghost"
                                                      className="h-5 w-5 p-0"
                                                      onClick={toggleExpand}
                                                    >
                                                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                                    </Button>
                                                  )}
                                                  <p className="text-sm font-mono truncate" title={metricName}>{metricName}</p>
                                                </div>
                                                {details?.help && (
                                                  <p className="text-xs text-muted-foreground line-clamp-2 break-words" title={details.help}>
                                                    {details.help}
                                                  </p>
                                                )}
                                                <div className="flex gap-1 mt-1">
                                                  {details?.type && (
                                                    <Badge variant="secondary" className="text-xs">
                                                      {details.type}
                                                    </Badge>
                                                  )}
                                                  {hasSamples && (
                                                    <Badge 
                                                      variant="outline" 
                                                      className="text-xs cursor-pointer"
                                                      onClick={toggleExpand}
                                                    >
                                                      {details.sampleCount} samples {isExpanded ? '▼' : '▶'}
                                                    </Badge>
                                                  )}
                                                </div>
                                              </div>
                                              <div className="flex-shrink-0">
                                                {!hasSamples && (
                                                  isBaseAdded ? (
                                                    <Badge variant="secondary">Added</Badge>
                                                  ) : isConfiguringBase ? null : (
                                                    <Button
                                                      type="button"
                                                      size="sm"
                                                      variant="ghost"
                                                      onClick={() => {
                                                        setAddingMetric(metricName);
                                                        setAddingLabelString('');
                                                        setNewMetricLabel(metricName.replace(/^node_/, '').replace(/_/g, ' '));
                                                      }}
                                                      data-testid={`button-add-metric-${metricName}`}
                                                    >
                                                      <Plus className="w-4 h-4" />
                                                    </Button>
                                                  )
                                                )}
                                              </div>
                                            </div>
                                            
                                            {/* Show samples when expanded */}
                                            {hasSamples && isExpanded && details.samples && (
                                              <div className="ml-6 mt-1 space-y-1 border-l-2 border-muted pl-2">
                                                {details.samples.map((sample, idx) => {
                                                  const fullQuery = `${metricName}${sample.labelString}`;
                                                  const isSampleAdded = prometheusMetrics.some(m => 
                                                    m.metricName === metricName && m.labelSelector === sample.labelString
                                                  );
                                                  const isConfiguringSample = addingMetric === metricName && addingLabelString === sample.labelString;
                                                  
                                                  // Extract meaningful label values for display
                                                  const labelDisplay = Object.entries(sample.labels)
                                                    .map(([k, v]) => `${k}="${v}"`)
                                                    .join(', ');
                                                  
                                                  return (
                                                    <div key={idx}>
                                                      <div className="flex items-center justify-between gap-2 p-1.5 hover-elevate rounded text-xs">
                                                        <div className="flex-1 min-w-0">
                                                          <code className="text-xs bg-muted px-1 py-0.5 rounded break-all">
                                                            {labelDisplay || '(no labels)'}
                                                          </code>
                                                          <span className="ml-2 text-muted-foreground">
                                                            = {sample.value}
                                                          </span>
                                                        </div>
                                                        <div className="flex-shrink-0">
                                                          {isSampleAdded ? (
                                                            <Badge variant="secondary" className="text-xs">Added</Badge>
                                                          ) : isConfiguringSample ? null : (
                                                            <Button
                                                              type="button"
                                                              size="sm"
                                                              variant="ghost"
                                                              className="h-6 w-6 p-0"
                                                              onClick={() => {
                                                                setAddingMetric(metricName);
                                                                setAddingLabelString(sample.labelString);
                                                                // Generate default label from metric + label values
                                                                const labelVals = Object.values(sample.labels).join(', ');
                                                                const baseName = metricName.replace(/^node_/, '').replace(/_/g, ' ');
                                                                setNewMetricLabel(labelVals ? `${baseName} (${labelVals})` : baseName);
                                                              }}
                                                              data-testid={`button-add-sample-${idx}`}
                                                            >
                                                              <Plus className="w-3 h-3" />
                                                            </Button>
                                                          )}
                                                        </div>
                                                      </div>
                                                      
                                                      {/* Config form for this sample */}
                                                      {isConfiguringSample && (
                                                        <div className="ml-2 mt-2 p-3 border rounded-md space-y-3 bg-muted/50">
                                                          <div className="space-y-2">
                                                            <Label className="text-xs">Display Label</Label>
                                                            <Input
                                                              value={newMetricLabel}
                                                              onChange={(e) => setNewMetricLabel(e.target.value)}
                                                              placeholder="Enter display label"
                                                              data-testid="input-new-metric-label"
                                                            />
                                                          </div>
                                                          <div className="grid grid-cols-2 gap-2">
                                                            <div className="space-y-2">
                                                              <Label className="text-xs">Display Type</Label>
                                                              <Select value={newMetricDisplayType} onValueChange={(v) => setNewMetricDisplayType(v as any)}>
                                                                <SelectTrigger data-testid="select-new-metric-display-type">
                                                                  <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                  <SelectItem value="number">Number</SelectItem>
                                                                  <SelectItem value="bytes">Bytes</SelectItem>
                                                                  <SelectItem value="percentage">Percentage</SelectItem>
                                                                  <SelectItem value="bar">Progress Bar</SelectItem>
                                                                  <SelectItem value="text">Text</SelectItem>
                                                                  <SelectItem value="boolean">Boolean (Yes/No)</SelectItem>
                                                                  <SelectItem value="rate">Rate (/sec)</SelectItem>
                                                                </SelectContent>
                                                              </Select>
                                                            </div>
                                                            <div className="space-y-2">
                                                              <Label className="text-xs">Unit (optional)</Label>
                                                              <Input
                                                                value={newMetricUnit}
                                                                onChange={(e) => setNewMetricUnit(e.target.value)}
                                                                placeholder="e.g., MB, %"
                                                                data-testid="input-new-metric-unit"
                                                              />
                                                            </div>
                                                          </div>
                                                          <div className="flex gap-2">
                                                            <Button
                                                              type="button"
                                                              size="sm"
                                                              onClick={() => handleAddDiscoveredMetric(metricName, sample.labelString)}
                                                              data-testid="button-confirm-add-metric"
                                                            >
                                                              Add Metric
                                                            </Button>
                                                            <Button
                                                              type="button"
                                                              size="sm"
                                                              variant="ghost"
                                                              onClick={() => {
                                                                setAddingMetric(null);
                                                                setAddingLabelString('');
                                                              }}
                                                              data-testid="button-cancel-add-metric"
                                                            >
                                                              Cancel
                                                            </Button>
                                                          </div>
                                                        </div>
                                                      )}
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            )}
                                            
                                            {/* Config form for base metric (no samples) */}
                                            {isConfiguringBase && (
                                              <div className="ml-2 mt-2 p-3 border rounded-md space-y-3 bg-muted/50">
                                                <div className="space-y-2">
                                                  <Label className="text-xs">Display Label</Label>
                                                  <Input
                                                    value={newMetricLabel}
                                                    onChange={(e) => setNewMetricLabel(e.target.value)}
                                                    placeholder="Enter display label"
                                                    data-testid="input-new-metric-label"
                                                  />
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                  <div className="space-y-2">
                                                    <Label className="text-xs">Display Type</Label>
                                                    <Select value={newMetricDisplayType} onValueChange={(v) => setNewMetricDisplayType(v as any)}>
                                                      <SelectTrigger data-testid="select-new-metric-display-type">
                                                        <SelectValue />
                                                      </SelectTrigger>
                                                      <SelectContent>
                                                        <SelectItem value="number">Number</SelectItem>
                                                        <SelectItem value="bytes">Bytes</SelectItem>
                                                        <SelectItem value="percentage">Percentage</SelectItem>
                                                        <SelectItem value="bar">Progress Bar</SelectItem>
                                                        <SelectItem value="text">Text</SelectItem>
                                                        <SelectItem value="boolean">Boolean (Yes/No)</SelectItem>
                                                        <SelectItem value="rate">Rate (/sec)</SelectItem>
                                                      </SelectContent>
                                                    </Select>
                                                  </div>
                                                  <div className="space-y-2">
                                                    <Label className="text-xs">Unit (optional)</Label>
                                                    <Input
                                                      value={newMetricUnit}
                                                      onChange={(e) => setNewMetricUnit(e.target.value)}
                                                      placeholder="e.g., MB, %"
                                                      data-testid="input-new-metric-unit"
                                                    />
                                                  </div>
                                                </div>
                                                <div className="flex gap-2">
                                                  <Button
                                                    type="button"
                                                    size="sm"
                                                    onClick={() => handleAddDiscoveredMetric(metricName)}
                                                    data-testid="button-confirm-add-metric"
                                                  >
                                                    Add Metric
                                                  </Button>
                                                  <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => setAddingMetric(null)}
                                                    data-testid="button-cancel-add-metric"
                                                  >
                                                    Cancel
                                                  </Button>
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                  </ScrollArea>
                                  
                                  {discoveredMetrics.metrics.filter(m => m.toLowerCase().includes(metricSearch.toLowerCase())).length > 100 && (
                                    <p className="text-xs text-muted-foreground text-center">
                                      Showing first 100 matches. Refine your search to see more.
                                    </p>
                                  )}
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          )}
                          
                          {/* Show currently added custom metrics */}
                          {prometheusMetrics.filter(m => !PROMETHEUS_METRIC_PRESETS.some(p => p.id === m.id)).length > 0 && (
                            <div className="mt-3">
                              <h5 className="text-xs font-medium text-muted-foreground mb-2">Custom Metrics Added:</h5>
                              <div className="flex flex-wrap gap-1">
                                {prometheusMetrics
                                  .filter(m => !PROMETHEUS_METRIC_PRESETS.some(p => p.id === m.id))
                                  .map(m => (
                                    <div key={m.id} className="flex items-center gap-0.5">
                                      <Badge 
                                        variant="secondary" 
                                        className="cursor-pointer pr-1"
                                        onClick={() => handleStartEditMetric(m)}
                                        title="Click to edit"
                                        data-testid={`badge-metric-${m.id}`}
                                      >
                                        {m.label}
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          className="h-4 w-4 ml-1 hover:bg-destructive/20"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleRemoveMetric(m.id);
                                          }}
                                          title="Remove"
                                          data-testid={`button-remove-metric-${m.id}`}
                                        >
                                          <X className="h-3 w-3" />
                                        </Button>
                                      </Badge>
                                    </div>
                                  ))
                                }
                              </div>
                              
                              {/* Edit form for selected metric */}
                              {editingMetricId && prometheusMetrics.some(m => m.id === editingMetricId && !PROMETHEUS_METRIC_PRESETS.some(p => p.id === m.id)) && (
                                <div className="mt-3 p-3 border rounded-md space-y-3 bg-muted/50">
                                  <div className="flex items-center justify-between">
                                    <h6 className="text-sm font-medium">Edit Metric</h6>
                                  </div>
                                  <div className="space-y-2">
                                    <Label className="text-xs">Display Label</Label>
                                    <Input
                                      value={editMetricLabel}
                                      onChange={(e) => setEditMetricLabel(e.target.value)}
                                      placeholder="Enter display label"
                                      data-testid="input-edit-metric-label"
                                    />
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-2">
                                      <Label className="text-xs">Display Type</Label>
                                      <Select value={editMetricDisplayType} onValueChange={(v) => setEditMetricDisplayType(v as any)}>
                                        <SelectTrigger data-testid="select-edit-metric-display-type">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="number">Number</SelectItem>
                                          <SelectItem value="bytes">Bytes</SelectItem>
                                          <SelectItem value="percentage">Percentage</SelectItem>
                                          <SelectItem value="bar">Progress Bar</SelectItem>
                                          <SelectItem value="text">Text</SelectItem>
                                          <SelectItem value="boolean">Boolean (Yes/No)</SelectItem>
                                          <SelectItem value="rate">Rate (/sec)</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="space-y-2">
                                      <Label className="text-xs">Unit (optional)</Label>
                                      <Input
                                        value={editMetricUnit}
                                        onChange={(e) => setEditMetricUnit(e.target.value)}
                                        placeholder="e.g., MB, %"
                                        data-testid="input-edit-metric-unit"
                                      />
                                    </div>
                                  </div>
                                  <div className="flex gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      onClick={handleSaveEditMetric}
                                      data-testid="button-save-edit-metric"
                                    >
                                      Save
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      onClick={handleCancelEditMetric}
                                      data-testid="button-cancel-edit-metric"
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {serverPollingType === 'snmp' && (
                      <>
                        <div className="space-y-2">
                          <Label>SNMP Version</Label>
                          <Select value={snmpVersion} onValueChange={(v) => setSnmpVersion(v as any)}>
                            <SelectTrigger data-testid="select-server-snmp-version">
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
                              data-testid="input-server-snmp-community"
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
                                data-testid="input-server-snmp-username"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label>Auth Protocol</Label>
                                <Select value={snmpAuthProtocol} onValueChange={(v) => setSnmpAuthProtocol(v as any)}>
                                  <SelectTrigger data-testid="select-server-snmp-auth-protocol">
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
                                  data-testid="input-server-snmp-auth-key"
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label>Privacy Protocol</Label>
                                <Select value={snmpPrivProtocol} onValueChange={(v) => setSnmpPrivProtocol(v as any)}>
                                  <SelectTrigger data-testid="select-server-snmp-priv-protocol">
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
                                  data-testid="input-server-snmp-priv-key"
                                />
                              </div>
                            </div>
                          </>
                        )}
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

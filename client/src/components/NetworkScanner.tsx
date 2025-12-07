import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Search, Router, Server, Wifi, CheckCircle2, XCircle, Loader2, Save, Trash2 } from "lucide-react";
import type { CredentialProfile, ScanProfile } from "@shared/schema";

interface DeviceFingerprint {
  deviceType: string;
  confidence: 'high' | 'medium' | 'low';
  detectedName?: string;
  detectedModel?: string;
  detectedVia: string;
  sysDescr?: string;
  additionalInfo?: Record<string, any>;
}

interface ScanResult {
  ip: string;
  status: 'success' | 'failed' | 'timeout' | 'pending';
  deviceType?: string;
  deviceData?: any;
  credentialProfileId?: string;
  alreadyExists?: boolean;
  fingerprint?: DeviceFingerprint;
  rtt?: number;
}

interface ScanResponse {
  totalScanned: number;
  discovered: number;
  results: ScanResult[];
}

interface ScanProgress {
  phase: 'ping_sweep' | 'fingerprint';
  completed: number;
  total: number;
  found?: number;
  message?: string;
}

interface NetworkScannerProps {
  open: boolean;
  onClose: () => void;
}

type ProbeType = 'mikrotik' | 'snmp' | 'server' | 'find_all';

export function NetworkScanner({ open, onClose }: NetworkScannerProps) {
  const { toast } = useToast();
  const [ipRange, setIpRange] = useState("192.168.1.0/24");
  const [selectedCredProfiles, setSelectedCredProfiles] = useState<string[]>([]);
  const [probeTypes, setProbeTypes] = useState<ProbeType[]>(['mikrotik', 'snmp']);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [selectedScanProfile, setSelectedScanProfile] = useState<string>("");
  const [saveProfileName, setSaveProfileName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanPhase, setScanPhase] = useState<'idle' | 'ping_sweep' | 'fingerprint'>('idle');
  const [eventSourceRef, setEventSourceRef] = useState<EventSource | null>(null);
  
  // Cleanup EventSource on unmount or dialog close
  useEffect(() => {
    return () => {
      if (eventSourceRef) {
        eventSourceRef.close();
      }
    };
  }, [eventSourceRef]);
  
  // Close EventSource when dialog closes
  useEffect(() => {
    if (!open && eventSourceRef) {
      eventSourceRef.close();
      setEventSourceRef(null);
      setIsScanning(false);
      setScanPhase('idle');
    }
  }, [open, eventSourceRef]);

  const { data: credentialProfiles = [] } = useQuery<CredentialProfile[]>({
    queryKey: ['/api/credential-profiles'],
  });

  const { data: scanProfiles = [] } = useQuery<ScanProfile[]>({
    queryKey: ['/api/scan-profiles'],
  });

  useEffect(() => {
    if (selectedScanProfile && scanProfiles.length > 0) {
      const profile = scanProfiles.find(p => p.id === selectedScanProfile);
      if (profile) {
        setIpRange(profile.ipRange);
        setSelectedCredProfiles(profile.credentialProfileIds);
        setProbeTypes(profile.probeTypes as ProbeType[]);
      }
    }
  }, [selectedScanProfile, scanProfiles]);

  const scanMutation = useMutation({
    mutationFn: async (data: { ipRange: string; credentialProfileIds: string[]; probeTypes: string[] }) => {
      const response = await apiRequest('POST', '/api/network-scan', data);
      return response as ScanResponse;
    },
    onSuccess: (data) => {
      setScanResults(data.results);
      const newDevices = data.results.filter(r => !r.alreadyExists);
      setSelectedResults(new Set(newDevices.map(r => r.ip)));
      toast({
        title: "Scan Complete",
        description: `Found ${data.discovered} devices (${newDevices.length} new)`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Scan Failed",
        description: error.message || "An error occurred during scanning",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsScanning(false);
    },
  });

  const createDevicesMutation = useMutation({
    mutationFn: async (devices: Array<{ name: string; type: string; ipAddress: string; credentialProfileId?: string; deviceData?: any }>) => {
      const response = await apiRequest('POST', '/api/devices/batch', { devices });
      return response;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/devices'] });
      toast({
        title: "Devices Created",
        description: `Successfully created ${data.created} devices`,
      });
      setScanResults([]);
      setSelectedResults(new Set());
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Creation Failed",
        description: error.message || "Failed to create devices",
        variant: "destructive",
      });
    },
  });

  const saveScanProfileMutation = useMutation({
    mutationFn: async (data: { name: string; ipRange: string; credentialProfileIds: string[]; probeTypes: string[] }) => {
      const response = await apiRequest('POST', '/api/scan-profiles', data);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/scan-profiles'] });
      setShowSaveDialog(false);
      setSaveProfileName("");
      toast({
        title: "Profile Saved",
        description: "Scan profile has been saved",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save scan profile",
        variant: "destructive",
      });
    },
  });

  const deleteScanProfileMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/scan-profiles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/scan-profiles'] });
      setSelectedScanProfile("");
      toast({
        title: "Profile Deleted",
        description: "Scan profile has been deleted",
      });
    },
  });

  const isFindAllMode = probeTypes.includes('find_all');

  const handleStartScan = () => {
    // Find All mode doesn't require credentials (uses default SNMP community)
    if (!isFindAllMode && selectedCredProfiles.length === 0) {
      toast({
        title: "No Credentials Selected",
        description: "Please select at least one credential profile",
        variant: "destructive",
      });
      return;
    }
    if (probeTypes.length === 0) {
      toast({
        title: "No Probe Types Selected",
        description: "Please select at least one device type to scan for",
        variant: "destructive",
      });
      return;
    }
    
    setIsScanning(true);
    setScanResults([]);
    setSelectedResults(new Set());
    setScanProgress(null);
    setScanPhase('idle');
    
    // Use streaming for Find All mode
    if (isFindAllMode) {
      handleStreamingScan();
    } else {
      scanMutation.mutate({
        ipRange,
        credentialProfileIds: selectedCredProfiles,
        probeTypes,
      });
    }
  };
  
  const handleStreamingScan = () => {
    // Close any existing connection
    if (eventSourceRef) {
      eventSourceRef.close();
    }
    
    const params = new URLSearchParams({
      ipRange,
      credentialProfileIds: selectedCredProfiles.join(','),
    });
    
    const eventSource = new EventSource(`/api/network-scan-stream?${params}`);
    setEventSourceRef(eventSource);
    
    const cleanup = () => {
      eventSource.close();
      setEventSourceRef(null);
      setIsScanning(false);
      setScanPhase('idle');
    };
    
    eventSource.addEventListener('start', (event) => {
      const data = JSON.parse(event.data);
      setScanPhase(data.phase);
      setScanProgress({
        phase: data.phase,
        completed: 0,
        total: data.totalIPs,
        message: data.message,
      });
    });
    
    eventSource.addEventListener('ping_found', (event) => {
      const data = JSON.parse(event.data);
      // Add device with pending status (awaiting fingerprint)
      setScanResults(prev => [...prev, {
        ip: data.ip,
        status: 'pending',
        rtt: data.rtt,
        alreadyExists: data.alreadyExists,
      }]);
    });
    
    eventSource.addEventListener('progress', (event) => {
      const data = JSON.parse(event.data);
      setScanProgress({
        phase: data.phase,
        completed: data.completed,
        total: data.total,
        found: data.found,
      });
    });
    
    eventSource.addEventListener('phase_complete', (event) => {
      const data = JSON.parse(event.data);
      if (data.phase === 'ping_sweep') {
        setScanPhase('fingerprint');
        setScanProgress({
          phase: 'fingerprint',
          completed: 0,
          total: data.found,
          message: data.message,
        });
      }
    });
    
    eventSource.addEventListener('fingerprint_result', (event) => {
      const data = JSON.parse(event.data);
      // Update device with fingerprint result
      setScanResults(prev => prev.map(r => 
        r.ip === data.ip 
          ? {
              ...r,
              status: 'success' as const,
              deviceType: data.deviceType,
              deviceData: data.deviceData,
              fingerprint: data.fingerprint,
              credentialProfileId: data.credentialProfileId,
            }
          : r
      ));
      setScanProgress({
        phase: 'fingerprint',
        completed: data.completed,
        total: data.total,
      });
    });
    
    eventSource.addEventListener('complete', (event) => {
      const data = JSON.parse(event.data);
      cleanup();
      
      // Auto-select new devices
      setScanResults(prev => {
        const newDevices = prev.filter(r => !r.alreadyExists);
        setSelectedResults(new Set(newDevices.map(r => r.ip)));
        return prev;
      });
      
      toast({
        title: "Scan Complete",
        description: `Found ${data.discovered} devices`,
      });
    });
    
    eventSource.addEventListener('error', (event: Event) => {
      const messageEvent = event as MessageEvent;
      let errorMessage = 'Scan failed or connection lost';
      try {
        if (messageEvent.data) {
          const data = JSON.parse(messageEvent.data);
          errorMessage = data.message || errorMessage;
        }
      } catch (e) {
        // Ignore parse errors - may be a connection error
      }
      cleanup();
      toast({
        title: "Scan Failed",
        description: errorMessage,
        variant: "destructive",
      });
    });
    
    // Also handle the onerror for connection issues
    eventSource.onerror = () => {
      if (eventSource.readyState === EventSource.CLOSED) {
        cleanup();
        toast({
          title: "Scan Failed",
          description: "Connection to server lost",
          variant: "destructive",
        });
      }
    };
  };

  const handleCreateDevices = () => {
    const selectedDevices = scanResults
      .filter(r => selectedResults.has(r.ip) && !r.alreadyExists)
      .map(r => ({
        name: r.deviceData?.systemIdentity || r.deviceData?.model || `Device-${r.ip}`,
        type: r.deviceType || 'generic_snmp',
        ipAddress: r.ip,
        credentialProfileId: r.credentialProfileId,
        deviceData: r.deviceData,
      }));
    
    if (selectedDevices.length === 0) {
      toast({
        title: "No Devices Selected",
        description: "Please select at least one new device to add",
        variant: "destructive",
      });
      return;
    }
    
    createDevicesMutation.mutate(selectedDevices);
  };

  const handleSaveProfile = () => {
    if (!saveProfileName.trim()) {
      toast({
        title: "Name Required",
        description: "Please enter a name for the scan profile",
        variant: "destructive",
      });
      return;
    }
    saveScanProfileMutation.mutate({
      name: saveProfileName.trim(),
      ipRange,
      credentialProfileIds: selectedCredProfiles,
      probeTypes,
    });
  };

  const toggleCredProfile = (id: string) => {
    setSelectedCredProfiles(prev => 
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const toggleProbeType = (type: ProbeType) => {
    setProbeTypes(prev => 
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const toggleSelectAll = () => {
    const newDevices = scanResults.filter(r => !r.alreadyExists);
    if (selectedResults.size === newDevices.length) {
      setSelectedResults(new Set());
    } else {
      setSelectedResults(new Set(newDevices.map(r => r.ip)));
    }
  };

  const getDeviceTypeLabel = (type?: string) => {
    switch (type) {
      case 'mikrotik_router': return 'Mikrotik Router';
      case 'mikrotik_switch': return 'Mikrotik Switch';
      case 'generic_snmp': return 'SNMP Device';
      case 'generic_ssh': return 'SSH Device';
      case 'generic_http': return 'HTTP Device';
      case 'server': return 'Server';
      case 'generic_ping': return 'Ping Only';
      case 'linux_server': return 'Linux Server';
      case 'windows_server': return 'Windows Server';
      case 'vmware_esxi': return 'VMware ESXi';
      case 'proxmox': return 'Proxmox';
      case 'synology': return 'Synology NAS';
      case 'qnap': return 'QNAP NAS';
      case 'ubiquiti': return 'Ubiquiti Device';
      case 'cisco': return 'Cisco Device';
      case 'hp_switch': return 'HP Switch';
      case 'printer': return 'Printer';
      case 'freebsd': return 'FreeBSD Server';
      case 'openbsd': return 'OpenBSD Server';
      case 'fortigate': return 'Fortinet FortiGate';
      case 'pfsense': return 'pfSense Firewall';
      case 'opnsense': return 'OPNsense Firewall';
      case 'unraid': return 'Unraid Server';
      case 'truenas': return 'TrueNAS';
      default: return type || 'Unknown';
    }
  };

  const getDeviceIcon = (type?: string) => {
    switch (type) {
      case 'mikrotik_router':
      case 'mikrotik_switch':
      case 'cisco':
      case 'ubiquiti':
      case 'hp_switch':
      case 'fortigate':
      case 'pfsense':
      case 'opnsense':
        return <Router className="h-4 w-4" />;
      case 'server':
      case 'linux_server':
      case 'windows_server':
      case 'vmware_esxi':
      case 'proxmox':
      case 'freebsd':
      case 'openbsd':
      case 'synology':
      case 'qnap':
      case 'unraid':
      case 'truenas':
      case 'generic_ssh':
        return <Server className="h-4 w-4" />;
      default:
        return <Wifi className="h-4 w-4" />;
    }
  };

  const newDevicesCount = scanResults.filter(r => !r.alreadyExists).length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Network Scanner
          </DialogTitle>
          <DialogDescription>
            Scan your network to discover devices automatically
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-medium">Scan Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <Label htmlFor="scan-profile" className="text-xs">Load Profile</Label>
                  <Select value={selectedScanProfile} onValueChange={setSelectedScanProfile}>
                    <SelectTrigger id="scan-profile" data-testid="select-scan-profile">
                      <SelectValue placeholder="Select saved profile..." />
                    </SelectTrigger>
                    <SelectContent>
                      {scanProfiles.map(profile => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedScanProfile && (
                  <Button 
                    variant="ghost" 
                    size="icon"
                    onClick={() => deleteScanProfileMutation.mutate(selectedScanProfile)}
                    data-testid="button-delete-profile"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowSaveDialog(true)}
                  data-testid="button-save-profile"
                >
                  <Save className="h-4 w-4 mr-1" />
                  Save
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="ip-range" className="text-xs">IP Range (CIDR or Range)</Label>
                  <Input
                    id="ip-range"
                    value={ipRange}
                    onChange={(e) => setIpRange(e.target.value)}
                    placeholder="192.168.1.0/24 or 10.0.0.1-10.0.0.254"
                    data-testid="input-ip-range"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Examples: 192.168.1.0/24, 10.0.0.1-10.0.0.100
                  </p>
                </div>

                <div>
                  <Label className="text-xs">Scan Mode</Label>
                  <div className="space-y-2 mt-2">
                    <div className="flex items-center gap-2 p-2 rounded-md border border-primary/30 bg-primary/5">
                      <Checkbox
                        id="probe-find-all"
                        checked={probeTypes.includes('find_all')}
                        onCheckedChange={() => {
                          if (probeTypes.includes('find_all')) {
                            setProbeTypes(probeTypes.filter(t => t !== 'find_all'));
                          } else {
                            setProbeTypes(['find_all']);
                          }
                        }}
                        data-testid="checkbox-probe-find-all"
                      />
                      <Label htmlFor="probe-find-all" className="text-sm cursor-pointer font-medium">
                        Find All Devices
                        <span className="text-xs text-muted-foreground block">
                          Auto-detect Linux, Windows, VMware, Proxmox, NAS, and more
                        </span>
                      </Label>
                    </div>
                    {!isFindAllMode && (
                      <div className="flex gap-4">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="probe-mikrotik"
                            checked={probeTypes.includes('mikrotik')}
                            onCheckedChange={() => toggleProbeType('mikrotik')}
                            data-testid="checkbox-probe-mikrotik"
                          />
                          <Label htmlFor="probe-mikrotik" className="text-sm cursor-pointer">
                            Mikrotik
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="probe-snmp"
                            checked={probeTypes.includes('snmp')}
                            onCheckedChange={() => toggleProbeType('snmp')}
                            data-testid="checkbox-probe-snmp"
                          />
                          <Label htmlFor="probe-snmp" className="text-sm cursor-pointer">
                            SNMP
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="probe-server"
                            checked={probeTypes.includes('server')}
                            onCheckedChange={() => toggleProbeType('server')}
                            data-testid="checkbox-probe-server"
                          />
                          <Label htmlFor="probe-server" className="text-sm cursor-pointer">
                            Servers
                          </Label>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs">
                  Credential Profiles
                  {isFindAllMode && (
                    <span className="text-muted-foreground ml-1">(optional - uses default SNMP community)</span>
                  )}
                </Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {credentialProfiles.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {isFindAllMode 
                        ? "No credential profiles found. Find All will use default 'public' SNMP community."
                        : "No credential profiles found. Create one in Settings first."}
                    </p>
                  ) : (
                    credentialProfiles.map(profile => (
                      <div key={profile.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`cred-${profile.id}`}
                          checked={selectedCredProfiles.includes(profile.id)}
                          onCheckedChange={() => toggleCredProfile(profile.id)}
                          data-testid={`checkbox-cred-${profile.id}`}
                        />
                        <Label 
                          htmlFor={`cred-${profile.id}`} 
                          className="text-sm cursor-pointer flex items-center gap-1"
                        >
                          <Badge variant="outline" className="text-xs">
                            {profile.type}
                          </Badge>
                          {profile.name}
                        </Label>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {isScanning && (
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {scanPhase === 'ping_sweep' && 'Phase 1: Ping Sweep'}
                      {scanPhase === 'fingerprint' && 'Phase 2: Fingerprinting'}
                      {scanPhase === 'idle' && 'Scanning network...'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {scanProgress?.message || (
                        scanProgress 
                          ? `${scanProgress.completed}/${scanProgress.total} ${scanProgress.phase === 'ping_sweep' ? 'IPs checked' : 'devices identified'}${scanProgress.found !== undefined ? ` (${scanProgress.found} found)` : ''}`
                          : 'This may take a few minutes'
                      )}
                    </p>
                  </div>
                  {scanResults.length > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {scanResults.length} found
                    </Badge>
                  )}
                </div>
                <Progress 
                  className="mt-2" 
                  value={scanProgress ? (scanProgress.completed / scanProgress.total) * 100 : undefined} 
                />
              </CardContent>
            </Card>
          )}

          {scanResults.length > 0 && (
            <Card className="flex-1 flex flex-col overflow-hidden">
              <CardHeader className="py-3 flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-sm font-medium">
                    Discovered Devices ({scanResults.length})
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {newDevicesCount} new, {scanResults.length - newDevicesCount} already exist
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="select-all"
                    checked={selectedResults.size === newDevicesCount && newDevicesCount > 0}
                    onCheckedChange={toggleSelectAll}
                    data-testid="checkbox-select-all"
                  />
                  <Label htmlFor="select-all" className="text-sm cursor-pointer">
                    Select All New
                  </Label>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-0">
                <ScrollArea className="h-[250px]">
                  <div className="space-y-1 p-4">
                    {scanResults.map((result) => (
                      <div 
                        key={result.ip}
                        className={`flex items-center gap-3 p-2 rounded-md ${
                          result.alreadyExists 
                            ? 'bg-muted/50 opacity-60' 
                            : result.status === 'pending'
                              ? 'bg-muted/30 border border-muted'
                              : selectedResults.has(result.ip) 
                                ? 'bg-primary/10 border border-primary/20' 
                                : 'hover-elevate'
                        }`}
                        data-testid={`scan-result-${result.ip}`}
                      >
                        {result.status === 'pending' ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : !result.alreadyExists ? (
                          <Checkbox
                            checked={selectedResults.has(result.ip)}
                            onCheckedChange={() => {
                              const newSelected = new Set(selectedResults);
                              if (newSelected.has(result.ip)) {
                                newSelected.delete(result.ip);
                              } else {
                                newSelected.add(result.ip);
                              }
                              setSelectedResults(newSelected);
                            }}
                            data-testid={`checkbox-result-${result.ip}`}
                          />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                        )}
                        <div className="flex items-center gap-2 text-muted-foreground">
                          {result.status === 'pending' ? (
                            <Wifi className="h-4 w-4" />
                          ) : (
                            getDeviceIcon(result.deviceType)
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {result.status === 'pending' 
                              ? result.ip 
                              : (result.deviceData?.systemIdentity || result.deviceData?.model || result.ip)
                            }
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {result.status === 'pending' 
                              ? `${result.ip} • Identifying...${result.rtt ? ` (${result.rtt.toFixed(1)}ms)` : ''}`
                              : `${result.ip} • ${getDeviceTypeLabel(result.deviceType)}`
                            }
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {result.status === 'pending' && (
                            <Badge variant="outline" className="text-xs">
                              Ping OK
                            </Badge>
                          )}
                          {result.fingerprint && (
                            <Badge 
                              variant={result.fingerprint.confidence === 'high' ? 'default' : 'secondary'} 
                              className="text-xs"
                            >
                              {result.fingerprint.detectedVia}
                            </Badge>
                          )}
                          {result.deviceData?.version && !result.fingerprint && result.status !== 'pending' && (
                            <Badge variant="secondary" className="text-xs">
                              {result.deviceData.version}
                            </Badge>
                          )}
                          {result.alreadyExists && (
                            <Badge variant="outline" className="text-xs">
                              Exists
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button 
            variant="outline" 
            onClick={onClose}
            data-testid="button-cancel-scan"
          >
            Cancel
          </Button>
          {scanResults.length > 0 ? (
            <Button
              onClick={handleCreateDevices}
              disabled={selectedResults.size === 0 || createDevicesMutation.isPending}
              data-testid="button-create-devices"
            >
              {createDevicesMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Creating...
                </>
              ) : (
                <>Add {selectedResults.size} Device{selectedResults.size !== 1 ? 's' : ''}</>
              )}
            </Button>
          ) : (
            <Button
              onClick={handleStartScan}
              disabled={isScanning || (!isFindAllMode && selectedCredProfiles.length === 0) || probeTypes.length === 0}
              data-testid="button-start-scan"
            >
              {isScanning ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-1" />
                  Start Scan
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Scan Profile</DialogTitle>
            <DialogDescription>
              Save current settings as a reusable scan profile
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="profile-name">Profile Name</Label>
            <Input
              id="profile-name"
              value={saveProfileName}
              onChange={(e) => setSaveProfileName(e.target.value)}
              placeholder="My Network Scan"
              data-testid="input-profile-name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveProfile}
              disabled={saveScanProfileMutation.isPending}
              data-testid="button-confirm-save-profile"
            >
              {saveScanProfileMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Save Profile"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

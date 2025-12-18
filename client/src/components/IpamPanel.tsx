import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { IpamPool, IpamAddress, IpamAddressWithAssignments, IpamAddressAssignment, Device, DeviceInterface, DevicePlacement, Map } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Network, 
  ChevronDown, 
  ChevronRight, 
  Plus, 
  Trash2, 
  RefreshCw,
  Globe,
  Loader2,
  Edit,
  MoreVertical,
  MapPin,
  Search,
  FileText
} from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface IpamPanelProps {
  isCollapsed?: boolean;
  onNavigateToDevice?: (deviceId: string, mapId: string) => void;
}

interface PoolStats {
  poolId: string | null;
  total: number;
  assigned: number;
  available: number;
  reserved: number;
}

const statusColors: Record<string, string> = {
  available: 'bg-green-500',
  assigned: 'bg-blue-500',
  reserved: 'bg-yellow-500',
  offline: 'bg-red-500',
};

const statusLabels: Record<string, string> = {
  available: 'Available',
  assigned: 'Assigned',
  reserved: 'Reserved',
  offline: 'Offline',
};

function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return 0;
  return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

export function IpamPanel({ isCollapsed = false, onNavigateToDevice }: IpamPanelProps) {
  const { toast } = useToast();
  const { canModify } = useAuth();
  const [isExpanded, setIsExpanded] = useState(false);
  const [addPoolOpen, setAddPoolOpen] = useState(false);
  const [editPoolOpen, setEditPoolOpen] = useState(false);
  const [selectedPool, setSelectedPool] = useState<IpamPool | null>(null);
  const [viewAddressesPool, setViewAddressesPool] = useState<IpamPool | 'unassigned' | null>(null);
  const [addressStatusFilter, setAddressStatusFilter] = useState<string>('all');
  const [addressSearchQuery, setAddressSearchQuery] = useState('');
  const [editNotesOpen, setEditNotesOpen] = useState(false);
  const [editNotesAddress, setEditNotesAddress] = useState<IpamAddressWithAssignments | null>(null);
  const [editNotesValue, setEditNotesValue] = useState('');

  // Form state for adding pool
  const [poolName, setPoolName] = useState('');
  const [poolDescription, setPoolDescription] = useState('');
  const [poolEntryType, setPoolEntryType] = useState<'cidr' | 'range' | 'single'>('cidr');
  const [poolCidr, setPoolCidr] = useState('');
  const [poolRangeStart, setPoolRangeStart] = useState('');
  const [poolRangeEnd, setPoolRangeEnd] = useState('');
  const [poolVlan, setPoolVlan] = useState('');
  const [poolGateway, setPoolGateway] = useState('');

  // Queries
  const { data: pools = [], isLoading: poolsLoading } = useQuery<IpamPool[]>({
    queryKey: ['/api/ipam/pools'],
  });

  const { data: devices = [] } = useQuery<Device[]>({
    queryKey: ['/api/devices'],
  });

  const { data: interfaces = [] } = useQuery<DeviceInterface[]>({
    queryKey: ['/api/interfaces'],
  });

  const { data: poolStats = [] } = useQuery<PoolStats[]>({
    queryKey: ['/api/ipam/pool-stats'],
  });

  const { data: placements = [] } = useQuery<DevicePlacement[]>({
    queryKey: ['/api/placements/all'],
  });

  const { data: maps = [] } = useQuery<Map[]>({
    queryKey: ['/api/maps'],
  });

  const viewAddressesPoolId = viewAddressesPool === 'unassigned' ? 'unassigned' : viewAddressesPool?.id;

  const { data: addresses = [], isLoading: addressesLoading } = useQuery<IpamAddressWithAssignments[]>({
    queryKey: ['/api/ipam/addresses', viewAddressesPoolId, 'withAssignments'],
    queryFn: async () => {
      if (!viewAddressesPool) return [];
      const poolId = viewAddressesPool === 'unassigned' ? 'unassigned' : viewAddressesPool.id;
      const res = await fetch(`/api/ipam/addresses?poolId=${poolId}&withAssignments=true`);
      if (!res.ok) throw new Error('Failed to fetch addresses');
      return res.json();
    },
    enabled: !!viewAddressesPool,
  });

  // Mutations
  const createPoolMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      entryType: 'cidr' | 'range' | 'single';
      cidr?: string;
      rangeStart?: string;
      rangeEnd?: string;
      vlan?: number;
      gateway?: string;
    }) => apiRequest('POST', '/api/ipam/pools', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ipam/pools'] });
      toast({ description: 'IP pool created' });
      resetPoolForm();
      setAddPoolOpen(false);
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', description: error.message || 'Failed to create pool' });
    },
  });

  const updatePoolMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; description?: string; vlan?: number | null; gateway?: string }) =>
      apiRequest('PATCH', `/api/ipam/pools/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ipam/pools'] });
      toast({ description: 'IP pool updated' });
      setEditPoolOpen(false);
      setSelectedPool(null);
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', description: error.message || 'Failed to update pool' });
    },
  });

  const deletePoolMutation = useMutation({
    mutationFn: async (id: string) => apiRequest('DELETE', `/api/ipam/pools/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ipam/pools'] });
      queryClient.invalidateQueries({ queryKey: ['/api/ipam/addresses'], exact: false });
      toast({ description: 'IP pool deleted' });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', description: error.message || 'Failed to delete pool' });
    },
  });

  const expandPoolMutation = useMutation({
    mutationFn: async (id: string) => apiRequest('POST', `/api/ipam/pools/${id}/expand`, {}),
    onSuccess: (_, poolId) => {
      queryClient.invalidateQueries({ queryKey: ['/api/ipam/pools'] });
      queryClient.invalidateQueries({ queryKey: ['/api/ipam/addresses', poolId] });
      toast({ description: 'Pool expanded to individual addresses' });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', description: error.message || 'Failed to expand pool' });
    },
  });

  const syncDevicesMutation = useMutation({
    mutationFn: async () => apiRequest('POST', '/api/ipam/sync-devices', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ipam/addresses'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/ipam/pools'] });
      toast({ description: 'Device IPs synced to IPAM' });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', description: error.message || 'Failed to sync devices' });
    },
  });

  const updateAddressMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; status?: string; hostname?: string; notes?: string }) =>
      apiRequest('PATCH', `/api/ipam/addresses/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ipam/addresses', viewAddressesPoolId] });
      queryClient.invalidateQueries({ queryKey: ['/api/ipam/pool-stats'] });
      toast({ description: 'Address updated' });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', description: error.message || 'Failed to update address' });
    },
  });

  const deleteAddressMutation = useMutation({
    mutationFn: async (id: string) => apiRequest('DELETE', `/api/ipam/addresses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ipam/addresses', viewAddressesPoolId] });
      queryClient.invalidateQueries({ queryKey: ['/api/ipam/pools'] });
      queryClient.invalidateQueries({ queryKey: ['/api/ipam/pool-stats'] });
      toast({ description: 'Address deleted' });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', description: error.message || 'Failed to delete address' });
    },
  });

  const resetPoolForm = () => {
    setPoolName('');
    setPoolDescription('');
    setPoolEntryType('cidr');
    setPoolCidr('');
    setPoolRangeStart('');
    setPoolRangeEnd('');
    setPoolVlan('');
    setPoolGateway('');
  };

  const handleCreatePool = () => {
    const data: Parameters<typeof createPoolMutation.mutate>[0] = {
      name: poolName,
      description: poolDescription || undefined,
      entryType: poolEntryType,
      vlan: poolVlan ? parseInt(poolVlan, 10) : undefined,
      gateway: poolGateway || undefined,
    };

    if (poolEntryType === 'cidr') {
      data.cidr = poolCidr;
    } else if (poolEntryType === 'range') {
      data.rangeStart = poolRangeStart;
      data.rangeEnd = poolRangeEnd;
    } else {
      data.cidr = poolCidr; // single IP uses cidr field
    }

    createPoolMutation.mutate(data);
  };

  const handleEditPool = () => {
    if (!selectedPool) return;
    updatePoolMutation.mutate({
      id: selectedPool.id,
      name: poolName,
      description: poolDescription || undefined,
      vlan: poolVlan ? parseInt(poolVlan, 10) : null,
      gateway: poolGateway || undefined,
    });
  };

  const openEditPool = (pool: IpamPool) => {
    setSelectedPool(pool);
    setPoolName(pool.name);
    setPoolDescription(pool.description || '');
    setPoolVlan(pool.vlan?.toString() || '');
    setPoolGateway(pool.gateway || '');
    setEditPoolOpen(true);
  };

  const getDeviceInfo = (deviceId: string | null, interfaceId: string | null) => {
    if (!deviceId) return { name: '-', interfaceInfo: null, deviceId: null, mapId: null };
    const device = devices.find(d => d.id === deviceId);
    const deviceName = device?.name || 'Unknown Device';
    
    // Find the first map this device is placed on
    const placement = placements.find(p => p.deviceId === deviceId);
    const mapId = placement?.mapId || null;
    
    if (!interfaceId) return { name: deviceName, interfaceInfo: null, deviceId, mapId };
    
    const iface = interfaces.find(i => i.id === interfaceId);
    if (!iface) return { name: deviceName, interfaceInfo: null, deviceId, mapId };
    
    return { name: deviceName, interfaceInfo: iface.name, deviceId, mapId };
  };

  // Get device info for an assignment from the junction table
  const getAssignmentDeviceInfo = (assignment: IpamAddressAssignment) => {
    const device = devices.find(d => d.id === assignment.deviceId);
    const deviceName = device?.name || 'Unknown Device';
    
    const placement = placements.find(p => p.deviceId === assignment.deviceId);
    const mapId = placement?.mapId || null;
    
    const iface = assignment.interfaceId ? interfaces.find(i => i.id === assignment.interfaceId) : null;
    
    return { 
      name: deviceName, 
      interfaceInfo: iface?.name || null, 
      deviceId: assignment.deviceId, 
      mapId 
    };
  };

  const filteredAddresses = useMemo(() => {
    const searchLower = addressSearchQuery.toLowerCase().trim();
    
    const filtered = addresses.filter(addr => {
      // Status filter
      if (addressStatusFilter !== 'all' && addr.status !== addressStatusFilter) {
        return false;
      }
      
      // Search filter - if no search query, show all
      if (!searchLower) return true;
      
      // Search by IP address
      if (addr.ipAddress.toLowerCase().includes(searchLower)) return true;
      
      // Search by hostname
      if (addr.hostname?.toLowerCase().includes(searchLower)) return true;
      
      // Search by notes
      if (addr.notes?.toLowerCase().includes(searchLower)) return true;
      
      // Search by device name (via assignments)
      const assignmentsList = addr.assignments && addr.assignments.length > 0 
        ? addr.assignments 
        : (addr.assignedDeviceId ? [{ deviceId: addr.assignedDeviceId }] : []);
      
      for (const assignment of assignmentsList) {
        const device = devices.find(d => d.id === assignment.deviceId);
        if (device?.name?.toLowerCase().includes(searchLower)) return true;
      }
      
      return false;
    });
    
    return filtered.sort((a, b) => ipToNumber(a.ipAddress) - ipToNumber(b.ipAddress));
  }, [addresses, addressStatusFilter, addressSearchQuery, devices]);

  const getPoolTypeLabel = (pool: IpamPool) => {
    if (pool.entryType === 'cidr') return pool.cidr || 'CIDR';
    if (pool.entryType === 'range') return `${pool.rangeStart} - ${pool.rangeEnd}`;
    return pool.cidr || 'Single';
  };

  const getPoolStats = (poolId: string | null): PoolStats | undefined => {
    return poolStats.find(s => s.poolId === poolId);
  };

  const unassignedStats = getPoolStats(null);

  if (isCollapsed) {
    return (
      <div className="flex items-center justify-center py-2 border-b border-border">
        <div className="relative">
          <Network className="h-4 w-4 text-muted-foreground" />
          {pools.length > 0 && (
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-blue-500 text-[8px] text-white flex items-center justify-center">
              {pools.length}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded} className="border-b border-border">
        <CollapsibleTrigger asChild>
          <div
            className="flex items-center justify-between px-4 py-2 cursor-pointer hover-elevate"
            data-testid="button-expand-ipam"
          >
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">IP Addresses</span>
              {pools.length > 0 && (
                <Badge variant="secondary" className="text-xs h-5 px-1.5">
                  {pools.length}
                </Badge>
              )}
            </div>
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-2 pb-2 space-y-2">
            {canModify && (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs h-7"
                  onClick={() => setAddPoolOpen(true)}
                  data-testid="button-add-pool"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Pool
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7"
                  onClick={() => syncDevicesMutation.mutate()}
                  disabled={syncDevicesMutation.isPending}
                  data-testid="button-sync-devices"
                >
                  {syncDevicesMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                </Button>
              </div>
            )}

            {poolsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-1">
                {/* Unassigned IPs entry */}
                {unassignedStats && unassignedStats.total > 0 && (
                  <div
                    className="p-2 rounded-md border border-dashed border-border hover-elevate cursor-pointer"
                    onClick={() => setViewAddressesPool('unassigned')}
                    data-testid="pool-item-unassigned"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          Unassigned
                        </p>
                        <p className="text-xs text-muted-foreground">
                          IPs not in any pool
                        </p>
                        <div className="flex gap-2 mt-1">
                          <Badge variant="secondary" className="text-[10px] h-4">
                            {unassignedStats.total} total
                          </Badge>
                          {unassignedStats.assigned > 0 && (
                            <Badge variant="secondary" className="text-[10px] h-4 bg-blue-500/20">
                              {unassignedStats.assigned} assigned
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {pools.length === 0 && (!unassignedStats || unassignedStats.total === 0) ? (
                  <p className="text-xs text-muted-foreground text-center py-3">
                    No IP pools defined
                  </p>
                ) : (
                  pools.map((pool) => {
                    const stats = getPoolStats(pool.id);
                    return (
                      <div
                        key={pool.id}
                        className="p-2 rounded-md border border-border hover-elevate cursor-pointer"
                        onClick={() => setViewAddressesPool(pool)}
                        data-testid={`pool-item-${pool.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {pool.name}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {getPoolTypeLabel(pool)}
                            </p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {pool.vlan && (
                                <Badge variant="secondary" className="text-[10px] h-4">
                                  VLAN {pool.vlan}
                                </Badge>
                              )}
                              {stats && stats.total > 0 && (
                                <>
                                  <Badge variant="secondary" className="text-[10px] h-4">
                                    {stats.total} IPs
                                  </Badge>
                                  {stats.assigned > 0 && (
                                    <Badge variant="secondary" className="text-[10px] h-4 bg-blue-500/20">
                                      {stats.assigned} used
                                    </Badge>
                                  )}
                                  {stats.available > 0 && (
                                    <Badge variant="secondary" className="text-[10px] h-4 bg-green-500/20">
                                      {stats.available} free
                                    </Badge>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                          {canModify && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  onClick={(e) => e.stopPropagation()}
                                  data-testid={`button-pool-menu-${pool.id}`}
                                >
                                  <MoreVertical className="h-3 w-3" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditPool(pool);
                                  }}
                                  data-testid={`menu-edit-pool-${pool.id}`}
                                >
                                  <Edit className="h-3 w-3 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    expandPoolMutation.mutate(pool.id);
                                  }}
                                  disabled={expandPoolMutation.isPending}
                                  data-testid={`menu-expand-pool-${pool.id}`}
                                >
                                  <Globe className="h-3 w-3 mr-2" />
                                  Expand to IPs
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deletePoolMutation.mutate(pool.id);
                                  }}
                                  className="text-destructive"
                                  data-testid={`menu-delete-pool-${pool.id}`}
                                >
                                  <Trash2 className="h-3 w-3 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Add Pool Dialog */}
      <Dialog open={addPoolOpen} onOpenChange={setAddPoolOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add IP Pool</DialogTitle>
            <DialogDescription>
              Create a new IP address pool to track and manage addresses.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pool-name">Name</Label>
              <Input
                id="pool-name"
                value={poolName}
                onChange={(e) => setPoolName(e.target.value)}
                placeholder="e.g., Office Network"
                data-testid="input-pool-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pool-description">Description</Label>
              <Input
                id="pool-description"
                value={poolDescription}
                onChange={(e) => setPoolDescription(e.target.value)}
                placeholder="Optional description"
                data-testid="input-pool-description"
              />
            </div>
            <div className="space-y-2">
              <Label>Entry Type</Label>
              <Tabs value={poolEntryType} onValueChange={(v) => setPoolEntryType(v as typeof poolEntryType)}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="cidr" data-testid="tab-cidr">CIDR</TabsTrigger>
                  <TabsTrigger value="range" data-testid="tab-range">Range</TabsTrigger>
                  <TabsTrigger value="single" data-testid="tab-single">Single</TabsTrigger>
                </TabsList>
                <TabsContent value="cidr" className="space-y-2 mt-2">
                  <Input
                    value={poolCidr}
                    onChange={(e) => setPoolCidr(e.target.value)}
                    placeholder="e.g., 192.168.1.0/24"
                    data-testid="input-pool-cidr"
                  />
                </TabsContent>
                <TabsContent value="range" className="space-y-2 mt-2">
                  <div className="flex gap-2">
                    <Input
                      value={poolRangeStart}
                      onChange={(e) => setPoolRangeStart(e.target.value)}
                      placeholder="Start IP"
                      data-testid="input-pool-range-start"
                    />
                    <Input
                      value={poolRangeEnd}
                      onChange={(e) => setPoolRangeEnd(e.target.value)}
                      placeholder="End IP"
                      data-testid="input-pool-range-end"
                    />
                  </div>
                </TabsContent>
                <TabsContent value="single" className="space-y-2 mt-2">
                  <Input
                    value={poolCidr}
                    onChange={(e) => setPoolCidr(e.target.value)}
                    placeholder="e.g., 192.168.1.100"
                    data-testid="input-pool-single"
                  />
                </TabsContent>
              </Tabs>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pool-vlan">VLAN (optional)</Label>
                <Input
                  id="pool-vlan"
                  type="number"
                  value={poolVlan}
                  onChange={(e) => setPoolVlan(e.target.value)}
                  placeholder="1-4094"
                  data-testid="input-pool-vlan"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pool-gateway">Gateway (optional)</Label>
                <Input
                  id="pool-gateway"
                  value={poolGateway}
                  onChange={(e) => setPoolGateway(e.target.value)}
                  placeholder="e.g., 192.168.1.1"
                  data-testid="input-pool-gateway"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddPoolOpen(false)} data-testid="button-cancel-pool">
              Cancel
            </Button>
            <Button
              onClick={handleCreatePool}
              disabled={!poolName || createPoolMutation.isPending}
              data-testid="button-save-pool"
            >
              {createPoolMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Create Pool
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Pool Dialog */}
      <Dialog open={editPoolOpen} onOpenChange={setEditPoolOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit IP Pool</DialogTitle>
            <DialogDescription>
              Update pool name, description, and network settings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-pool-name">Name</Label>
              <Input
                id="edit-pool-name"
                value={poolName}
                onChange={(e) => setPoolName(e.target.value)}
                data-testid="input-edit-pool-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-pool-description">Description</Label>
              <Input
                id="edit-pool-description"
                value={poolDescription}
                onChange={(e) => setPoolDescription(e.target.value)}
                data-testid="input-edit-pool-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-pool-vlan">VLAN</Label>
                <Input
                  id="edit-pool-vlan"
                  type="number"
                  value={poolVlan}
                  onChange={(e) => setPoolVlan(e.target.value)}
                  placeholder="1-4094"
                  data-testid="input-edit-pool-vlan"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-pool-gateway">Gateway</Label>
                <Input
                  id="edit-pool-gateway"
                  value={poolGateway}
                  onChange={(e) => setPoolGateway(e.target.value)}
                  data-testid="input-edit-pool-gateway"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPoolOpen(false)} data-testid="button-cancel-edit-pool">
              Cancel
            </Button>
            <Button
              onClick={handleEditPool}
              disabled={!poolName || updatePoolMutation.isPending}
              data-testid="button-update-pool"
            >
              {updatePoolMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Update Pool
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Addresses Dialog */}
      <Dialog open={!!viewAddressesPool} onOpenChange={(open) => {
        if (!open) {
          setViewAddressesPool(null);
          setAddressSearchQuery('');
        }
      }}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Network className="h-5 w-5" />
              {viewAddressesPool === 'unassigned' ? 'Unassigned' : viewAddressesPool?.name} - IP Addresses
            </DialogTitle>
            <DialogDescription>
              {viewAddressesPool === 'unassigned' 
                ? 'IP addresses not assigned to any pool'
                : (viewAddressesPool && getPoolTypeLabel(viewAddressesPool))}
              {viewAddressesPool !== 'unassigned' && viewAddressesPool?.gateway && ` • Gateway: ${viewAddressesPool.gateway}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search IP, hostname, notes, device..."
                  value={addressSearchQuery}
                  onChange={(e) => setAddressSearchQuery(e.target.value)}
                  className="pl-8"
                  data-testid="input-ipam-search"
                />
              </div>
              <Select value={addressStatusFilter} onValueChange={setAddressStatusFilter}>
                <SelectTrigger className="w-40" data-testid="select-address-status-filter">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="assigned">Assigned</SelectItem>
                  <SelectItem value="reserved">Reserved</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                </SelectContent>
              </Select>
              {canModify && viewAddressesPool !== 'unassigned' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => viewAddressesPool && expandPoolMutation.mutate(viewAddressesPool.id)}
                  disabled={expandPoolMutation.isPending}
                  data-testid="button-expand-to-ips"
                >
                  {expandPoolMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Globe className="h-4 w-4 mr-2" />
                  )}
                  Expand to IPs
                </Button>
              )}
            </div>

            <ScrollArea className="h-[400px] border rounded-md">
              {addressesLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredAddresses.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <Globe className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">No addresses in this pool</p>
                  <p className="text-xs">Click "Expand to IPs" to generate addresses</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Device</TableHead>
                      <TableHead>Hostname</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead>Last Seen</TableHead>
                      {canModify && <TableHead className="w-10"></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAddresses.map((addr) => (
                      <TableRow key={addr.id} data-testid={`address-row-${addr.id}`}>
                        <TableCell className="font-mono text-sm">
                          {addr.ipAddress}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className="text-xs"
                          >
                            <div className={`h-2 w-2 rounded-full mr-1.5 ${statusColors[addr.status]}`} />
                            {statusLabels[addr.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {(() => {
                            // Use assignments from junction table if available, fallback to legacy fields
                            const assignmentsList = addr.assignments && addr.assignments.length > 0 
                              ? addr.assignments 
                              : (addr.assignedDeviceId ? [{ deviceId: addr.assignedDeviceId, interfaceId: addr.assignedInterfaceId }] : []);
                            
                            if (assignmentsList.length === 0) {
                              return <div className="text-muted-foreground">-</div>;
                            }
                            
                            return (
                              <div className="space-y-1">
                                {assignmentsList.map((assignment, idx) => {
                                  const info = getAssignmentDeviceInfo(assignment as IpamAddressAssignment);
                                  const canNavigate = info.deviceId && info.mapId && onNavigateToDevice;
                                  return (
                                    <div key={`${assignment.deviceId}-${idx}`}>
                                      {canNavigate ? (
                                        <button
                                          className="text-left text-primary hover:underline flex items-center gap-1"
                                          onClick={() => {
                                            onNavigateToDevice(info.deviceId!, info.mapId!);
                                            setViewAddressesPool(null);
                                          }}
                                          data-testid={`link-device-${info.deviceId}`}
                                        >
                                          <MapPin className="h-3 w-3" />
                                          {info.name}
                                        </button>
                                      ) : (
                                        <div>{info.name}</div>
                                      )}
                                      {info.interfaceInfo && (
                                        <div className="text-xs text-muted-foreground ml-4">{info.interfaceInfo}</div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {addr.hostname || '-'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate" title={addr.notes || ''}>
                          {addr.notes || '-'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {addr.lastSeenAt
                            ? new Date(addr.lastSeenAt).toLocaleString()
                            : '-'}
                        </TableCell>
                        {canModify && (
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon" variant="ghost" className="h-6 w-6">
                                  <MoreVertical className="h-3 w-3" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => {
                                    setEditNotesAddress(addr);
                                    setEditNotesValue(addr.notes || '');
                                    setEditNotesOpen(true);
                                  }}
                                  data-testid={`button-edit-notes-${addr.id}`}
                                >
                                  <FileText className="h-3 w-3 mr-2" />
                                  Edit Notes
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    updateAddressMutation.mutate({
                                      id: addr.id,
                                      status: 'reserved',
                                    })
                                  }
                                >
                                  Mark Reserved
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    updateAddressMutation.mutate({
                                      id: addr.id,
                                      status: 'available',
                                    })
                                  }
                                >
                                  Mark Available
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => deleteAddressMutation.mutate(addr.id)}
                                  className="text-destructive"
                                >
                                  <Trash2 className="h-3 w-3 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Notes Dialog */}
      <Dialog open={editNotesOpen} onOpenChange={(open) => {
        if (!open) {
          setEditNotesOpen(false);
          setEditNotesAddress(null);
          setEditNotesValue('');
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Edit Notes
            </DialogTitle>
            <DialogDescription>
              {editNotesAddress?.ipAddress} - Add or update notes for this IP address
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder="Enter notes for this IP address..."
              value={editNotesValue}
              onChange={(e) => setEditNotesValue(e.target.value)}
              className="min-h-[100px]"
              data-testid="input-edit-notes"
            />
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setEditNotesOpen(false);
                setEditNotesAddress(null);
                setEditNotesValue('');
              }}
              data-testid="button-cancel-edit-notes"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editNotesAddress) {
                  updateAddressMutation.mutate({
                    id: editNotesAddress.id,
                    notes: editNotesValue,
                  });
                  setEditNotesOpen(false);
                  setEditNotesAddress(null);
                  setEditNotesValue('');
                }
              }}
              disabled={updateAddressMutation.isPending}
              data-testid="button-save-notes"
            >
              {updateAddressMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Save Notes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

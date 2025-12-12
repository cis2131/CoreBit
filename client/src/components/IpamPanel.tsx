import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { IpamPool, IpamAddress, Device } from '@shared/schema';
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
  MoreVertical
} from 'lucide-react';
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

export function IpamPanel({ isCollapsed = false }: IpamPanelProps) {
  const { toast } = useToast();
  const { canModify } = useAuth();
  const [isExpanded, setIsExpanded] = useState(false);
  const [addPoolOpen, setAddPoolOpen] = useState(false);
  const [editPoolOpen, setEditPoolOpen] = useState(false);
  const [selectedPool, setSelectedPool] = useState<IpamPool | null>(null);
  const [viewAddressesPool, setViewAddressesPool] = useState<IpamPool | null>(null);
  const [addressStatusFilter, setAddressStatusFilter] = useState<string>('all');

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

  const { data: addresses = [], isLoading: addressesLoading } = useQuery<IpamAddress[]>({
    queryKey: ['/api/ipam/addresses', viewAddressesPool?.id],
    queryFn: async () => {
      if (!viewAddressesPool) return [];
      const res = await fetch(`/api/ipam/addresses?poolId=${viewAddressesPool.id}`);
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
      queryClient.invalidateQueries({ queryKey: ['/api/ipam/addresses', viewAddressesPool?.id] });
      toast({ description: 'Address updated' });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', description: error.message || 'Failed to update address' });
    },
  });

  const deleteAddressMutation = useMutation({
    mutationFn: async (id: string) => apiRequest('DELETE', `/api/ipam/addresses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ipam/addresses', viewAddressesPool?.id] });
      queryClient.invalidateQueries({ queryKey: ['/api/ipam/pools'] });
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

  const getDeviceName = (deviceId: string | null) => {
    if (!deviceId) return '-';
    const device = devices.find(d => d.id === deviceId);
    return device?.name || 'Unknown Device';
  };

  const filteredAddresses = addresses.filter(addr => 
    addressStatusFilter === 'all' || addr.status === addressStatusFilter
  );

  const getPoolTypeLabel = (pool: IpamPool) => {
    if (pool.entryType === 'cidr') return pool.cidr || 'CIDR';
    if (pool.entryType === 'range') return `${pool.rangeStart} - ${pool.rangeEnd}`;
    return pool.cidr || 'Single';
  };

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
            ) : pools.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">
                No IP pools defined
              </p>
            ) : (
              <div className="space-y-1">
                {pools.map((pool) => (
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
                        {pool.vlan && (
                          <Badge variant="secondary" className="text-[10px] mt-1 h-4">
                            VLAN {pool.vlan}
                          </Badge>
                        )}
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
                ))}
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
      <Dialog open={!!viewAddressesPool} onOpenChange={(open) => !open && setViewAddressesPool(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Network className="h-5 w-5" />
              {viewAddressesPool?.name} - IP Addresses
            </DialogTitle>
            <DialogDescription>
              {getPoolTypeLabel(viewAddressesPool!)}
              {viewAddressesPool?.gateway && ` • Gateway: ${viewAddressesPool.gateway}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
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
              {canModify && (
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
                          {getDeviceName(addr.assignedDeviceId)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {addr.hostname || '-'}
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
    </>
  );
}

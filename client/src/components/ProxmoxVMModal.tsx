import { ProxmoxVm, Device } from '@shared/schema';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { Box, Container, Cpu, MemoryStick, HardDrive, Clock, Search, Link2, ExternalLink, X, Server } from 'lucide-react';

interface ProxmoxVMModalProps {
  device: Device | null;
  isOpen: boolean;
  onClose: () => void;
  onDeviceClick?: (deviceId: string) => void;
}

const vmStatusColors = {
  running: 'bg-green-500',
  stopped: 'bg-red-500',
  paused: 'bg-orange-500',
  unknown: 'bg-gray-400',
};

const vmStatusBadgeVariants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  running: 'default',
  stopped: 'destructive',
  paused: 'secondary',
  unknown: 'outline',
};

function formatBytes(bytes: string | null | undefined): string {
  if (!bytes) return '-';
  const num = parseInt(bytes);
  if (isNaN(num)) return '-';
  if (num >= 1024 * 1024 * 1024 * 1024) return `${(num / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
  if (num >= 1024 * 1024 * 1024) return `${(num / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (num >= 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(0)} MB`;
  return `${(num / 1024).toFixed(0)} KB`;
}

function formatUptime(seconds: number | null | undefined): string {
  if (!seconds) return '-';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function ProxmoxVMModal({ device, isOpen, onClose, onDeviceClick }: ProxmoxVMModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const { data: vms = [], isLoading } = useQuery<ProxmoxVm[]>({
    queryKey: ['/api/devices', device?.id, 'proxmox-vms'],
    enabled: !!device?.id && isOpen,
  });

  const filteredVms = useMemo(() => {
    return vms.filter(vm => {
      const matchesSearch = !searchQuery || 
        vm.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        vm.vmid.toString().includes(searchQuery) ||
        (vm.ipAddresses && vm.ipAddresses.some(ip => ip.includes(searchQuery)));
      
      const matchesStatus = !statusFilter || vm.status === statusFilter;
      const matchesType = !typeFilter || vm.vmType === typeFilter;
      
      return matchesSearch && matchesStatus && matchesType;
    });
  }, [vms, searchQuery, statusFilter, typeFilter]);

  const runningCount = vms.filter(vm => vm.status === 'running').length;
  const stoppedCount = vms.filter(vm => vm.status === 'stopped').length;
  const qemuCount = vms.filter(vm => vm.vmType === 'qemu').length;
  const lxcCount = vms.filter(vm => vm.vmType === 'lxc').length;

  if (!device) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col" data-testid="proxmox-vm-modal">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5 text-[#E57000]" />
            {device.name} - Virtual Machines
          </DialogTitle>
          <DialogDescription>
            {vms.length} VMs on {device.ipAddress}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 flex-wrap pb-3 border-b border-border flex-shrink-0">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, ID, or IP..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-vm-search"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={statusFilter === 'running' ? 'default' : 'outline'}
              onClick={() => setStatusFilter(statusFilter === 'running' ? null : 'running')}
              data-testid="button-filter-running"
            >
              <div className="w-2 h-2 rounded-full bg-green-500 mr-1.5" />
              {runningCount}
            </Button>
            <Button
              size="sm"
              variant={statusFilter === 'stopped' ? 'destructive' : 'outline'}
              onClick={() => setStatusFilter(statusFilter === 'stopped' ? null : 'stopped')}
              data-testid="button-filter-stopped"
            >
              <div className="w-2 h-2 rounded-full bg-red-500 mr-1.5" />
              {stoppedCount}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={typeFilter === 'qemu' ? 'secondary' : 'outline'}
              onClick={() => setTypeFilter(typeFilter === 'qemu' ? null : 'qemu')}
              data-testid="button-filter-qemu"
            >
              <Box className="h-3.5 w-3.5 mr-1.5" />
              {qemuCount} VMs
            </Button>
            <Button
              size="sm"
              variant={typeFilter === 'lxc' ? 'secondary' : 'outline'}
              onClick={() => setTypeFilter(typeFilter === 'lxc' ? null : 'lxc')}
              data-testid="button-filter-lxc"
            >
              <Container className="h-3.5 w-3.5 mr-1.5" />
              {lxcCount} LXC
            </Button>
          </div>

          {(statusFilter || typeFilter || searchQuery) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setStatusFilter(null);
                setTypeFilter(null);
                setSearchQuery('');
              }}
              data-testid="button-clear-filters"
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>

        <ScrollArea className="flex-1 min-h-0 overflow-y-auto" style={{ maxHeight: 'calc(85vh - 200px)' }}>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#E57000] border-t-transparent" />
            </div>
          ) : filteredVms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Box className="h-12 w-12 mb-3 opacity-50" />
              <p>No VMs found</p>
              {searchQuery && <p className="text-sm">Try adjusting your search or filters</p>}
            </div>
          ) : (
            <div className="space-y-2 pr-4">
              {filteredVms.map((vm) => (
                <div
                  key={vm.id}
                  className="flex items-center gap-4 p-3 rounded-lg border border-border bg-card hover-elevate"
                  data-testid={`vm-row-${vm.vmid}`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-3 h-3 rounded-full flex-shrink-0 ${vmStatusColors[vm.status as keyof typeof vmStatusColors] || vmStatusColors.unknown}`} />
                    
                    {vm.vmType === 'lxc' ? (
                      <Container className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <Box className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground truncate">{vm.name}</span>
                        <Badge variant="outline" className="text-xs">
                          #{vm.vmid}
                        </Badge>
                        <Badge variant={vmStatusBadgeVariants[vm.status] || 'outline'} className="text-xs capitalize">
                          {vm.status}
                        </Badge>
                      </div>
                      
                      {vm.ipAddresses && vm.ipAddresses.length > 0 && (
                        <div className="flex items-center gap-1 mt-1">
                          {vm.ipAddresses.slice(0, 3).map((ip, idx) => (
                            <span key={idx} className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              {ip}
                            </span>
                          ))}
                          {vm.ipAddresses.length > 3 && (
                            <span className="text-xs text-muted-foreground">
                              +{vm.ipAddresses.length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-sm text-muted-foreground flex-shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1">
                          <Cpu className="h-4 w-4" />
                          <span>{vm.cpuUsage || '-'}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>CPU Cores</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1">
                          <MemoryStick className="h-4 w-4" />
                          <span>{formatBytes(vm.memoryBytes)}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>Memory</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1">
                          <HardDrive className="h-4 w-4" />
                          <span>{formatBytes(vm.diskBytes)}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>Disk Size</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          <span>{formatUptime(vm.uptime)}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>Uptime</TooltipContent>
                    </Tooltip>

                    {vm.matchedDeviceId && onDeviceClick && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              onDeviceClick(vm.matchedDeviceId!);
                              onClose();
                            }}
                            data-testid={`button-goto-device-${vm.vmid}`}
                          >
                            <Link2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Go to linked device</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

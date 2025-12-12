import { Device, ProxmoxVm } from '@shared/schema';
import { Server, Cpu, MemoryStick, Clock, ExternalLink, Bell, BellOff, Users, Box, Container } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useQuery } from '@tanstack/react-query';

interface ProxmoxHostNodeProps {
  device: Device & { position: { x: number; y: number } };
  isSelected: boolean;
  isHighlighted: boolean;
  isOffline: boolean;
  linkedMapId?: string | null;
  linkedMapHasOffline?: boolean;
  hasGlobalNotifications?: boolean;
  isMuted?: boolean;
  onClick: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onMapLinkClick?: (mapId: string) => void;
  onVmClick?: (vm: ProxmoxVm) => void;
}

const statusColors = {
  online: 'bg-green-500',
  warning: 'bg-yellow-500',
  stale: 'bg-orange-500',
  offline: 'bg-red-500',
  unknown: 'bg-gray-400',
};

const vmStatusColors = {
  running: 'bg-green-500',
  stopped: 'bg-red-500',
  paused: 'bg-orange-500',
  unknown: 'bg-gray-400',
};

function parseUptime(uptime: string | undefined): { value: number; unit: string } {
  if (!uptime) return { value: 0, unit: 'h' };

  const mikrotikMatch = uptime.match(/(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (mikrotikMatch) {
    const weeks = parseInt(mikrotikMatch[1] || '0');
    const days = parseInt(mikrotikMatch[2] || '0');
    const hours = parseInt(mikrotikMatch[3] || '0');
    const totalDays = weeks * 7 + days;
    
    if (totalDays >= 1) {
      return { value: totalDays, unit: 'd' };
    } else {
      return { value: hours, unit: 'h' };
    }
  }

  const snmpDaysMatch = uptime.match(/(\d+)\s+days/);
  if (snmpDaysMatch) {
    return { value: parseInt(snmpDaysMatch[1]), unit: 'd' };
  }

  const snmpHoursMatch = uptime.match(/^(\d+):/);
  if (snmpHoursMatch) {
    const hours = parseInt(snmpHoursMatch[1]);
    return { value: hours, unit: 'h' };
  }

  return { value: 0, unit: 'h' };
}

export function ProxmoxHostNode({ 
  device, 
  isSelected, 
  isHighlighted, 
  isOffline, 
  linkedMapId, 
  linkedMapHasOffline, 
  hasGlobalNotifications, 
  isMuted, 
  onClick, 
  onDragStart, 
  onMapLinkClick,
  onVmClick 
}: ProxmoxHostNodeProps) {
  const { data: vms = [], isLoading, isError } = useQuery<ProxmoxVm[]>({
    queryKey: ['/api/devices', device.id, 'proxmox-vms'],
  });

  const uptime = parseUptime(device.deviceData?.uptime);
  
  const runningVms = vms.filter(vm => vm.status === 'running').length;
  const stoppedVms = vms.filter(vm => vm.status === 'stopped').length;
  const pausedVms = vms.filter(vm => vm.status === 'paused').length;
  const totalVms = vms.length;
  
  const displayVms = vms.slice(0, 6);
  const hasMoreVms = vms.length > 6;

  return (
    <div
      className={`absolute cursor-move select-none ${
        isHighlighted || isOffline ? 'animate-pulse' : ''
      }`}
      style={{
        left: `${device.position.x}px`,
        top: `${device.position.y}px`,
        transform: 'translate(-50%, -50%)',
        willChange: 'left, top',
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={onDragStart}
      data-testid={`proxmox-node-${device.id}`}
    >
      <div
        className={`relative rounded-lg border-2 shadow-sm transition-all hover-elevate ${
          isSelected
            ? 'border-primary shadow-lg'
            : isOffline
            ? 'border-red-500 shadow-md'
            : isHighlighted
            ? 'border-yellow-400 shadow-md'
            : 'border-[#E57000] dark:border-[#E57000]'
        }`}
        style={{ 
          width: '380px',
          background: 'linear-gradient(135deg, rgba(229, 112, 0, 0.08) 0%, rgba(229, 112, 0, 0.02) 100%)',
        }}
      >
        <div className="bg-slate-50/95 dark:bg-gray-800/95 rounded-t-md">
          <div
            className={`absolute top-3 right-3 w-3 h-3 rounded-full ${
              statusColors[device.status as keyof typeof statusColors] || statusColors.unknown
            }`}
            data-testid={`status-indicator-${device.status}`}
          />

          {(hasGlobalNotifications || device.useOnDuty || isMuted) && (
            <div className="absolute top-3 right-8">
              {isMuted ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="p-1 rounded bg-orange-100 dark:bg-orange-900/30">
                      <BellOff className="h-3 w-3 text-orange-500" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">Notifications muted</p>
                  </TooltipContent>
                </Tooltip>
              ) : hasGlobalNotifications && device.useOnDuty ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="p-1 rounded bg-blue-100 dark:bg-blue-900/30 flex items-center gap-0.5">
                      <Bell className="h-3 w-3 text-blue-500" />
                      <Users className="h-3 w-3 text-blue-500" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">Global + On-duty notifications</p>
                  </TooltipContent>
                </Tooltip>
              ) : hasGlobalNotifications ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="p-1 rounded bg-blue-100 dark:bg-blue-900/30">
                      <Bell className="h-3 w-3 text-blue-500" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">Global notifications enabled</p>
                  </TooltipContent>
                </Tooltip>
              ) : device.useOnDuty ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="p-1 rounded bg-blue-100 dark:bg-blue-900/30">
                      <Users className="h-3 w-3 text-blue-500" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">On-duty notifications enabled</p>
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          )}

          <div className="p-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex-shrink-0 p-1.5 rounded bg-[#E57000]/10">
                <Server className="h-5 w-5 text-[#E57000]" />
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-foreground truncate" data-testid={`text-device-name-${device.id}`}>
                  {device.name}
                </h3>
                <p className="text-xs text-[#E57000] font-medium">Proxmox VE Host</p>
              </div>

              {linkedMapId && onMapLinkClick && (
                <Button
                  size="icon"
                  variant="ghost"
                  className={`h-7 w-7 flex-shrink-0 ${
                    linkedMapHasOffline 
                      ? 'text-red-500 animate-pulse shadow-[0_0_8px_2px_rgba(239,68,68,0.6)] rounded-md' 
                      : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMapLinkClick(linkedMapId);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title={linkedMapHasOffline ? "Go to linked map (has offline devices)" : "Go to linked map"}
                  data-testid={`button-go-linked-map-${device.id}`}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              )}

              <div className="w-4 flex-shrink-0" />
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
              <div className="flex-1 min-w-0">
                {device.ipAddress && (
                  <p className="text-sm text-muted-foreground font-medium truncate" data-testid={`text-ip-${device.id}`}>
                    {device.ipAddress}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3">
                {device.deviceData?.cpuUsagePct !== undefined && device.deviceData?.memoryUsagePct !== undefined && (
                  <div 
                    className={`flex items-center gap-2 text-xs ${
                      device.status === 'online' ? '' : 'opacity-40'
                    }`} 
                    data-testid={`vitals-${device.id}`}
                  >
                    <div className="flex items-center gap-1">
                      <Cpu className="h-3 w-3 text-muted-foreground" />
                      <span className={`font-bold ${
                        device.status === 'online' ? 'text-foreground' : 'text-muted-foreground'
                      }`}>{device.deviceData.cpuUsagePct}%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <MemoryStick className="h-3 w-3 text-muted-foreground" />
                      <span className={`font-bold ${
                        device.status === 'online' ? 'text-foreground' : 'text-muted-foreground'
                      }`}>{device.deviceData.memoryUsagePct}%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className={`font-bold ${
                        device.status === 'online' ? 'text-foreground' : 'text-muted-foreground'
                      }`}>{uptime.value}{uptime.unit}</span>
                    </div>
                  </div>
                )}

                <div className={`flex items-center gap-2 text-sm font-bold ${
                  device.status === 'online' ? '' : 'opacity-40'
                }`}>
                  {runningVms > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1">
                          <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                          <span className="text-foreground">{runningVms}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="text-xs">{runningVms} running VMs</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {stoppedVms > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1">
                          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                          <span className="text-foreground">{stoppedVms}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="text-xs">{stoppedVms} stopped VMs</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {pausedVms > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1">
                          <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                          <span className="text-foreground">{pausedVms}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="text-xs">{pausedVms} paused VMs</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {(totalVms > 0 || isLoading) && (
          <div className="p-2 bg-slate-100/80 dark:bg-gray-900/80 rounded-b-md border-t border-[#E57000]/20">
            {isLoading ? (
              <div className="flex items-center justify-center py-2">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#E57000] border-t-transparent" />
                <span className="ml-2 text-xs text-muted-foreground">Loading VMs...</span>
              </div>
            ) : isError ? (
              <div className="flex items-center justify-center py-2 text-xs text-muted-foreground">
                Failed to load VMs
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-1.5">
                  {displayVms.map((vm) => (
                    <Tooltip key={vm.id}>
                      <TooltipTrigger asChild>
                        <div 
                          className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-gray-800 rounded border border-slate-200 dark:border-gray-700 cursor-pointer hover-elevate"
                          onClick={(e) => {
                            e.stopPropagation();
                            onVmClick?.(vm);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          data-testid={`vm-item-${vm.id}`}
                        >
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            vmStatusColors[vm.status as keyof typeof vmStatusColors] || vmStatusColors.unknown
                          }`} />
                          {vm.vmType === 'lxc' ? (
                            <Container className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          ) : (
                            <Box className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          )}
                          <span className="text-xs text-foreground truncate flex-1">{vm.name}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <div className="space-y-1">
                          <p className="font-medium">{vm.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {vm.vmType === 'lxc' ? 'Container' : 'VM'} #{vm.vmid} - {vm.status}
                          </p>
                          {vm.cpuUsage && vm.memoryBytes && (
                            <p className="text-xs text-muted-foreground">
                              {vm.cpuUsage} cores, {Math.round(parseInt(vm.memoryBytes) / 1024 / 1024 / 1024)}GB RAM
                            </p>
                          )}
                          {vm.ipAddresses && vm.ipAddresses.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              IP: {vm.ipAddresses[0]}
                            </p>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
                {hasMoreVms && (
                  <div className="text-center mt-1.5">
                    <button
                      className="text-xs text-[#E57000] hover:underline cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        onVmClick?.(vms[0]);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      data-testid={`button-show-more-vms-${device.id}`}
                    >
                      +{vms.length - 6} more VMs
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

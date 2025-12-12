import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Device,
  Connection,
  Map,
  type CredentialProfile,
  type Notification,
  type DeviceNotification,
  type ProxmoxVm,
} from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  X,
  Trash2,
  Edit,
  RefreshCw,
  Key,
  Cpu,
  MemoryStick,
  Bell,
  BellOff,
  Link as LinkIcon,
  Clock,
  AlertTriangle,
  Map as MapIcon,
  Server,
  Container,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { StatusHistoryBar, StatusHistoryModal } from "@/components/StatusHistory";

interface DevicePropertiesPanelProps {
  device: Device & {
    placementId?: string;
    position?: { x: number; y: number };
    placementLinkedMapId?: string | null;
  };
  connections?: Connection[];
  allDevices?: Device[];
  onClose: () => void;
  onDelete: (deviceId: string) => void;
  onEdit: (device: Device) => void;
  onNavigateToDevice?: (deviceId: string) => void;
  onStartConnectionFromPort?: (deviceId: string, portName: string) => void;
  onNavigateToMap?: (mapId: string) => void;
  canModify?: boolean;
  currentMapId?: string | null;
}

const statusLabels = {
  online: { label: "Online", color: "bg-green-500" },
  warning: { label: "Warning", color: "bg-yellow-500" },
  stale: { label: "Stale", color: "bg-orange-500" },
  offline: { label: "Offline", color: "bg-red-500" },
  unknown: { label: "Unknown", color: "bg-gray-400" },
};

function formatLastSeen(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return `${diffSecs} seconds ago`;
  } else if (diffMins < 60) {
    return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  } else {
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  }
}

function formatStatusDuration(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return `for ${diffSecs} second${diffSecs !== 1 ? "s" : ""}`;
  } else if (diffMins < 60) {
    return `for ${diffMins} minute${diffMins !== 1 ? "s" : ""}`;
  } else if (diffHours < 24) {
    const remainingMins = diffMins % 60;
    if (remainingMins > 0) {
      return `for ${diffHours}h ${remainingMins}m`;
    }
    return `for ${diffHours} hour${diffHours !== 1 ? "s" : ""}`;
  } else {
    const remainingHours = diffHours % 24;
    if (remainingHours > 0) {
      return `for ${diffDays}d ${remainingHours}h`;
    }
    return `for ${diffDays} day${diffDays !== 1 ? "s" : ""}`;
  }
}

export function DevicePropertiesPanel({
  device,
  connections = [],
  allDevices = [],
  onClose,
  onDelete,
  onEdit,
  onNavigateToDevice,
  onStartConnectionFromPort,
  onNavigateToMap,
  canModify = true,
  currentMapId,
}: DevicePropertiesPanelProps) {
  const { toast } = useToast();
  const [probing, setProbing] = useState(false);
  const [statusHistoryOpen, setStatusHistoryOpen] = useState(false);
  const [timeoutValue, setTimeoutValue] = useState<string>(
    device.probeTimeout?.toString() ?? "",
  );
  const [thresholdValue, setThresholdValue] = useState<string>(
    device.offlineThreshold?.toString() ?? "",
  );
  const status =
    statusLabels[device.status as keyof typeof statusLabels] ||
    statusLabels.unknown;

  useEffect(() => {
    setTimeoutValue(device.probeTimeout?.toString() ?? "");
    setThresholdValue(device.offlineThreshold?.toString() ?? "");
  }, [device.id, device.probeTimeout, device.offlineThreshold]);

  const { data: maps = [] } = useQuery<Map[]>({
    queryKey: ["/api/maps"],
  });

  const updateLinkedMapMutation = useMutation({
    mutationFn: async (linkedMapId: string | null) => {
      // Update the placement's linkedMapId (per-placement link)
      if (device.placementId) {
        return apiRequest("PATCH", `/api/placements/${device.placementId}`, { linkedMapId });
      }
      throw new Error("Device not placed on map");
    },
    onSuccess: () => {
      // Invalidate all placement, device, and map health queries
      queryClient.invalidateQueries({ queryKey: ["/api/placements", currentMapId] });
      queryClient.invalidateQueries({ queryKey: ["/api/placements/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/map-health/summary"] });
      toast({ description: "Map link updated" });
    },
    onError: () => {
      toast({
        variant: "destructive",
        description: "Failed to update map link",
      });
    },
  });

  const { data: credentialProfile } = useQuery<CredentialProfile>({
    queryKey: ["/api/credential-profiles", device.credentialProfileId],
    queryFn: async () => {
      if (!device.credentialProfileId) return null;
      const response = await fetch(
        `/api/credential-profiles/${device.credentialProfileId}`,
      );
      if (!response.ok) throw new Error("Failed to fetch credential profile");
      return response.json();
    },
    enabled: !!device.credentialProfileId,
  });

  const { data: defaultProbeTimeoutData } = useQuery<{
    key: string;
    value: number;
  }>({
    queryKey: ["/api/settings", "default_probe_timeout"],
    queryFn: async () => {
      const response = await fetch("/api/settings/default_probe_timeout");
      if (!response.ok) return { key: "default_probe_timeout", value: 6 };
      return response.json();
    },
  });

  const { data: defaultOfflineThresholdData } = useQuery<{
    key: string;
    value: number;
  }>({
    queryKey: ["/api/settings", "default_offline_threshold"],
    queryFn: async () => {
      const response = await fetch("/api/settings/default_offline_threshold");
      if (!response.ok) return { key: "default_offline_threshold", value: 1 };
      return response.json();
    },
  });

  const { data: pollingIntervalData } = useQuery<{
    key: string;
    value: number;
  }>({
    queryKey: ["/api/settings", "polling_interval"],
    queryFn: async () => {
      const response = await fetch("/api/settings/polling_interval");
      if (!response.ok) return { key: "polling_interval", value: 30 };
      return response.json();
    },
  });

  const globalDefaultTimeout = defaultProbeTimeoutData?.value || 6;
  const globalDefaultThreshold = defaultOfflineThresholdData?.value || 1;
  const pollingInterval = pollingIntervalData?.value || 30;

  // Calculate lastSeen staleness color based on polling interval
  const getLastSeenColor = (
    lastSeenDate: Date,
  ): { color: string; label: string } => {
    const now = new Date();
    const diffMs = now.getTime() - lastSeenDate.getTime();
    const diffSecs = diffMs / 1000;

    // Thresholds based on polling interval
    const freshThreshold = pollingInterval * 1.5; // Within 1.5x = fresh (green)
    const staleThreshold = pollingInterval * 3; // Within 3x = stale (orange)
    // Beyond 3x = very stale (red)

    if (diffSecs <= freshThreshold) {
      return { color: "text-green-600 dark:text-green-400", label: "Recent" };
    } else if (diffSecs <= staleThreshold) {
      return { color: "text-orange-500 dark:text-orange-400", label: "Stale" };
    } else {
      return { color: "text-red-500 dark:text-red-400", label: "Very stale" };
    }
  };

  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
  });

  const { data: deviceNotifications = [] } = useQuery<DeviceNotification[]>({
    queryKey: ["/api/devices", device.id, "notifications"],
    queryFn: async () => {
      const response = await fetch(`/api/devices/${device.id}/notifications`);
      if (!response.ok) throw new Error("Failed to fetch device notifications");
      return response.json();
    },
  });

  const { data: proxmoxVms = [] } = useQuery<ProxmoxVm[]>({
    queryKey: ["/api/devices", device.id, "proxmox-vms"],
    queryFn: async () => {
      const response = await fetch(`/api/devices/${device.id}/proxmox-vms`);
      if (!response.ok) return [];
      return response.json();
    },
    enabled: device.type === "proxmox",
  });

  const addNotificationMutation = useMutation({
    mutationFn: async (notificationId: string) =>
      apiRequest("POST", `/api/devices/${device.id}/notifications`, {
        notificationId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/devices", device.id, "notifications"],
      });
      toast({ description: "Notification enabled for device" });
    },
    onError: () => {
      toast({
        variant: "destructive",
        description: "Failed to enable notification",
      });
    },
  });

  const removeNotificationMutation = useMutation({
    mutationFn: async (notificationId: string) =>
      apiRequest(
        "DELETE",
        `/api/devices/${device.id}/notifications/${notificationId}`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/devices", device.id, "notifications"],
      });
      toast({ description: "Notification disabled for device" });
    },
    onError: () => {
      toast({
        variant: "destructive",
        description: "Failed to disable notification",
      });
    },
  });

  const isNotificationEnabled = (notificationId: string) => {
    return deviceNotifications.some(
      (dn) => dn.notificationId === notificationId,
    );
  };

  const handleNotificationToggle = (
    notificationId: string,
    enabled: boolean,
  ) => {
    if (enabled) {
      addNotificationMutation.mutate(notificationId);
    } else {
      removeNotificationMutation.mutate(notificationId);
    }
  };

  const updateTimeoutMutation = useMutation({
    mutationFn: async (timeout: number | null) =>
      apiRequest("PATCH", `/api/devices/${device.id}`, {
        probeTimeout: timeout,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      toast({ description: "Probe timeout updated" });
    },
    onError: () => {
      toast({
        variant: "destructive",
        description: "Failed to update timeout",
      });
    },
  });

  const handleTimeoutBlur = () => {
    const parsed = parseInt(timeoutValue, 10);
    if (timeoutValue === "" || isNaN(parsed)) {
      updateTimeoutMutation.mutate(null);
    } else if (parsed >= 1 && parsed <= 120) {
      updateTimeoutMutation.mutate(parsed);
    } else {
      setTimeoutValue(device.probeTimeout?.toString() ?? "");
      toast({
        variant: "destructive",
        description: "Timeout must be between 1 and 120 seconds",
      });
    }
  };

  const updateThresholdMutation = useMutation({
    mutationFn: async (threshold: number | null) =>
      apiRequest("PATCH", `/api/devices/${device.id}`, {
        offlineThreshold: threshold,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      toast({ description: "Offline threshold updated" });
    },
    onError: () => {
      toast({
        variant: "destructive",
        description: "Failed to update threshold",
      });
    },
  });

  const handleThresholdBlur = () => {
    const parsed = parseInt(thresholdValue, 10);
    if (thresholdValue === "" || isNaN(parsed)) {
      updateThresholdMutation.mutate(null);
    } else if (parsed >= 1 && parsed <= 10) {
      updateThresholdMutation.mutate(parsed);
    } else {
      setThresholdValue(device.offlineThreshold?.toString() ?? "");
      toast({
        variant: "destructive",
        description: "Threshold must be between 1 and 10 cycles",
      });
    }
  };

  // On-Duty toggle mutation
  const updateOnDutyMutation = useMutation({
    mutationFn: async (useOnDuty: boolean) =>
      apiRequest("PATCH", `/api/devices/${device.id}`, { useOnDuty }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      toast({ description: "On-duty notification setting updated" });
    },
    onError: () => {
      toast({
        variant: "destructive",
        description: "Failed to update on-duty setting",
      });
    },
  });

  // Mute device mutation
  const muteMutation = useMutation({
    mutationFn: async (duration: number | 'forever') =>
      apiRequest("POST", `/api/devices/${device.id}/mute`, { duration }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      toast({ description: "Device notifications muted" });
    },
    onError: () => {
      toast({
        variant: "destructive",
        description: "Failed to mute device",
      });
    },
  });

  // Unmute device mutation
  const unmuteMutation = useMutation({
    mutationFn: async () =>
      apiRequest("DELETE", `/api/devices/${device.id}/mute`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      toast({ description: "Device notifications unmuted" });
    },
    onError: () => {
      toast({
        variant: "destructive",
        description: "Failed to unmute device",
      });
    },
  });

  const handleProbeNow = async () => {
    setProbing(true);
    try {
      await apiRequest("POST", `/api/devices/${device.id}/probe`, {});
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      toast({
        title: "Device probed",
        description: "Device information has been updated.",
      });
    } catch (error) {
      toast({
        title: "Probe failed",
        description:
          "Could not connect to device. Check credentials and IP address.",
        variant: "destructive",
      });
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="h-full w-80 bg-background border-l border-border flex flex-col">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">
          Device Properties
        </h2>
        <Button
          size="icon"
          variant="ghost"
          onClick={onClose}
          data-testid="button-close-properties"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Name</p>
                <p
                  className="font-medium text-foreground"
                  data-testid="text-property-name"
                >
                  {device.name}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Type</p>
                <Badge
                  variant="secondary"
                  className="mt-1"
                  data-testid="badge-property-type"
                >
                  {device.type.replace(/_/g, " ")}
                </Badge>
              </div>
              {device.ipAddress && (
                <div>
                  <p className="text-muted-foreground text-xs">IP Address</p>
                  <p
                    className="font-medium font-mono text-foreground"
                    data-testid="text-property-ip"
                  >
                    {device.ipAddress}
                  </p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground text-xs">Status</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className={`w-2 h-2 rounded-full ${status.color}`} />
                  <span
                    className="font-medium text-foreground"
                    data-testid="text-property-status"
                  >
                    {status.label}
                  </span>
                </div>
                {(device.status === 'offline' || device.status === 'stale') && device.statusChangedAt && (
                  <p className="text-xs text-muted-foreground mt-1" data-testid="text-offline-duration">
                    {formatStatusDuration(new Date(device.statusChangedAt))}
                  </p>
                )}
                {(device.status === 'offline' || device.status === 'stale') && device.lastProbeError && (
                  <div className="flex items-start gap-1.5 mt-2 p-2 bg-destructive/10 rounded-md border border-destructive/20">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                    <p className="text-xs text-destructive" data-testid="text-probe-error">
                      {device.lastProbeError}
                    </p>
                  </div>
                )}
              </div>
              {device.lastSeen && (
                <div>
                  <p className="text-muted-foreground text-xs">Last Seen</p>
                  {(() => {
                    const lastSeenDate = new Date(device.lastSeen);
                    const { color } = getLastSeenColor(lastSeenDate);
                    return (
                      <p
                        className={`font-medium ${color}`}
                        data-testid="text-property-last-seen"
                      >
                        {formatLastSeen(lastSeenDate)}
                      </p>
                    );
                  })()}
                </div>
              )}
              <div>
                <p className="text-muted-foreground text-xs mb-1.5">Status History (24h)</p>
                <StatusHistoryBar 
                  deviceId={device.id} 
                  onClick={() => setStatusHistoryOpen(true)}
                />
              </div>
            </CardContent>
          </Card>

          {device.deviceData?.cpuUsagePct !== undefined &&
            device.deviceData?.memoryUsagePct !== undefined && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">System Vitals</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-muted-foreground" />
                        <span className="text-foreground font-medium">
                          CPU Usage
                        </span>
                      </div>
                      <span
                        className="font-mono font-semibold text-foreground"
                        data-testid="text-cpu-usage"
                      >
                        {device.deviceData.cpuUsagePct}%
                      </span>
                    </div>
                    <Progress
                      value={device.deviceData.cpuUsagePct}
                      className="h-2"
                      data-testid="progress-cpu"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <MemoryStick className="h-4 w-4 text-muted-foreground" />
                        <span className="text-foreground font-medium">
                          Memory Usage
                        </span>
                      </div>
                      <span
                        className="font-mono font-semibold text-foreground"
                        data-testid="text-memory-usage"
                      >
                        {device.deviceData.memoryUsagePct}%
                      </span>
                    </div>
                    <Progress
                      value={device.deviceData.memoryUsagePct}
                      className="h-2"
                      data-testid="progress-memory"
                    />
                  </div>
                </CardContent>
              </Card>
            )}

          {device.deviceData && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Device Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {device.deviceData.systemIdentity && (
                  <div>
                    <p className="text-muted-foreground text-xs">
                      System Identity
                    </p>
                    <p className="font-medium text-foreground">
                      {device.deviceData.systemIdentity}
                    </p>
                  </div>
                )}
                {device.deviceData.model && (
                  <div>
                    <p className="text-muted-foreground text-xs">Model</p>
                    <p className="font-medium text-foreground">
                      {device.deviceData.model}
                    </p>
                  </div>
                )}
                {device.deviceData.version && (
                  <div>
                    <p className="text-muted-foreground text-xs">Version</p>
                    <p className="font-medium text-foreground">
                      {device.deviceData.version}
                    </p>
                  </div>
                )}
                {device.deviceData.uptime && (
                  <div>
                    <p className="text-muted-foreground text-xs">Uptime</p>
                    <p className="font-medium text-foreground">
                      {device.deviceData.uptime}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {device.type === "proxmox" && proxmoxVms.length > 0 && (
            <Card data-testid="card-proxmox-vms" className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">Virtual Machines</CardTitle>
                  <Badge variant="secondary" className="text-xs flex-shrink-0" data-testid="badge-vm-count">
                    {proxmoxVms.filter(vm => vm.status === 'running').length}/{proxmoxVms.length} running
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="overflow-hidden">
                <div className="space-y-2">
                  {proxmoxVms.map((vm) => (
                    <div key={vm.id} className="flex items-center gap-1.5 text-sm w-full" data-testid={`row-vm-${vm.vmid}`}>
                      <div
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          vm.status === "running"
                            ? "bg-green-500"
                            : vm.status === "stopped"
                            ? "bg-gray-400"
                            : "bg-yellow-500"
                        }`}
                        data-testid={`status-vm-${vm.vmid}`}
                      />
                      {vm.vmType === 'lxc' ? (
                        <Container className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <Server className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1" style={{ maxWidth: 'calc(100% - 90px)' }}>
                        <p className="font-medium text-foreground truncate" title={vm.name} data-testid={`text-vm-name-${vm.vmid}`}>
                          {vm.name}
                        </p>
                        {vm.ipAddresses && vm.ipAddresses.length > 0 && (
                          <p className="text-xs text-muted-foreground font-mono truncate" data-testid={`text-vm-ip-${vm.vmid}`}>
                            {vm.ipAddresses[0]}
                            {vm.ipAddresses.length > 1 && ` +${vm.ipAddresses.length - 1}`}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className="text-xs flex-shrink-0 whitespace-nowrap ml-auto" data-testid={`badge-vm-type-${vm.vmid}`}>
                        {vm.vmType.toUpperCase()} {vm.vmid}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {device.deviceData?.ports && device.deviceData.ports.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Network Ports</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {device.deviceData.ports.map((port, idx) => {
                    // Use defaultName (or name as fallback) for new connections
                    const portIdentifier = port.defaultName || port.name;

                    // Find connection for this port with backward compatibility
                    // Match against BOTH defaultName and name to handle:
                    // 1. New connections (use defaultName)
                    // 2. Legacy connections (use old name that might have been renamed)
                    // 3. Mikrotik renames (connection stored with defaultName still works)
                    const connection = connections.find((conn) => {
                      // Check if this port is the source
                      if (conn.sourceDeviceId === device.id) {
                        // Match if connection identifier matches either defaultName OR current name
                        return (
                          conn.sourcePort === port.defaultName ||
                          conn.sourcePort === port.name
                        );
                      }
                      // Check if this port is the target
                      if (conn.targetDeviceId === device.id) {
                        // Match if connection identifier matches either defaultName OR current name
                        return (
                          conn.targetPort === port.defaultName ||
                          conn.targetPort === port.name
                        );
                      }
                      return false;
                    });

                    // Find connected device and port
                    let connectedDevice: Device | undefined;
                    let connectedPortIdentifier: string | undefined;
                    let connectedPortName: string | undefined;
                    if (connection) {
                      const isSourcePort =
                        connection.sourceDeviceId === device.id;
                      const connectedDeviceId = isSourcePort
                        ? connection.targetDeviceId
                        : connection.sourceDeviceId;
                      connectedDevice = allDevices.find(
                        (d) => d.id === connectedDeviceId,
                      );
                      connectedPortIdentifier =
                        (isSourcePort
                          ? connection.targetPort
                          : connection.sourcePort) || undefined;

                      // Find the user-friendly name of the connected port with backward compatibility
                      if (connectedDevice && connectedPortIdentifier) {
                        // Try to find port by defaultName first, then fall back to name
                        const connectedPort =
                          connectedDevice.deviceData?.ports?.find(
                            (p) =>
                              (p.defaultName || p.name) ===
                                connectedPortIdentifier ||
                              p.name === connectedPortIdentifier,
                          );
                        connectedPortName =
                          connectedPort?.name || connectedPortIdentifier;
                      }
                    }

                    return (
                      <div key={idx} className="flex flex-col gap-1 text-sm">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <div
                              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                device.status === "online" &&
                                port.status === "up"
                                  ? "bg-green-500"
                                  : "bg-gray-400"
                              }`}
                            />
                            <span className="font-medium text-foreground">
                              {port.name}
                            </span>
                            {connection &&
                            connectedDevice &&
                            onNavigateToDevice ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-5 w-5 flex-shrink-0"
                                onClick={() =>
                                  onNavigateToDevice(connectedDevice.id)
                                }
                                title={`Connected to ${connectedDevice.name}`}
                                data-testid={`button-navigate-connection-${port.name}`}
                              >
                                <LinkIcon className="h-3 w-3 text-primary" />
                              </Button>
                            ) : (
                              onStartConnectionFromPort && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-5 w-5 flex-shrink-0"
                                  onClick={() =>
                                    onStartConnectionFromPort(
                                      device.id,
                                      portIdentifier,
                                    )
                                  }
                                  title="Create connection from this port"
                                  data-testid={`button-start-connection-${port.name}`}
                                >
                                  <LinkIcon className="h-3 w-3 text-muted-foreground" />
                                </Button>
                              )
                            )}
                          </div>
                          {port.speed && (
                            <Badge
                              variant="outline"
                              className="text-xs flex-shrink-0"
                            >
                              {port.speed}
                            </Badge>
                          )}
                        </div>
                        {port.description && (
                          <p className="text-xs text-muted-foreground ml-5">
                            {port.description}
                          </p>
                        )}
                        {connection && connectedDevice && connectedPortName && (
                          <p
                            className="text-xs text-primary ml-5"
                            data-testid={`text-connected-to-${port.name}`}
                          >
                            → {connectedDevice.name} ({connectedPortName})
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm">Credentials</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {device.credentialProfileId && credentialProfile ? (
                <div className="space-y-1">
                  <div className="text-sm text-foreground font-medium">
                    {credentialProfile.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {credentialProfile.type === "mikrotik"
                      ? "Mikrotik Device"
                      : "SNMP Device"}
                  </div>
                  <Badge variant="outline" className="text-xs mt-2">
                    Profile
                  </Badge>
                </div>
              ) : device.customCredentials ? (
                <div className="space-y-1">
                  <div className="text-sm text-foreground font-medium">
                    Custom Credentials
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Device-specific credentials configured
                  </div>
                  <Badge variant="outline" className="text-xs mt-2">
                    Custom
                  </Badge>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No credentials configured
                </div>
              )}

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-medium">Probe Timeout</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={120}
                    placeholder={String(globalDefaultTimeout)}
                    value={timeoutValue}
                    onChange={(e) => setTimeoutValue(e.target.value)}
                    onBlur={handleTimeoutBlur}
                    className="w-20 h-8"
                    data-testid="input-probe-timeout"
                    disabled={!canModify}
                  />
                  <span className="text-sm text-muted-foreground">
                    seconds{" "}
                    {device.probeTimeout
                      ? "(custom)"
                      : `(global: ${globalDefaultTimeout}s)`}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Leave empty to use global default from Settings
                </p>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-medium">
                    Offline Threshold
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    placeholder={String(globalDefaultThreshold)}
                    value={thresholdValue}
                    onChange={(e) => setThresholdValue(e.target.value)}
                    onBlur={handleThresholdBlur}
                    className="w-20 h-8"
                    data-testid="input-offline-threshold"
                    disabled={!canModify}
                  />
                  <span className="text-sm text-muted-foreground">
                    cycles{" "}
                    {device.offlineThreshold
                      ? "(custom)"
                      : `(global: ${globalDefaultThreshold})`}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Leave empty to use global default from Settings
                </p>
                {device.failureCount ? (
                  <p className="text-xs text-yellow-600">
                    Current failures: {device.failureCount}/
                    {device.offlineThreshold || globalDefaultThreshold}
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm">Notifications</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {notifications.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No notifications configured. Create notifications in Settings.
                </div>
              ) : (
                <div className="space-y-3">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className="flex items-start space-x-3"
                      data-testid={`notification-checkbox-${notification.id}`}
                    >
                      <Checkbox
                        id={`notification-${notification.id}`}
                        checked={isNotificationEnabled(notification.id)}
                        onCheckedChange={(checked) =>
                          handleNotificationToggle(
                            notification.id,
                            checked as boolean,
                          )
                        }
                        disabled={!notification.enabled}
                        data-testid={`checkbox-notification-${notification.id}`}
                      />
                      <div className="flex-1 space-y-1">
                        <label
                          htmlFor={`notification-${notification.id}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {notification.name}
                        </label>
                        {!notification.enabled && (
                          <Badge variant="outline" className="text-xs">
                            Disabled
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              <Separator />
              
              <div className="space-y-2">
                <div className="flex items-start space-x-3" data-testid="on-duty-checkbox-container">
                  <Checkbox
                    id="use-on-duty"
                    checked={device.useOnDuty ?? false}
                    onCheckedChange={(checked) => {
                      if (canModify) {
                        updateOnDutyMutation.mutate(checked as boolean);
                      }
                    }}
                    disabled={!canModify || updateOnDutyMutation.isPending}
                    data-testid="checkbox-use-on-duty"
                  />
                  <div className="flex-1 space-y-1">
                    <label
                      htmlFor="use-on-duty"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      Use On-Duty Notifications
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Also notify the on-duty operator (based on shift schedule configured in Settings)
                    </p>
                  </div>
                </div>
              </div>
              
              <Separator />
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <BellOff className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Mute Notifications</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Temporarily silence alerts for maintenance
                    </p>
                  </div>
                </div>
                
                {device.mutedUntil && new Date(device.mutedUntil) > new Date() ? (
                  <div className="flex items-center justify-between p-2 bg-orange-50 dark:bg-orange-900/20 rounded-md">
                    <div className="flex items-center gap-2">
                      <BellOff className="h-4 w-4 text-orange-500" />
                      <span className="text-sm text-orange-700 dark:text-orange-400">
                        Muted until {new Date(device.mutedUntil).getTime() > Date.now() + 50 * 365 * 24 * 60 * 60 * 1000 
                          ? 'Forever' 
                          : new Date(device.mutedUntil).toLocaleString()}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => unmuteMutation.mutate()}
                      disabled={!canModify || unmuteMutation.isPending}
                      data-testid="button-unmute-device"
                    >
                      Unmute
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    {([
                      { label: '1h', value: 1 },
                      { label: '3h', value: 3 },
                      { label: '10h', value: 10 },
                      { label: '24h', value: 24 },
                      { label: 'Forever', value: 'forever' as const },
                    ] as const).map((option) => (
                      <Button
                        key={option.label}
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => muteMutation.mutate(option.value)}
                        disabled={!canModify || muteMutation.isPending}
                        data-testid={`button-mute-${option.label}`}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <MapIcon className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm">Map Link</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Link this device placement to another map. A link icon will appear on the
                device in the canvas.
              </p>
              {device.placementId ? (
                <>
                  <Select
                    value={device.placementLinkedMapId || "none"}
                    onValueChange={(value) => {
                      if (canModify) {
                        updateLinkedMapMutation.mutate(
                          value === "none" ? null : value,
                        );
                      }
                    }}
                    disabled={!canModify}
                  >
                    <SelectTrigger data-testid="select-linked-map">
                      <SelectValue placeholder="No map linked" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No map linked</SelectItem>
                      {maps.map((map) => (
                        <SelectItem key={map.id} value={map.id}>
                          {map.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {device.placementLinkedMapId && onNavigateToMap && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2"
                      onClick={() => onNavigateToMap(device.placementLinkedMapId!)}
                      data-testid="button-go-to-linked-map"
                    >
                      <LinkIcon className="h-3 w-3" />
                      Go to{" "}
                      {maps.find((m) => m.id === device.placementLinkedMapId)?.name ||
                        "Linked Map"}
                    </Button>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Place this device on a map to configure map links.
                </p>
              )}
            </CardContent>
          </Card>

          {device.position && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Position</p>
              <div className="flex gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">X:</span>{" "}
                  <span className="font-mono font-medium text-foreground">
                    {Math.round(device.position.x)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Y:</span>{" "}
                  <span className="font-mono font-medium text-foreground">
                    {Math.round(device.position.y)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <Separator />

      <div className="p-4 space-y-2">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={handleProbeNow}
          disabled={probing}
          data-testid="button-probe-device"
        >
          <RefreshCw className={`h-4 w-4 ${probing ? "animate-spin" : ""}`} />
          {probing ? "Probing..." : "Probe Now"}
        </Button>
        {canModify && (
          <>
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={() => onEdit(device)}
              data-testid="button-edit-device"
            >
              <Edit className="h-4 w-4" />
              Edit Device
            </Button>
            <Button
              variant="destructive"
              className="w-full justify-start gap-2"
              onClick={() => onDelete(device.id)}
              data-testid="button-delete-device"
            >
              <Trash2 className="h-4 w-4" />
              Remove Device
            </Button>
          </>
        )}
      </div>

      <StatusHistoryModal
        deviceId={device.id}
        deviceName={device.name}
        open={statusHistoryOpen}
        onOpenChange={setStatusHistoryOpen}
      />
    </div>
  );
}

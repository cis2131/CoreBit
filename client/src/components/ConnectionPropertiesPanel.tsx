import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Connection, Device } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
  Save,
  Activity,
  ArrowDown,
  ArrowUp,
  Radio,
  AlertTriangle,
  RefreshCw,
  BarChart3,
  Spline,
  RefreshCcw,
  ExternalLink,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ConnectionBandwidthChartViewer } from "@/components/MetricsChartViewer";

interface TrafficHistoryPoint {
  timestamp: number;
  inBitsPerSec: number;
  outBitsPerSec: number;
  utilizationPct: number;
}

interface ConnectionPropertiesPanelProps {
  connection: Connection;
  sourceDevice: Device;
  targetDevice: Device;
  onClose: () => void;
  onDelete: (connectionId: string) => void;
  canModify?: boolean;
}

const linkSpeeds = ["WiFi", "1G", "2.5G", "10G", "25G", "40G", "100G", "Custom"] as const;

export function ConnectionPropertiesPanel({
  connection,
  sourceDevice,
  targetDevice,
  onClose,
  onDelete,
  canModify = true,
}: ConnectionPropertiesPanelProps) {
  const { toast } = useToast();
  const [linkSpeed, setLinkSpeed] = useState(connection.linkSpeed || "1G");
  const [sourcePort, setSourcePort] = useState(connection.sourcePort || "none");
  const [targetPort, setTargetPort] = useState(connection.targetPort || "none");
  const [monitorInterface, setMonitorInterface] = useState<string>(
    connection.monitorInterface || "none",
  );
  const [curveMode, setCurveMode] = useState<"straight" | "curved" | "spline" | "auto">(
    (connection.curveMode as "straight" | "curved" | "spline" | "auto") || "straight",
  );
  const [curveOffset, setCurveOffset] = useState(connection.curveOffset || 0);
  const [flipTrafficDirection, setFlipTrafficDirection] = useState(
    connection.flipTrafficDirection || false,
  );
  const [bandwidthChartOpen, setBandwidthChartOpen] = useState(false);
  const [isDynamic, setIsDynamic] = useState(connection.isDynamic || false);
  const [warningThreshold, setWarningThreshold] = useState<number | null>(
    connection.warningThresholdPct ?? 70,
  );
  const [criticalThreshold, setCriticalThreshold] = useState<number | null>(
    connection.criticalThresholdPct ?? 90,
  );
  const [labelPosition, setLabelPosition] = useState(
    connection.labelPosition ?? 50,
  );
  const [customLinkSpeedMbps, setCustomLinkSpeedMbps] = useState<number | null>(
    connection.customLinkSpeedMbps ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [resettingIndex, setResettingIndex] = useState(false);

  // Check if source device is a VM (matched to a Proxmox VM) for dynamic connection eligibility
  const isSourceVmDevice =
    sourceDevice.type === "generic_prometheus" ||
    sourceDevice.type === "server";
  const isTargetProxmoxHost = targetDevice.type === "proxmox";
  const canBeDynamicConnection = isSourceVmDevice && isTargetProxmoxHost;

  // Fetch traffic history for bandwidth graph (poll every 10 seconds when monitoring is enabled)
  const { data: trafficHistory = [] } = useQuery<TrafficHistoryPoint[]>({
    queryKey: ["/api/connections", connection.id, "traffic-history"],
    enabled: !!connection.monitorInterface,
    refetchInterval: 10000,
  });

  // Sync state when connection prop changes (e.g., clicking between different connections)
  useEffect(() => {
    setLinkSpeed(connection.linkSpeed || "1G");
    setSourcePort(connection.sourcePort || "none");
    setTargetPort(connection.targetPort || "none");
    setMonitorInterface(connection.monitorInterface || "none");
    setCurveMode(
      (connection.curveMode as "straight" | "curved" | "spline" | "auto") || "straight",
    );
    setCurveOffset(connection.curveOffset || 0);
    setFlipTrafficDirection(connection.flipTrafficDirection || false);
    setIsDynamic(connection.isDynamic || false);
    setWarningThreshold(connection.warningThresholdPct ?? 70);
    setCriticalThreshold(connection.criticalThresholdPct ?? 90);
    setLabelPosition(connection.labelPosition ?? 50);
    setCustomLinkSpeedMbps(connection.customLinkSpeedMbps ?? null);
  }, [
    connection.id,
    connection.linkSpeed,
    connection.sourcePort,
    connection.targetPort,
    connection.monitorInterface,
    connection.curveMode,
    connection.curveOffset,
    connection.flipTrafficDirection,
    connection.isDynamic,
    connection.warningThresholdPct,
    connection.criticalThresholdPct,
    connection.labelPosition,
    connection.customLinkSpeedMbps,
  ]);

  const sourcePorts = sourceDevice.deviceData?.ports || [];
  const targetPorts = targetDevice.deviceData?.ports || [];

  // Helper to find port by defaultName or name (for display in trigger)
  const findPort = (ports: typeof sourcePorts, portValue: string) => {
    if (!portValue || portValue === "none") return null;
    return ports.find(
      (p) => p.defaultName === portValue || p.name === portValue,
    );
  };

  const selectedSourcePort = findPort(sourcePorts, sourcePort);
  const selectedTargetPort = findPort(targetPorts, targetPort);

  const hasChanges =
    linkSpeed !== (connection.linkSpeed || "1G") ||
    sourcePort !== (connection.sourcePort || "none") ||
    targetPort !== (connection.targetPort || "none") ||
    monitorInterface !== (connection.monitorInterface || "none") ||
    curveMode !==
      ((connection.curveMode as "straight" | "curved" | "auto") ||
        "straight") ||
    curveOffset !== (connection.curveOffset || 0) ||
    flipTrafficDirection !== (connection.flipTrafficDirection || false) ||
    isDynamic !== (connection.isDynamic || false) ||
    warningThreshold !== (connection.warningThresholdPct ?? 70) ||
    criticalThreshold !== (connection.criticalThresholdPct ?? 90) ||
    labelPosition !== (connection.labelPosition ?? 50) ||
    customLinkSpeedMbps !== (connection.customLinkSpeedMbps ?? null);

  const handleSave = async () => {
    setSaving(true);
    try {
      // WiFi and Custom links can have thresholds if they have a custom speed set
      const needsCustomSpeed = linkSpeed === "WiFi" || linkSpeed === "Custom";
      const hasCustomSpeed = customLinkSpeedMbps && customLinkSpeedMbps > 0;
      
      // Build update payload
      const updatePayload: Record<string, any> = {
        linkSpeed,
        sourcePort: sourcePort === "none" ? "" : sourcePort,
        targetPort: targetPort === "none" ? "" : targetPort,
        monitorInterface: monitorInterface === "none" ? null : monitorInterface,
        curveMode,
        curveOffset,
        flipTrafficDirection,
        isDynamic,
        warningThresholdPct: (needsCustomSpeed && !hasCustomSpeed) ? null : warningThreshold,
        criticalThresholdPct: (needsCustomSpeed && !hasCustomSpeed) ? null : criticalThreshold,
        labelPosition,
        customLinkSpeedMbps: needsCustomSpeed ? customLinkSpeedMbps : null,
      };

      // If enabling dynamic connection, set the type and metadata
      if (isDynamic && canBeDynamicConnection) {
        updatePayload.dynamicType = "proxmox_vm_host";
        updatePayload.dynamicMetadata = {
          vmDeviceId: sourceDevice.id,
          vmEnd: "source",
          lastResolvedHostId: targetDevice.id,
          lastResolvedNodeName: null,
          state: "pending",
        };
      } else if (!isDynamic) {
        updatePayload.dynamicType = null;
        updatePayload.dynamicMetadata = null;
      }

      await apiRequest(
        "PATCH",
        `/api/connections/${connection.id}`,
        updatePayload,
      );
      queryClient.invalidateQueries({
        queryKey: ["/api/connections", connection.mapId],
      });
      // Also invalidate bandwidth history cache so flip direction takes effect
      queryClient.invalidateQueries({
        queryKey: ["/api/connections", connection.id, "bandwidth-history"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/connections", connection.id, "traffic-history"],
      });
      toast({
        title: "Connection updated",
        description: "Connection properties have been saved.",
      });
    } catch (error) {
      toast({
        title: "Update failed",
        description: "Could not update connection properties.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const formatBitsPerSec = (bitsPerSec: number) => {
    if (bitsPerSec === 0) return "0 bps";
    const k = 1000; // Network uses decimal (1000), not binary (1024)
    const sizes = ["bps", "Kbps", "Mbps", "Gbps", "Tbps"];
    const i = Math.floor(Math.log(bitsPerSec) / Math.log(k));
    const value = bitsPerSec / Math.pow(k, i);
    // Show 2 decimal places for values < 10, 1 decimal for values < 100, 0 for larger
    const decimals = value < 10 ? 2 : value < 100 ? 1 : 0;
    return value.toFixed(decimals) + " " + sizes[i];
  };

  const handleResetSnmpIndex = async () => {
    setResettingIndex(true);
    try {
      await apiRequest(
        "POST",
        `/api/connections/${connection.id}/reset-snmp-index`,
      );
      queryClient.invalidateQueries({
        queryKey: ["/api/connections", connection.mapId],
      });
      toast({
        title: "SNMP index reset",
        description:
          "Traffic monitoring will re-discover the interface on next poll.",
      });
    } catch (error) {
      toast({
        title: "Reset failed",
        description: "Could not reset SNMP index.",
        variant: "destructive",
      });
    } finally {
      setResettingIndex(false);
    }
  };

  return (
    <div className="h-full w-80 bg-background border-l border-border flex flex-col">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">
          Connection Properties
        </h2>
        <Button
          size="icon"
          variant="ghost"
          onClick={onClose}
          data-testid="button-close-connection-properties"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Link Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 items-end">
                <div className="space-y-2">
                  <Label htmlFor="link-speed">Link Speed</Label>
                  <Select value={linkSpeed} onValueChange={setLinkSpeed}>
                    <SelectTrigger
                      id="link-speed"
                      data-testid="select-link-speed"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {linkSpeeds.map((speed) => (
                        <SelectItem key={speed} value={speed}>
                          {speed}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  {(linkSpeed === "WiFi" || linkSpeed === "Custom") && (
                    <>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="custom-link-speed" className="text-xs">
                          {linkSpeed === "WiFi" ? "WiFi Speed" : "Custom Speed"}
                        </Label>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Input
                          id="custom-link-speed"
                          type="number"
                          min={1}
                          max={1000000}
                          value={customLinkSpeedMbps || ""}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                            const val = parseInt(e.target.value);
                            setCustomLinkSpeedMbps(isNaN(val) ? null : Math.min(1000000, Math.max(1, val)));
                          }}
                          placeholder="Mbps"
                          className="h-9"
                          data-testid="input-custom-link-speed"
                        />
                        <span className="text-[10px] font-medium text-muted-foreground uppercase">Mbps</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {sourcePorts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <Label
                      htmlFor="source-port"
                      className="text-xs text-muted-foreground"
                    >
                      Source
                    </Label>
                    <span className="text-xs font-medium text-foreground truncate">
                      {sourceDevice.name}
                    </span>
                  </div>
                  <Select value={sourcePort} onValueChange={setSourcePort}>
                    <SelectTrigger
                      id="source-port"
                      data-testid="select-source-port"
                      className="h-auto min-h-9"
                    >
                      {selectedSourcePort ? (
                        <div className="flex items-start gap-2 py-1 text-left w-full">
                          <div
                            className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${
                              sourceDevice.status === "online" &&
                              selectedSourcePort.status === "up"
                                ? "bg-green-500"
                                : sourceDevice.status === "online" &&
                                    selectedSourcePort.status === "down"
                                  ? "bg-red-500"
                                  : "bg-gray-400"
                            }`}
                          />
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="break-words">
                              {selectedSourcePort.name}{" "}
                              {selectedSourcePort.speed &&
                                `(${selectedSourcePort.speed})`}
                            </span>
                            {selectedSourcePort.description && (
                              <span className="text-xs text-muted-foreground break-words">
                                {selectedSourcePort.description}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <SelectValue placeholder="Select port" />
                      )}
                    </SelectTrigger>
                    <SelectContent className="max-w-[280px]">
                      <SelectItem value="none">None</SelectItem>
                      {sourcePorts.map((port, idx) => (
                        <SelectItem
                          key={idx}
                          value={port.defaultName || port.name}
                        >
                          <div className="flex items-start gap-2">
                            <div
                              className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${
                                sourceDevice.status === "online" &&
                                port.status === "up"
                                  ? "bg-green-500"
                                  : sourceDevice.status === "online" &&
                                      port.status === "down"
                                    ? "bg-red-500"
                                    : "bg-gray-400"
                              }`}
                            />
                            <div className="flex flex-col">
                              <span className="break-words">
                                {port.name} {port.speed && `(${port.speed})`}
                              </span>
                              {port.description && (
                                <span className="text-xs text-muted-foreground break-words">
                                  {port.description}
                                </span>
                              )}
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {targetPorts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <Label
                      htmlFor="target-port"
                      className="text-xs text-muted-foreground"
                    >
                      Target
                    </Label>
                    <span className="text-xs font-medium text-foreground truncate">
                      {targetDevice.name}
                    </span>
                  </div>
                  <Select value={targetPort} onValueChange={setTargetPort}>
                    <SelectTrigger
                      id="target-port"
                      data-testid="select-target-port"
                      className="h-auto min-h-9"
                    >
                      {selectedTargetPort ? (
                        <div className="flex items-start gap-2 py-1 text-left w-full">
                          <div
                            className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${
                              targetDevice.status === "online" &&
                              selectedTargetPort.status === "up"
                                ? "bg-green-500"
                                : targetDevice.status === "online" &&
                                    selectedTargetPort.status === "down"
                                  ? "bg-red-500"
                                  : "bg-gray-400"
                            }`}
                          />
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="break-words">
                              {selectedTargetPort.name}{" "}
                              {selectedTargetPort.speed &&
                                `(${selectedTargetPort.speed})`}
                            </span>
                            {selectedTargetPort.description && (
                              <span className="text-xs text-muted-foreground break-words">
                                {selectedTargetPort.description}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <SelectValue placeholder="Select port" />
                      )}
                    </SelectTrigger>
                    <SelectContent className="max-w-[280px]">
                      <SelectItem value="none">None</SelectItem>
                      {targetPorts.map((port, idx) => (
                        <SelectItem
                          key={idx}
                          value={port.defaultName || port.name}
                        >
                          <div className="flex items-start gap-2">
                            <div
                              className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${
                                targetDevice.status === "online" &&
                                port.status === "up"
                                  ? "bg-green-500"
                                  : targetDevice.status === "online" &&
                                      port.status === "down"
                                    ? "bg-red-500"
                                    : "bg-gray-400"
                              }`}
                            />
                            <div className="flex flex-col">
                              <span className="break-words">
                                {port.name} {port.speed && `(${port.speed})`}
                              </span>
                              {port.description && (
                                <span className="text-xs text-muted-foreground break-words">
                                  {port.description}
                                </span>
                              )}
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Spline className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm">Line Appearance</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="curve-mode">Line Style</Label>
                <Select
                  value={curveMode}
                  onValueChange={(v) => {
                    const newMode = v as "straight" | "curved" | "spline" | "auto";
                    setCurveMode(newMode);
                    // Reset curve offset when switching away from 'curved' mode
                    if (newMode !== "curved") {
                      setCurveOffset(0);
                    } else if (curveOffset === 0) {
                      // Set a default offset when switching to curved mode
                      setCurveOffset(50);
                    }
                  }}
                >
                  <SelectTrigger
                    id="curve-mode"
                    data-testid="select-curve-mode"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="straight">Straight</SelectItem>
                    <SelectItem value="curved">Curved</SelectItem>
                    <SelectItem value="spline">Spline (S-curve)</SelectItem>
                    <SelectItem value="auto">
                      Auto (for parallel links)
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Use curved lines when multiple connections exist between the
                  same devices.
                </p>
              </div>

              {curveMode === "curved" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="curve-offset">Curve Intensity</Label>
                    <span className="text-xs text-muted-foreground">
                      {curveOffset}px
                    </span>
                  </div>
                  <Slider
                    id="curve-offset"
                    data-testid="slider-curve-intensity"
                    min={-150}
                    max={150}
                    step={10}
                    value={[curveOffset]}
                    onValueChange={(v) => setCurveOffset(v[0])}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    Negative values curve left, positive values curve right.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="label-position">Label Position</Label>
                  <span className="text-xs text-muted-foreground">
                    {labelPosition < 50
                      ? `${50 - labelPosition}% toward source`
                      : labelPosition > 50
                        ? `${labelPosition - 50}% toward target`
                        : "Center"}
                  </span>
                </div>
                <Slider
                  id="label-position"
                  data-testid="slider-label-position"
                  min={10}
                  max={90}
                  step={5}
                  value={[labelPosition]}
                  onValueChange={(v) => setLabelPosition(v[0])}
                  className="w-full [&>span:first-child>span]:bg-transparent"
                />
                <p className="text-xs text-muted-foreground">
                  Slide to move the RX/TX label along the connection line.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm">Traffic Monitoring</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-muted-foreground">
                Select an interface to monitor traffic via SNMP. Traffic stats
                will appear on next interface polling cycle (it can take a
                couple of minutes).
              </div>
              <div className="space-y-2">
                <Label htmlFor="monitor-interface">Monitor Interface</Label>
                <Select
                  value={monitorInterface}
                  onValueChange={setMonitorInterface}
                >
                  <SelectTrigger
                    id="monitor-interface"
                    data-testid="select-monitor-interface"
                  >
                    <SelectValue placeholder="Select interface to monitor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (disabled)</SelectItem>
                    {sourcePort && sourcePort !== "none" && (
                      <SelectItem value="source">
                        <div className="flex flex-col">
                          <span>
                            Source: {selectedSourcePort?.name || sourcePort}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {sourceDevice.name}
                          </span>
                        </div>
                      </SelectItem>
                    )}
                    {targetPort && targetPort !== "none" && (
                      <SelectItem value="target">
                        <div className="flex flex-col">
                          <span>
                            Target: {selectedTargetPort?.name || targetPort}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {targetDevice.name}
                          </span>
                        </div>
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              {monitorInterface !== "none" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="text-xs">
                      Monitoring:{" "}
                      {monitorInterface === "source"
                        ? sourceDevice.name
                        : targetDevice.name}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleResetSnmpIndex}
                      disabled={resettingIndex}
                      className="h-6 text-xs"
                      data-testid="button-reset-snmp-index"
                    >
                      <RefreshCw
                        className={`h-3 w-3 mr-1 ${resettingIndex ? "animate-spin" : ""}`}
                      />
                      {resettingIndex ? "Refreshing..." : "Refresh Index"}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="flip-direction" className="text-sm">
                        Flip RX/TX Direction
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Swap inbound/outbound if connection was drawn backwards
                      </p>
                    </div>
                    <Switch
                      id="flip-direction"
                      checked={flipTrafficDirection}
                      onCheckedChange={setFlipTrafficDirection}
                      data-testid="switch-flip-traffic"
                    />
                  </div>

                  <div className="space-y-3 pt-3 border-t">
                    <Label className="text-sm font-medium">
                      Utilization Thresholds
                    </Label>
                    {(linkSpeed === "WiFi" || linkSpeed === "Custom") && !customLinkSpeedMbps ? (
                      <p className="text-xs text-muted-foreground">
                        Set a {linkSpeed === "WiFi" ? "WiFi max speed" : "custom link speed"} above to enable thresholds.
                      </p>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground">
                          Connection line flashes when utilization exceeds these
                          thresholds
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <Label
                              htmlFor="warning-threshold"
                              className="text-xs flex items-center gap-1.5"
                            >
                              <span className="w-2 h-2 rounded-full bg-orange-500" />
                              Warning
                            </Label>
                            <div className="flex items-center gap-2">
                              <Input
                                id="warning-threshold"
                                type="number"
                                min={0}
                                max={100}
                                value={warningThreshold || 0}
                                onChange={(
                                  e: React.ChangeEvent<HTMLInputElement>,
                                ) => {
                                  const val = parseInt(e.target.value) || 0;
                                  setWarningThreshold(
                                    Math.min(100, Math.max(0, val)),
                                  );
                                }}
                                className="h-8 w-20"
                                data-testid="input-warning-threshold"
                              />
                              <span className="text-xs text-muted-foreground">
                                %
                              </span>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor="critical-threshold"
                              className="text-xs flex items-center gap-1.5"
                            >
                              <span className="w-2 h-2 rounded-full bg-red-500" />
                              Critical
                            </Label>
                            <div className="flex items-center gap-2">
                              <Input
                                id="critical-threshold"
                                type="number"
                                min={0}
                                max={100}
                                value={criticalThreshold || 0}
                                onChange={(
                                  e: React.ChangeEvent<HTMLInputElement>,
                                ) => {
                                  const val = parseInt(e.target.value) || 0;
                                  setCriticalThreshold(
                                    Math.min(100, Math.max(0, val)),
                                  );
                                }}
                                className="h-8 w-20"
                                data-testid="input-critical-threshold"
                              />
                              <span className="text-xs text-muted-foreground">
                                %
                              </span>
                            </div>
                          </div>
                        </div>
                        {warningThreshold !== null && criticalThreshold !== null && warningThreshold >= criticalThreshold && (
                          <p className="text-xs text-destructive">
                            Warning threshold should be less than critical threshold
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {canBeDynamicConnection && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <RefreshCcw className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-sm">
                    Dynamic VM Connection
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="is-dynamic" className="text-sm">
                      Auto-update on VM migration
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Automatically update this connection when the VM migrates
                      to a different Proxmox host
                    </p>
                  </div>
                  <Switch
                    id="is-dynamic"
                    checked={isDynamic}
                    onCheckedChange={setIsDynamic}
                    data-testid="switch-dynamic-connection"
                  />
                </div>
                {isDynamic && (
                  <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
                    When enabled, if this VM migrates to another Proxmox cluster
                    node, this connection will automatically point to the new
                    host device.
                  </div>
                )}
                {connection.dynamicMetadata?.lastResolvedNodeName && (
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="text-xs">
                      Last node:{" "}
                      {connection.dynamicMetadata.lastResolvedNodeName}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {connection.linkStats &&
            (() => {
              // When monitoring on target device, flip RX/TX to show correct direction
              // from the connection's perspective (source → target)
              // Also apply manual flip if user toggled the switch
              const linkStats = connection.linkStats!;
              const isMonitoringTarget =
                connection.monitorInterface === "target";
              const shouldFlip = isMonitoringTarget !== flipTrafficDirection; // XOR logic
              const inboundBps = shouldFlip
                ? linkStats.outBitsPerSec || 0
                : linkStats.inBitsPerSec || 0;
              const outboundBps = shouldFlip
                ? linkStats.inBitsPerSec || 0
                : linkStats.outBitsPerSec || 0;

              return (
                <Card className={linkStats.isStale ? "opacity-60" : ""}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-muted-foreground" />
                        <CardTitle className="text-sm">
                          Traffic Statistics
                        </CardTitle>
                      </div>
                      <div className="flex items-center gap-2">
                        {linkStats.isStale && (
                          <Badge
                            variant="outline"
                            className="text-xs text-yellow-600 border-yellow-600"
                          >
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Stale
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => setBandwidthChartOpen(true)}
                          title="View bandwidth history"
                          data-testid="button-view-bandwidth-chart"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {inboundBps !== undefined && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <ArrowDown className="h-4 w-4 text-blue-500" />
                            <span className="text-foreground font-medium">
                              RX
                            </span>
                          </div>
                          <span
                            className="font-mono font-semibold text-foreground"
                            data-testid="text-inbound-traffic"
                          >
                            {linkStats.isStale
                              ? "—"
                              : formatBitsPerSec(inboundBps)}
                          </span>
                        </div>
                      </div>
                    )}
                    {outboundBps !== undefined && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <ArrowUp className="h-4 w-4 text-green-500" />
                            <span className="text-foreground font-medium">
                              TX
                            </span>
                          </div>
                          <span
                            className="font-mono font-semibold text-foreground"
                            data-testid="text-outbound-traffic"
                          >
                            {linkStats.isStale
                              ? "—"
                              : formatBitsPerSec(outboundBps)}
                          </span>
                        </div>
                      </div>
                    )}
                    {linkStats.utilizationPct !== undefined && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-foreground font-medium">
                            Utilization
                          </span>
                          <span
                            className="font-mono font-semibold text-foreground"
                            data-testid="text-utilization"
                          >
                            {linkStats.isStale
                              ? "—"
                              : `${linkStats.utilizationPct}%`}
                          </span>
                        </div>
                        <Progress
                          value={
                            linkStats.isStale ? 0 : linkStats.utilizationPct
                          }
                          className="h-2"
                          data-testid="progress-utilization"
                        />
                      </div>
                    )}
                    {linkStats.lastSampleAt && (
                      <div className="text-xs text-muted-foreground">
                        Last updated:{" "}
                        {new Date(linkStats.lastSampleAt).toLocaleString()}
                        {linkStats.isStale && " (no response)"}
                      </div>
                    )}

                    {trafficHistory.length > 1 && (
                      <div className="pt-2">
                        <div className="flex items-center gap-2 mb-2">
                          <BarChart3 className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            Bandwidth (last{" "}
                            {Math.round((trafficHistory.length * 10) / 60)} min)
                          </span>
                        </div>
                        <div
                          className="h-24 w-full"
                          data-testid="chart-bandwidth"
                        >
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                              data={trafficHistory.map((point) => ({
                                time: new Date(
                                  point.timestamp,
                                ).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }),
                                rx:
                                  (shouldFlip
                                    ? point.outBitsPerSec
                                    : point.inBitsPerSec) / 1000000,
                                tx:
                                  (shouldFlip
                                    ? point.inBitsPerSec
                                    : point.outBitsPerSec) / 1000000,
                              }))}
                              margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
                            >
                              <XAxis
                                dataKey="time"
                                tick={{ fontSize: 9 }}
                                tickLine={false}
                                axisLine={false}
                                interval="preserveStartEnd"
                              />
                              <YAxis
                                tick={{ fontSize: 9 }}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(value) => {
                                  if (value >= 1000)
                                    return `${(value / 1000).toFixed(0)}G`;
                                  if (value >= 1) return `${value.toFixed(0)}M`;
                                  if (value >= 0.001)
                                    return `${(value * 1000).toFixed(0)}K`;
                                  return "0";
                                }}
                                width={40}
                              />
                              <Tooltip
                                contentStyle={{
                                  fontSize: "11px",
                                  padding: "4px 8px",
                                  borderRadius: "4px",
                                }}
                                formatter={(value: number) => {
                                  if (value >= 1000)
                                    return [
                                      `${(value / 1000).toFixed(2)} Gbps`,
                                    ];
                                  if (value >= 1)
                                    return [`${value.toFixed(2)} Mbps`];
                                  if (value >= 0.001)
                                    return [
                                      `${(value * 1000).toFixed(2)} Kbps`,
                                    ];
                                  return [
                                    `${(value * 1000000).toFixed(0)} bps`,
                                  ];
                                }}
                                labelFormatter={(label) => `Time: ${label}`}
                              />
                              <Area
                                type="monotone"
                                dataKey="rx"
                                name="RX"
                                stroke="#3b82f6"
                                fill="#3b82f6"
                                fillOpacity={0.3}
                                strokeWidth={1.5}
                              />
                              <Area
                                type="monotone"
                                dataKey="tx"
                                name="TX"
                                stroke="#22c55e"
                                fill="#22c55e"
                                fillOpacity={0.2}
                                strokeWidth={1.5}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="flex justify-center gap-4 mt-1">
                          <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-blue-500" />
                            <span className="text-xs text-muted-foreground">
                              RX
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-green-500" />
                            <span className="text-xs text-muted-foreground">
                              TX
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}
        </div>
      </ScrollArea>

      <Separator />

      {canModify && (
        <div className="p-4 space-y-2">
          <Button
            variant="default"
            className="w-full justify-start gap-2"
            onClick={handleSave}
            disabled={!hasChanges || saving}
            data-testid="button-save-connection"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save Changes"}
          </Button>
          <Button
            variant="destructive"
            className="w-full justify-start gap-2"
            onClick={() => onDelete(connection.id)}
            data-testid="button-delete-connection"
          >
            <Trash2 className="h-4 w-4" />
            Delete Connection
          </Button>
        </div>
      )}

      <ConnectionBandwidthChartViewer
        connectionId={connection.id}
        connectionName={`${sourceDevice.name} → ${targetDevice.name}`}
        open={bandwidthChartOpen}
        onOpenChange={setBandwidthChartOpen}
      />
    </div>
  );
}

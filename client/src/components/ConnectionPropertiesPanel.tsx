import { useState, useEffect } from "react";
import { Connection, Device } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
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
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ConnectionPropertiesPanelProps {
  connection: Connection;
  sourceDevice: Device;
  targetDevice: Device;
  onClose: () => void;
  onDelete: (connectionId: string) => void;
}

const linkSpeeds = ["1G", "10G", "25G", "40G", "100G"] as const;

export function ConnectionPropertiesPanel({
  connection,
  sourceDevice,
  targetDevice,
  onClose,
  onDelete,
}: ConnectionPropertiesPanelProps) {
  const { toast } = useToast();
  const [linkSpeed, setLinkSpeed] = useState(connection.linkSpeed || "1G");
  const [sourcePort, setSourcePort] = useState(connection.sourcePort || "none");
  const [targetPort, setTargetPort] = useState(connection.targetPort || "none");
  const [monitorInterface, setMonitorInterface] = useState<string>(
    connection.monitorInterface || "none",
  );
  const [saving, setSaving] = useState(false);

  // Sync state when connection prop changes (e.g., clicking between different connections)
  useEffect(() => {
    setLinkSpeed(connection.linkSpeed || "1G");
    setSourcePort(connection.sourcePort || "none");
    setTargetPort(connection.targetPort || "none");
    setMonitorInterface(connection.monitorInterface || "none");
  }, [
    connection.id,
    connection.linkSpeed,
    connection.sourcePort,
    connection.targetPort,
    connection.monitorInterface,
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
    monitorInterface !== (connection.monitorInterface || "none");

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiRequest("PATCH", `/api/connections/${connection.id}`, {
        linkSpeed,
        sourcePort: sourcePort === "none" ? "" : sourcePort,
        targetPort: targetPort === "none" ? "" : targetPort,
        monitorInterface: monitorInterface === "none" ? null : monitorInterface,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/connections", connection.mapId],
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
                <Badge variant="secondary" className="text-xs">
                  Monitoring:{" "}
                  {monitorInterface === "source"
                    ? sourceDevice.name
                    : targetDevice.name}
                </Badge>
              )}
            </CardContent>
          </Card>

          {connection.linkStats && (
            <Card className={connection.linkStats.isStale ? "opacity-60" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-sm">
                      Traffic Statistics
                    </CardTitle>
                  </div>
                  {connection.linkStats.isStale && (
                    <Badge
                      variant="outline"
                      className="text-xs text-yellow-600 border-yellow-600"
                    >
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Stale
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {connection.linkStats.inBitsPerSec !== undefined && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <ArrowDown className="h-4 w-4 text-blue-500" />
                        <span className="text-foreground font-medium">RX</span>
                      </div>
                      <span
                        className="font-mono font-semibold text-foreground"
                        data-testid="text-inbound-traffic"
                      >
                        {connection.linkStats.isStale
                          ? "—"
                          : formatBitsPerSec(connection.linkStats.inBitsPerSec)}
                      </span>
                    </div>
                  </div>
                )}
                {connection.linkStats.outBitsPerSec !== undefined && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <ArrowUp className="h-4 w-4 text-green-500" />
                        <span className="text-foreground font-medium">TX</span>
                      </div>
                      <span
                        className="font-mono font-semibold text-foreground"
                        data-testid="text-outbound-traffic"
                      >
                        {connection.linkStats.isStale
                          ? "—"
                          : formatBitsPerSec(
                              connection.linkStats.outBitsPerSec,
                            )}
                      </span>
                    </div>
                  </div>
                )}
                {connection.linkStats.utilizationPct !== undefined && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground font-medium">
                        Utilization
                      </span>
                      <span
                        className="font-mono font-semibold text-foreground"
                        data-testid="text-utilization"
                      >
                        {connection.linkStats.isStale
                          ? "—"
                          : `${connection.linkStats.utilizationPct}%`}
                      </span>
                    </div>
                    <Progress
                      value={
                        connection.linkStats.isStale
                          ? 0
                          : connection.linkStats.utilizationPct
                      }
                      className="h-2"
                      data-testid="progress-utilization"
                    />
                  </div>
                )}
                {connection.linkStats.lastSampleAt && (
                  <div className="text-xs text-muted-foreground">
                    Last updated:{" "}
                    {new Date(
                      connection.linkStats.lastSampleAt,
                    ).toLocaleString()}
                    {connection.linkStats.isStale && " (no response)"}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>

      <Separator />

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
    </div>
  );
}

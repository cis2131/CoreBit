import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Activity, AlertTriangle } from "lucide-react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface PingHistoryPoint {
  id: string;
  targetId: string;
  timestamp: Date;
  sent: number;
  received: number;
  lossPct: number;
  rttMin: number | null;
  rttMax: number | null;
  rttAvg: number | null;
  rttMdev: number | null;
  rttP10: number | null;
  rttP25: number | null;
  rttP50: number | null;
  rttP75: number | null;
  rttP90: number | null;
  rttP95: number | null;
}

interface PingTarget {
  id: string;
  deviceId: string;
  ipAddress: string;
  label: string | null;
  enabled: boolean;
  probeCount: number;
  intervalSeconds: number;
}

interface PingTargetWithHistory {
  target: PingTarget;
  history: PingHistoryPoint[];
}

interface PingLatencyChartProps {
  deviceId: string;
  deviceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTargetIp?: string;
}

const TIME_RANGES = [
  { value: "1h", label: "Last 1 Hour", hours: 1 },
  { value: "3h", label: "Last 3 Hours", hours: 3 },
  { value: "6h", label: "Last 6 Hours", hours: 6 },
  { value: "12h", label: "Last 12 Hours", hours: 12 },
  { value: "24h", label: "Last 24 Hours", hours: 24 },
];

function formatTime(timestamp: Date | string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatMs(value: number | null): string {
  if (value === null) return "N/A";
  if (value < 1) return `${(value * 1000).toFixed(0)}μs`;
  if (value < 100) return `${value.toFixed(1)}ms`;
  return `${Math.round(value)}ms`;
}

export function PingLatencyChart({
  deviceId,
  deviceName,
  open,
  onOpenChange,
  initialTargetIp,
}: PingLatencyChartProps) {
  const [timeRange, setTimeRange] = useState("3h");
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [hasInitialized, setHasInitialized] = useState(false);

  const selectedRange = TIME_RANGES.find((r) => r.value === timeRange);
  const since = new Date(
    Date.now() - (selectedRange?.hours || 3) * 60 * 60 * 1000
  );

  const { data: pingData, isLoading, refetch, isRefetching } = useQuery<
    PingTargetWithHistory[]
  >({
    queryKey: ["/api/devices", deviceId, "ping-history", timeRange],
    queryFn: async () => {
      const response = await fetch(
        `/api/devices/${deviceId}/ping-history?since=${since.toISOString()}`
      );
      if (!response.ok) throw new Error("Failed to fetch ping history");
      return response.json();
    },
    enabled: open,
    refetchInterval: 30000,
  });

  // Refetch when dialog opens or time range changes
  useEffect(() => {
    if (open) {
      refetch();
    }
  }, [open, timeRange, refetch]);

  // Initialize selected target based on initialTargetIp or default to first
  useEffect(() => {
    if (pingData && pingData.length > 0 && !hasInitialized) {
      if (initialTargetIp) {
        const targetByIp = pingData.find((t) => t.target?.ipAddress === initialTargetIp);
        if (targetByIp?.target?.id) {
          setSelectedTargetId(targetByIp.target.id);
        } else if (pingData[0]?.target?.id) {
          // Fall back to first target if initialTargetIp not found
          setSelectedTargetId(pingData[0].target.id);
        }
      } else if (pingData[0]?.target?.id) {
        // Default to first target when no initialTargetIp
        setSelectedTargetId(pingData[0].target.id);
      }
      setHasInitialized(true);
    }
  }, [pingData, initialTargetIp, hasInitialized]);

  // Reset initialization when dialog closes
  useEffect(() => {
    if (!open) {
      setHasInitialized(false);
      setSelectedTargetId(null);
    }
  }, [open]);

  // Use useMemo to ensure stable target that updates when data loads
  const currentTarget = useMemo(() => {
    if (!pingData || pingData.length === 0) return null;
    if (selectedTargetId) {
      const found = pingData.find((t) => t.target?.id === selectedTargetId);
      if (found) return found;
    }
    return pingData[0];
  }, [pingData, selectedTargetId]);

  const chartData =
    currentTarget?.history?.map((point) => ({
      timestamp: new Date(point.timestamp).getTime(),
      timeLabel: formatTime(point.timestamp),
      rttMin: point.rttMin,
      rttMax: point.rttMax,
      rttAvg: point.rttAvg,
      rttP10: point.rttP10,
      rttP25: point.rttP25,
      rttP50: point.rttP50,
      rttP75: point.rttP75,
      rttP90: point.rttP90,
      rttP95: point.rttP95,
      lossPct: point.lossPct,
      hasLoss: point.lossPct > 0,
    })) || [];

  const latestPoint = chartData[chartData.length - 1];

  const maxRtt = Math.max(
    ...chartData.map((d) => d.rttMax || 0).filter((v) => v > 0),
    1
  );

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0].payload;
    return (
      <div className="bg-popover border rounded-lg p-3 shadow-lg text-sm space-y-1">
        <div className="font-medium">{data.timeLabel}</div>
        <div className="text-muted-foreground space-y-0.5">
          <div className="flex justify-between gap-4">
            <span>Min:</span>
            <span className="text-green-500 font-mono">
              {formatMs(data.rttMin)}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Avg:</span>
            <span className="text-blue-500 font-mono">
              {formatMs(data.rttAvg)}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Max:</span>
            <span className="text-orange-500 font-mono">
              {formatMs(data.rttMax)}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span>P50:</span>
            <span className="font-mono">{formatMs(data.rttP50)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>P95:</span>
            <span className="font-mono">{formatMs(data.rttP95)}</span>
          </div>
          {data.lossPct > 0 && (
            <div className="flex justify-between gap-4 text-red-500 font-medium">
              <span>Loss:</span>
              <span>{data.lossPct.toFixed(1)}%</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-muted-foreground" />
              <div>
                <DialogTitle>Ping Latency - {deviceName}</DialogTitle>
                {currentTarget?.target && (
                  <p className="text-sm text-muted-foreground font-mono mt-0.5">
                    {currentTarget.target.label 
                      ? `${currentTarget.target.label} (${currentTarget.target.ipAddress})`
                      : currentTarget.target.ipAddress}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 mr-6">
              <Select value={timeRange} onValueChange={setTimeRange}>
                <SelectTrigger className="w-36" data-testid="select-time-range">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_RANGES.map((range) => (
                    <SelectItem key={range.value} value={range.value}>
                      {range.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={() => refetch()}
                disabled={isRefetching}
                data-testid="button-refresh-ping-chart"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`}
                />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {pingData && pingData.length > 0 && currentTarget?.target && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Target:</span>
              {pingData.length > 1 ? (
                <Select
                  value={selectedTargetId || pingData[0]?.target?.id || ""}
                  onValueChange={setSelectedTargetId}
                >
                  <SelectTrigger className="w-64" data-testid="select-ping-target">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pingData.filter((t) => t.target).map((t) => (
                      <SelectItem key={t.target.id} value={t.target.id}>
                        {t.target.label ? `${t.target.label} (${t.target.ipAddress})` : t.target.ipAddress}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="outline" className="font-mono" data-testid="badge-ping-target-ip">
                  {currentTarget.target.label ? `${currentTarget.target.label} (${currentTarget.target.ipAddress})` : currentTarget.target.ipAddress}
                </Badge>
              )}
            </div>
          )}

          {latestPoint && (
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Current:</span>
                <Badge variant="outline" className="font-mono">
                  {formatMs(latestPoint.rttAvg)}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Min/Max:</span>
                <Badge variant="outline" className="font-mono text-green-600">
                  {formatMs(latestPoint.rttMin)}
                </Badge>
                <span className="text-muted-foreground">/</span>
                <Badge variant="outline" className="font-mono text-orange-600">
                  {formatMs(latestPoint.rttMax)}
                </Badge>
              </div>
              {latestPoint.lossPct > 0 && (
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  <Badge variant="destructive">
                    {latestPoint.lossPct.toFixed(1)}% loss
                  </Badge>
                </div>
              )}
            </div>
          )}

          {isLoading ? (
            <div className="h-80 flex items-center justify-center text-muted-foreground">
              Loading ping data...
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-80 flex items-center justify-center text-muted-foreground">
              No ping history available. Enable ping monitoring for this device.
            </div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis
                    dataKey="timeLabel"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[0, maxRtt * 1.1]}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    tickFormatter={(v) => `${v.toFixed(0)}ms`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  
                  <Area
                    type="monotone"
                    dataKey="rttMax"
                    fill="hsl(var(--chart-3))"
                    stroke="none"
                    fillOpacity={0.2}
                    name="P90-Max"
                  />
                  <Area
                    type="monotone"
                    dataKey="rttP90"
                    fill="hsl(var(--chart-2))"
                    stroke="none"
                    fillOpacity={0.3}
                    name="P75-P90"
                  />
                  <Area
                    type="monotone"
                    dataKey="rttP75"
                    fill="hsl(var(--chart-1))"
                    stroke="none"
                    fillOpacity={0.4}
                    name="P50-P75"
                  />
                  <Area
                    type="monotone"
                    dataKey="rttP50"
                    fill="hsl(var(--chart-1))"
                    stroke="none"
                    fillOpacity={0.5}
                    name="P25-P50"
                  />
                  
                  <Line
                    type="monotone"
                    dataKey="rttAvg"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    name="Average"
                  />
                  <Line
                    type="monotone"
                    dataKey="rttMin"
                    stroke="hsl(var(--chart-4))"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    dot={false}
                    name="Min"
                  />
                  
                  {chartData
                    .filter((d) => d.lossPct > 0)
                    .map((d, i) => (
                      <ReferenceLine
                        key={i}
                        x={d.timeLabel}
                        stroke="hsl(var(--destructive))"
                        strokeWidth={2}
                        strokeOpacity={Math.min(d.lossPct / 20, 1)}
                      />
                    ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="flex items-center gap-4 text-xs text-muted-foreground justify-center">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm bg-primary opacity-80" />
              <span>Average RTT</span>
            </div>
            <div className="flex items-center gap-1">
              <div
                className="w-3 h-3 rounded-sm opacity-40"
                style={{ background: "hsl(var(--chart-1))" }}
              />
              <span>P25-P75</span>
            </div>
            <div className="flex items-center gap-1">
              <div
                className="w-3 h-3 rounded-sm opacity-30"
                style={{ background: "hsl(var(--chart-2))" }}
              />
              <span>P75-P90</span>
            </div>
            <div className="flex items-center gap-1">
              <div
                className="w-3 h-3 rounded-sm opacity-20"
                style={{ background: "hsl(var(--chart-3))" }}
              />
              <span>P90-Max</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm bg-destructive" />
              <span>Packet Loss</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface PingStatusBadgeProps {
  deviceId: string;
  onClick?: () => void;
}

export function PingStatusBadge({ deviceId, onClick }: PingStatusBadgeProps) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  
  const { data: pingData } = useQuery<PingTargetWithHistory[]>({
    queryKey: ["/api/devices", deviceId, "ping-history", "1h"],
    queryFn: async () => {
      const response = await fetch(
        `/api/devices/${deviceId}/ping-history?since=${since.toISOString()}&maxPoints=10`
      );
      if (!response.ok) return [];
      return response.json();
    },
    refetchInterval: 30000,
  });

  if (!pingData || pingData.length === 0) return null;

  const latestPoints = pingData.map((t) => t.history[t.history.length - 1]).filter(Boolean);
  if (latestPoints.length === 0) return null;

  const avgRtt =
    latestPoints.reduce((sum, p) => sum + (p.rttAvg || 0), 0) / latestPoints.length;
  const hasLoss = latestPoints.some((p) => p.lossPct > 0);
  const maxLoss = Math.max(...latestPoints.map((p) => p.lossPct || 0));

  return (
    <Badge
      variant={hasLoss ? "destructive" : "outline"}
      className="cursor-pointer font-mono text-xs whitespace-nowrap flex-shrink-0"
      onClick={onClick}
      data-testid="badge-ping-status"
    >
      <Activity className="h-3 w-3 mr-1 flex-shrink-0" />
      <span className="truncate max-w-[100px]">
        {avgRtt.toFixed(1)}ms{hasLoss && ` / ${maxLoss.toFixed(0)}%`}
      </span>
    </Badge>
  );
}

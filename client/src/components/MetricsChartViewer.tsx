import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Legend,
  LineChart, Line
} from 'recharts';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Activity, HardDrive, Cpu, MemoryStick, Timer, RefreshCw, ArrowDown, ArrowUp } from 'lucide-react';

type TimeRange = '15m' | '1h' | '6h' | '24h' | '7d';

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '15m', label: 'Last 15 min' },
  { value: '1h', label: 'Last 1 hour' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
];

function getTimeRangeMs(range: TimeRange): number {
  switch (range) {
    case '15m': return 15 * 60 * 1000;
    case '1h': return 60 * 60 * 1000;
    case '6h': return 6 * 60 * 60 * 1000;
    case '24h': return 24 * 60 * 60 * 1000;
    case '7d': return 7 * 24 * 60 * 60 * 1000;
  }
}

interface DeviceMetricsHistoryEntry {
  id: string;
  deviceId: string;
  timestamp: string;
  cpuUsagePct?: number;
  memoryUsagePct?: number;
  diskUsagePct?: number;
  pingRtt?: number;
  uptimeSeconds?: number;
}

interface ConnectionBandwidthHistoryEntry {
  id: string;
  connectionId: string;
  timestamp: string;
  inBitsPerSec?: number;
  outBitsPerSec?: number;
  utilizationPct?: number;
}

interface DeviceMetricsChartViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceId: string;
  deviceName: string;
  initialMetric?: 'cpu' | 'memory' | 'disk' | 'ping';
}

interface ConnectionBandwidthChartViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  connectionName: string;
}

function formatTimestamp(timestamp: string, range: TimeRange): string {
  const date = new Date(timestamp);
  if (range === '15m' || range === '1h') {
    return format(date, 'HH:mm:ss');
  } else if (range === '6h' || range === '24h') {
    return format(date, 'HH:mm');
  } else {
    return format(date, 'MM/dd HH:mm');
  }
}

function formatBitsPerSec(bps: number): string {
  if (bps >= 1000000000) return `${(bps / 1000000000).toFixed(2)} Gbps`;
  if (bps >= 1000000) return `${(bps / 1000000).toFixed(2)} Mbps`;
  if (bps >= 1000) return `${(bps / 1000).toFixed(2)} Kbps`;
  return `${bps.toFixed(0)} bps`;
}

export function DeviceMetricsChartViewer({
  open,
  onOpenChange,
  deviceId,
  deviceName,
  initialMetric = 'cpu',
}: DeviceMetricsChartViewerProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('1h');
  const [selectedMetric, setSelectedMetric] = useState(initialMetric);
  const [autoRefresh, setAutoRefresh] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedMetric(initialMetric);
    }
  }, [open, initialMetric]);

  const since = useMemo(() => {
    return new Date(Date.now() - getTimeRangeMs(timeRange)).toISOString();
  }, [timeRange]);

  const { data: metrics = [], isLoading, refetch } = useQuery<DeviceMetricsHistoryEntry[]>({
    queryKey: ['/api/devices', deviceId, 'metrics-history', 'aggregated', since],
    queryFn: async () => {
      const params = new URLSearchParams({ since, maxPoints: '300' });
      const res = await fetch(`/api/devices/${deviceId}/metrics-history/aggregated?${params}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Failed to fetch metrics: ${res.statusText}`);
      return res.json();
    },
    enabled: open && !!deviceId,
    refetchInterval: autoRefresh ? 30000 : false,
  });

  const chartData = useMemo(() => {
    return metrics.map(m => ({
      time: formatTimestamp(m.timestamp, timeRange),
      timestamp: m.timestamp,
      cpu: m.cpuUsagePct,
      memory: m.memoryUsagePct,
      disk: m.diskUsagePct,
      ping: m.pingRtt,
      uptime: m.uptimeSeconds,
    }));
  }, [metrics, timeRange]);

  const hasData = chartData.length > 0;

  const getMetricConfig = () => {
    switch (selectedMetric) {
      case 'cpu':
        return { 
          key: 'cpu', 
          label: 'CPU Usage', 
          color: '#ef4444', 
          unit: '%', 
          icon: Cpu,
          domain: [0, 100] as [number, number]
        };
      case 'memory':
        return { 
          key: 'memory', 
          label: 'Memory Usage', 
          color: '#8b5cf6', 
          unit: '%', 
          icon: MemoryStick,
          domain: [0, 100] as [number, number]
        };
      case 'disk':
        return { 
          key: 'disk', 
          label: 'Disk Usage', 
          color: '#f59e0b', 
          unit: '%', 
          icon: HardDrive,
          domain: [0, 100] as [number, number]
        };
      case 'ping':
        return { 
          key: 'ping', 
          label: 'Ping RTT', 
          color: '#22c55e', 
          unit: 'ms', 
          icon: Activity,
          domain: [0, 'auto'] as [number, 'auto']
        };
      default:
        return { key: 'cpu', label: 'CPU', color: '#ef4444', unit: '%', icon: Cpu, domain: [0, 100] as [number, number] };
    }
  };

  const config = getMetricConfig();
  const Icon = config.icon;

  const latestValue = chartData.length > 0 
    ? chartData[chartData.length - 1][config.key as keyof typeof chartData[0]] 
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {deviceName} - Metrics History
          </DialogTitle>
          <DialogDescription className="sr-only">
            Historical metrics chart for {deviceName}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4 py-2 flex-shrink-0">
          <Tabs value={selectedMetric} onValueChange={(v) => setSelectedMetric(v as typeof selectedMetric)}>
            <TabsList>
              <TabsTrigger value="cpu" className="gap-1" data-testid="tab-cpu">
                <Cpu className="h-3 w-3" /> CPU
              </TabsTrigger>
              <TabsTrigger value="memory" className="gap-1" data-testid="tab-memory">
                <MemoryStick className="h-3 w-3" /> Memory
              </TabsTrigger>
              <TabsTrigger value="disk" className="gap-1" data-testid="tab-disk">
                <HardDrive className="h-3 w-3" /> Disk
              </TabsTrigger>
              <TabsTrigger value="ping" className="gap-1" data-testid="tab-ping">
                <Activity className="h-3 w-3" /> Ping
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
              <SelectTrigger className="w-32" data-testid="select-time-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_RANGE_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={autoRefresh ? 'default' : 'outline'}
              size="icon"
              onClick={() => {
                if (autoRefresh) {
                  setAutoRefresh(false);
                } else {
                  refetch();
                }
              }}
              onDoubleClick={() => setAutoRefresh(!autoRefresh)}
              disabled={isLoading && !autoRefresh}
              title={autoRefresh ? 'Click to stop auto-refresh' : 'Click to refresh, double-click for auto-refresh'}
              data-testid="button-refresh"
            >
              <RefreshCw className={`h-4 w-4 ${autoRefresh || isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {latestValue !== null && latestValue !== undefined && (
          <div className="flex items-center gap-2 pb-2 flex-shrink-0">
            <Badge variant="secondary" className="text-lg px-3 py-1">
              Current: {typeof latestValue === 'number' ? latestValue.toFixed(1) : latestValue}{config.unit}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {chartData.length} data points
            </span>
          </div>
        )}

        <div className="h-[350px]">
          {isLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !hasData ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
              <Timer className="h-12 w-12 mb-4 opacity-50" />
              <p>No metrics data available for this time range</p>
              <p className="text-sm mt-1">Metrics are collected during device probing cycles</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={350}>
              <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 30 }}>
                <defs>
                  <linearGradient id={`gradient-${config.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={config.color} stopOpacity={0.4}/>
                    <stop offset="95%" stopColor={config.color} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis 
                  dataKey="time" 
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  interval="preserveStartEnd"
                />
                <YAxis 
                  domain={config.domain}
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tickFormatter={(value) => `${value}${config.unit}`}
                  width={60}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-popover border rounded-lg p-3 shadow-lg">
                          <p className="text-xs text-muted-foreground mb-1">
                            {format(new Date(data.timestamp), 'PPpp')}
                          </p>
                          <p className="font-medium" style={{ color: config.color }}>
                            {config.label}: {payload[0].value !== null && payload[0].value !== undefined 
                              ? `${Number(payload[0].value).toFixed(1)}${config.unit}` 
                              : 'N/A'}
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area
                  type="monotone"
                  dataKey={config.key}
                  stroke={config.color}
                  strokeWidth={2}
                  fill={`url(#gradient-${config.key})`}
                  connectNulls
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Types for Prometheus metrics
interface PrometheusMetricConfig {
  id: string;
  metricName: string;
  displayName: string;
  unit?: string;
  transform?: string;
}

interface PrometheusMetricsHistoryEntry {
  id: string;
  deviceId: string;
  metricId: string;
  metricName: string;
  value: number;
  rawValue?: number;
  timestamp: string;
}

interface PrometheusMetricsChartViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceId: string;
  deviceName: string;
  prometheusMetrics?: PrometheusMetricConfig[];
  initialMetricId?: string;
}

const PROMETHEUS_METRIC_COLORS = [
  '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#06b6d4', '#84cc16'
];

export function PrometheusMetricsChartViewer({
  open,
  onOpenChange,
  deviceId,
  deviceName,
  prometheusMetrics = [],
  initialMetricId,
}: PrometheusMetricsChartViewerProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('1h');
  const [selectedMetricId, setSelectedMetricId] = useState<string>(initialMetricId || prometheusMetrics[0]?.id || '');
  const [autoRefresh, setAutoRefresh] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialMetricId && prometheusMetrics.some(m => m.id === initialMetricId)) {
        setSelectedMetricId(initialMetricId);
      } else if (prometheusMetrics.length > 0 && !prometheusMetrics.some(m => m.id === selectedMetricId)) {
        setSelectedMetricId(prometheusMetrics[0].id);
      }
    }
  }, [open, initialMetricId, prometheusMetrics, selectedMetricId]);

  const selectedMetric = prometheusMetrics.find(m => m.id === selectedMetricId);
  const metricColor = PROMETHEUS_METRIC_COLORS[prometheusMetrics.findIndex(m => m.id === selectedMetricId) % PROMETHEUS_METRIC_COLORS.length];

  const since = useMemo(() => {
    return new Date(Date.now() - getTimeRangeMs(timeRange)).toISOString();
  }, [timeRange]);

  const { data: history = [], isLoading, refetch } = useQuery<PrometheusMetricsHistoryEntry[]>({
    queryKey: ['/api/devices', deviceId, 'prometheus-metrics', 'history', 'aggregated', selectedMetricId, since],
    queryFn: async () => {
      if (!selectedMetricId) return [];
      const params = new URLSearchParams({ since, metricId: selectedMetricId, maxPoints: '300' });
      const res = await fetch(`/api/devices/${deviceId}/prometheus-metrics/history/aggregated?${params}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Failed to fetch Prometheus metrics: ${res.statusText}`);
      return res.json();
    },
    enabled: open && !!deviceId && !!selectedMetricId,
    refetchInterval: autoRefresh ? 30000 : false,
  });

  const chartData = useMemo(() => {
    return history.map(h => ({
      time: formatTimestamp(h.timestamp, timeRange),
      timestamp: h.timestamp,
      value: h.value,
    }));
  }, [history, timeRange]);

  const hasData = chartData.length > 0;

  const latestValue = chartData.length > 0 ? chartData[chartData.length - 1].value : null;

  const formatValue = (value: number): string => {
    if (selectedMetric?.unit === 'bytes') {
      if (value >= 1073741824) return `${(value / 1073741824).toFixed(2)} GB`;
      if (value >= 1048576) return `${(value / 1048576).toFixed(2)} MB`;
      if (value >= 1024) return `${(value / 1024).toFixed(2)} KB`;
      return `${value.toFixed(0)} B`;
    }
    if (selectedMetric?.unit === '%') {
      return `${value.toFixed(1)}%`;
    }
    if (selectedMetric?.unit === 'seconds') {
      if (value >= 86400) return `${(value / 86400).toFixed(1)} days`;
      if (value >= 3600) return `${(value / 3600).toFixed(1)} hours`;
      if (value >= 60) return `${(value / 60).toFixed(1)} min`;
      return `${value.toFixed(1)} sec`;
    }
    // Default: just format the number
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(2);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            {deviceName} - Custom Metrics History
          </DialogTitle>
          <DialogDescription className="sr-only">
            Historical custom Prometheus metrics chart for {deviceName}
          </DialogDescription>
        </DialogHeader>

        {prometheusMetrics.length === 0 ? (
          <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground">
            <Activity className="h-12 w-12 mb-4 opacity-50" />
            <p>No custom metrics configured for this device</p>
            <p className="text-sm mt-1">Add Prometheus metrics in the device credentials</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 py-2 flex-shrink-0">
              <Select value={selectedMetricId} onValueChange={setSelectedMetricId}>
                <SelectTrigger className="w-[250px]" data-testid="select-prometheus-metric">
                  <SelectValue placeholder="Select a metric" />
                </SelectTrigger>
                <SelectContent>
                  {prometheusMetrics.map((metric, idx) => (
                    <SelectItem key={metric.id} value={metric.id}>
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-2 h-2 rounded-full" 
                          style={{ backgroundColor: PROMETHEUS_METRIC_COLORS[idx % PROMETHEUS_METRIC_COLORS.length] }}
                        />
                        {metric.displayName || metric.id}
                        {metric.unit && <span className="text-muted-foreground">({metric.unit})</span>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2">
                <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
                  <SelectTrigger className="w-32" data-testid="select-prometheus-time-range">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_RANGE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant={autoRefresh ? 'default' : 'outline'}
                  size="icon"
                  onClick={() => {
                    if (autoRefresh) {
                      setAutoRefresh(false);
                    } else {
                      refetch();
                    }
                  }}
                  onDoubleClick={() => setAutoRefresh(!autoRefresh)}
                  disabled={isLoading && !autoRefresh}
                  title={autoRefresh ? 'Click to stop auto-refresh' : 'Click to refresh, double-click for auto-refresh'}
                  data-testid="button-prometheus-refresh"
                >
                  <RefreshCw className={`h-4 w-4 ${autoRefresh || isLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>

            {latestValue !== null && latestValue !== undefined && (
              <div className="flex items-center gap-2 pb-2 flex-shrink-0">
                <Badge variant="secondary" className="text-lg px-3 py-1">
                  Current: {formatValue(latestValue)}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {chartData.length} data points
                </span>
              </div>
            )}

            <div className="h-[350px]">
              {isLoading ? (
                <div className="h-full flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : !hasData ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                  <Timer className="h-12 w-12 mb-4 opacity-50" />
                  <p>No data available for "{selectedMetric?.displayName || selectedMetricId}"</p>
                  <p className="text-sm mt-1">Data is collected during device probing cycles</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={350}>
                  <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 30 }}>
                    <defs>
                      <linearGradient id="gradientPrometheus" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={metricColor} stopOpacity={0.4}/>
                        <stop offset="95%" stopColor={metricColor} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                    <XAxis 
                      dataKey="time" 
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={{ stroke: 'hsl(var(--border))' }}
                      interval="preserveStartEnd"
                    />
                    <YAxis 
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={{ stroke: 'hsl(var(--border))' }}
                      tickFormatter={(value) => formatValue(value)}
                      width={80}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-popover border rounded-lg p-3 shadow-lg">
                              <p className="text-xs text-muted-foreground mb-1">
                                {format(new Date(data.timestamp), 'PPpp')}
                              </p>
                              <p className="font-medium" style={{ color: metricColor }}>
                                {selectedMetric?.displayName || selectedMetricId}: {formatValue(data.value)}
                              </p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={metricColor}
                      strokeWidth={2}
                      fill="url(#gradientPrometheus)"
                      connectNulls
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ConnectionBandwidthChartViewer({
  open,
  onOpenChange,
  connectionId,
  connectionName,
}: ConnectionBandwidthChartViewerProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('1h');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const since = useMemo(() => {
    return new Date(Date.now() - getTimeRangeMs(timeRange)).toISOString();
  }, [timeRange]);

  const { data: history = [], isLoading, refetch } = useQuery<ConnectionBandwidthHistoryEntry[]>({
    queryKey: ['/api/connections', connectionId, 'bandwidth-history', 'aggregated', since],
    queryFn: async () => {
      const params = new URLSearchParams({ since, maxPoints: '300' });
      const res = await fetch(`/api/connections/${connectionId}/bandwidth-history/aggregated?${params}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Failed to fetch bandwidth history: ${res.statusText}`);
      return res.json();
    },
    enabled: open && !!connectionId,
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const chartData = useMemo(() => {
    return history.map(h => ({
      time: formatTimestamp(h.timestamp, timeRange),
      timestamp: h.timestamp,
      inbound: h.inBitsPerSec ?? 0,
      outbound: h.outBitsPerSec ?? 0,
      utilization: h.utilizationPct ?? 0,
    }));
  }, [history, timeRange]);

  const hasData = chartData.length > 0;

  const latestIn = chartData.length > 0 ? chartData[chartData.length - 1].inbound : 0;
  const latestOut = chartData.length > 0 ? chartData[chartData.length - 1].outbound : 0;
  const latestUtil = chartData.length > 0 ? chartData[chartData.length - 1].utilization : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            {connectionName} - Bandwidth History
          </DialogTitle>
          <DialogDescription className="sr-only">
            Bandwidth history chart for {connectionName}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4 py-2 flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-blue-500">
              <ArrowDown className="h-4 w-4" />
              <span className="text-sm font-medium">{formatBitsPerSec(latestIn)}</span>
            </div>
            <div className="flex items-center gap-2 text-green-500">
              <ArrowUp className="h-4 w-4" />
              <span className="text-sm font-medium">{formatBitsPerSec(latestOut)}</span>
            </div>
            <Badge variant={latestUtil > 80 ? 'destructive' : latestUtil > 50 ? 'secondary' : 'outline'}>
              {latestUtil.toFixed(1)}% utilization
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
              <SelectTrigger className="w-32" data-testid="select-bandwidth-time-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_RANGE_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={autoRefresh ? 'default' : 'outline'}
              size="icon"
              onClick={() => {
                if (autoRefresh) {
                  setAutoRefresh(false);
                } else {
                  refetch();
                }
              }}
              onDoubleClick={() => setAutoRefresh(!autoRefresh)}
              disabled={isLoading && !autoRefresh}
              title={autoRefresh ? 'Click to stop auto-refresh' : 'Click to refresh, double-click for auto-refresh'}
              data-testid="button-bandwidth-refresh"
            >
              <RefreshCw className={`h-4 w-4 ${autoRefresh || isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        <div className="text-sm text-muted-foreground pb-2 flex-shrink-0">
          {chartData.length} data points
        </div>

        <div className="h-[350px]">
          {isLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !hasData ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
              <Timer className="h-12 w-12 mb-4 opacity-50" />
              <p>No bandwidth data available for this time range</p>
              <p className="text-sm mt-1">Bandwidth is collected during traffic monitoring cycles</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={350}>
              <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 30 }}>
                <defs>
                  <linearGradient id="gradientIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gradientOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis 
                  dataKey="time" 
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  interval="preserveStartEnd"
                />
                <YAxis 
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tickFormatter={(value) => {
                    if (value >= 1000000000) return `${(value / 1000000000).toFixed(0)}G`;
                    if (value >= 1000000) return `${(value / 1000000).toFixed(0)}M`;
                    if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
                    return `${value}`;
                  }}
                  width={60}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-popover border rounded-lg p-3 shadow-lg">
                          <p className="text-xs text-muted-foreground mb-2">
                            {format(new Date(data.timestamp), 'PPpp')}
                          </p>
                          <div className="space-y-1">
                            <p className="text-blue-500 flex items-center gap-1">
                              <ArrowDown className="h-3 w-3" />
                              In: {formatBitsPerSec(data.inbound)}
                            </p>
                            <p className="text-green-500 flex items-center gap-1">
                              <ArrowUp className="h-3 w-3" />
                              Out: {formatBitsPerSec(data.outbound)}
                            </p>
                            <p className="text-muted-foreground text-sm">
                              Utilization: {data.utilization.toFixed(1)}%
                            </p>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend 
                  verticalAlign="top" 
                  height={36}
                  formatter={(value) => value === 'inbound' ? 'Inbound' : 'Outbound'}
                />
                <Area
                  type="monotone"
                  dataKey="inbound"
                  name="inbound"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#gradientIn)"
                />
                <Area
                  type="monotone"
                  dataKey="outbound"
                  name="outbound"
                  stroke="#22c55e"
                  strokeWidth={2}
                  fill="url(#gradientOut)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

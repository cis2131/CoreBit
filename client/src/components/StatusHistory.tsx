import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Clock, AlertCircle, CheckCircle2, AlertTriangle, HelpCircle } from "lucide-react";
import { format } from "date-fns";
import type { DeviceStatusEvent } from "@shared/schema";

interface StatusHistoryBarProps {
  deviceId: string;
  onClick?: () => void;
}

interface StatusHistoryModalProps {
  deviceId: string;
  deviceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface StatusSummary {
  since: string;
  totalMs: number;
  summary: Array<{ status: string; durationMs: number; percentage: number }>;
}

interface StatusSegment {
  status: string;
  startTime: string;
  endTime: string;
}

interface StatusSegmentsResponse {
  since: string;
  until: string;
  segments: StatusSegment[];
}

const statusColors: Record<string, string> = {
  online: "bg-green-500",
  warning: "bg-yellow-500",
  stale: "bg-orange-500",
  offline: "bg-red-500",
  unknown: "bg-gray-400",
};

const statusTextColors: Record<string, string> = {
  online: "text-green-600 dark:text-green-400",
  warning: "text-yellow-600 dark:text-yellow-400",
  stale: "text-orange-600 dark:text-orange-400",
  offline: "text-red-600 dark:text-red-400",
  unknown: "text-gray-600 dark:text-gray-400",
};

const statusIcons: Record<string, typeof CheckCircle2> = {
  online: CheckCircle2,
  warning: AlertTriangle,
  stale: AlertCircle,
  offline: AlertCircle,
  unknown: HelpCircle,
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }
  if (hours > 0) {
    const remainingMins = minutes % 60;
    return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

function formatEventTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  if (diffDays === 0) {
    return `Today ${timeStr}`;
  } else if (diffDays === 1) {
    return `Yesterday ${timeStr}`;
  } else {
    return `${date.toLocaleDateString()} ${timeStr}`;
  }
}

function generateTimeLabels(since: Date, until: Date, range: string): { time: Date; label: string }[] {
  const labels: { time: Date; label: string }[] = [];
  const totalMs = until.getTime() - since.getTime();
  
  // Determine appropriate interval based on range
  let intervalMs: number;
  let formatStr: string;
  
  if (range === '24h') {
    intervalMs = 4 * 60 * 60 * 1000; // 4 hours
    formatStr = 'HH:mm';
  } else if (range === '7d') {
    intervalMs = 24 * 60 * 60 * 1000; // 1 day
    formatStr = 'MMM d';
  } else if (range === '30d') {
    intervalMs = 5 * 24 * 60 * 60 * 1000; // 5 days
    formatStr = 'MMM d';
  } else {
    intervalMs = 15 * 24 * 60 * 60 * 1000; // 15 days
    formatStr = 'MMM d';
  }
  
  let current = new Date(since);
  // Round to nearest interval
  current.setMinutes(0, 0, 0);
  if (range === '24h') {
    current.setHours(Math.ceil(current.getHours() / 4) * 4);
  }
  
  while (current <= until) {
    if (current >= since) {
      labels.push({
        time: new Date(current),
        label: format(current, formatStr)
      });
    }
    current = new Date(current.getTime() + intervalMs);
  }
  
  return labels;
}

interface StatusTimelineBarProps {
  deviceId: string;
  range?: string;
  height?: number;
  showLabels?: boolean;
  onClick?: () => void;
}

export function StatusTimelineBar({ 
  deviceId, 
  range = '24h', 
  height = 24,
  showLabels = true,
  onClick 
}: StatusTimelineBarProps) {
  const { data: segmentsData, isLoading } = useQuery<StatusSegmentsResponse>({
    queryKey: ['/api/devices', deviceId, 'status-segments', range],
    queryFn: async () => {
      const response = await fetch(`/api/devices/${deviceId}/status-segments?range=${range}`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch status segments');
      return response.json();
    },
    refetchInterval: 60000,
  });

  const timeLabels = useMemo(() => {
    if (!segmentsData) return [];
    const since = new Date(segmentsData.since);
    const until = new Date(segmentsData.until);
    return generateTimeLabels(since, until, range);
  }, [segmentsData, range]);

  if (isLoading || !segmentsData) {
    return (
      <div className="space-y-1">
        <div 
          className="bg-muted rounded-sm animate-pulse"
          style={{ height }}
        />
        {showLabels && <div className="h-4" />}
      </div>
    );
  }

  const since = new Date(segmentsData.since);
  const until = new Date(segmentsData.until);
  const totalMs = until.getTime() - since.getTime();

  if (segmentsData.segments.length === 0) {
    return (
      <div className="space-y-1">
        <div 
          className="bg-gray-300 dark:bg-gray-600 rounded-sm flex items-center justify-center cursor-pointer hover-elevate"
          style={{ height }}
          onClick={onClick}
          data-testid="status-timeline-bar-empty"
        >
          <span className="text-[10px] text-muted-foreground">No data</span>
        </div>
        {showLabels && <div className="h-4" />}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div 
        className="relative rounded-sm overflow-hidden cursor-pointer hover-elevate"
        style={{ height }}
        onClick={onClick}
        data-testid="status-timeline-bar"
      >
        {segmentsData.segments.map((segment, index) => {
          const startTime = new Date(segment.startTime);
          const endTime = new Date(segment.endTime);
          const startPct = ((startTime.getTime() - since.getTime()) / totalMs) * 100;
          const widthPct = ((endTime.getTime() - startTime.getTime()) / totalMs) * 100;
          
          return (
            <Tooltip key={index}>
              <TooltipTrigger asChild>
                <div
                  className={`absolute top-0 h-full ${statusColors[segment.status] || statusColors.unknown} transition-all flex items-center justify-center`}
                  style={{ 
                    left: `${startPct}%`, 
                    width: `${Math.max(widthPct, 0.5)}%` 
                  }}
                >
                  {widthPct > 10 && (
                    <span className="text-[10px] text-white font-medium capitalize px-1 truncate">
                      {segment.status === 'online' ? 'On' : segment.status === 'offline' ? 'Off' : segment.status}
                    </span>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <div className="font-medium capitalize">{segment.status}</div>
                <div className="text-muted-foreground">
                  {format(startTime, 'MMM d HH:mm')} - {format(endTime, 'HH:mm')}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      
      {showLabels && (
        <div className="relative h-4 text-[10px] text-muted-foreground">
          {timeLabels.map((label, index) => {
            const pct = ((label.time.getTime() - since.getTime()) / totalMs) * 100;
            return (
              <span
                key={index}
                className="absolute transform -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${Math.min(Math.max(pct, 3), 97)}%` }}
              >
                {label.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function StatusHistoryBar({ deviceId, onClick }: StatusHistoryBarProps) {
  return (
    <StatusTimelineBar 
      deviceId={deviceId} 
      range="24h" 
      height={16}
      showLabels={false}
      onClick={onClick}
    />
  );
}

export function StatusHistoryModal({ deviceId, deviceName, open, onOpenChange }: StatusHistoryModalProps) {
  const [range, setRange] = useState<string>('24h');
  const [includeWarnings, setIncludeWarnings] = useState(true);

  const { data: summary, isLoading: summaryLoading } = useQuery<StatusSummary>({
    queryKey: ['/api/devices', deviceId, 'status-summary', range],
    queryFn: async () => {
      const response = await fetch(`/api/devices/${deviceId}/status-summary?range=${range}`);
      if (!response.ok) throw new Error('Failed to fetch status summary');
      return response.json();
    },
    enabled: open,
  });

  const { data: events, isLoading: eventsLoading } = useQuery<DeviceStatusEvent[]>({
    queryKey: ['/api/devices', deviceId, 'status-events', range, includeWarnings],
    queryFn: async () => {
      const response = await fetch(`/api/devices/${deviceId}/status-events?range=${range}&includeWarnings=${includeWarnings}`);
      if (!response.ok) throw new Error('Failed to fetch status events');
      return response.json();
    },
    enabled: open,
  });

  const rangeLabels: Record<string, string> = {
    '24h': 'Last 24 Hours',
    '7d': 'Last 7 Days',
    '30d': 'Last 30 Days',
    '90d': 'Last 90 Days',
  };

  const filteredSummary = summary?.summary.filter(
    item => includeWarnings || item.status !== 'warning'
  ) || [];

  const sortedSummary = [...filteredSummary].sort((a, b) => {
    const order = ['online', 'warning', 'stale', 'offline', 'unknown'];
    return order.indexOf(a.status) - order.indexOf(b.status);
  });

  const recalculatedPercentages = sortedSummary.map(item => {
    const totalFiltered = filteredSummary.reduce((acc, s) => acc + s.durationMs, 0);
    return {
      ...item,
      percentage: totalFiltered > 0 ? Math.round((item.durationMs / totalFiltered) * 1000) / 10 : 0,
    };
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Status History - {deviceName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4 py-2">
          <div className="flex items-center gap-4">
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="w-40" data-testid="select-time-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">Last 24 Hours</SelectItem>
                <SelectItem value="7d">Last 7 Days</SelectItem>
                <SelectItem value="30d">Last 30 Days</SelectItem>
                <SelectItem value="90d">Last 90 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex items-center gap-2">
            <Switch
              id="include-warnings"
              checked={includeWarnings}
              onCheckedChange={setIncludeWarnings}
              data-testid="switch-include-warnings"
            />
            <Label htmlFor="include-warnings" className="text-sm">
              Include Warnings
            </Label>
          </div>
        </div>

        <Separator />

        <div className="space-y-4 py-4">
          <div>
            <h4 className="text-sm font-medium mb-2">Status Overview - {rangeLabels[range]}</h4>
            
            <div className="mb-4">
              <StatusTimelineBar 
                deviceId={deviceId} 
                range={range} 
                height={32}
                showLabels={true}
              />
            </div>
            
            {summaryLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-12 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : recalculatedPercentages.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {recalculatedPercentages.map((item) => {
                  const Icon = statusIcons[item.status] || statusIcons.unknown;
                  return (
                    <div 
                      key={item.status}
                      className="flex items-center gap-2 p-2 rounded-md bg-muted/50"
                    >
                      <div className={`w-3 h-3 rounded-full ${statusColors[item.status]}`} />
                      <div className="flex flex-col">
                        <span className={`text-sm font-medium capitalize ${statusTextColors[item.status]}`}>
                          {item.status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {item.percentage}% ({formatDuration(item.durationMs)})
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground text-sm">
                No status data available for this period
              </div>
            )}
          </div>

          <Separator />

          <div>
            <h4 className="text-sm font-medium mb-2">Status Change Log</h4>
            
            {eventsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : events && events.length > 0 ? (
              <ScrollArea className="h-[300px]">
                <div className="space-y-2 pr-4">
                  {events.map((event) => {
                    const Icon = statusIcons[event.newStatus] || statusIcons.unknown;
                    return (
                      <div
                        key={event.id}
                        className="flex items-start gap-3 p-3 rounded-md bg-muted/30 border border-border/50"
                        data-testid={`status-event-${event.id}`}
                      >
                        <div className={`mt-0.5 ${statusTextColors[event.newStatus]}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {event.previousStatus && (
                              <>
                                <Badge 
                                  variant="outline" 
                                  className={`text-xs ${statusTextColors[event.previousStatus]}`}
                                >
                                  {event.previousStatus}
                                </Badge>
                                <span className="text-muted-foreground">→</span>
                              </>
                            )}
                            <Badge 
                              variant="outline"
                              className={`text-xs ${statusTextColors[event.newStatus]}`}
                            >
                              {event.newStatus}
                            </Badge>
                          </div>
                          {event.message && (
                            <p className="text-xs text-muted-foreground mt-1 truncate">
                              {event.message}
                            </p>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatEventTime(event.createdAt as unknown as string)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No status changes recorded for this period
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

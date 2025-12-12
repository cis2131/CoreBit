import { useState } from "react";
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
import { Clock, AlertCircle, CheckCircle2, AlertTriangle, HelpCircle } from "lucide-react";
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

export function StatusHistoryBar({ deviceId, onClick }: StatusHistoryBarProps) {
  const { data: summary, isLoading } = useQuery<StatusSummary>({
    queryKey: ['/api/devices', deviceId, 'status-summary', '24h'],
    queryFn: async () => {
      const response = await fetch(`/api/devices/${deviceId}/status-summary?range=24h`);
      if (!response.ok) throw new Error('Failed to fetch status summary');
      return response.json();
    },
    refetchInterval: 60000,
  });

  if (isLoading || !summary || summary.summary.length === 0) {
    return (
      <div 
        className="h-4 bg-muted rounded-sm cursor-pointer hover-elevate"
        onClick={onClick}
        data-testid="status-history-bar-empty"
      >
        <div className="h-full bg-gray-300 dark:bg-gray-600 rounded-sm flex items-center justify-center">
          <span className="text-[10px] text-muted-foreground">No data</span>
        </div>
      </div>
    );
  }

  const sortedSummary = [...summary.summary].sort((a, b) => {
    const order = ['online', 'warning', 'stale', 'offline', 'unknown'];
    return order.indexOf(a.status) - order.indexOf(b.status);
  });

  return (
    <div 
      className="h-4 rounded-sm overflow-hidden flex cursor-pointer hover-elevate"
      onClick={onClick}
      title="Click to view detailed status history"
      data-testid="status-history-bar"
    >
      {sortedSummary.map((item, index) => (
        <div
          key={item.status}
          className={`${statusColors[item.status] || statusColors.unknown} h-full transition-all`}
          style={{ width: `${item.percentage}%` }}
          title={`${item.status}: ${item.percentage}%`}
        />
      ))}
    </div>
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
            
            {summaryLoading ? (
              <div className="h-8 bg-muted rounded animate-pulse" />
            ) : recalculatedPercentages.length > 0 ? (
              <>
                <div className="h-8 rounded overflow-hidden flex mb-3">
                  {recalculatedPercentages.map((item) => (
                    <div
                      key={item.status}
                      className={`${statusColors[item.status] || statusColors.unknown} h-full flex items-center justify-center text-white text-xs font-medium transition-all`}
                      style={{ width: `${Math.max(item.percentage, item.percentage > 0 ? 8 : 0)}%` }}
                    >
                      {item.percentage >= 10 && `${item.percentage}%`}
                    </div>
                  ))}
                </div>
                
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
              </>
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

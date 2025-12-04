import { useQuery, useMutation } from '@tanstack/react-query';
import { Log, Device } from '@shared/schema';
import { useState, useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowUpCircle, ArrowDownCircle, AlertCircle, Info, ArrowLeft, Trash2, Search, X } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'wouter';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

export default function Logs() {
  const [selectedDevice, setSelectedDevice] = useState<string>('all');
  const [selectedEventType, setSelectedEventType] = useState<string>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const { toast } = useToast();

  const { data: devices = [], isLoading: devicesLoading } = useQuery<Device[]>({
    queryKey: ['/api/devices'],
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<Log[]>({
    queryKey: selectedDevice === 'all' ? ['/api/logs'] : ['/api/logs/device', selectedDevice],
    enabled: selectedDevice !== '',
    refetchInterval: 5000,
  });

  const clearLogsMutation = useMutation({
    mutationFn: async () => {
      const endpoint = selectedDevice === 'all' 
        ? '/api/logs' 
        : `/api/logs/device/${selectedDevice}`;
      await apiRequest('DELETE', endpoint);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/logs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/logs/device'] });
      toast({
        title: 'Success',
        description: selectedDevice === 'all' 
          ? 'All logs cleared successfully' 
          : 'Device logs cleared successfully',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to clear logs',
        variant: 'destructive',
      });
    },
  });

  const getDeviceName = (deviceId: string | null) => {
    if (!deviceId) return 'System';
    const device = devices.find(d => d.id === deviceId);
    return device?.name || 'Unknown Device';
  };

  const filteredLogs = useMemo(() => {
    let result = logs;
    
    // Filter by event type
    if (selectedEventType !== 'all') {
      result = result.filter(log => log.eventType === selectedEventType);
    }
    
    // Filter by severity
    if (selectedSeverity !== 'all') {
      result = result.filter(log => log.severity === selectedSeverity);
    }
    
    // Filter by search query
    if (!searchQuery.trim()) return result;
    
    const query = searchQuery.toLowerCase().trim();
    return result.filter(log => {
      const deviceName = getDeviceName(log.deviceId).toLowerCase();
      const message = (log.message || '').toLowerCase();
      const severity = (log.severity || '').toLowerCase();
      const eventType = (log.eventType || '').toLowerCase();
      const oldStatus = (log.oldStatus || '').toLowerCase();
      const newStatus = (log.newStatus || '').toLowerCase();
      const ipAddress = (log.metadata as any)?.ipAddress?.toLowerCase() || '';
      
      return (
        deviceName.includes(query) ||
        message.includes(query) ||
        severity.includes(query) ||
        eventType.includes(query) ||
        oldStatus.includes(query) ||
        newStatus.includes(query) ||
        ipAddress.includes(query)
      );
    });
  }, [logs, searchQuery, devices, selectedEventType, selectedSeverity]);

  // Extract unique event types and severities from logs
  const eventTypes = useMemo(() => {
    const types = new Set(logs.map(log => log.eventType).filter(Boolean));
    return Array.from(types).sort();
  }, [logs]);

  const severities = useMemo(() => {
    const sev = new Set(logs.map(log => log.severity).filter(Boolean));
    return Array.from(sev).sort();
  }, [logs]);

  const getStatusIcon = (log: Log) => {
    if (log.eventType === 'status_change') {
      if (log.newStatus === 'online') {
        return <ArrowUpCircle className="h-5 w-5 text-green-500" />;
      } else if (log.newStatus === 'offline') {
        return <ArrowDownCircle className="h-5 w-5 text-red-500" />;
      } else if (log.newStatus === 'warning') {
        return <AlertCircle className="h-5 w-5 text-yellow-500" />;
      }
    }
    return <Info className="h-5 w-5 text-blue-500" />;
  };

  const getSeverityBadge = (severity: string) => {
    const variants: Record<string, { variant: 'default' | 'destructive' | 'outline' | 'secondary', className?: string }> = {
      error: { variant: 'destructive' },
      warning: { variant: 'default', className: 'bg-yellow-500 text-white hover:bg-yellow-600' },
      info: { variant: 'secondary' },
    };
    const config = variants[severity] || variants.info;
    return (
      <Badge variant={config.variant} className={config.className} data-testid={`badge-severity-${severity}`}>
        {severity}
      </Badge>
    );
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="border-b bg-card">
        <div className="flex items-center gap-4 px-6 py-4">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-page-title">Event Logs</h1>
            <p className="text-sm text-muted-foreground">Monitor device status changes and system events</p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <CardTitle>Recent Events</CardTitle>
                {searchQuery && (
                  <Badge variant="secondary" data-testid="badge-search-count">
                    {filteredLogs.length} of {logs.length}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Search logs..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 pr-8 w-[220px]"
                    data-testid="input-search-logs"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      data-testid="button-clear-search"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <Select value={selectedDevice} onValueChange={setSelectedDevice}>
                  <SelectTrigger className="w-[180px]" data-testid="select-device-filter">
                    <SelectValue placeholder="All devices" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" data-testid="select-device-all">All devices</SelectItem>
                    {devices.map(device => (
                      <SelectItem 
                        key={device.id} 
                        value={device.id}
                        data-testid={`select-device-${device.id}`}
                      >
                        {device.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedEventType} onValueChange={setSelectedEventType}>
                  <SelectTrigger className="w-[160px]" data-testid="select-event-type-filter">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" data-testid="select-event-type-all">All types</SelectItem>
                    {eventTypes.map(type => (
                      <SelectItem 
                        key={type} 
                        value={type}
                        data-testid={`select-event-type-${type}`}
                      >
                        {type.replace(/_/g, ' ').charAt(0).toUpperCase() + type.replace(/_/g, ' ').slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedSeverity} onValueChange={setSelectedSeverity}>
                  <SelectTrigger className="w-[140px]" data-testid="select-severity-filter">
                    <SelectValue placeholder="All levels" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" data-testid="select-severity-all">All levels</SelectItem>
                    {severities.map(severity => (
                      <SelectItem 
                        key={severity} 
                        value={severity}
                        data-testid={`select-severity-${severity}`}
                      >
                        {severity.charAt(0).toUpperCase() + severity.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => clearLogsMutation.mutate()}
                  disabled={clearLogsMutation.isPending || logs.length === 0}
                  data-testid="button-clear-logs"
                  className="gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  Clear All
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {logsLoading || devicesLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading logs...
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No events logged yet. Status changes will appear here automatically.
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No logs match your search "{searchQuery}"
              </div>
            ) : (
              <div className="space-y-2">
                {filteredLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start gap-4 p-4 rounded-lg border bg-card hover-elevate"
                    data-testid={`log-entry-${log.id}`}
                  >
                    <div className="mt-0.5">
                      {getStatusIcon(log)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium" data-testid={`log-device-${log.id}`}>
                          {getDeviceName(log.deviceId)}
                        </span>
                        {getSeverityBadge(log.severity)}
                        <span className="text-xs text-muted-foreground ml-auto" data-testid={`log-timestamp-${log.id}`}>
                          {format(new Date(log.timestamp), 'MMM dd, yyyy HH:mm:ss')}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground" data-testid={`log-message-${log.id}`}>
                        {log.message}
                      </p>
                      {log.oldStatus && log.newStatus && (
                        <div className="flex items-center gap-2 mt-2 text-xs">
                          <Badge variant="outline" data-testid={`log-old-status-${log.id}`}>
                            {log.oldStatus}
                          </Badge>
                          <span className="text-muted-foreground">→</span>
                          <Badge variant="outline" data-testid={`log-new-status-${log.id}`}>
                            {log.newStatus}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

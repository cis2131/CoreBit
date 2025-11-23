import { useQuery } from '@tanstack/react-query';
import { Log, Device } from '@shared/schema';
import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpCircle, ArrowDownCircle, AlertCircle, Info, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'wouter';

export default function Logs() {
  const [selectedDevice, setSelectedDevice] = useState<string>('all');

  const { data: devices = [], isLoading: devicesLoading } = useQuery<Device[]>({
    queryKey: ['/api/devices'],
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<Log[]>({
    queryKey: selectedDevice === 'all' ? ['/api/logs'] : ['/api/logs/device', selectedDevice],
    enabled: selectedDevice !== '',
  });

  const getDeviceName = (deviceId: string | null) => {
    if (!deviceId) return 'System';
    const device = devices.find(d => d.id === deviceId);
    return device?.name || 'Unknown Device';
  };

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
            <div className="flex items-center justify-between gap-4">
              <CardTitle>Recent Events</CardTitle>
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted-foreground">Filter by device:</label>
                <Select value={selectedDevice} onValueChange={setSelectedDevice}>
                  <SelectTrigger className="w-[200px]" data-testid="select-device-filter">
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
            ) : (
              <div className="space-y-2">
                {logs.map((log) => (
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

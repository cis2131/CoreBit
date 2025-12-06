import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Users, BellOff, X, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { format } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface OnDutyUser {
  id: string;
  username: string;
  displayName: string | null;
}

interface OnDutyResponse {
  shift: 'day' | 'night' | null;
  users: OnDutyUser[];
  message?: string;
}

interface AlarmMute {
  id: string;
  userId: string | null;
  mutedBy: string;
  muteUntil: string | null;
  reason: string | null;
  createdAt: string;
  mutedUser: { id: string; username: string; displayName: string | null } | null;
  mutedByUser: { id: string; username: string; displayName: string | null } | null;
}

const MUTE_DURATIONS = [
  { value: '1', label: '1 Hour' },
  { value: '3', label: '3 Hours' },
  { value: '10', label: '10 Hours' },
  { value: '24', label: '24 Hours' },
  { value: 'forever', label: 'Forever' },
];

function MuteButton({ targetUserId, targetName, isGlobal = false }: { targetUserId?: string; targetName: string; isGlobal?: boolean }) {
  const [duration, setDuration] = useState<string>('1');
  const [isOpen, setIsOpen] = useState(false);

  const createMute = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/alarm-mutes', {
        userId: targetUserId || null,
        duration,
        reason: `Muted ${isGlobal ? 'all alarms' : targetName}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/alarm-mutes'] });
      setIsOpen(false);
    },
  });

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button 
          size="sm" 
          variant="ghost" 
          className="h-6 w-6 p-0"
          data-testid={`button-mute-${isGlobal ? 'global' : targetUserId}`}
        >
          <BellOff className="h-3 w-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56" align="end">
        <div className="space-y-3">
          <p className="text-sm font-medium">
            Mute {isGlobal ? 'All Alarms' : targetName}
          </p>
          <Select value={duration} onValueChange={setDuration}>
            <SelectTrigger className="h-8" data-testid="select-mute-duration">
              <SelectValue placeholder="Select duration" />
            </SelectTrigger>
            <SelectContent>
              {MUTE_DURATIONS.map((d) => (
                <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="w-full"
            onClick={() => createMute.mutate()}
            disabled={createMute.isPending}
            data-testid="button-confirm-mute"
          >
            {createMute.isPending ? 'Muting...' : 'Mute'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MuteIndicator({ mute, canUnmute }: { mute: AlarmMute; canUnmute: boolean }) {
  const deleteMute = useMutation({
    mutationFn: async () => {
      return apiRequest('DELETE', `/api/alarm-mutes/${mute.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/alarm-mutes'] });
    },
  });

  const formatMuteTime = (muteUntil: string | null) => {
    if (!muteUntil) return 'Forever';
    return format(new Date(muteUntil), 'MMM d, h:mm a');
  };

  return (
    <div className="flex items-center gap-1">
      <Badge variant="secondary" className="text-xs gap-1 pl-1.5 pr-1">
        <BellOff className="h-3 w-3" />
        <span className="text-[10px]">
          {mute.muteUntil ? `Until ${formatMuteTime(mute.muteUntil)}` : 'Muted'}
        </span>
        {canUnmute && (
          <Button
            size="sm"
            variant="ghost"
            className="h-4 w-4 p-0 ml-0.5 hover:bg-destructive/20"
            onClick={() => deleteMute.mutate()}
            disabled={deleteMute.isPending}
            data-testid={`button-unmute-${mute.id}`}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </Badge>
    </div>
  );
}

interface OnDutyPanelProps {
  isCollapsed?: boolean;
}

export function OnDutyPanel({ isCollapsed = false }: OnDutyPanelProps) {
  const { user } = useAuth();
  const canMute = user?.role === 'admin' || user?.role === 'superuser';
  const [isExpanded, setIsExpanded] = useState(false);

  const { data: onDutyData } = useQuery<OnDutyResponse>({
    queryKey: ['/api/duty-on-call'],
    refetchInterval: 30000,
  });

  const { data: mutes = [] } = useQuery<AlarmMute[]>({
    queryKey: ['/api/alarm-mutes'],
    refetchInterval: 30000,
  });

  const globalMute = mutes.find(m => !m.userId);
  const userMutes = mutes.filter(m => m.userId);

  const getUserMute = (userId: string) => userMutes.find(m => m.userId === userId);

  if (isCollapsed) {
    return (
      <div className="flex items-center justify-center py-2">
        <div className="relative">
          <Users className="h-4 w-4 text-muted-foreground" />
          {onDutyData?.users && onDutyData.users.length > 0 && (
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-green-500" />
          )}
        </div>
      </div>
    );
  }

  if (!onDutyData?.shift) {
    return (
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertCircle className="h-4 w-4" />
          <span className="text-xs">No shift configured</span>
        </div>
      </div>
    );
  }

  const userCount = onDutyData.users.length;
  const shiftLabel = onDutyData.shift === 'day' ? 'Day' : 'Night';

  return (
    <div className="px-3 py-2 border-b border-border">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 hover:bg-muted/50 rounded px-1 py-0.5 -ml-1 transition-colors">
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              )}
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs">
                {userCount} on {shiftLabel} shift
              </span>
              {globalMute && (
                <BellOff className="h-3 w-3 text-orange-500" />
              )}
            </button>
          </CollapsibleTrigger>
          {canMute && !globalMute && (
            <MuteButton targetName="All" isGlobal />
          )}
          {globalMute && canMute && (
            <MuteIndicator mute={globalMute} canUnmute={canMute} />
          )}
        </div>

        <CollapsibleContent className="mt-2 space-y-1">
          {globalMute && (
            <div className="bg-orange-500/10 rounded-md p-2 mb-2">
              <span className="text-xs text-orange-500">All alarms muted</span>
            </div>
          )}

          {userCount === 0 ? (
            <p className="text-xs text-muted-foreground pl-5">No operators on duty</p>
          ) : (
            onDutyData.users.map((u) => {
              const userMute = getUserMute(u.id);
              return (
                <div 
                  key={u.id} 
                  className="flex items-center justify-between py-1 px-2 rounded-sm bg-muted/30"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-2 w-2 rounded-full bg-green-500 flex-shrink-0" />
                    <span className="text-xs truncate">
                      {u.displayName || u.username}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {userMute ? (
                      <MuteIndicator mute={userMute} canUnmute={canMute} />
                    ) : (
                      canMute && (
                        <MuteButton 
                          targetUserId={u.id} 
                          targetName={u.displayName || u.username} 
                        />
                      )
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

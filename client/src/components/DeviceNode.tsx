import { Device } from '@shared/schema';
import { Server, Router, Wifi, HardDrive, Activity } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface DeviceNodeProps {
  device: Device;
  isSelected: boolean;
  isHighlighted: boolean;
  onClick: () => void;
  onDragStart: (e: React.MouseEvent) => void;
}

const deviceIcons = {
  mikrotik_router: Router,
  mikrotik_switch: Server,
  generic_snmp: Server,
  server: HardDrive,
  access_point: Wifi,
};

const statusColors = {
  online: 'bg-green-500',
  warning: 'bg-yellow-500',
  offline: 'bg-red-500',
  unknown: 'bg-gray-400',
};

export function DeviceNode({ device, isSelected, isHighlighted, onClick, onDragStart }: DeviceNodeProps) {
  const Icon = deviceIcons[device.type as keyof typeof deviceIcons] || Activity;

  return (
    <div
      className={`absolute flex flex-col items-center cursor-move select-none transition-all ${
        isHighlighted ? 'animate-pulse' : ''
      }`}
      style={{
        left: `${device.position.x}px`,
        top: `${device.position.y}px`,
        transform: 'translate(-50%, -50%)',
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={onDragStart}
      data-testid={`device-node-${device.id}`}
    >
      <div
        className={`relative bg-white dark:bg-gray-900 rounded-md p-4 border-2 transition-all hover-elevate ${
          isSelected
            ? 'border-primary shadow-lg'
            : isHighlighted
            ? 'border-yellow-400 shadow-md'
            : 'border-border'
        }`}
        style={{ minWidth: '120px' }}
      >
        <div
          className={`absolute -top-2 -right-2 w-4 h-4 rounded-full border-2 border-white dark:border-gray-900 ${
            statusColors[device.status as keyof typeof statusColors] || statusColors.unknown
          }`}
          data-testid={`status-indicator-${device.status}`}
        />

        <div className="flex flex-col items-center gap-2">
          <Icon className="h-12 w-12 text-primary" />
          <div className="text-center space-y-1">
            <p className="text-sm font-semibold text-foreground line-clamp-2" data-testid={`text-device-name-${device.id}`}>
              {device.name}
            </p>
            {device.ipAddress && (
              <p className="text-xs text-muted-foreground" data-testid={`text-ip-${device.id}`}>
                {device.ipAddress}
              </p>
            )}
          </div>
        </div>
      </div>

      <Badge
        variant="secondary"
        className="mt-2 text-xs"
        data-testid={`badge-device-type-${device.id}`}
      >
        {device.type.replace(/_/g, ' ')}
      </Badge>
    </div>
  );
}

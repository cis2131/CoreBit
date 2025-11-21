import { Connection, Device } from '@shared/schema';

interface ConnectionLineProps {
  connection: Connection;
  sourcePosition: { x: number; y: number };
  targetPosition: { x: number; y: number };
  isSelected: boolean;
  onClick: () => void;
  sourceDevice?: Device;
  targetDevice?: Device;
}

const linkSpeedStyles = {
  '1G': { width: 2, color: 'hsl(var(--muted-foreground))', dashArray: '' },
  '10G': { width: 3, color: '#14b8a6', dashArray: '' }, // teal
  '25G': { width: 4, color: '#3b82f6', dashArray: '8,4' }, // blue, dashed
  '40G': { width: 5, color: '#a855f7', dashArray: '' }, // purple
  '100G': { width: 6, color: 'hsl(var(--primary))', dashArray: '' }, // primary
};

export function ConnectionLine({
  connection,
  sourcePosition,
  targetPosition,
  isSelected,
  onClick,
  sourceDevice,
  targetDevice,
}: ConnectionLineProps) {
  const midX = (sourcePosition.x + targetPosition.x) / 2;
  const midY = (sourcePosition.y + targetPosition.y) / 2;

  const speed = (connection.linkSpeed || '1G') as keyof typeof linkSpeedStyles;
  const style = linkSpeedStyles[speed] || linkSpeedStyles['1G'];
  const strokeWidth = isSelected ? style.width + 2 : style.width;

  // Calculate intersection points with device rectangle boundaries
  // Device nodes are 320px wide and approximately 130px tall, centered at their position
  const DEVICE_WIDTH = 320;
  const DEVICE_HEIGHT = 130;
  const HALF_WIDTH = DEVICE_WIDTH / 2;
  const HALF_HEIGHT = DEVICE_HEIGHT / 2;

  const calculateRectangleIntersection = (
    centerX: number,
    centerY: number,
    targetX: number,
    targetY: number
  ): { x: number; y: number } => {
    const dx = targetX - centerX;
    const dy = targetY - centerY;

    if (dx === 0 && dy === 0) {
      return { x: centerX, y: centerY };
    }

    // Find which edge the line intersects
    const ratio = Math.abs(dy) > 0 ? Math.abs(dx / dy) : Infinity;

    let intersectX = centerX;
    let intersectY = centerY;

    if (Math.abs(dx) >= Math.abs(dy)) {
      // Hits left or right edge
      intersectX = centerX + (dx > 0 ? HALF_WIDTH : -HALF_WIDTH);
      const t = (intersectX - centerX) / dx;
      intersectY = centerY + t * dy;
    } else {
      // Hits top or bottom edge
      intersectY = centerY + (dy > 0 ? HALF_HEIGHT : -HALF_HEIGHT);
      const t = (intersectY - centerY) / dy;
      intersectX = centerX + t * dx;
    }

    return { x: intersectX, y: intersectY };
  };

  const sourceIntersection = calculateRectangleIntersection(
    sourcePosition.x,
    sourcePosition.y,
    targetPosition.x,
    targetPosition.y
  );

  const targetIntersection = calculateRectangleIntersection(
    targetPosition.x,
    targetPosition.y,
    sourcePosition.x,
    sourcePosition.y
  );

  const sourceIndicatorX = sourceIntersection.x;
  const sourceIndicatorY = sourceIntersection.y;
  const targetIndicatorX = targetIntersection.x;
  const targetIndicatorY = targetIntersection.y;

  // Get port status colors
  const getPortStatusColor = (device: Device | undefined, portName: string | undefined): string => {
    if (!device || !portName || portName === 'none') return 'hsl(var(--muted-foreground))';
    const port = device.deviceData?.ports?.find(p => p.name === portName);
    if (!port) return 'hsl(var(--muted-foreground))';
    return port.status === 'up' ? '#22c55e' : '#ef4444'; // green for up, red for down
  };

  const sourcePortStatus = getPortStatusColor(sourceDevice, connection.sourcePort);
  const targetPortStatus = getPortStatusColor(targetDevice, connection.targetPort);

  return (
    <g
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="cursor-pointer"
      style={{ pointerEvents: 'auto' }}
      data-testid={`connection-line-${connection.id}`}
    >
      <line
        x1={sourcePosition.x}
        y1={sourcePosition.y}
        x2={targetPosition.x}
        y2={targetPosition.y}
        stroke={style.color}
        strokeWidth={strokeWidth}
        strokeOpacity={0.7}
        strokeDasharray={style.dashArray}
        className="transition-all"
      />
      
      <line
        x1={sourcePosition.x}
        y1={sourcePosition.y}
        x2={targetPosition.x}
        y2={targetPosition.y}
        stroke="transparent"
        strokeWidth="20"
        pointerEvents="stroke"
      />

      {/* Port status indicators at connection endpoints */}
      {(connection.sourcePort && connection.sourcePort !== 'none') && (
        <>
          <circle
            cx={sourceIndicatorX}
            cy={sourceIndicatorY}
            r="5"
            fill={sourcePortStatus}
            opacity="0.8"
          />
          <circle
            cx={sourceIndicatorX}
            cy={sourceIndicatorY}
            r="5"
            fill="none"
            stroke="white"
            strokeWidth="1"
            opacity="0.6"
          />
        </>
      )}

      {(connection.targetPort && connection.targetPort !== 'none') && (
        <>
          <circle
            cx={targetIndicatorX}
            cy={targetIndicatorY}
            r="5"
            fill={targetPortStatus}
            opacity="0.8"
          />
          <circle
            cx={targetIndicatorX}
            cy={targetIndicatorY}
            r="5"
            fill="none"
            stroke="white"
            strokeWidth="1"
            opacity="0.6"
          />
        </>
      )}

      {isSelected && (
        <circle
          cx={midX}
          cy={midY}
          r="6"
          fill="hsl(var(--primary))"
          stroke="white"
          strokeWidth="2"
        />
      )}
    </g>
  );
}

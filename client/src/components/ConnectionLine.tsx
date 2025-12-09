import { Connection, Device } from '@shared/schema';
import { ArrowDown, ArrowUp } from 'lucide-react';

interface ConnectionLineProps {
  connection: Connection;
  sourcePosition: { x: number; y: number };
  targetPosition: { x: number; y: number };
  isSelected: boolean;
  onClick: () => void;
  sourceDevice?: Device;
  targetDevice?: Device;
  autoOffset?: number;
}

// Format bits per second to human readable (network standard)
const formatBitsPerSec = (bitsPerSec: number): string => {
  if (bitsPerSec === 0) return '0 bps';
  const k = 1000; // Network uses decimal (1000), not binary (1024)
  const sizes = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
  const i = Math.floor(Math.log(bitsPerSec) / Math.log(k));
  const value = bitsPerSec / Math.pow(k, i);
  return value >= 10 ? Math.round(value) + ' ' + sizes[i] : value.toFixed(1) + ' ' + sizes[i];
};

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
  autoOffset = 0,
}: ConnectionLineProps) {
  const speed = (connection.linkSpeed || '1G') as keyof typeof linkSpeedStyles;
  const style = linkSpeedStyles[speed] || linkSpeedStyles['1G'];
  const strokeWidth = isSelected ? style.width + 2 : style.width;

  // Calculate curve offset - use manual offset if set, otherwise use auto-offset for duplicate connections
  const curveMode = connection.curveMode || 'straight';
  const manualOffset = connection.curveOffset || 0;
  const effectiveOffset = curveMode === 'curved' 
    ? (manualOffset || 50) 
    : curveMode === 'auto' 
      ? autoOffset 
      : 0;

  // Calculate perpendicular offset for curve control points
  const dx = targetPosition.x - sourcePosition.x;
  const dy = targetPosition.y - sourcePosition.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  
  // Normal vector (perpendicular to the line)
  const nx = length > 0 ? -dy / length : 0;
  const ny = length > 0 ? dx / length : 0;

  // Control point for quadratic/cubic bezier - at midpoint, offset perpendicular to the line
  const midX = (sourcePosition.x + targetPosition.x) / 2 + nx * effectiveOffset;
  const midY = (sourcePosition.y + targetPosition.y) / 2 + ny * effectiveOffset;

  // Original midpoint for labels (before curve offset)
  const labelMidX = (sourcePosition.x + targetPosition.x) / 2;
  const labelMidY = (sourcePosition.y + targetPosition.y) / 2;

  const isCurved = effectiveOffset !== 0;

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

    // Calculate the slope - handle vertical and horizontal lines
    const slope = dx !== 0 ? dy / dx : Infinity;

    // Calculate intersections with all four edges
    const candidates: Array<{ x: number; y: number }> = [];

    // Right edge (x = centerX + HALF_WIDTH)
    if (dx > 0) {
      const x = centerX + HALF_WIDTH;
      const y = centerY + slope * (x - centerX);
      if (Math.abs(y - centerY) <= HALF_HEIGHT) {
        candidates.push({ x, y });
      }
    }

    // Left edge (x = centerX - HALF_WIDTH)
    if (dx < 0) {
      const x = centerX - HALF_WIDTH;
      const y = centerY + slope * (x - centerX);
      if (Math.abs(y - centerY) <= HALF_HEIGHT) {
        candidates.push({ x, y });
      }
    }

    // Bottom edge (y = centerY + HALF_HEIGHT)
    if (dy > 0) {
      const y = centerY + HALF_HEIGHT;
      const x = dx !== 0 ? centerX + (y - centerY) / slope : centerX;
      if (Math.abs(x - centerX) <= HALF_WIDTH) {
        candidates.push({ x, y });
      }
    }

    // Top edge (y = centerY - HALF_HEIGHT)
    if (dy < 0) {
      const y = centerY - HALF_HEIGHT;
      const x = dx !== 0 ? centerX + (y - centerY) / slope : centerX;
      if (Math.abs(x - centerX) <= HALF_WIDTH) {
        candidates.push({ x, y });
      }
    }

    // Return the closest candidate to the center
    if (candidates.length === 0) {
      return { x: centerX, y: centerY };
    }

    return candidates.reduce((closest, candidate) => {
      const closestDist =
        (closest.x - centerX) ** 2 + (closest.y - centerY) ** 2;
      const candidateDist =
        (candidate.x - centerX) ** 2 + (candidate.y - centerY) ** 2;
      return candidateDist < closestDist ? candidate : closest;
    });
  };

  // For curved lines, use the control point as the direction target
  // This ensures indicators are placed where the curve actually exits/enters the device
  const sourceTarget = isCurved ? { x: midX, y: midY } : targetPosition;
  const targetTarget = isCurved ? { x: midX, y: midY } : sourcePosition;

  const sourceIntersection = calculateRectangleIntersection(
    sourcePosition.x,
    sourcePosition.y,
    sourceTarget.x,
    sourceTarget.y
  );

  const targetIntersection = calculateRectangleIntersection(
    targetPosition.x,
    targetPosition.y,
    targetTarget.x,
    targetTarget.y
  );

  const sourceIndicatorX = sourceIntersection.x;
  const sourceIndicatorY = sourceIntersection.y;
  const targetIndicatorX = targetIntersection.x;
  const targetIndicatorY = targetIntersection.y;

  // Get port status colors
  const getPortStatusColor = (device: Device | undefined, portName: string | undefined): string => {
    if (!device || !portName || portName === 'none') return 'hsl(var(--muted-foreground))';
    // If device is down, show grey regardless of port status
    if (device.status !== 'online') return 'hsl(var(--muted-foreground))';
    // Match by defaultName first (stable identifier used in connections), then fall back to name
    const port = device.deviceData?.ports?.find(p => 
      p.defaultName === portName || p.name === portName
    );
    if (!port) return 'hsl(var(--muted-foreground))';
    return port.status === 'up' ? '#22c55e' : '#ef4444'; // green for up, red for down
  };

  const sourcePortStatus = getPortStatusColor(sourceDevice, connection.sourcePort || undefined);
  const targetPortStatus = getPortStatusColor(targetDevice, connection.targetPort || undefined);

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
      {isCurved ? (
        <>
          {/* Curved path using quadratic bezier */}
          <path
            d={`M ${sourcePosition.x} ${sourcePosition.y} Q ${midX} ${midY} ${targetPosition.x} ${targetPosition.y}`}
            fill="none"
            stroke={style.color}
            strokeWidth={strokeWidth}
            strokeOpacity={0.7}
            strokeDasharray={style.dashArray}
            className="transition-all"
          />
          {/* Invisible hit area for curved path */}
          <path
            d={`M ${sourcePosition.x} ${sourcePosition.y} Q ${midX} ${midY} ${targetPosition.x} ${targetPosition.y}`}
            fill="none"
            stroke="transparent"
            strokeWidth="20"
            pointerEvents="stroke"
          />
        </>
      ) : (
        <>
          {/* Straight line */}
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
          {/* Invisible hit area for straight line */}
          <line
            x1={sourcePosition.x}
            y1={sourcePosition.y}
            x2={targetPosition.x}
            y2={targetPosition.y}
            stroke="transparent"
            strokeWidth="20"
            pointerEvents="stroke"
          />
        </>
      )}

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

      {/* Traffic stats display when monitoring is enabled - positioned at curve apex */}
      {connection.monitorInterface && connection.linkStats && (
        <g>
          {/* Background box for traffic stats */}
          <rect
            x={midX - 50}
            y={midY - 28}
            width="100"
            height="36"
            rx="4"
            fill="hsl(var(--background))"
            stroke="hsl(var(--border))"
            strokeWidth="1"
            opacity="0.95"
          />
          {/* RX traffic */}
          <text
            x={midX}
            y={midY - 14}
            textAnchor="middle"
            className="text-[10px] font-mono fill-blue-500"
            data-testid="text-connection-inbound"
          >
            ↓ {formatBitsPerSec(connection.linkStats.inBitsPerSec || 0)}
          </text>
          {/* TX traffic */}
          <text
            x={midX}
            y={midY + 2}
            textAnchor="middle"
            className="text-[10px] font-mono fill-green-500"
            data-testid="text-connection-outbound"
          >
            ↑ {formatBitsPerSec(connection.linkStats.outBitsPerSec || 0)}
          </text>
        </g>
      )}
    </g>
  );
}

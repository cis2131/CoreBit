import { Connection, Device } from '@shared/schema';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

interface BandwidthDataPoint {
  timestamp: number;
  inbound: number;
  outbound: number;
}

interface TrafficHistoryPoint {
  timestamp: number;
  inBitsPerSec: number;
  outBitsPerSec: number;
  utilizationPct: number;
}

interface ConnectionLineProps {
  connection: Connection;
  sourcePosition: { x: number; y: number };
  targetPosition: { x: number; y: number };
  isSelected: boolean;
  onClick: () => void;
  sourceDevice?: Device;
  targetDevice?: Device;
  autoOffset?: number;
  bandwidthHistory?: BandwidthDataPoint[];
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
  '2.5G': { width: 2.5, color: '#0ea5e9', dashArray: '' }, // sky blue
  '10G': { width: 3, color: '#14b8a6', dashArray: '' }, // teal
  '25G': { width: 4, color: '#3b82f6', dashArray: '8,4' }, // blue, dashed
  '40G': { width: 5, color: '#a855f7', dashArray: '' }, // purple
  '100G': { width: 6, color: 'hsl(var(--primary))', dashArray: '' }, // primary
  'WiFi': { width: 2, color: '#f59e0b', dashArray: '4,4' }, // amber, dotted pattern
  'Custom': { width: 2, color: '#ec4899', dashArray: '6,3' }, // pink, dashed
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
  bandwidthHistory = [],
}: ConnectionLineProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const speed = (connection.linkSpeed || '1G') as keyof typeof linkSpeedStyles;
  const style = linkSpeedStyles[speed] || linkSpeedStyles['1G'];
  const strokeWidth = isSelected ? style.width + 2 : style.width;

  // Fetch traffic history for bandwidth graph - only when hovered and monitoring is enabled
  const hasMonitoring = !!connection.monitorInterface;
  const { data: trafficHistoryData = [] } = useQuery<TrafficHistoryPoint[]>({
    queryKey: ["/api/connections", connection.id, "traffic-history"],
    enabled: hasMonitoring && isHovered, // Only fetch when hovering
    refetchInterval: isHovered ? 10000 : false, // Only poll when hovered
    staleTime: 5000, // Keep data fresh for 5 seconds
  });

  // Convert traffic history to bandwidth history format
  const fetchedBandwidthHistory: BandwidthDataPoint[] = trafficHistoryData.map(point => ({
    timestamp: point.timestamp,
    inbound: point.inBitsPerSec,
    outbound: point.outBitsPerSec,
  }));

  // Use passed-in bandwidthHistory if available, otherwise use fetched data
  const effectiveBandwidthHistory = bandwidthHistory.length > 0 ? bandwidthHistory : fetchedBandwidthHistory;

  // Determine threshold flash class based on utilization
  const utilizationPct = connection.linkStats?.utilizationPct || 0;
  const warningThreshold = connection.warningThresholdPct ?? 70;
  const criticalThreshold = connection.criticalThresholdPct ?? 90;
  
  let thresholdFlashClass = '';
  if (utilizationPct >= criticalThreshold) {
    thresholdFlashClass = 'connection-critical-flash';
  } else if (utilizationPct >= warningThreshold) {
    thresholdFlashClass = 'connection-warning-flash';
  }

  // Calculate curve offset - use manual offset if set, otherwise use auto-offset for duplicate connections
  const curveMode = connection.curveMode || 'straight';
  const manualOffset = connection.curveOffset || 0;
  const isSpline = curveMode === 'spline';
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
  
  // Spline control points for S-curve (cubic bezier)
  // Creates smooth horizontal exits from both devices
  const splineControlOffset = Math.min(length * 0.4, 150); // Control point distance
  const splineCtrl1 = {
    x: sourcePosition.x + (dx > 0 ? splineControlOffset : -splineControlOffset),
    y: sourcePosition.y,
  };
  const splineCtrl2 = {
    x: targetPosition.x - (dx > 0 ? splineControlOffset : -splineControlOffset),
    y: targetPosition.y,
  };

  // Calculate intersection points with device rectangle boundaries
  // Standard device nodes are 320px wide and approximately 130px tall, centered at their position
  // Proxmox device nodes are 380px wide and approximately 200px tall (due to VM list)
  const getDeviceDimensions = (device: Device | undefined) => {
    if (device?.type === 'proxmox') {
      return { width: 380, height: 220 };
    }
    return { width: 320, height: 130 };
  };
  
  const sourceDimensions = getDeviceDimensions(sourceDevice);
  const targetDimensions = getDeviceDimensions(targetDevice);

  const calculateRectangleIntersection = (
    centerX: number,
    centerY: number,
    targetX: number,
    targetY: number,
    dimensions: { width: number; height: number }
  ): { x: number; y: number } => {
    const halfWidth = dimensions.width / 2;
    const halfHeight = dimensions.height / 2;
    const dx = targetX - centerX;
    const dy = targetY - centerY;

    if (dx === 0 && dy === 0) {
      return { x: centerX, y: centerY };
    }

    // Calculate the slope - handle vertical and horizontal lines
    const slope = dx !== 0 ? dy / dx : Infinity;

    // Calculate intersections with all four edges
    const candidates: Array<{ x: number; y: number }> = [];

    // Right edge (x = centerX + halfWidth)
    if (dx > 0) {
      const x = centerX + halfWidth;
      const y = centerY + slope * (x - centerX);
      if (Math.abs(y - centerY) <= halfHeight) {
        candidates.push({ x, y });
      }
    }

    // Left edge (x = centerX - halfWidth)
    if (dx < 0) {
      const x = centerX - halfWidth;
      const y = centerY + slope * (x - centerX);
      if (Math.abs(y - centerY) <= halfHeight) {
        candidates.push({ x, y });
      }
    }

    // Bottom edge (y = centerY + halfHeight)
    if (dy > 0) {
      const y = centerY + halfHeight;
      const x = dx !== 0 ? centerX + (y - centerY) / slope : centerX;
      if (Math.abs(x - centerX) <= halfWidth) {
        candidates.push({ x, y });
      }
    }

    // Top edge (y = centerY - halfHeight)
    if (dy < 0) {
      const y = centerY - halfHeight;
      const x = dx !== 0 ? centerX + (y - centerY) / slope : centerX;
      if (Math.abs(x - centerX) <= halfWidth) {
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

  // Quadratic Bézier: P(t) = (1-t)²P0 + 2(1-t)t*P1 + t²P2
  const getPointOnQuadraticBezier = (t: number) => {
    const mt = 1 - t;
    return {
      x: mt * mt * sourcePosition.x + 2 * mt * t * midX + t * t * targetPosition.x,
      y: mt * mt * sourcePosition.y + 2 * mt * t * midY + t * t * targetPosition.y,
    };
  };
  
  // Cubic Bézier for spline: P(t) = (1-t)³P0 + 3(1-t)²t*P1 + 3(1-t)t²*P2 + t³P3
  const getPointOnCubicBezier = (t: number) => {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const t2 = t * t;
    const t3 = t2 * t;
    return {
      x: mt3 * sourcePosition.x + 3 * mt2 * t * splineCtrl1.x + 3 * mt * t2 * splineCtrl2.x + t3 * targetPosition.x,
      y: mt3 * sourcePosition.y + 3 * mt2 * t * splineCtrl1.y + 3 * mt * t2 * splineCtrl2.y + t3 * targetPosition.y,
    };
  };

  // Calculate label position along the curve (0-100, default 50 for middle)
  const labelT = (connection.labelPosition ?? 50) / 100;
  
  // Calculate curve apex (point at t=0.5) for selection indicator and traffic banner
  const curveApex = isSpline 
    ? getPointOnCubicBezier(0.5)
    : isCurved 
      ? getPointOnQuadraticBezier(0.5) 
      : { x: (sourcePosition.x + targetPosition.x) / 2, y: (sourcePosition.y + targetPosition.y) / 2 };
  
  // Calculate traffic label coordinates (uses labelT instead of fixed 0.5)
  const trafficLabelPoint = isSpline
    ? getPointOnCubicBezier(labelT)
    : isCurved 
      ? getPointOnQuadraticBezier(labelT) 
      : { 
          x: sourcePosition.x + (targetPosition.x - sourcePosition.x) * labelT, 
          y: sourcePosition.y + (targetPosition.y - sourcePosition.y) * labelT 
        };

  // Check if a point is inside a device rectangle
  const isInsideDevice = (
    point: { x: number; y: number }, 
    devicePos: { x: number; y: number },
    dimensions: { width: number; height: number }
  ) => {
    const halfWidth = dimensions.width / 2;
    const halfHeight = dimensions.height / 2;
    return (
      Math.abs(point.x - devicePos.x) <= halfWidth &&
      Math.abs(point.y - devicePos.y) <= halfHeight
    );
  };

  // Find where a curve exits a device rectangle by sampling + binary search
  // Takes a point sampler function to work with any curve type
  const findCurveExitPointGeneric = (
    devicePos: { x: number; y: number },
    dimensions: { width: number; height: number },
    startT: number,
    endT: number,
    step: number,
    getPointAtT: (t: number) => { x: number; y: number }
  ): { x: number; y: number } => {
    // Coarse search: find first point outside the device
    let lastInsideT = startT;
    let firstOutsideT = endT;
    let found = false;

    const direction = startT < endT ? 1 : -1;
    for (let t = startT; direction > 0 ? t <= endT : t >= endT; t += step * direction) {
      const point = getPointAtT(t);
      if (isInsideDevice(point, devicePos, dimensions)) {
        lastInsideT = t;
      } else {
        firstOutsideT = t;
        found = true;
        break;
      }
    }

    if (!found) {
      // Curve never exits device, return device edge intersection
      return getPointAtT(endT);
    }

    // Binary search to refine the exit point
    for (let i = 0; i < 10; i++) {
      const midT = (lastInsideT + firstOutsideT) / 2;
      const point = getPointAtT(midT);
      if (isInsideDevice(point, devicePos, dimensions)) {
        lastInsideT = midT;
      } else {
        firstOutsideT = midT;
      }
    }

    // Return the first point outside (on the curve, just past the edge)
    return getPointAtT(firstOutsideT);
  };

  // Calculate indicator positions
  let sourceIndicatorX: number, sourceIndicatorY: number;
  let targetIndicatorX: number, targetIndicatorY: number;
  
  // Also track spline edge points for rendering the path from edges
  let splineSourceEdge = sourcePosition;
  let splineTargetEdge = targetPosition;

  if (isSpline) {
    // For spline lines, find where cubic bezier exits each device
    const sourceExit = findCurveExitPointGeneric(sourcePosition, sourceDimensions, 0, 0.5, 0.02, getPointOnCubicBezier);
    const targetExit = findCurveExitPointGeneric(targetPosition, targetDimensions, 1, 0.5, 0.02, getPointOnCubicBezier);
    
    sourceIndicatorX = sourceExit.x;
    sourceIndicatorY = sourceExit.y;
    targetIndicatorX = targetExit.x;
    targetIndicatorY = targetExit.y;
    splineSourceEdge = sourceExit;
    splineTargetEdge = targetExit;
  } else if (isCurved) {
    // For curved lines, find where quadratic bezier exits each device
    const sourceExit = findCurveExitPointGeneric(sourcePosition, sourceDimensions, 0, 0.5, 0.02, getPointOnQuadraticBezier);
    const targetExit = findCurveExitPointGeneric(targetPosition, targetDimensions, 1, 0.5, 0.02, getPointOnQuadraticBezier);
    
    sourceIndicatorX = sourceExit.x;
    sourceIndicatorY = sourceExit.y;
    targetIndicatorX = targetExit.x;
    targetIndicatorY = targetExit.y;
  } else {
    // For straight lines, use the rectangle intersection calculation
    const sourceIntersection = calculateRectangleIntersection(
      sourcePosition.x,
      sourcePosition.y,
      targetPosition.x,
      targetPosition.y,
      sourceDimensions
    );

    const targetIntersection = calculateRectangleIntersection(
      targetPosition.x,
      targetPosition.y,
      sourcePosition.x,
      sourcePosition.y,
      targetDimensions
    );

    sourceIndicatorX = sourceIntersection.x;
    sourceIndicatorY = sourceIntersection.y;
    targetIndicatorX = targetIntersection.x;
    targetIndicatorY = targetIntersection.y;
  }
  
  // Recalculate spline control points based on edge positions for cleaner rendering
  const splineEdgeCtrl1 = {
    x: splineSourceEdge.x + (dx > 0 ? splineControlOffset * 0.6 : -splineControlOffset * 0.6),
    y: splineSourceEdge.y,
  };
  const splineEdgeCtrl2 = {
    x: splineTargetEdge.x - (dx > 0 ? splineControlOffset * 0.6 : -splineControlOffset * 0.6),
    y: splineTargetEdge.y,
  };

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
      {isSpline ? (
        <>
          {/* Spline path using cubic bezier for S-curve - starts/ends at device edges */}
          <path
            d={`M ${splineSourceEdge.x} ${splineSourceEdge.y} C ${splineEdgeCtrl1.x} ${splineEdgeCtrl1.y} ${splineEdgeCtrl2.x} ${splineEdgeCtrl2.y} ${splineTargetEdge.x} ${splineTargetEdge.y}`}
            fill="none"
            stroke={style.color}
            strokeWidth={strokeWidth}
            strokeOpacity={0.7}
            strokeDasharray={style.dashArray}
            className={`transition-all ${thresholdFlashClass}`}
          />
          {/* Invisible hit area for spline path */}
          <path
            d={`M ${splineSourceEdge.x} ${splineSourceEdge.y} C ${splineEdgeCtrl1.x} ${splineEdgeCtrl1.y} ${splineEdgeCtrl2.x} ${splineEdgeCtrl2.y} ${splineTargetEdge.x} ${splineTargetEdge.y}`}
            fill="none"
            stroke="transparent"
            strokeWidth="20"
            pointerEvents="stroke"
          />
        </>
      ) : isCurved ? (
        <>
          {/* Curved path using quadratic bezier */}
          <path
            d={`M ${sourcePosition.x} ${sourcePosition.y} Q ${midX} ${midY} ${targetPosition.x} ${targetPosition.y}`}
            fill="none"
            stroke={style.color}
            strokeWidth={strokeWidth}
            strokeOpacity={0.7}
            strokeDasharray={style.dashArray}
            className={`transition-all ${thresholdFlashClass}`}
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
            className={`transition-all ${thresholdFlashClass}`}
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
          cx={curveApex.x}
          cy={curveApex.y}
          r="6"
          fill="hsl(var(--primary))"
          stroke="white"
          strokeWidth="2"
        />
      )}

      {/* Traffic stats display when monitoring is enabled - positioned using labelPosition */}
      {connection.monitorInterface && connection.linkStats && (() => {
        const isMonitoringTarget = connection.monitorInterface === 'target';
        const shouldFlip = isMonitoringTarget !== (connection.flipTrafficDirection || false);
        const inbound = shouldFlip 
          ? connection.linkStats.outBitsPerSec || 0
          : connection.linkStats.inBitsPerSec || 0;
        const outbound = shouldFlip
          ? connection.linkStats.inBitsPerSec || 0
          : connection.linkStats.outBitsPerSec || 0;
        
        const chartData = effectiveBandwidthHistory.length > 0 
          ? effectiveBandwidthHistory.map((point, index) => ({
              time: index,
              inbound: shouldFlip ? point.outbound : point.inbound,
              outbound: shouldFlip ? point.inbound : point.outbound,
            }))
          : [];
        
        return (
          <>
            <foreignObject
              x={trafficLabelPoint.x - 55}
              y={trafficLabelPoint.y - 30}
              width="110"
              height="45"
              style={{ overflow: 'visible' }}
            >
              <div 
                className="bg-background border border-border rounded px-2 py-1 cursor-pointer hover-elevate"
                style={{ opacity: 0.95 }}
                onMouseEnter={(e) => {
                  setIsHovered(true);
                  const rect = e.currentTarget.getBoundingClientRect();
                  setMousePos({ x: rect.left + rect.width / 2, y: rect.top });
                }}
                onMouseMove={(e) => {
                  setMousePos({ x: e.clientX, y: e.clientY - 20 });
                }}
                onMouseLeave={() => setIsHovered(false)}
                data-testid={`traffic-stats-${connection.id}`}
              >
                <div className="text-[10px] font-mono text-blue-500 flex items-center gap-1" data-testid="text-connection-inbound">
                  <ArrowDown className="h-3 w-3" /> {formatBitsPerSec(inbound)}
                </div>
                <div className="text-[10px] font-mono text-green-500 flex items-center gap-1" data-testid="text-connection-outbound">
                  <ArrowUp className="h-3 w-3" /> {formatBitsPerSec(outbound)}
                </div>
              </div>
            </foreignObject>
            {/* Portal-based tooltip for bandwidth graph - renders above everything */}
            {isHovered && createPortal(
              <div 
                className="fixed bg-popover border border-border rounded-md shadow-xl p-3 w-80 pointer-events-none"
                style={{ 
                  left: mousePos.x - 160,
                  top: mousePos.y - 220,
                  zIndex: 9999,
                }}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Bandwidth Monitor</span>
                    {utilizationPct > 0 && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        utilizationPct >= criticalThreshold 
                          ? 'bg-red-500/20 text-red-500' 
                          : utilizationPct >= warningThreshold 
                            ? 'bg-orange-500/20 text-orange-500'
                            : 'bg-muted text-muted-foreground'
                      }`}>
                        {utilizationPct.toFixed(1)}% utilization
                      </span>
                    )}
                  </div>
                  <div className="flex gap-4 text-xs">
                    <div className="flex items-center gap-1 text-blue-500">
                      <ArrowDown className="h-3 w-3" /> In: {formatBitsPerSec(inbound)}
                    </div>
                    <div className="flex items-center gap-1 text-green-500">
                      <ArrowUp className="h-3 w-3" /> Out: {formatBitsPerSec(outbound)}
                    </div>
                  </div>
                  {chartData.length > 1 ? (
                    <div className="h-24 mt-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id={`inGrad-${connection.id}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id={`outGrad-${connection.id}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <YAxis 
                            width={45}
                            tickFormatter={(value) => {
                              if (value >= 1000000000) return `${(value / 1000000000).toFixed(0)}G`;
                              if (value >= 1000000) return `${(value / 1000000).toFixed(0)}M`;
                              if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
                              return `${value}`;
                            }}
                            tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <XAxis hide dataKey="time" />
                          <Tooltip 
                            content={({ active, payload }) => {
                              if (active && payload && payload.length) {
                                return (
                                  <div className="bg-popover border rounded p-2 text-xs shadow-lg">
                                    <div className="text-blue-500">In: {formatBitsPerSec(payload[0]?.value as number || 0)}</div>
                                    <div className="text-green-500">Out: {formatBitsPerSec(payload[1]?.value as number || 0)}</div>
                                  </div>
                                );
                              }
                              return null;
                            }}
                          />
                          <Area 
                            type="monotone" 
                            dataKey="inbound" 
                            stroke="#3b82f6" 
                            strokeWidth={1.5}
                            fill={`url(#inGrad-${connection.id})`}
                          />
                          <Area 
                            type="monotone" 
                            dataKey="outbound" 
                            stroke="#22c55e" 
                            strokeWidth={1.5}
                            fill={`url(#outGrad-${connection.id})`}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">
                      Collecting bandwidth history...
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground flex justify-between">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-orange-500" /> {warningThreshold}%
                      <span className="mx-1">|</span>
                      <span className="w-2 h-2 rounded-full bg-red-500" /> {criticalThreshold}%
                    </span>
                    <span>{connection.linkSpeed || '1G'}</span>
                  </div>
                </div>
              </div>,
              document.body
            )}
          </>
        );
      })()}
    </g>
  );
}

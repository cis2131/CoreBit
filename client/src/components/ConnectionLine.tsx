import { Connection } from '@shared/schema';

interface ConnectionLineProps {
  connection: Connection;
  sourcePosition: { x: number; y: number };
  targetPosition: { x: number; y: number };
  isSelected: boolean;
  onClick: () => void;
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
}: ConnectionLineProps) {
  const midX = (sourcePosition.x + targetPosition.x) / 2;
  const midY = (sourcePosition.y + targetPosition.y) / 2;

  const speed = (connection.linkSpeed || '1G') as keyof typeof linkSpeedStyles;
  const style = linkSpeedStyles[speed] || linkSpeedStyles['1G'];
  const strokeWidth = isSelected ? style.width + 2 : style.width;

  return (
    <g
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="cursor-pointer"
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
        className="transition-all pointer-events-stroke"
      />
      
      <line
        x1={sourcePosition.x}
        y1={sourcePosition.y}
        x2={targetPosition.x}
        y2={targetPosition.y}
        stroke="transparent"
        strokeWidth="20"
        className="pointer-events-stroke"
      />

      {isSelected && (
        <>
          <circle
            cx={sourcePosition.x}
            cy={sourcePosition.y}
            r="4"
            fill="hsl(var(--primary))"
          />
          <circle
            cx={targetPosition.x}
            cy={targetPosition.y}
            r="4"
            fill="hsl(var(--primary))"
          />
          <circle
            cx={midX}
            cy={midY}
            r="6"
            fill="hsl(var(--primary))"
            stroke="white"
            strokeWidth="2"
          />
        </>
      )}
    </g>
  );
}

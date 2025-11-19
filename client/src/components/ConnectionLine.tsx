import { Connection } from '@shared/schema';

interface ConnectionLineProps {
  connection: Connection;
  sourcePosition: { x: number; y: number };
  targetPosition: { x: number; y: number };
  isSelected: boolean;
  onClick: () => void;
}

export function ConnectionLine({
  connection,
  sourcePosition,
  targetPosition,
  isSelected,
  onClick,
}: ConnectionLineProps) {
  const midX = (sourcePosition.x + targetPosition.x) / 2;
  const midY = (sourcePosition.y + targetPosition.y) / 2;

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
        stroke="hsl(var(--muted-foreground))"
        strokeWidth={isSelected ? 3 : 2}
        strokeOpacity={0.6}
        className="transition-all hover:stroke-primary pointer-events-stroke"
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

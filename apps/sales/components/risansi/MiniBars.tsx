export interface MiniBarsProps {
  values:    number[];
  labels?:   string[];
  width?:    number;
  height?:   number;
  color?:    string;
  dimColor?: string;   // colour for non-current bars (default: var(--fg-2) at 0.4 opacity)
  target?:   number | null;
}

export function MiniBars({
  values,
  labels,
  width    = 220,
  height   = 80,
  color    = 'var(--accent)',
  dimColor,
  target,
}: MiniBarsProps) {
  const hasLabels = labels && labels.length > 0;
  const totalH    = height + (hasLabels ? 16 : 0);
  const max       = Math.max(...values, target ?? 0) || 1;
  const bw        = (width - (values.length - 1) * 6) / values.length;

  return (
    <svg width={width} height={totalH}>
      {/* Target line */}
      {target != null && (
        <line
          x1={0} x2={width}
          y1={height - (target / max) * (height - 8)}
          y2={height - (target / max) * (height - 8)}
          stroke={color}
          strokeDasharray="3 3"
          strokeWidth={1}
          opacity={0.6}
        />
      )}

      {/* Bars */}
      {values.map((v, i) => {
        const h      = (v / max) * (height - 8);
        const x      = i * (bw + 6);
        const y      = height - h;
        const isLast = i === values.length - 1;
        return (
          <g key={i}>
            <rect
              x={x} y={y}
              width={bw} height={h}
              rx={1.5}
              fill={isLast ? color : (dimColor ?? 'var(--fg-2)')}
              opacity={isLast ? 1 : (dimColor ? 1 : 0.4)}
            />
            {hasLabels && (
              <text
                x={x + bw / 2} y={height + 12}
                textAnchor="middle"
                fontSize={9}
                fill="var(--fg-3)"
                fontFamily="var(--font-mono)"
              >
                {labels![i]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

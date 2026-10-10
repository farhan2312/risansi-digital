export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}

export function Sparkline({
  values,
  width  = 80,
  height = 24,
  color  = 'var(--accent)',
  fill   = true,
}: SparklineProps) {
  if (!values || values.length === 0) return null;

  const max   = Math.max(...values);
  const min   = Math.min(...values);
  const range = max - min || 1;
  const step  = width / ((values.length - 1) || 1);

  const pts = values.map((v, i) =>
    `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / range) * (height - 4)).toFixed(1)}`
  );
  const d    = `M ${pts.join(' L ')}`;
  const area = `${d} L ${width},${height} L 0,${height} Z`;

  const lastV = values[values.length - 1];
  const cx    = (values.length - 1) * step;
  const cy    = height - 2 - ((lastV - min) / range) * (height - 4);

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {fill && <path d={area} fill={color} opacity={0.12} />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={cx} cy={cy} r={2} fill={color} />
    </svg>
  );
}

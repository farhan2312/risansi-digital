import type { ReactNode } from 'react';

export interface DonutSlice {
  pct:   number;
  color: string;
  name?: string;
}

export interface DonutProps {
  data:    DonutSlice[];
  size?:   number;
  thick?:  number;
  center?: ReactNode;
}

export function Donut({ data, size = 120, thick = 18, center }: DonutProps) {
  const total = data.reduce((s, d) => s + d.pct, 0) || 1;
  const r     = size / 2 - thick / 2;
  const c     = size / 2;
  let cum     = 0;

  return (
    <svg width={size} height={size}>
      {data.map((d, i) => {
        const startDeg = (cum / total) * 360 - 90;
        cum += d.pct;
        const endDeg = (cum / total) * 360 - 90;

        const x1    = c + r * Math.cos((startDeg * Math.PI) / 180);
        const y1    = c + r * Math.sin((startDeg * Math.PI) / 180);
        const x2    = c + r * Math.cos((endDeg   * Math.PI) / 180);
        const y2    = c + r * Math.sin((endDeg   * Math.PI) / 180);
        const large = endDeg - startDeg > 180 ? 1 : 0;

        return (
          <path
            key={i}
            d={`M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`}
            stroke={d.color}
            strokeWidth={thick}
            fill="none"
          />
        );
      })}

      {center && (
        <foreignObject x={0} y={0} width={size} height={size}>
          {/* @ts-expect-error: xmlns needed inside SVG foreignObject */}
          <div xmlns="http://www.w3.org/1999/xhtml" style={{
            width: size,
            height: size,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
          }}>
            {center}
          </div>
        </foreignObject>
      )}
    </svg>
  );
}

// oxlint-disable jsx-a11y/prefer-tag-over-role -- SVG groups use explicit keyboard-accessible button semantics.
'use client';
import {
  DIM,
  availableEdges,
  isMale,
  type Configuration,
  type Edge,
  type Pod,
  type Layout,
} from '@/lib/model/types';
import { cellId, cellPosition, normal } from '@/lib/model/layout';
const points = (r: number, h: number, half = false) =>
  half
    ? `${r},0 ${r / 2},${-h} ${-r / 2},${-h} ${-r},0`
    : `${r},0 ${r / 2},${-h} ${-r / 2},${-h} ${-r},0 ${-r / 2},${h} ${r / 2},${h}`;
export function ConnectorDiagram({
  pod,
  onToggle,
}: {
  pod: Pod;
  onToggle: (edge: Edge, on: boolean) => void;
}) {
  return (
    <svg
      className="connector-diagram"
      viewBox="-32 -30 64 60"
      aria-label="Connector diagram, viewed from the open front"
    >
      <polygon
        points={points(DIM.radius, 17, pod.kind === 'half')}
        fill="#e9eee7"
        stroke="#c2cfc4"
        strokeWidth=".5"
      />
      <polygon points={points(17.32, 15, pod.kind === 'half')} fill="#f9faf6" />
      {availableEdges(pod.kind).map((edge) => {
        const [nx, ny] = normal(edge),
          on = pod.enabled.includes(edge);
        return (
          <g
            key={edge}
            role="button"
            tabIndex={0}
            aria-label={`${edge} ${isMale(edge) ? 'male' : 'female'} connector ${on ? 'on' : 'off'}`}
            aria-pressed={on}
            onClick={() => onToggle(edge, !on)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onToggle(edge, !on);
              }
            }}
            className="edge-hit"
          >
            <circle
              cx={nx * 23}
              cy={-ny * 23}
              r="5.4"
              fill={on ? (isMale(edge) ? '#be7544' : '#426c61') : '#ffffff'}
              stroke={on ? 'none' : '#ccd5cc'}
              strokeWidth=".4"
            />
            <text
              x={nx * 23}
              y={-ny * 23 + 0.9}
              textAnchor="middle"
              fill={on ? 'white' : '#586d61'}
              fontSize="3.0"
              fontWeight="600"
            >
              {edge}
            </text>
            <line
              x1={nx * 18 - ny * 4}
              y1={-ny * 18 - nx * 4}
              x2={nx * 18 + ny * 4}
              y2={-ny * 18 + nx * 4}
              stroke={on ? (isMale(edge) ? '#be7544' : '#426c61') : '#bdcbbf'}
              strokeWidth="1.3"
            />
          </g>
        );
      })}
      <text
        x="0"
        y={pod.kind === 'half' ? -5 : 1}
        textAnchor="middle"
        fontSize="3"
        fill="#89988d"
      >
        FRONT
      </text>
    </svg>
  );
}
export function LayoutDiagram({
  config,
  layout,
  selected,
  onSelect,
}: {
  config: Configuration;
  layout: Layout | null;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const pitch = DIM.height + config.clearances.wallGap,
    width = (((config.columns - 1) * Math.sqrt(3)) / 2) * pitch + 45,
    height = (config.rows - 0.5) * pitch + 45;
  return (
    <div className="layout-map">
      <svg
        viewBox={`-23 ${-height + 22} ${width} ${height + 20}`}
        style={{ minHeight: 130, maxHeight: 230 }}
        aria-label="Select a pod or empty cell in the layout"
      >
        {Array.from({ length: config.columns }, (_, col) =>
          Array.from({ length: config.rows }, (_, row) => {
            const id = cellId(col, row),
              kind = config.cells[id] ?? 'full',
              [x, y] = cellPosition(col, row, config.clearances.wallGap);
            return (
              <g
                key={id}
                transform={`translate(${x} ${-y})`}
                role="button"
                tabIndex={0}
                aria-label={`Column ${col + 1}, row ${row + 1}, ${kind}`}
                aria-pressed={id === selected}
                onClick={() => onSelect(id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(id);
                  }
                }}
              >
                <polygon
                  points={points(DIM.radius - 1, 16)}
                  fill={
                    kind === 'empty'
                      ? 'transparent'
                      : id === selected
                        ? '#486e5b'
                        : '#dbe5d9'
                  }
                  stroke={id === selected ? '#bb784b' : '#aebfab'}
                  strokeWidth={id === selected ? 1.5 : 0.6}
                  strokeDasharray={kind === 'empty' ? '2 2' : undefined}
                />
                {kind === 'half' && (
                  <polygon
                    points={`${DIM.radius - 1},0 ${(DIM.radius - 1) / 2},16 ${-(DIM.radius - 1) / 2},16 ${-DIM.radius + 1},0`}
                    fill="#f4f5ee"
                  />
                )}
                <text
                  textAnchor="middle"
                  y={kind === 'half' ? -5 : 2}
                  fontSize="5"
                  fill={
                    id === selected && kind !== 'empty' ? 'white' : '#667b6b'
                  }
                >
                  {kind === 'empty' ? '+' : `${col + 1}.${row + 1}`}
                </text>
              </g>
            );
          }),
        )}
        {layout?.pods
          .filter((p) => p.filler)
          .map((p) => (
            <g
              key={p.id}
              transform={`translate(${p.x} ${-p.y})`}
              onClick={() => onSelect(p.id)}
              role="button"
              tabIndex={0}
              aria-label={`Base filler ${p.id}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(p.id);
                }
              }}
            >
              <polygon
                points={points(DIM.radius - 1, 16, true)}
                fill={selected === p.id ? '#486e5b' : '#cbd8c7'}
                stroke="#aebfab"
                strokeWidth=".6"
              />
            </g>
          ))}
      </svg>
      <p>Choose a cell to change its shape or connectors.</p>
    </div>
  );
}

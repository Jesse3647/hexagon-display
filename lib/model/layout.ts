import {
  DIM,
  EDGES,
  OPPOSITE,
  availableEdges,
  isMale,
  validateConfig,
  type Configuration,
  type Edge,
  type Layout,
  type Pod,
} from './types';
export const cellId = (column: number, row: number) => `${column},${row}`;
export const edgeOverrideKey = (id: string, edge: Edge) => `${id}:${edge}`;
export const pairKey = (a: string, b: string) => [a, b].sort().join('|');
export const normal = (edge: Edge): [number, number] => {
  const angle = ((EDGES.indexOf(edge) * 60 + 30) * Math.PI) / 180;
  return [
    Math.abs(Math.cos(angle)) < 1e-10 ? 0 : Math.cos(angle),
    Math.abs(Math.sin(angle)) < 1e-10 ? 0 : Math.sin(angle),
  ];
};
export function cellPosition(
  column: number,
  row: number,
  gap: number,
): [number, number] {
  const pitch = DIM.height + gap;
  return [
    ((column * Math.sqrt(3)) / 2) * pitch,
    (row + (column % 2) / 2) * pitch,
  ];
}
export function removalOrder(
  pods: Pod[],
  connections: Layout['connections'],
): string[] {
  const remaining = new Set(pods.map((p) => p.id));
  const order: string[] = [];
  // A female can slide toward the open front off its male neighbor. Remove
  // sinks first; all outgoing edges point east/north, so this graph is acyclic.
  while (remaining.size) {
    const next = pods
      .filter(
        (p) =>
          remaining.has(p.id) &&
          !connections.some(
            (c) => c.on && c.male === p.id && remaining.has(c.female),
          ),
      )
      .sort((a, b) => b.x - a.x || b.y - a.y || a.id.localeCompare(b.id))[0];
    if (!next)
      throw new Error('No collision-free connector removal order exists.');
    remaining.delete(next.id);
    order.push(next.id);
  }
  return order;
}
export function makeLayout(config: Configuration): Layout {
  const errors = validateConfig(config);
  if (errors.length) throw new Error(errors.join(' '));
  if (config.mode === 'single') {
    const pod: Pod = {
      id: 'single',
      kind: config.kind,
      x: 0,
      y: 0,
      baseTrim: 0,
      enabled: config.enabled.filter((e) =>
        availableEdges(config.kind).includes(e),
      ),
      filler: false,
    };
    return {
      pods: [pod],
      connections: [],
      groups: [['single']],
      order: ['single'],
      warnings: [],
    };
  }
  const pods: Pod[] = [];
  const warnings: string[] = [];
  for (let col = 0; col < config.columns; col++)
    for (let row = 0; row < config.rows; row++) {
      const id = cellId(col, row),
        kind = config.cells[id] ?? 'full';
      if (kind === 'empty') continue;
      const [x, y] = cellPosition(col, row, config.clearances.wallGap);
      pods.push({ id, kind, x, y, baseTrim: 0, enabled: [], filler: false });
    }
  if (config.flatBase && pods.length) {
    const floor = Math.min(
      ...pods.map((p) => p.y + (p.kind === 'full' ? -DIM.height / 2 : 0)),
    );
    for (let col = 0; col < config.columns; col++) {
      const bottom = pods
        .filter((p) => p.id.startsWith(`${col},`))
        .sort((a, b) => a.y - b.y)[0];
      if (!bottom) continue;
      const y = bottom.y - DIM.height - config.clearances.wallGap;
      const trim = floor - y;
      if (
        bottom.kind === 'full' &&
        trim >= -1e-6 &&
        trim <= config.clearances.wallGap / 2 + 1e-6
      ) {
        pods.push({
          id: `base-${col}`,
          kind: 'half',
          x: bottom.x,
          y,
          baseTrim: Math.max(0, trim),
          enabled: [],
          filler: true,
        });
      }
    }
    if (
      pods.some(
        (p) =>
          p.y + (p.kind === 'full' ? -DIM.height / 2 : p.baseTrim) >
            floor + 0.001 && !pods.some((b) => b.x === p.x && b.y < p.y),
      )
    )
      warnings.push(
        'This silhouette has raised columns that a single half filler cannot reach.',
      );
  }
  const connections: Layout['connections'] = [];
  const map = new Map(
    pods.map((p) => [`${p.x.toFixed(5)},${p.y.toFixed(5)}`, p]),
  );
  for (const pod of pods)
    for (const edge of availableEdges(pod.kind)) {
      const [nx, ny] = normal(edge),
        pitch = DIM.height + config.clearances.wallGap;
      const other = map.get(
        `${(pod.x + nx * pitch).toFixed(5)},${(pod.y + ny * pitch).toFixed(5)}`,
      );
      if (other && availableEdges(other.kind).includes(OPPOSITE[edge])) {
        const key = pairKey(pod.id, other.id);
        if (connections.some((c) => c.key === key)) continue;
        const on = config.overrides[key] ?? true;
        connections.push({
          key,
          a: pod.id,
          b: other.id,
          edge,
          on,
          male: isMale(edge) ? pod.id : other.id,
          female: isMale(edge) ? other.id : pod.id,
        });
        if (on) {
          pod.enabled.push(edge);
          other.enabled.push(OPPOSITE[edge]);
        }
      } else if (config.overrides[edgeOverrideKey(pod.id, edge)] === true)
        pod.enabled.push(edge);
    }
  const unseen = new Set(pods.map((p) => p.id)),
    groups: string[][] = [];
  while (unseen.size) {
    const queue = [unseen.values().next().value!],
      group: string[] = [];
    unseen.delete(queue[0]);
    while (queue.length) {
      const id = queue.shift()!;
      group.push(id);
      for (const c of connections.filter(
        (c) => c.on && (c.a === id || c.b === id),
      )) {
        const other = c.a === id ? c.b : c.a;
        if (unseen.delete(other)) queue.push(other);
      }
    }
    groups.push(group);
  }
  if (groups.length > 1)
    warnings.push(
      `${groups.length} disconnected groups will print as separate assemblies.`,
    );
  if (!pods.length) warnings.push('Add a pod to generate a printable model.');
  return {
    pods,
    connections,
    groups,
    order: removalOrder(pods, connections),
    warnings,
  };
}
export function toggleEdge(
  config: Configuration,
  id: string,
  edge: Edge,
  on: boolean,
): Configuration {
  if (config.mode === 'single')
    return {
      ...config,
      enabled: on
        ? Array.from(new Set([...config.enabled, edge]))
        : config.enabled.filter((e) => e !== edge),
    };
  const layout = makeLayout(config),
    connection = layout.connections.find(
      (c) =>
        (c.a === id && c.edge === edge) ||
        (c.b === id && OPPOSITE[c.edge] === edge),
    );
  return {
    ...config,
    overrides: {
      ...config.overrides,
      [connection?.key ?? edgeOverrideKey(id, edge)]: on,
    },
  };
}

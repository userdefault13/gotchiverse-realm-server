export type MeshNode = {
  id: string;
  x: number;
  y: number;
  powered: boolean;
  hp: number;
};

export type MeshPoint = {
  x: number;
  y: number;
};

/**
 * BFS over powered antennas (hp > 0) within link range to see if the wall receiver is reachable.
 */
export function canReachReceiver(
  antennas: MeshNode[],
  receiver: MeshPoint,
  range: number,
): boolean {
  const active = antennas.filter((a) => a.powered && a.hp > 0);
  if (active.length === 0) return false;

  for (const antenna of active) {
    if (Math.hypot(antenna.x - receiver.x, antenna.y - receiver.y) <= range) {
      return true;
    }
  }

  const visited = new Set<string>();
  const queue: string[] = [];

  for (const antenna of active) {
    visited.add(antenna.id);
    queue.push(antenna.id);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = active.find((a) => a.id === id);
    if (!node) continue;

    for (const other of active) {
      if (visited.has(other.id)) continue;
      if (Math.hypot(node.x - other.x, node.y - other.y) <= range) {
        visited.add(other.id);
        queue.push(other.id);
      }
    }
  }

  for (const id of visited) {
    const node = active.find((a) => a.id === id);
    if (!node) continue;
    if (Math.hypot(node.x - receiver.x, node.y - receiver.y) <= range) {
      return true;
    }
  }

  return false;
}

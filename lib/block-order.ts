export type BlockBounds = { id: string; top: number; height: number };

// The destination is an index in the list after the moving block is removed.
export function blockDropIndex(bounds: BlockBounds[], y: number) {
  const index = bounds.findIndex(block => y < block.top + block.height / 2);
  return index < 0 ? bounds.length : index;
}

export function reorderBlock<T extends { id: string }>(blocks: T[], id: string, destination: number): T[] {
  const source = blocks.findIndex(block => block.id === id);
  if (source < 0 || !Number.isFinite(destination)) return blocks;
  const target = Math.max(0, Math.min(blocks.length - 1, Math.trunc(destination)));
  if (source === target) return blocks;
  const next = [...blocks], [block] = next.splice(source, 1);
  next.splice(target, 0, block);
  return next;
}

export function blockScrollStep(y: number, top: number, bottom: number, elapsed: number) {
  const edge = Math.min(64, (bottom - top) / 4);
  if (edge <= 0) return 0;
  const strength = y < top + edge ? -Math.min(1, (top + edge - y) / edge)
    : y > bottom - edge ? Math.min(1, (y - bottom + edge) / edge) : 0;
  return strength * 650 * Math.min(32, Math.max(0, elapsed)) / 1000;
}

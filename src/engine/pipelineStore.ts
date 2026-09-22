// ============================================================
// Tiny cross-component store so DroneSimulation can reuse whatever
// image/segmentation/costmap/path was last solved in the Pipeline tab,
// instead of always generating its own random synthetic scene. Plain
// external store (no extra deps needed) consumed via React's built-in
// useSyncExternalStore.
// ============================================================
import type { SegmentationResult, CostmapResult, PathResult } from './algorithms';

export interface PipelineSnapshot {
  imgData: ImageData;
  seg: SegmentationResult;
  costmap: CostmapResult;
  path: PathResult;
}

let snapshot: PipelineSnapshot | null = null;
const listeners = new Set<() => void>();

export function setPipelineSnapshot(next: PipelineSnapshot): void {
  snapshot = next;
  for (const l of listeners) l();
}

export function getPipelineSnapshot(): PipelineSnapshot | null {
  return snapshot;
}

export function subscribePipelineSnapshot(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

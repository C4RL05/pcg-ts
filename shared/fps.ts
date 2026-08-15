/**
 * Tiny FPS meter: call the returned function once per frame; it pushes a
 * smoothed frames-per-second reading into `set` twice a second.
 */
export function createFpsMeter(set: (value: string) => void): () => void {
  let frames = 0;
  let last = performance.now();
  return () => {
    frames++;
    const now = performance.now();
    if (now - last >= 500) {
      set(((frames * 1000) / (now - last)).toFixed(0));
      frames = 0;
      last = now;
    }
  };
}

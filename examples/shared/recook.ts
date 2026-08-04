/**
 * Coalescing re-cook trigger: control changes can fire faster than a cook
 * completes, so runs are serialized and intermediate requests collapse
 * into a single trailing run.
 */
export function makeRecooker(run: () => Promise<void>): () => void {
  let busy = false;
  let queued = false;
  const kick = (): void => {
    if (busy) {
      queued = true;
      return;
    }
    busy = true;
    run()
      .catch((err: unknown) => console.error("recook failed:", err))
      .finally(() => {
        busy = false;
        if (queued) {
          queued = false;
          kick();
        }
      });
  };
  return kick;
}

/**
 * Minimal module shim so `tsc --noEmit` (npm run check) accepts `.svelte`
 * imports in the examples. Vite's svelte plugin does the real compiling;
 * props are typed inside each component.
 */
declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component<Record<string, unknown>>;
  export default component;
}

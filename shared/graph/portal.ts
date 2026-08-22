/**
 * Move an element to `document.body` and keep it there for its lifetime.
 *
 * WHY A FULL-SCREEN OVERLAY NEEDS THIS. `position: fixed` is relative to
 * the viewport only while no ancestor is a containing block for it, and an
 * ancestor becomes one by carrying a `filter`, a `backdrop-filter`, a
 * `transform`, or `will-change` on any of them. The demos' panel carries
 * `backdrop-filter: blur(6px)` — so a backdrop rendered inside it is
 * `inset: 0` against a 300px card, and the modal opens inside the
 * thumbnail that was supposed to expand.
 *
 * It could equally be fixed by taking the blur off the panel. That would
 * be fixing the wrong thing: the blur is a deliberate look, the trap is a
 * property of every ancestor between here and the root, and the next
 * component to grow a transform would spring it again.
 *
 * Svelte scopes styles with a class ON the element, not with a selector
 * rooted at its parent, so markup keeps its styling wherever it is moved.
 */
export function portal(node: HTMLElement): { destroy(): void } {
  const parent = node.parentNode;
  document.body.appendChild(node);
  return {
    destroy() {
      // Back where Svelte expects it, so its own removal finds it. Without
      // this, unmounting looks for the node under a parent it no longer has.
      if (parent && node.parentNode === document.body) parent.appendChild(node);
      node.remove();
    },
  };
}

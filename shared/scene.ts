/**
 * Shared three.js scene bootstrap for the examples: renderer, camera,
 * lights, optional orbit controls, resize handling, and the animation
 * loop. Every example gets the same dark look from here.
 */
import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** Shared dark background color (also used by page CSS). */
/**
 * The ground every demo's render sits on, and the colour its fog fades to.
 *
 * BLACK, because the site is. It was `0x0d1117` — a blue-black, and the
 * one hue left on a page whose chrome is now pure greyscale. The editor
 * had already opted out of it by passing `0x000000` of its own, which is
 * the clearest statement anyone made about what this should be.
 */
export const BACKGROUND = 0x000000;

/** Options for {@link createScene}. */
export interface SceneOptions {
  /** Initial camera position (default [28, 22, 28]). */
  cameraPosition?: readonly [number, number, number];
  /** Orbit/look target (default origin). */
  target?: readonly [number, number, number];
  /** Attach OrbitControls (default true). */
  orbit?: boolean;
  /** Add scene fog between the given distances. */
  fog?: { near: number; far: number };
  /** Camera far plane (default 2000). */
  far?: number;
  /**
   * Scene background, and the fog colour that has to match it (default
   * {@link BACKGROUND}). Optional because every demo but one wants the
   * shared dark blue; the editor asks for pure black.
   */
  background?: number;
  /**
   * Light colours. The default is a cool sky over a warm sun, which is
   * what gives the shared look its blue cast — a page that wants a
   * NEUTRAL render has to say so here, because no amount of grey in the
   * materials survives being lit by a tinted lamp.
   */
  lights?: {
    /** Hemisphere light, sky side (default 0xa8bce0). */
    sky?: number;
    /** Hemisphere light, ground side (default 0x232a33). */
    ground?: number;
    /** Key light (default 0xfff1dc). */
    sun?: number;
  };
}

/** Handle returned by {@link createScene}. */
export interface ExampleScene {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly controls: OrbitControls | undefined;
  /** Start the render loop; `tick` runs before each render. */
  start(tick?: (dt: number, elapsed: number) => void): void;
}

/** Create renderer + scene + camera + lights and wire resize handling. */
export function createScene(opts: SceneOptions = {}): ExampleScene {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new Scene();
  const background = opts.background ?? BACKGROUND;
  scene.background = new Color(background);
  if (opts.fog) scene.fog = new Fog(background, opts.fog.near, opts.fog.far);

  const camera = new PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    opts.far ?? 2000,
  );
  const [cx, cy, cz] = opts.cameraPosition ?? [28, 22, 28];
  camera.position.set(cx, cy, cz);
  const [tx, ty, tz] = opts.target ?? [0, 0, 0];
  camera.lookAt(tx, ty, tz);

  const hemi = new HemisphereLight(
    opts.lights?.sky ?? 0xa8bce0,
    opts.lights?.ground ?? 0x232a33,
    0.9,
  );
  scene.add(hemi);
  const sun = new DirectionalLight(opts.lights?.sun ?? 0xfff1dc, 1.6);
  sun.position.set(60, 90, 35);
  scene.add(sun);

  let controls: OrbitControls | undefined;
  if (opts.orbit !== false) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(tx, ty, tz);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.update();
  }

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return {
    scene,
    camera,
    renderer,
    controls,
    start(tick) {
      let last = performance.now();
      renderer.setAnimationLoop(() => {
        const now = performance.now();
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        controls?.update();
        tick?.(dt, now / 1000);
        renderer.render(scene, camera);
      });
    },
  };
}

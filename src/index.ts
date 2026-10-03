import {
  BufferAttribute,
  Color,
  CubeCamera,
  HalfFloatType,
  Mesh,
  Scene,
  ShaderChunk,
  ShaderMaterial,
  Vector3,
  Quaternion,
  WebGLCubeRenderTarget,
  WebGLRenderer,
} from "three";
import type {
  BufferGeometry,
  DataTexture,
  Object3D,
  PerspectiveCamera,
  OrthographicCamera,
  Texture,
  ToneMapping,
  DirectionalLight,
  SpotLight,
} from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
// Explicit ESM source entry also works with releases whose package root still selects a CommonJS bundle.
import { WebGLPathTracer } from "three-gpu-pathtracer/src/index.js";
import { CubeToEquirectGenerator } from "three-gpu-pathtracer/src/utils/CubeToEquirectGenerator.js";

export interface GradientBackground {
  center: Color;
  edge: Color;
}
export interface RendererOptions {
  canvas: HTMLCanvasElement;
  scene: Scene;
  camera: PerspectiveCamera | OrthographicCamera;
  width: number;
  height: number;
  toneMapping: ToneMapping;
  toneMappingExposure: number;
  outputColorSpace: "srgb" | "srgb-linear";
  bounces?: number;
  /** An explicit environment texture, or a scene to bake. Omit to retain scene.environment; null disables it. */
  environment?: Texture | { scene: Scene; resolution?: number } | null;
  /** Screen-space linear-color gradient. Omit to retain scene.background. */
  gradientBackground?: GradientBackground;
  /** readPixels() throws when every RGB value is 0, which usually means a lost GPU context. Defaults to true. */
  failAllBlack?: boolean;
}
export interface Renderer {
  readonly name: "three-gpu-pathtracer";
  readonly renderer: WebGLRenderer;
  readonly frames: number;
  render(): void;
  setSize(width: number, height: number): void;
  setCamera(camera: PerspectiveCamera | OrthographicCamera): void;
  /** The displayed image as RGBA8, top row first. Throws on an all-black image unless failAllBlack is false. */
  readPixels(): Uint8Array;
  dispose(): void;
}

/** True when every RGB value of an RGBA8 image is 0. */
export function isAllBlack(pixels: Uint8Array): boolean {
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i] || pixels[i + 1] || pixels[i + 2]) return false;
  return true;
}

/** Throws on an all-black image unless `failAllBlack` is false. */
export function assertNotAllBlack(
  pixels: Uint8Array,
  { failAllBlack = true }: Pick<RendererOptions, "failAllBlack"> = {},
): void {
  if (failAllBlack && isAllBlack(pixels))
    throw new Error(
      "Render is all black (GPU context lost?); set failAllBlack: false if that is expected",
    );
}
/** Explicitly bake a procedural scene to readable equirectangular HDR data. Caller owns the returned texture. */
export function bakeEnvironment(
  renderer: WebGLRenderer,
  scene: Scene,
  resolution = 256,
): DataTexture {
  if (!Number.isSafeInteger(resolution) || resolution <= 0)
    throw new Error("Environment resolution must be a positive integer");
  const target = new WebGLCubeRenderTarget(resolution, { type: HalfFloatType });
  try {
    new CubeCamera(0.1, 100, target).update(renderer, scene);
    // Older pathtracer releases reference this removed shader chunk without using it.
    (ShaderChunk as Record<string, string>).cube_uv_reflection_fragment ??= "";
    return new CubeToEquirectGenerator(renderer).generate(target.texture);
  } finally {
    target.dispose();
  }
}
function createBlitMaterial(background?: GradientBackground): ShaderMaterial {
  const gradient = background;
  return new ShaderMaterial({
    defines: { GRADIENT_BACKGROUND: gradient ? 1 : 0 },
    uniforms: {
      map: { value: null },
      center: { value: gradient?.center ?? new Color() },
      edge: { value: gradient?.edge ?? new Color() },
    },
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = vec4( position.xy, 0.0, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 center;
      uniform vec3 edge;
      void main() {
        ivec2 size = textureSize( map, 0 );
        vec4 radiance = texelFetch( map, ivec2( gl_FragCoord.xy ), 0 );
        #if GRADIENT_BACKGROUND
        vec2 uv = gl_FragCoord.xy / vec2( size );
        radiance.rgb += mix( center, edge, distance( uv, vec2( 0.5 ) ) / 0.5 ) * ( 1.0 - radiance.a );
        #endif
        gl_FragColor = vec4( radiance.rgb, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

export function dequantizeAttributes(scene: Object3D): void {
  const prepared = new Map<BufferGeometry, BufferGeometry>();
  scene.traverse((object) => {
    let geometry = (object as Mesh).geometry as BufferGeometry | undefined;
    if (!geometry) return;
    const cached = prepared.get(geometry);
    if (cached) {
      (object as Mesh).geometry = cached;
      return;
    }
    const source = geometry;
    geometry = geometry.clone();
    prepared.set(source, geometry);
    (object as Mesh).geometry = geometry;
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      if (!("isInterleavedBufferAttribute" in attribute) && attribute.array instanceof Float32Array)
        continue;
      const { count, itemSize } = attribute;
      const array = new Float32Array(count * itemSize);
      for (let i = 0; i < count; i++) {
        for (let c = 0; c < itemSize; c++) array[i * itemSize + c] = attribute.getComponent(i, c);
      }
      geometry.setAttribute(name, new BufferAttribute(array, itemSize));
    }
  });
}

/** Clone the scene while retaining light targets in the cloned hierarchy and external targets in world space. */
export function cloneScene(source: Scene): Scene {
  source.updateWorldMatrix(true, true);
  const scene = clone(source) as Scene;
  const originals: Object3D[] = [];
  const copies: Object3D[] = [];
  source.traverse((object) => originals.push(object));
  scene.traverse((object) => copies.push(object));
  const mapping = new Map(originals.map((object, index) => [object, copies[index]!]));
  for (const object of originals) {
    const light = object as DirectionalLight | SpotLight;
    if (
      !("isDirectionalLight" in light && light.isDirectionalLight) &&
      !("isSpotLight" in light && light.isSpotLight)
    )
      continue;
    const copy = mapping.get(light) as DirectionalLight | SpotLight;
    const target = mapping.get(light.target);
    if (target) copy.target = target;
    else {
      light.target.updateWorldMatrix(true, false);
      copy.target.matrix.copy(light.target.matrixWorld);
      copy.target.matrix.decompose(copy.target.position, copy.target.quaternion, copy.target.scale);
      copy.target.matrixWorld.copy(light.target.matrixWorld);
    }
  }
  scene.updateMatrixWorld(true);
  return scene;
}

/** Full beauty rendering with the legacy WebGL backend. No DOM/GPU setup is inferred. */
export async function createRenderer(options: RendererOptions): Promise<Renderer> {
  const { canvas, width, height, gradientBackground } = options;
  if (![width, height].every((x) => Number.isSafeInteger(x) && x > 0))
    throw new Error("Dimensions must be positive integers");
  if (!Number.isFinite(options.toneMappingExposure) || options.toneMappingExposure < 0)
    throw new Error("Specify toneMappingExposure explicitly");
  if (!["srgb", "srgb-linear"].includes(options.outputColorSpace))
    throw new Error("Specify outputColorSpace explicitly");
  if (options.failAllBlack !== undefined && typeof options.failAllBlack !== "boolean")
    throw new Error("failAllBlack must be a boolean");
  const scene = cloneScene(options.scene);
  dequantizeAttributes(scene);
  let camera = options.camera.clone();
  const adoptCamera = (source: PerspectiveCamera | OrthographicCamera) => {
    source.updateWorldMatrix(true, false);
    camera = source.clone();
    camera.position.copy(source.getWorldPosition(new Vector3()));
    camera.quaternion.copy(source.getWorldQuaternion(new Quaternion()));
    camera.updateMatrixWorld(true);
  };
  adoptCamera(options.camera);
  const renderer = new WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.toneMapping = options.toneMapping;
  renderer.toneMappingExposure = options.toneMappingExposure;
  renderer.outputColorSpace = options.outputColorSpace;
  let baked: DataTexture | undefined;
  let pathTracer: WebGLPathTracer | undefined;
  let blit: FullScreenQuad | undefined;
  const dispose = () => {
    blit?.material.dispose();
    blit?.dispose();
    pathTracer?.dispose();
    baked?.dispose();
    renderer.dispose();
    scene.traverse((object) => {
      if ((object as Mesh).geometry) (object as Mesh).geometry.dispose();
    });
  };
  try {
    if (options.environment && "scene" in options.environment) {
      baked = bakeEnvironment(renderer, options.environment.scene, options.environment.resolution);
      scene.environment = baked;
    } else if (options.environment !== undefined) scene.environment = options.environment;
    if (gradientBackground) scene.background = new Color(0);
    pathTracer = new WebGLPathTracer(renderer);
    pathTracer.renderDelay = 0;
    pathTracer.fadeDuration = 0;
    pathTracer.minSamples = 0;
    pathTracer.rasterizeScene = false;
    pathTracer.dynamicLowRes = false;
    pathTracer.tiles.set(1, 1);
    pathTracer.bounces = options.bounces ?? 8;
    pathTracer.filterGlossyFactor = 0;
    blit = new FullScreenQuad(createBlitMaterial(gradientBackground));
    const quad = blit;
    pathTracer.renderToCanvasCallback = (target) => {
      (quad.material as ShaderMaterial).uniforms.map!.value = target.texture;
      quad.render(renderer);
    };
    const tracer = pathTracer;
    const updateSize = (w: number, h: number) => {
      if (![w, h].every((x) => Number.isSafeInteger(x) && x > 0))
        throw new Error("Dimensions must be positive integers");
      renderer.setSize(w, h, false);
      if ("aspect" in camera) camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    updateSize(width, height);
    tracer.setScene(scene, camera);
    if (gradientBackground) {
      // Background alpha is currently exposed only on the legacy implementation's internal material.
      (
        tracer as unknown as { _pathTracer: { material: { backgroundAlpha: number } } }
      )._pathTracer.material.backgroundAlpha = 0;
    }
    return {
      name: "three-gpu-pathtracer",
      renderer,
      get frames() {
        return tracer.samples;
      },
      render() {
        tracer.renderSample();
      },
      setSize(w, h) {
        updateSize(w, h);
        tracer.updateCamera();
      },
      setCamera(source) {
        adoptCamera(source);
        updateSize(renderer.domElement.width, renderer.domElement.height);
        tracer.setCamera(camera);
      },
      readPixels() {
        // the drawing buffer is preserved, so it still holds the last presented sample
        const { width: w, height: h } = renderer.domElement;
        const gl = renderer.getContext();
        renderer.setRenderTarget(null);
        const bottomFirst = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bottomFirst);
        const pixels = new Uint8Array(bottomFirst.length);
        const stride = w * 4;
        for (let y = 0; y < h; y++)
          pixels.set(bottomFirst.subarray(y * stride, (y + 1) * stride), (h - 1 - y) * stride);
        assertNotAllBlack(pixels, options);
        return pixels;
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

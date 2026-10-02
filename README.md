# fidelity-kit-three-gpu-pathtracer

Reusable full-image renderer for the legacy WebGL `three-gpu-pathtracer`. The package supplies scene preparation, procedural environment baking, linear background compositing, and explicit Three.js tone mapping/output color space. It has no AO/direct output modes and does not initialize a browser or headless canvas for you.

```sh
npm install fidelity-kit-three-gpu-pathtracer three three-gpu-pathtracer three-mesh-bvh
```

```ts
import { createRenderer } from "fidelity-kit-three-gpu-pathtracer";
import { ACESFilmicToneMapping } from "three";

const renderer = await createRenderer({
  canvas,
  scene,
  camera,
  width: 1024,
  height: 1024,
  toneMapping: ACESFilmicToneMapping,
  toneMappingExposure: 1,
  outputColorSpace: "srgb",
  bounces: 8,
});
for (let i = 0; i < 256; i++) renderer.render();
// renderer.frames is the accumulated sample count.
const pixels = renderer.readPixels(); // RGBA8, top row first
renderer.dispose();
```

The renderer clones the scene and camera and prepares cloned geometry, preserving caller materials, geometry, transforms and scene backgrounds. Call `setCamera(camera)` after changing the caller camera, or `setSize(width, height)` to resize and reset accumulation. Other scene edits require creating a new renderer. Both perspective and orthographic cameras are accepted. `readPixels()` returns the displayed image as RGBA8, top row first. It throws when every RGB value is 0, which usually means the GPU context was lost; pass `failAllBlack: false` for scenes that are expected to be black. `isAllBlack` and `assertNotAllBlack` are exported for other renderers. The handle also exposes its WebGLRenderer; headless environments must provide their own DOM/canvas setup. `render()` performs one full-frame sample with tiles fixed at 1×1.

`environment` can be a Three.js texture, `{ scene, resolution?: 256 }` to bake a procedural environment, or `null` to disable lighting. When omitted, the scene's environment is retained. Scene environment intensity/rotation are passed through the cloned scene to the upstream path tracer. `gradientBackground: { center: Color, edge: Color }` composites linear-color radial gradient pixels under the accumulated radiance before tone mapping. Other backgrounds remain ordinary scene backgrounds. The display output is opaque, matching the fidelity suite.

`bakeEnvironment(webglRenderer, environmentScene, resolution = 256)` returns a readable equirectangular HDR DataTexture that can also be passed to `fidelity-kit-blender/three`'s `exportEnvironment`. The caller owns and disposes that texture. `dequantizeAttributes(object)` prepares cloned float geometry on the supplied objects; the renderer applies this to its own snapshot.

Three.js, three-gpu-pathtracer and three-mesh-bvh are peers, so fidelity suites can use their own forks and ensure one Three.js instance. The adapter imports the path tracer's ESM source entry explicitly, avoiding the historical CommonJS bundle selected by older npm releases. No `three.cjs` build is required. This package initially targets the legacy WebGL backend. The WebGPU backend remains in the consuming fidelity suite and is not part of this package's API. Upstream material/light limitations still apply; custom postprocessing is not exported or reproduced.

Standalone development pins [bhouston/three-gpu-pathtracer](https://github.com/bhouston/three-gpu-pathtracer) as `submodules/three-gpu-pathtracer`, tracking its `ss-fidelity` branch with an exact committed revision. The local pnpm workspace links that fork instead of installing its published package. A containing fidelity workspace can override the dependency with its own shared fork. Runtime consumers still supply the peer; the nested development submodule is not bundled into the npm package.

```sh
git-dedup clone --recurse-submodules https://github.com/bhouston/fidelity-kit-three-gpu-pathtracer.git
# Existing checkout: git-dedup submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm build
pnpm tsc
pnpm lint
pnpm test --coverage
WEBGL_INTEGRATION=1 pnpm test
```

The optional integration test uses a real headless WebGL canvas. Runtime consumers do not depend on that test backend.

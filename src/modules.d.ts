declare module "three-gpu-pathtracer/src/utils/CubeToEquirectGenerator.js" {
  import type { WebGLRenderer, Texture, DataTexture } from "three";
  export class CubeToEquirectGenerator {
    constructor(renderer: WebGLRenderer);
    generate(texture: Texture): DataTexture;
  }
}

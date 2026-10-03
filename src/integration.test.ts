import { expect, it } from "vitest";
it.skipIf(process.env.WEBGL_INTEGRATION !== "1")(
  "renders with the real legacy WebGL path tracer and preserves caller state",
  async () => {
    const { installDOM, createCanvas } = await import("@onirenaud/node-webgl");
    installDOM();
    const {
      Scene,
      Mesh,
      SphereGeometry,
      MeshStandardMaterial,
      PerspectiveCamera,
      DirectionalLight,
      Color,
      NoToneMapping,
    } = await import("three");
    const { createRenderer } = await import("./index.js");
    const scene = new Scene();
    const mesh = new Mesh(
      new SphereGeometry(1, 16, 12),
      new MeshStandardMaterial({ color: 0xffffff }),
    );
    scene.add(mesh);
    const light = new DirectionalLight(0xffffff, 2);
    light.position.set(0, 0, 5);
    scene.add(light);
    const camera = new PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 5;
    const canvas = createCanvas(16, 16);
    const handle = await createRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      scene,
      camera,
      width: 16,
      height: 16,
      toneMapping: NoToneMapping,
      toneMappingExposure: 1,
      outputColorSpace: "srgb",
      gradientBackground: { center: new Color(0x808080), edge: new Color(0x808080) },
    });
    try {
      const deadline = performance.now() + 30_000;
      while (handle.frames < 4 && performance.now() < deadline) {
        handle.render();
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(handle.frames).toBe(4);
      const { data } = canvas.getImageData();
      expect(data[(8 * 16 + 8) * 4]!).toBeGreaterThan(0);
      expect(data[0]).toBeGreaterThan(100);
      // readPixels matches the canvas readback, top row first
      expect([...handle.readPixels()]).toEqual([...data]);
      handle.setSize(8, 8);
      expect(handle.frames).toBe(0);
      const second = camera.clone();
      second.position.x = 0.1;
      handle.setCamera(second);
      while (handle.frames < 1 && performance.now() < deadline) {
        handle.render();
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(handle.frames).toBe(1);
      expect(scene.background).toBeNull();
      expect(camera.aspect).toBe(1);
      expect(mesh.geometry.attributes.position?.array).not.toBeNull();
    } finally {
      handle.dispose();
    }
  },
  120_000,
);

it.skipIf(process.env.WEBGL_INTEGRATION !== "1")(
  "keeps directional illumination invariant when a scene and its light target are translated",
  async () => {
    const { installDOM, createCanvas } = await import("@onirenaud/node-webgl");
    installDOM();
    const {
      Scene,
      Mesh,
      PlaneGeometry,
      MeshStandardMaterial,
      PerspectiveCamera,
      DirectionalLight,
      NoToneMapping,
    } = await import("three");
    const { createRenderer } = await import("./index.js");
    const centerPixels: number[] = [];
    for (const offset of [0, 10]) {
      const scene = new Scene();
      const mesh = new Mesh(new PlaneGeometry(4, 4), new MeshStandardMaterial({ roughness: 1 }));
      mesh.position.x = offset;
      const light = new DirectionalLight(0xffffff, Math.PI);
      light.position.set(offset, 0, 5);
      light.target.position.set(offset, 0, 0);
      scene.add(mesh, light, light.target);
      const camera = new PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.set(offset, 0, 5);
      const canvas = createCanvas(16, 16);
      const handle = await createRenderer({
        canvas: canvas as unknown as HTMLCanvasElement,
        scene,
        camera,
        width: 16,
        height: 16,
        toneMapping: NoToneMapping,
        toneMappingExposure: 1,
        outputColorSpace: "srgb",
      });
      try {
        const deadline = performance.now() + 30_000;
        while (handle.frames < 64 && performance.now() < deadline) {
          handle.render();
          await new Promise((resolve) => setImmediate(resolve));
        }
        expect(handle.frames).toBe(64);
        const data = canvas.getImageData().data;
        let sum = 0;
        for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) sum += data[(y * 16 + x) * 4]!;
        centerPixels.push(sum / 64);
      } finally {
        handle.dispose();
        mesh.geometry.dispose();
        (mesh.material as typeof mesh.material & { dispose(): void }).dispose();
      }
    }
    expect(centerPixels[0]).toBeGreaterThan(180);
    expect(Math.abs(centerPixels[0]! - centerPixels[1]!)).toBeLessThan(8);
  },
  120_000,
);

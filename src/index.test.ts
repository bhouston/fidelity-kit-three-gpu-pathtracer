import { expect, it } from "vitest";
import { BufferGeometry, Int16BufferAttribute, Mesh, MeshStandardMaterial, Scene } from "three";
import { dequantizeAttributes, createRenderer } from "./index.js";
it("prepares quantized geometry without changing the original geometry", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Int16BufferAttribute([32767, 0, -32767], 3, true));
  const scene = new Scene();
  const mesh = new Mesh(geometry, new MeshStandardMaterial());
  scene.add(mesh);
  dequantizeAttributes(scene);
  expect(mesh.geometry).not.toBe(geometry);
  expect(mesh.geometry.attributes.position?.array).toBeInstanceOf(Float32Array);
  expect([...mesh.geometry.attributes.position!.array]).toEqual([1, 0, -1]);
  expect(geometry.attributes.position?.array).toBeInstanceOf(Int16Array);
});
it("requires explicit valid dimensions before GPU initialization", async () => {
  await expect(
    createRenderer({ width: 0, height: 1 } as Parameters<typeof createRenderer>[0]),
  ).rejects.toThrow("Dimensions");
});

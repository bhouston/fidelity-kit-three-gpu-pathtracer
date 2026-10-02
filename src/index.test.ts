import { expect, it } from "vitest";
import { BufferGeometry, Int16BufferAttribute, Mesh, MeshStandardMaterial, Scene } from "three";
import { assertNotAllBlack, dequantizeAttributes, createRenderer, isAllBlack } from "./index.js";
it("prepares quantized geometry without changing the original geometry", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Int16BufferAttribute([32767, 0, -32767], 3, true));
  const scene = new Scene();
  const mesh = new Mesh(geometry, new MeshStandardMaterial());
  scene.add(mesh);
  const second = new Mesh(geometry, new MeshStandardMaterial());
  scene.add(second);
  dequantizeAttributes(scene);
  expect(second.geometry).toBe(mesh.geometry);
  expect(mesh.geometry).not.toBe(geometry);
  expect(mesh.geometry.attributes.position?.array).toBeInstanceOf(Float32Array);
  expect([...mesh.geometry.attributes.position!.array]).toEqual([1, 0, -1]);
  expect(geometry.attributes.position?.array).toBeInstanceOf(Int16Array);
});
it("detects all-black images, ignoring alpha, unless failAllBlack is false", () => {
  const black = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 0]);
  const dim = new Uint8Array([0, 0, 0, 255, 0, 1, 0, 255]);
  expect(isAllBlack(black)).toBe(true);
  expect(isAllBlack(dim)).toBe(false);
  expect(() => assertNotAllBlack(black)).toThrow("all black");
  expect(() => assertNotAllBlack(black, { failAllBlack: false })).not.toThrow();
  expect(() => assertNotAllBlack(dim)).not.toThrow();
});
it("requires explicit valid dimensions before GPU initialization", async () => {
  await expect(
    createRenderer({ width: 0, height: 1 } as Parameters<typeof createRenderer>[0]),
  ).rejects.toThrow("Dimensions");
});

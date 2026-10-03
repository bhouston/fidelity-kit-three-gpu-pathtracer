import { expect, it } from "vitest";
import { DirectionalLight, SpotLight, Group, Scene, Vector3 } from "three";
import { cloneScene } from "./index.js";

it.each([DirectionalLight, SpotLight])(
  "retains a parented target in the cloned hierarchy for %s",
  (Light) => {
    const scene = new Scene();
    const parent = new Group();
    parent.position.set(7, 3, -2);
    parent.rotation.y = Math.PI / 3;
    const light = new Light();
    light.name = "sun";
    light.position.set(-10, 8, 4);
    light.target.name = "target";
    light.target.position.set(1, 2, 3);
    parent.add(light.target);
    scene.add(light, parent);
    const copy = cloneScene(scene);
    const clonedLight = copy.getObjectByName("sun") as DirectionalLight;
    expect(clonedLight.target).toBe(copy.getObjectByName("target"));
    expect(clonedLight.target).not.toBe(light.target);
    expect(
      clonedLight.target
        .getWorldPosition(new Vector3())
        .distanceTo(light.target.getWorldPosition(new Vector3())),
    ).toBeLessThan(1e-12);
    clonedLight.target.position.x += 2;
    expect(light.target.position.x).toBe(1);
  },
);

it.each([DirectionalLight, SpotLight])(
  "preserves an external target in world space for %s",
  (Light) => {
    const scene = new Scene();
    const parent = new Group();
    parent.position.set(7, 3, -2);
    parent.rotation.y = Math.PI / 3;
    const light = new Light();
    light.name = "sun";
    light.target.position.set(1, 2, 3);
    parent.add(light.target);
    scene.add(light);
    const copy = cloneScene(scene).getObjectByName("sun") as DirectionalLight;
    expect(copy.target.parent).toBeNull();
    expect(
      copy.target
        .getWorldPosition(new Vector3())
        .distanceTo(light.target.getWorldPosition(new Vector3())),
    ).toBeLessThan(1e-12);
    expect(light.target.parent).toBe(parent);
  },
);

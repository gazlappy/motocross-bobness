import * as THREE from 'three';

// A bike's shadow from a stand-in: two wheel discs and a body box, about a hundred triangles. It is
// invisible in the picture (writes neither colour nor depth) but solid to the shadow pass; the
// detailed bike, 180k triangles for the Honda, no longer casts. Drawing every bike twice in full
// detail made the GPU spike whenever the pack bunched up in the shadow area (visible judder).

const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const wheelGeometry = new THREE.CylinderGeometry(0.34, 0.34, 0.11, 16).rotateZ(Math.PI / 2);
const bodyGeometry = new THREE.BoxGeometry(0.3, 0.55, 1.15);

/** Wheels at the physics wheel positions (bike space, axles `axleY` high), body between them. */
export function bikeShadowProxy(axleY: number) {
  const g = new THREE.Group();
  for (const z of [-0.82, 0.66]) {
    const wheel = new THREE.Mesh(wheelGeometry, material);
    wheel.position.set(0, axleY, z);
    g.add(wheel);
  }
  const body = new THREE.Mesh(bodyGeometry, material);
  body.position.set(0, axleY + 0.42, -0.08);
  g.add(body);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

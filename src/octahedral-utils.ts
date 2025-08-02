/**
 * Octahedral mapping utilities for direction encoding/decoding
 */

import {
  Vector2,
  Vector3,
  Sphere,
  Object3D,
  Mesh
} from 'three';

// ============================================================================
// SHARED RESOURCES
// ============================================================================

/** Temporary sphere for bounding calculations */
const TEMP_SPHERE = new Sphere();

/** Reusable vectors for octahedral mapping calculations */
const OCTAHEDRAL_VECTORS = {
  absolute: new Vector3(),
  octant: new Vector3(),
  octahedron: new Vector3()
};

// ============================================================================
// BOUNDING SPHERE UTILITIES
// ============================================================================

/**
 * Computes the bounding sphere of a 3D object hierarchy.
 * Recursively traverses all mesh objects and combines their bounding spheres.
 * 
 * @param obj - The root object to compute bounds for
 * @param target - Optional target sphere to store the result
 * @param forceComputeBoundingSphere - Whether to force recomputation of geometry bounds
 * @returns The computed bounding sphere
 */
export function computeObjectBoundingSphere(
  obj: Object3D,
  target = new Sphere(),
  forceComputeBoundingSphere = false
): Sphere {
  target.makeEmpty();
  
  function traverse(currentObj: Object3D): void {
    if ((currentObj as Mesh).isMesh) {
      const mesh = currentObj as Mesh;
      const { geometry } = mesh;
      
      if (forceComputeBoundingSphere || !geometry.boundingSphere) {
        geometry.computeBoundingSphere();
      }
      
      TEMP_SPHERE.copy(geometry.boundingSphere!).applyMatrix4(currentObj.matrixWorld);
      target.union(TEMP_SPHERE);
    }
    
    currentObj.children.forEach(traverse);
  }
  
  traverse(obj);
  return target;
}

// ============================================================================
// OCTAHEDRAL MAPPING FUNCTIONS
// ============================================================================

/**
 * Converts hemispherical octahedral grid coordinates to a 3D direction vector.
 * 
 * @param grid - 2D grid coordinates in [0,1] range
 * @param target - Optional target vector to store the result
 * @returns Normalized direction vector
 */
export function hemiOctaGridToDir(grid: Vector2, target = new Vector3()): Vector3 {
  target.set(grid.x - grid.y, 0, -1 + grid.x + grid.y);
  target.y = 1 - Math.abs(target.x) - Math.abs(target.z);
  return target;
}

/**
 * Converts full octahedral grid coordinates to a 3D direction vector.
 * 
 * @param grid - 2D grid coordinates in [0,1] range
 * @param target - Optional target vector to store the result
 * @returns Normalized direction vector
 */
export function octaGridToDir(grid: Vector2, target = new Vector3()): Vector3 {
  const encoded = new Vector2(grid.x * 2 - 1, grid.y * 2 - 1);
  target.set(encoded.x, 0, encoded.y);
  target.y = 1 - Math.abs(target.x) - Math.abs(target.z);
  
  if (target.y < 0) {
    const signX = target.x >= 0 ? 1 : -1;
    const signZ = target.z >= 0 ? 1 : -1;
    const oldX = target.x;
    
    target.x = (1 - Math.abs(target.z)) * signX;
    target.z = (1 - Math.abs(oldX)) * signZ;
  }
  
  return target.normalize();
}

/**
 * Converts a 3D direction vector to hemispherical octahedral grid coordinates.
 * 
 * @param dir - Normalized direction vector
 * @param target - Optional target vector to store the result
 * @returns 2D grid coordinates in [0,1] range
 */
export function hemiOctaDirToGrid(dir: Vector3, target = new Vector2()): Vector2 {
  const { octant, octahedron } = OCTAHEDRAL_VECTORS;
  
  octant.set(Math.sign(dir.x), Math.sign(dir.y), Math.sign(dir.z));
  const sum = dir.dot(octant);
  octahedron.copy(dir).divideScalar(sum);
  
  return target.set(
    (1 + octahedron.x + octahedron.z) * 0.5,
    (1 + octahedron.z - octahedron.x) * 0.5
  );
}

/**
 * Converts a 3D direction vector to full octahedral grid coordinates.
 * 
 * @param dir - Normalized direction vector
 * @param target - Optional target vector to store the result
 * @returns 2D grid coordinates in [0,1] range
 */
export function octaDirToGrid(dir: Vector3, target = new Vector2()): Vector2 {
  const absDir = new Vector3(Math.abs(dir.x), Math.abs(dir.y), Math.abs(dir.z));
  const normalizedDir = dir.clone().divideScalar(absDir.x + absDir.y + absDir.z);
  
  if (normalizedDir.y < 0) {
    const signX = normalizedDir.x >= 0 ? 1 : -1;
    const signZ = normalizedDir.z >= 0 ? 1 : -1;
    const oldX = normalizedDir.x;
    
    normalizedDir.x = (1 - Math.abs(normalizedDir.z)) * signX;
    normalizedDir.z = (1 - Math.abs(oldX)) * signZ;
  }
  
  return target.set(
    normalizedDir.x * 0.5 + 0.5,
    normalizedDir.z * 0.5 + 0.5
  );
}
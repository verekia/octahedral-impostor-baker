/**
 * Minimal octahedral utilities for standalone demo
 */

import { Sphere, Object3D, Mesh } from 'three';

// ============================================================================
// SHARED RESOURCES
// ============================================================================

/** Temporary sphere for bounding calculations */
const TEMP_SPHERE = new Sphere();

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
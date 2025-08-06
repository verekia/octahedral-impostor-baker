/**
 * Shared types and interfaces for octahedral impostor system
 * Combined with octahedral mapping utilities for direction encoding/decoding
 */

import {
  Material,
  Matrix4,
  Vector3,
  WebGLRenderer,
  Object3D,
  WebGLRenderTarget,
  Texture,
  IUniform,
  Vector2,
  Sphere,
  Mesh
} from 'three';

// ============================================================================
// SHARED CONSTANTS
// ============================================================================

/** Octahedral mapping modes */
export enum OctahedralMode {
  /** Full spherical mapping (360° coverage) */
  SPHERICAL = 'spherical',
  /** Hemispherical mapping (upper hemisphere only) */
  HEMISPHERICAL = 'hemispherical'
}

/** Camera types for atlas generation */
export enum CameraType {
  /** Orthographic camera (no perspective distortion) */
  ORTHOGRAPHIC = 'orthographic',
  /** Perspective camera (with perspective distortion) */
  PERSPECTIVE = 'perspective'
}

/** Default configuration values */
export const DEFAULT_CONFIG = {
  ATLAS_SIZE: 4096,
  SPRITES_PER_SIDE: 32,
  CAMERA_FACTOR: 1,
  ALPHA_TEST: 0.1,
  ALPHA_CLAMP: 0.1,
  SCALE: 1,
  TRANSLATION: new Vector3(),
  OCTAHEDRAL_MODE: OctahedralMode.HEMISPHERICAL,
  CAMERA_TYPE: CameraType.ORTHOGRAPHIC,
  HYBRID_DISTANCE: 2.0
} as const;

// ============================================================================
// OCTAHEDRAL IMPOSTOR TYPES
// ============================================================================

/** Supported shader defines for octahedral impostor materials */
export type OctahedralImpostorDefinesKeys = 
  | 'OCTAHEDRAL_USE_HEMI_OCTAHEDRON' 
  | 'OCTAHEDRAL_USE_NORMAL' 
  | 'OCTAHEDRAL_USE_ORM' 
  | 'OCTAHEDRAL_TRANSPARENT';

/** Collection of shader defines for octahedral impostor materials */
export type OctahedralImpostorDefines = { 
  [key in OctahedralImpostorDefinesKeys]?: boolean 
};

/** Utility type to extract uniform value type */
export type UniformValue<T> = T extends IUniform<infer U> ? U : never;

/** Material constructor type */
export type MaterialConstructor<T extends Material> = new () => T;

/**
 * Uniforms used by octahedral impostor materials.
 */
export interface OctahedralImpostorUniforms {
  /** Number of sprites per side of the atlas */
  spritesPerSide: IUniform<number>;
  /** Alpha threshold for transparency testing */
  alphaClamp: IUniform<number>;
  /** Transformation matrix for impostor positioning */
  transform: IUniform<Matrix4>;
  /** Flag to disable triplanar blending */
  disableBlending: IUniform<number>;
  /** Elevation threshold above which impostor can tilt upward */
  hybridDistance: IUniform<number>;
}

/**
 * Configuration for octahedral impostor material properties.
 */
export interface OctahedralImpostorMaterial {
  /** Whether material should use transparency */
  transparent?: boolean;
  /** Alpha threshold for transparency testing */
  alphaClamp?: number;
  /** Scale factor for impostor billboards */
  scale?: number;
  /** Position offset for impostor billboards */
  translation?: Vector3;
  /** Whether to disable triplanar blending */
  disableBlending?: boolean;
  /** Elevation threshold above which impostor can tilt upward */
  hybridDistance?: number;
}

// ============================================================================
// ATLAS GENERATION TYPES  
// ============================================================================

/**
 * Configuration parameters for texture atlas creation.
 */
export interface CreateTextureAtlasParams {
  /** WebGL renderer instance */
  renderer: WebGLRenderer;
  /** Octahedral mapping mode (spherical or hemispherical) */
  octahedralMode: OctahedralMode;
  /** Target 3D object to generate atlas for */
  target: Object3D;
  /** Atlas texture resolution (default: 2048) */
  textureSize?: number;
  /** Number of sprites per atlas side (default: 16) */
  spritesPerSide?: number;
  /** Camera distance factor (default: 1) */
  cameraFactor?: number;
  /** Camera type for atlas generation (default: ORTHOGRAPHIC) */
  cameraType?: CameraType;
}

/**
 * Generated texture atlas containing albedo and normal-depth textures.
 */
export interface TextureAtlas {
  /** Multi-target render target containing both textures */
  renderTarget: WebGLRenderTarget;
  /** RGB albedo texture */
  albedo: Texture;
  /** RGBA normal-depth texture (XYZ = normal, W = depth) */
  normalDepth: Texture;
}

/**
 * Complete configuration for creating an octahedral impostor material.
 */
export interface CreateOctahedralImpostor<T extends Material> 
  extends OctahedralImpostorMaterial, CreateTextureAtlasParams {
  /** Base Three.js material type to extend */
  baseType: MaterialConstructor<T>;
}

// Augment Three.js Material interface
declare module 'three' {
  interface Material extends OctahedralImpostorMaterial {
    /** Flag indicating this is an octahedral impostor material */
    isOctahedralImpostorMaterial?: boolean;
    /** Uniforms for octahedral impostor rendering */
    octahedralImpostorUniforms?: OctahedralImpostorUniforms;
    /** Shader defines for octahedral impostor rendering */
    octahedralImpostorDefines?: OctahedralImpostorDefines;
  }
}

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
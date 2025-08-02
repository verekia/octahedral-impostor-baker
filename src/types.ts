/**
 * Shared types and interfaces for octahedral impostor system
 */

import {
  Material,
  Matrix4,
  Vector3,
  WebGLRenderer,
  Object3D,
  WebGLRenderTarget,
  Texture,
  IUniform
} from 'three';

// ============================================================================
// SHARED CONSTANTS
// ============================================================================

/** Default configuration values */
export const DEFAULT_CONFIG = {
  ATLAS_SIZE: 2048,
  SPRITES_PER_SIDE: 16,
  CAMERA_FACTOR: 1,
  ALPHA_TEST: 0.1,
  ALPHA_CLAMP: 0.1,
  SCALE: 1,
  TRANSLATION: new Vector3()
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
  /** Whether to use hemispherical or full octahedral mapping */
  useHemiOctahedron: boolean;
  /** Target 3D object to generate atlas for */
  target: Object3D;
  /** Atlas texture resolution (default: 2048) */
  textureSize?: number;
  /** Number of sprites per atlas side (default: 16) */
  spritesPerSide?: number;
  /** Camera distance factor (default: 1) */
  cameraFactor?: number;
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
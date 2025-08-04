/**
 * Minimal types for octahedral impostor system (standalone demo)
 */

import { Material, Matrix4, Vector3, IUniform } from 'three';

// ============================================================================
// SHARED CONSTANTS
// ============================================================================

/** Default configuration values */
export const DEFAULT_CONFIG = {
  SPRITES_PER_SIDE: 16,
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

/**
 * Configuration for creating octahedral impostor with pregenerated textures
 */
export interface CreateOctahedralImpostorStandalone<T extends Material> 
  extends OctahedralImpostorMaterial {
  /** Base Three.js material type to extend */
  baseType: MaterialConstructor<T>;
  /** Whether to use hemispherical or full octahedral mapping */
  useHemiOctahedron: boolean;
  /** Number of sprites per atlas side */
  spritesPerSide?: number;
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
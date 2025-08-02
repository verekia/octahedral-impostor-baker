/**
 * Octahedral Impostor Rendering System
 * 
 * A comprehensive solution for creating and rendering octahedral impostors in Three.js.
 * Provides utilities for texture atlas generation, octahedral mapping, and billboard rendering.
 * 
 * This main file re-exports all functionality from the modular components for backwards compatibility.
 * 
 * @author Your Name
 * @version 1.0.0
 */

// Re-export all types and interfaces
export * from './types.js';

// Re-export octahedral utilities
export * from './octahedral-utils.js';

// Re-export texture export utilities
export * from './texture-export.js';

// Re-export atlas generation functionality
export * from './atlas-generation.js';

// Re-export impostor rendering functionality
export * from './impostor-rendering.js';

// Import TSL modules for future extensibility
// These imports are preserved but not currently used
import {
  Fn,
  If,
  uniform,
  varying,
  attribute,
  uv,
  positionLocal,
  positionWorld,
  positionView,
  normalLocal,
  normalView,
  normalWorld,
  cameraPosition,
  modelViewMatrix,
  cameraProjectionMatrix,
  vec2,
  vec3,
  vec4,
  mat3,
  mat4,
  float,
  int,
  bool,
  texture,
  mix,
  clamp,
  min,
  max,
  abs,
  sign,
  dot,
  cross,
  normalize,
  length,
  fract,
  floor,
  ceil,
  step,
  smoothstep,
  sin,
  cos,
  atan,
  pow,
  sqrt,
  select,
  Discard
} from 'three/tsl';

// TSL utilities reserved for future extensions
// Add any additional TSL utilities if needed in the future

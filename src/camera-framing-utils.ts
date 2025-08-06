/**
 * Smart camera framing utilities for optimal scene composition
 * Provides intelligent camera positioning and object framing based on bounding spheres
 */

import {
  Vector3,
  Sphere,
  Camera,
  PerspectiveCamera,
  OrthographicCamera,
  Object3D,
  Quaternion,
  Euler,
  MathUtils
} from 'three';

import { computeObjectBoundingSphere } from './octahedral-utils.js';

// ============================================================================
// FRAMING MODES AND CONFIGURATION
// ============================================================================

/** Different framing approaches for camera positioning */
export enum FramingMode {
  /** Tight fit - object fills most of the view */
  TIGHT = 'tight',
  /** Comfortable - object with pleasant padding around it */
  COMFORTABLE = 'comfortable', 
  /** Cinematic - wide shot with dramatic composition */
  CINEMATIC = 'cinematic',
  /** Custom - user-defined padding factor */
  CUSTOM = 'custom'
}

/** Camera orientation presets for pleasant viewing angles */
export enum ViewingAngle {
  /** Standard front view */
  FRONT = 'front',
  /** 3/4 view from front-right */
  FRONT_RIGHT = 'front-right',
  /** Side view from right */
  RIGHT = 'right',
  /** 3/4 view from back-right */
  BACK_RIGHT = 'back-right',
  /** Back view */
  BACK = 'back',
  /** 3/4 view from back-left */
  BACK_LEFT = 'back-left',
  /** Side view from left */
  LEFT = 'left',
  /** 3/4 view from front-left */
  FRONT_LEFT = 'front-left',
  /** Top-down view */
  TOP = 'top',
  /** Slightly elevated front view (most pleasant for most objects) */
  HERO = 'hero',
  /** Custom angle */
  CUSTOM = 'custom'
}

/** Configuration for camera framing */
export interface CameraFramingConfig {
  /** Framing mode - determines how much padding around the object */
  framingMode: FramingMode;
  /** Custom padding factor (only used with CUSTOM framing mode) */
  customPadding?: number;
  /** Viewing angle preset */
  viewingAngle: ViewingAngle;
  /** Custom viewing direction (only used with CUSTOM viewing angle) */
  customDirection?: Vector3;
  /** Custom up vector for camera orientation */
  customUp?: Vector3;
  /** Whether to automatically adjust for object proportions */
  autoAdjustForProportions: boolean;
  /** Minimum distance multiplier to prevent clipping */
  minDistanceMultiplier: number;
  /** Maximum distance multiplier to prevent objects becoming too small */
  maxDistanceMultiplier: number;
}

/** Default framing configuration */
export const DEFAULT_FRAMING_CONFIG: CameraFramingConfig = {
  framingMode: FramingMode.COMFORTABLE,
  viewingAngle: ViewingAngle.HERO,
  autoAdjustForProportions: true,
  minDistanceMultiplier: 1.2,
  maxDistanceMultiplier: 10.0
};

/** Result of camera framing calculation */
export interface FramingResult {
  /** Optimal camera position */
  position: Vector3;
  /** Camera look-at target */
  target: Vector3;
  /** Camera up vector */
  up: Vector3;
  /** Calculated distance from target */
  distance: number;
  /** Bounding sphere used for calculation */
  boundingSphere: Sphere;
  /** Actual padding factor applied */
  paddingFactor: number;
}

// ============================================================================
// PADDING FACTORS FOR DIFFERENT FRAMING MODES
// ============================================================================

const FRAMING_PADDING_FACTORS = {
  [FramingMode.TIGHT]: 1.1,
  [FramingMode.COMFORTABLE]: 1.5,
  [FramingMode.CINEMATIC]: 2.5,
  [FramingMode.CUSTOM]: 1.0 // Will be overridden by customPadding
} as const;

// ============================================================================
// VIEWING ANGLE PRESETS
// ============================================================================

const VIEWING_ANGLE_DIRECTIONS = {
  [ViewingAngle.FRONT]: new Vector3(0, 0, 1),
  [ViewingAngle.FRONT_RIGHT]: new Vector3(1, 0, 1).normalize(),
  [ViewingAngle.RIGHT]: new Vector3(1, 0, 0),
  [ViewingAngle.BACK_RIGHT]: new Vector3(1, 0, -1).normalize(),
  [ViewingAngle.BACK]: new Vector3(0, 0, -1),
  [ViewingAngle.BACK_LEFT]: new Vector3(-1, 0, -1).normalize(),
  [ViewingAngle.LEFT]: new Vector3(-1, 0, 0),
  [ViewingAngle.FRONT_LEFT]: new Vector3(-1, 0, 1).normalize(),
  [ViewingAngle.TOP]: new Vector3(0, 1, 0),
  [ViewingAngle.HERO]: new Vector3(1, 0.7, 1.5).normalize(), // Slightly elevated front-right
  [ViewingAngle.CUSTOM]: new Vector3(0, 0, 1) // Will be overridden
} as const;

// ============================================================================
// SMART CAMERA FRAMING FUNCTIONS
// ============================================================================

/**
 * Calculates optimal camera framing for the given object
 * 
 * @param target - The 3D object to frame
 * @param camera - The camera to position
 * @param config - Framing configuration
 * @returns Framing calculation result
 */
export function calculateOptimalFraming(
  target: Object3D,
  camera: Camera,
  config: Partial<CameraFramingConfig> = {}
): FramingResult {
  const finalConfig = { ...DEFAULT_FRAMING_CONFIG, ...config };
  
  // Compute bounding sphere
  const boundingSphere = computeObjectBoundingSphere(target, new Sphere(), true);
  
  // Get viewing direction
  const viewDirection = getViewingDirection(finalConfig.viewingAngle, finalConfig.customDirection);
  
  // Calculate padding factor
  const paddingFactor = getPaddingFactor(finalConfig);
  
  // Calculate optimal distance based on camera type
  const distance = calculateOptimalDistance(camera, boundingSphere, paddingFactor, finalConfig);
  
  // Calculate camera position
  const position = viewDirection.clone()
    .multiplyScalar(distance)
    .add(boundingSphere.center);
  
  // Calculate up vector
  const up = calculateUpVector(viewDirection, finalConfig.customUp);
  
  return {
    position,
    target: boundingSphere.center.clone(),
    up,
    distance,
    boundingSphere,
    paddingFactor
  };
}

/**
 * Updates orbital controls to center on the given target point with optimal distance
 * 
 * @param controls - OrbitControls instance
 * @param targetPoint - Point to center the camera on
 * @param boundingSphere - Bounding sphere of the object for distance calculation
 * @param camera - Camera for calculating optimal distance
 * @param paddingFactor - Optional padding factor (default: 1.5 for comfortable viewing)
 */
export function centerOrbitalCamera(
  controls: any, // OrbitControls type
  targetPoint: Vector3,
  boundingSphere?: Sphere,
  camera?: Camera,
  paddingFactor: number = 1.5
): void {
  // Update the controls target
  controls.target.copy(targetPoint);
  
  // Calculate optimal distance if bounding sphere and camera are provided
  if (boundingSphere && camera) {
    const distance = calculateOptimalViewingDistance(camera, boundingSphere, paddingFactor);
    const currentDirection = controls.object.position.clone().sub(controls.target).normalize();
    controls.object.position.copy(targetPoint).add(currentDirection.multiplyScalar(distance));
  }
  
  // Update the controls
  controls.update();
}

/**
 * Calculates optimal viewing distance to ensure the entire object is visible
 * 
 * @param camera - The camera to calculate distance for
 * @param boundingSphere - Bounding sphere of the object
 * @param paddingFactor - Padding factor for comfortable viewing
 * @returns Optimal viewing distance
 */
export function calculateOptimalViewingDistance(
  camera: Camera,
  boundingSphere: Sphere,
  paddingFactor: number = 1.5
): number {
  const radius = boundingSphere.radius;
  let distance: number;
  
  if ((camera as any).isPerspectiveCamera) {
    const perspCamera = camera as PerspectiveCamera;
    const fovRadians = (perspCamera.fov * Math.PI) / 180;
    
    // Calculate distance needed for object to fit in view with padding
    // Use the larger dimension (width or height) to ensure full coverage
    const aspectRatio = perspCamera.aspect || 1;
    const effectiveRadius = radius * paddingFactor;
    
    // Calculate distances for both vertical and horizontal FOV
    const verticalDistance = effectiveRadius / Math.tan(fovRadians / 2);
    const horizontalDistance = (effectiveRadius * aspectRatio) / Math.tan(fovRadians / 2);
    
    // Use the larger distance to ensure the object fits in both dimensions
    distance = Math.max(verticalDistance, horizontalDistance);
    
    // Add some extra margin for safety
    distance *= 1.1;
    
  } else if ((camera as any).isOrthographicCamera) {
    const orthoCamera = camera as OrthographicCamera;
    
    // For orthographic cameras, we need to adjust the zoom instead of distance
    // But we still need a reasonable distance for depth precision
    distance = radius * paddingFactor * 2;
    
    // Calculate the required zoom to fit the object
    const cameraWidth = Math.abs(orthoCamera.right - orthoCamera.left);
    const cameraHeight = Math.abs(orthoCamera.top - orthoCamera.bottom);
    const objectSize = radius * paddingFactor * 2;
    
    // Calculate zoom based on the limiting dimension
    const zoomX = cameraWidth / objectSize;
    const zoomY = cameraHeight / objectSize;
    const optimalZoom = Math.min(zoomX, zoomY);
    
    // Apply the zoom
    orthoCamera.zoom = optimalZoom;
    orthoCamera.updateProjectionMatrix();
    
  } else {
    // Fallback for unknown camera types
    distance = radius * paddingFactor * 3;
  }
  
  // Ensure minimum distance for depth buffer precision
  distance = Math.max(distance, radius * 1.5);
  
  return distance;
}

/**
 * Applies the framing result to a camera
 * 
 * @param camera - Camera to position
 * @param framing - Framing result from calculateOptimalFraming
 */
export function applyCameraFraming(camera: Camera, framing: FramingResult): void {
  camera.position.copy(framing.position);
  camera.lookAt(framing.target);
  camera.up.copy(framing.up);
  camera.updateMatrixWorld();
}

/**
 * Creates a smooth transition between two framing configurations
 * 
 * @param camera - Camera to animate
 * @param fromFraming - Starting framing
 * @param toFraming - Target framing
 * @param progress - Animation progress (0-1)
 */
export function interpolateFraming(
  camera: Camera,
  fromFraming: FramingResult,
  toFraming: FramingResult,
  progress: number
): void {
  const t = MathUtils.clamp(progress, 0, 1);
  
  // Smooth interpolation using smoothstep
  const smoothT = t * t * (3 - 2 * t);
  
  // Interpolate position
  const position = new Vector3().lerpVectors(fromFraming.position, toFraming.position, smoothT);
  
  // Interpolate target
  const target = new Vector3().lerpVectors(fromFraming.target, toFraming.target, smoothT);
  
  // Interpolate up vector (using quaternion for proper rotation)
  const fromQuat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), fromFraming.up);
  const toQuat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), toFraming.up);
  const interpolatedQuat = new Quaternion().slerpQuaternions(fromQuat, toQuat, smoothT);
  const up = new Vector3(0, 1, 0).applyQuaternion(interpolatedQuat);
  
  camera.position.copy(position);
  camera.lookAt(target);
  camera.up.copy(up);
  camera.updateMatrixWorld();
}

/**
 * Auto-frames multiple objects in a single view
 * 
 * @param targets - Array of objects to frame together
 * @param camera - Camera to position
 * @param config - Framing configuration
 * @returns Combined framing result
 */
export function frameMultipleObjects(
  targets: Object3D[],
  camera: Camera,
  config: Partial<CameraFramingConfig> = {}
): FramingResult {
  if (targets.length === 0) {
    throw new Error('At least one target object is required');
  }
  
  if (targets.length === 1) {
    return calculateOptimalFraming(targets[0], camera, config);
  }
  
  // Calculate combined bounding sphere
  const combinedSphere = new Sphere();
  combinedSphere.makeEmpty();
  
  for (const target of targets) {
    const sphere = computeObjectBoundingSphere(target, new Sphere(), true);
    combinedSphere.union(sphere);
  }
  
  // Create a dummy object with the combined bounds
  const dummyObject = new Object3D();
  dummyObject.position.copy(combinedSphere.center);
  
  // Override computeObjectBoundingSphere for this dummy object
  const originalSphere = combinedSphere.clone();
  
  return {
    ...calculateOptimalFraming(dummyObject, camera, config),
    boundingSphere: originalSphere
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Gets the viewing direction vector for the specified angle
 */
function getViewingDirection(angle: ViewingAngle, customDirection?: Vector3): Vector3 {
  if (angle === ViewingAngle.CUSTOM && customDirection) {
    return customDirection.clone().normalize();
  }
  
  return VIEWING_ANGLE_DIRECTIONS[angle].clone();
}

/**
 * Calculates the padding factor based on framing mode
 */
function getPaddingFactor(config: CameraFramingConfig): number {
  if (config.framingMode === FramingMode.CUSTOM && config.customPadding !== undefined) {
    return Math.max(1.0, config.customPadding);
  }
  
  return FRAMING_PADDING_FACTORS[config.framingMode];
}

/**
 * Calculates optimal camera distance based on camera type and object bounds
 */
function calculateOptimalDistance(
  camera: Camera,
  boundingSphere: Sphere,
  paddingFactor: number,
  config: CameraFramingConfig
): number {
  // Use the improved distance calculation
  let distance = calculateOptimalViewingDistance(camera, boundingSphere, paddingFactor);
  
  // Apply configuration constraints
  const radius = boundingSphere.radius;
  distance = Math.max(distance, radius * config.minDistanceMultiplier);
  distance = Math.min(distance, radius * config.maxDistanceMultiplier);
  
  return distance;
}

/**
 * Calculates appropriate up vector for camera orientation
 */
function calculateUpVector(viewDirection: Vector3, customUp?: Vector3): Vector3 {
  if (customUp) {
    return customUp.clone().normalize();
  }
  
  // Default to world up unless the view direction is too close to vertical
  const worldUp = new Vector3(0, 1, 0);
  const dotProduct = Math.abs(viewDirection.dot(worldUp));
  
  if (dotProduct > 0.9) {
    // View direction is nearly vertical, use forward as up
    return new Vector3(0, 0, 1);
  }
  
  return worldUp;
}

// ============================================================================
// ANIMATION AND TRANSITION UTILITIES
// ============================================================================

/**
 * Configuration for animated camera transitions
 */
export interface CameraAnimationConfig {
  /** Duration of animation in milliseconds */
  duration: number;
  /** Easing function type */
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
  /** Callback when animation completes */
  onComplete?: () => void;
  /** Callback for each animation frame */
  onUpdate?: (progress: number) => void;
}

/**
 * Default animation configuration
 */
export const DEFAULT_ANIMATION_CONFIG: CameraAnimationConfig = {
  duration: 1000,
  easing: 'ease-in-out'
};

/**
 * Animates camera from current position to new framing
 * 
 * @param camera - Camera to animate
 * @param targetFraming - Target framing to animate to
 * @param config - Animation configuration
 * @returns Promise that resolves when animation completes
 */
export function animateCameraToFraming(
  camera: Camera,
  targetFraming: FramingResult,
  config: Partial<CameraAnimationConfig> = {}
): Promise<void> {
  const finalConfig = { ...DEFAULT_ANIMATION_CONFIG, ...config };
  
  // Capture starting state
  const startFraming: FramingResult = {
    position: camera.position.clone(),
    target: new Vector3().addVectors(camera.position, camera.getWorldDirection(new Vector3())),
    up: camera.up.clone(),
    distance: camera.position.distanceTo(targetFraming.target),
    boundingSphere: targetFraming.boundingSphere,
    paddingFactor: targetFraming.paddingFactor
  };
  
  return new Promise((resolve) => {
    const startTime = performance.now();
    
    function animate() {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / finalConfig.duration, 1);
      
      // Apply easing
      const easedProgress = applyEasing(progress, finalConfig.easing);
      
      // Interpolate camera state
      interpolateFraming(camera, startFraming, targetFraming, easedProgress);
      
      // Call update callback
      finalConfig.onUpdate?.(easedProgress);
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        finalConfig.onComplete?.();
        resolve();
      }
    }
    
    requestAnimationFrame(animate);
  });
}

/**
 * Applies easing functions to animation progress
 */
function applyEasing(t: number, easing: CameraAnimationConfig['easing']): number {
  switch (easing) {
    case 'linear':
      return t;
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return 1 - (1 - t) * (1 - t);
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    default:
      return t;
  }
}

// ============================================================================
// PRESET COMPOSITIONS
// ============================================================================

/**
 * Common framing presets for different use cases
 */
export const FRAMING_PRESETS = {
  /** Product photography style - clean, centered, well-lit appearance */
  PRODUCT: {
    framingMode: FramingMode.COMFORTABLE,
    viewingAngle: ViewingAngle.HERO,
    autoAdjustForProportions: true,
    customPadding: 1.5
  },
  
  /** Architectural/technical documentation style */
  TECHNICAL: {
    framingMode: FramingMode.TIGHT,
    viewingAngle: ViewingAngle.FRONT_RIGHT,
    autoAdjustForProportions: true,
    customPadding: 1.2
  },
  
  /** Cinematic/artistic presentation */
  CINEMATIC: {
    framingMode: FramingMode.CINEMATIC,
    viewingAngle: ViewingAngle.HERO,
    autoAdjustForProportions: false,
    customPadding: 2.5
  },
  
  /** Overview/inspection mode - shows object clearly from multiple angles */
  INSPECTION: {
    framingMode: FramingMode.COMFORTABLE,
    viewingAngle: ViewingAngle.FRONT_RIGHT,
    autoAdjustForProportions: true,
    customPadding: 1.8
  }
} as const;

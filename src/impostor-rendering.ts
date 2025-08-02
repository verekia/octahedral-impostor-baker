/**
 * Octahedral impostor rendering system
 * Contains all shader logic and material creation for runtime impostor rendering
 */

import {
  Material,
  Matrix4,
  PlaneGeometry,
  Mesh,
  Sphere
} from 'three';

import { computeObjectBoundingSphere } from './octahedral-utils.js';
import { 
  OctahedralImpostorUniforms, 
  OctahedralImpostorDefines,
  CreateOctahedralImpostor,
  MaterialConstructor,
  DEFAULT_CONFIG
} from './types.js';
import { createTextureAtlas } from './atlas-generation.js';

// ============================================================================
// OCTAHEDRAL IMPOSTOR MATERIAL SHADERS
// ============================================================================

/**
 * Fragment shader chunk for impostor map sampling and blending.
 * Replaces the standard Three.js map_fragment include.
 */
const IMPOSTOR_MAP_FRAGMENT = /* glsl */ `
  float spriteSize = 1.0 / spritesPerSide;

  vec2 uv1 = getUV(vSpriteUV1, vSprite1, spriteSize);
  vec2 uv2 = getUV(vSpriteUV2, vSprite2, spriteSize);
  vec2 uv3 = getUV(vSpriteUV3, vSprite3, spriteSize);

  vec4 sprite1, sprite2, sprite3;
  float alphaThreshold = 1.0 - alphaClamp;

  // Sample sprites with early alpha testing for the dominant sprite
  if (vSpritesWeight.x >= alphaThreshold) {
    sprite1 = texture(map, uv1);
    if (sprite1.a <= alphaClamp) discard;
    sprite2 = texture(map, uv2);
    sprite3 = texture(map, uv3);
  } else if (vSpritesWeight.y >= alphaThreshold) {
    sprite2 = texture(map, uv2);
    if (sprite2.a <= alphaClamp) discard;
    sprite1 = texture(map, uv1);
    sprite3 = texture(map, uv3);
  } else if (vSpritesWeight.z >= alphaThreshold) {
    sprite3 = texture(map, uv3);
    if (sprite3.a <= alphaClamp) discard;
    sprite1 = texture(map, uv1);
    sprite2 = texture(map, uv2);
  } else {
    sprite1 = texture(map, uv1);
    sprite2 = texture(map, uv2);
    sprite3 = texture(map, uv3);
  }

  vec4 blendedColor;

  if (disableBlending > 0.5) {
    // Use only the sprite with highest weight (no blending)
    if (vSpritesWeight.x >= vSpritesWeight.y && vSpritesWeight.x >= vSpritesWeight.z) {
      blendedColor = sprite1;
    } else if (vSpritesWeight.y >= vSpritesWeight.z) {
      blendedColor = sprite2;
    } else {
      blendedColor = sprite3;
    }
  } else {
    // Standard triplanar blending
    blendedColor = sprite1 * vSpritesWeight.x + sprite2 * vSpritesWeight.y + sprite3 * vSpritesWeight.z;
  }

  if (blendedColor.a <= alphaClamp) discard;

  #ifndef OCTAHEDRAL_TRANSPARENT
    blendedColor = vec4(blendedColor.rgb / blendedColor.a, 1.0);
  #endif

  diffuseColor *= blendedColor;
`;

/**
 * Fragment shader chunk for normal calculation.
 * Replaces the standard Three.js normal_fragment_begin include.
 */
const IMPOSTOR_NORMAL_FRAGMENT = /* glsl */ `
  vec3 normal;
  if (disableBlending > 0.5) {
    normal = blendNormalsNoBlending(uv1, uv2, uv3);
  } else {
    normal = blendNormals(uv1, uv2, uv3);
  }
  vec3 nonPerturbedNormal = normal;
`;

/**
 * Fragment shader parameters and utility functions.
 * Replaces the standard Three.js clipping_planes_pars_fragment include.
 */
const IMPOSTOR_FRAGMENT_PARAMS = /* glsl */ `
  #include <clipping_planes_pars_fragment>

  uniform float spritesPerSide;
  uniform float alphaClamp;
  uniform float disableBlending;

  #ifdef OCTAHEDRAL_USE_ORM
    uniform sampler2D ormMap;
  #endif

  flat varying vec4 vSpritesWeight;
  flat varying vec2 vSprite1;
  flat varying vec2 vSprite2;
  flat varying vec2 vSprite3;
  varying vec2 vSpriteUV1;
  varying vec2 vSpriteUV2;
  varying vec2 vSpriteUV3;

  #ifdef OCTAHEDRAL_USE_NORMAL
    vec3 blendNormals(vec2 uv1, vec2 uv2, vec2 uv3) {
      vec4 normalDepth1 = texture2D(normalMap, uv1);
      vec4 normalDepth2 = texture2D(normalMap, uv2);
      vec4 normalDepth3 = texture2D(normalMap, uv3);

      return normalize(
        normalDepth1.xyz * vSpritesWeight.x + 
        normalDepth2.xyz * vSpritesWeight.y + 
        normalDepth3.xyz * vSpritesWeight.z
      );
    }

    vec3 blendNormalsNoBlending(vec2 uv1, vec2 uv2, vec2 uv3) {
      vec4 normalDepth1 = texture2D(normalMap, uv1);
      vec4 normalDepth2 = texture2D(normalMap, uv2);
      vec4 normalDepth3 = texture2D(normalMap, uv3);

      // Use only the normal with the highest weight
      if (vSpritesWeight.x >= vSpritesWeight.y && vSpritesWeight.x >= vSpritesWeight.z) {
        return normalize(normalDepth1.xyz);
      } else if (vSpritesWeight.y >= vSpritesWeight.z) {
        return normalize(normalDepth2.xyz);
      } else {
        return normalize(normalDepth3.xyz);
      }
    }
  #endif

  vec2 getUV(vec2 uv_f, vec2 frame, float frame_size) {
    uv_f = clamp(uv_f, vec2(0), vec2(1));
    return frame_size * (frame + uv_f);
  }
`;

/**
 * Vertex shader parameters and utility functions.
 * Replaces the standard Three.js clipping_planes_pars_vertex include.
 */
const IMPOSTOR_VERTEX_PARAMS = /* glsl */ `
  #include <clipping_planes_pars_vertex>

  uniform mat4 transform;
  uniform float spritesPerSide;
  uniform float hybridDistance;

  flat varying vec4 vSpritesWeight;
  flat varying vec2 vSprite1;
  flat varying vec2 vSprite2;
  flat varying vec2 vSprite3;
  varying vec2 vSpriteUV1;
  varying vec2 vSpriteUV2;
  varying vec2 vSpriteUV3;

  vec2 encodeDirection(vec3 direction) {
    #ifdef OCTAHEDRAL_USE_HEMI_OCTAHEDRON
      vec3 octahedron = direction / dot(direction, sign(direction));
      return vec2(1.0 + octahedron.x + octahedron.z, 1.0 + octahedron.z - octahedron.x) * 0.5;
    #else
      // Full octahedral encoding
      vec3 absDir = abs(direction);
      direction /= (absDir.x + absDir.y + absDir.z);
      
      if (direction.y < 0.0) {
        vec2 signNotZero = vec2(
          direction.x >= 0.0 ? 1.0 : -1.0, 
          direction.z >= 0.0 ? 1.0 : -1.0
        );
        float oldX = direction.x;
        direction.x = (1.0 - abs(direction.z)) * signNotZero.x;
        direction.z = (1.0 - abs(oldX)) * signNotZero.y;
      }
      
      return direction.xz * 0.5 + 0.5;
    #endif
  }

  vec3 decodeDirection(vec2 gridIndex, vec2 spriteCountMinusOne) {
    vec2 gridUV = gridIndex / spriteCountMinusOne;

    #ifdef OCTAHEDRAL_USE_HEMI_OCTAHEDRON
      vec3 position = vec3(gridUV.x - gridUV.y, 0.0, -1.0 + gridUV.x + gridUV.y);
      position.y = 1.0 - abs(position.x) - abs(position.z);
    #else
      // Full octahedral decoding
      vec2 encoded = gridUV * 2.0 - 1.0;
      vec3 position = vec3(encoded.x, 0.0, encoded.y);
      position.y = 1.0 - abs(position.x) - abs(position.z);

      if (position.y < 0.0) {
        vec2 signNotZero = vec2(
          position.x >= 0.0 ? 1.0 : -1.0, 
          position.z >= 0.0 ? 1.0 : -1.0
        );
        float oldX = position.x;
        position.x = (1.0 - abs(position.z)) * signNotZero.x;
        position.z = (1.0 - abs(oldX)) * signNotZero.y;
      }
    #endif

    return normalize(position);
  }

  void computePlaneBasis(vec3 normal, out vec3 tangent, out vec3 bitangent) {
    vec3 up = vec3(0.0, 1.0, 0.0);

    if (normal.y > 0.999) {
      up = vec3(-1.0, 0.0, 0.0);
    }
    #ifndef OCTAHEDRAL_USE_HEMI_OCTAHEDRON
      else if (normal.y < -0.999) {
        up = vec3(1.0, 0.0, 0.0);
      }
    #endif

    tangent = normalize(cross(up, normal));
    bitangent = cross(normal, tangent);
  }

  vec3 projectVertex(vec3 normal) {
    vec3 tangent, bitangent;
    computePlaneBasis(normal, tangent, bitangent);
    return tangent * position.x + bitangent * position.y;
  }

  void computeSpritesWeight(vec2 gridFract) {
    vSpritesWeight = vec4(
      min(1.0 - gridFract.x, 1.0 - gridFract.y),
      abs(gridFract.x - gridFract.y),
      min(gridFract.x, gridFract.y),
      ceil(gridFract.x - gridFract.y)
    );
  }

  vec2 projectToPlaneUV(vec3 normal, vec3 tangent, vec3 bitangent, vec3 cameraPosition, vec3 viewDir) {
    float denom = dot(viewDir, normal);
    
    // Avoid division by zero when view direction is parallel to plane
    if (abs(denom) < 1e-6) {
      return vec2(0.5);
    }
    
    float t = -dot(cameraPosition, normal) / denom;
    vec3 hit = cameraPosition + viewDir * t;
    vec2 uv = vec2(dot(tangent, hit), dot(bitangent, hit));
    return uv + 0.5;
  }
`;

/**
 * Main vertex transformation for impostor rendering.
 * Replaces the standard Three.js project_vertex include.
 */
const IMPOSTOR_VERTEX_TRANSFORM = /* glsl */ `
  vec2 spritesMinusOne = vec2(spritesPerSide - 1.0);

  #if defined USE_INSTANCING || defined USE_INSTANCING_INDIRECT
    mat4 instanceMatrix2 = instanceMatrix * transform;
    vec3 cameraPosLocal = (inverse(instanceMatrix2 * modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  #else
    vec3 cameraPosLocal = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  #endif

  // Hybrid rotation: Y-locked when close, full alignment when far
  // Calculate distance from impostor center to camera
  float distance = length(cameraPosLocal);
  
  // Stable hybrid rotation with reduced jittering
  float horizontalDist = length(vec2(cameraPosLocal.x, cameraPosLocal.z));
  float verticalOffset = abs(cameraPosLocal.y);
  
  // Add small deadzone for micro-movements to reduce jitter
  float verticalDeadzone = 0.2; // Ignore very small Y changes
  float stabilizedVertical = max(0.0, verticalOffset - verticalDeadzone);
  
  // Base distance factor with slight smoothing for stability
  float baseFactor = smoothstep(hybridDistance * 0.8, hybridDistance * 1.2, distance);
  
  // Elevation factor kicks in more readily
  float elevationFactor = clamp(stabilizedVertical / max(horizontalDist, 1.5), 0.0, 1.0);
  
  // More responsive elevation thresholds
  float horizontalThreshold = hybridDistance * 0.25;
  float elevationThreshold = 1.0; // Lower threshold for elevation
  float horizontalWeight = smoothstep(0.0, horizontalThreshold, horizontalDist);
  float elevationWeight = smoothstep(0.0, elevationThreshold, stabilizedVertical);
  
  // Keep stronger elevation contribution for overhead views
  float elevationContribution = elevationFactor * horizontalWeight * elevationWeight * 0.75;
  float blendFactor = max(baseFactor, elevationContribution);
  
  vec3 uprightDir = normalize(vec3(cameraPosLocal.x, 0.0, cameraPosLocal.z));
  vec3 fullDir = normalize(cameraPosLocal);
  vec3 cameraDir = mix(uprightDir, fullDir, blendFactor);

  vec3 projectedVertex = projectVertex(cameraDir);
  vec3 viewDirLocal = normalize(projectedVertex - cameraPosLocal);

  vec2 grid = encodeDirection(cameraDir) * spritesMinusOne;
  vec2 gridFloor = min(floor(grid), spritesMinusOne);
  vec2 gridFract = fract(grid);

  computeSpritesWeight(gridFract);

  vSprite1 = gridFloor;
  vSprite2 = min(vSprite1 + mix(vec2(0.0, 1.0), vec2(1.0, 0.0), vSpritesWeight.w), spritesMinusOne);
  vSprite3 = min(vSprite1 + vec2(1.0), spritesMinusOne);

  vec3 spriteNormal1 = decodeDirection(vSprite1, spritesMinusOne);
  vec3 spriteNormal2 = decodeDirection(vSprite2, spritesMinusOne);
  vec3 spriteNormal3 = decodeDirection(vSprite3, spritesMinusOne);

  vec3 planeX1, planeY1, planeX2, planeY2, planeX3, planeY3;
  computePlaneBasis(spriteNormal1, planeX1, planeY1);
  computePlaneBasis(spriteNormal2, planeX2, planeY2);
  computePlaneBasis(spriteNormal3, planeX3, planeY3);

  vSpriteUV1 = projectToPlaneUV(spriteNormal1, planeX1, planeY1, cameraPosLocal, viewDirLocal);
  vSpriteUV2 = projectToPlaneUV(spriteNormal2, planeX2, planeY2, cameraPosLocal, viewDirLocal);
  vSpriteUV3 = projectToPlaneUV(spriteNormal3, planeX3, planeY3, cameraPosLocal, viewDirLocal);

  vec4 mvPosition = vec4(projectedVertex, 1.0);

  #if defined USE_INSTANCING || defined USE_INSTANCING_INDIRECT
    mvPosition = instanceMatrix2 * mvPosition;
  #endif

  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
`;

// ============================================================================
// MATERIAL CREATION & MANAGEMENT
// ============================================================================

/**
 * Creates an octahedral impostor material from the given parameters.
 * Generates texture atlas and sets up shader compilation overrides.
 * 
 * @param parameters - Complete configuration for the impostor material
 * @returns Configured Three.js material with impostor capabilities
 */
export function createOctahedralImpostorMaterial<T extends Material>(
  parameters: CreateOctahedralImpostor<T>
): T {
  // Validate required parameters
  if (!parameters) {
    throw new Error('createOctahedralImpostorMaterial: parameters is required');
  }
  if (!parameters.baseType) {
    throw new Error('createOctahedralImpostorMaterial: baseType is required');
  }
  if (parameters.useHemiOctahedron == null) {
    throw new Error('createOctahedralImpostorMaterial: useHemiOctahedron is required');
  }

  // Generate texture atlas
  const { albedo, normalDepth } = createTextureAtlas(parameters);

  // Create and configure base material
  const material = new parameters.baseType();
  material.isOctahedralImpostorMaterial = true;
  material.transparent = parameters.transparent ?? false;
  
  // Assign textures
  (material as any).map = albedo;
  (material as any).normalMap = normalDepth;

  // Configure shader defines
  material.octahedralImpostorDefines = {
    OCTAHEDRAL_USE_NORMAL: true,
    ...(parameters.useHemiOctahedron && { OCTAHEDRAL_USE_HEMI_OCTAHEDRON: true }),
    ...(parameters.transparent && { OCTAHEDRAL_TRANSPARENT: true })
  };

  // Configure uniforms
  const scale = parameters.scale ?? DEFAULT_CONFIG.SCALE;
  const translation = parameters.translation ?? DEFAULT_CONFIG.TRANSLATION;
  const spritesPerSide = parameters.spritesPerSide ?? DEFAULT_CONFIG.SPRITES_PER_SIDE;
  const alphaClamp = parameters.alphaClamp ?? DEFAULT_CONFIG.ALPHA_CLAMP;

  material.octahedralImpostorUniforms = {
    spritesPerSide: { value: spritesPerSide },
    alphaClamp: { value: alphaClamp },
    transform: { 
      value: new Matrix4()
        .makeScale(scale, scale, scale)
        .setPosition(translation) 
    },
    disableBlending: { value: parameters.disableBlending ? 1.0 : 0.0 },
    hybridDistance: { value: parameters.hybridDistance ?? 2.5 }
  };

  // Setup shader compilation override
  setupMaterialShaderOverride(material);

  return material;
}

/**
 * Sets up shader compilation overrides for octahedral impostor materials.
 * Modifies the material's shader compilation process to inject impostor-specific code.
 */
function setupMaterialShaderOverride(material: Material): void {
  const originalOnBeforeCompile = material.onBeforeCompile;

  material.onBeforeCompile = (shader, renderer) => {
    // Merge defines and uniforms
    shader.defines = { ...shader.defines, ...material.octahedralImpostorDefines };
    shader.uniforms = { ...shader.uniforms, ...material.octahedralImpostorUniforms };

    // Replace vertex shader chunks
    shader.vertexShader = shader.vertexShader
      .replace('#include <clipping_planes_pars_vertex>', IMPOSTOR_VERTEX_PARAMS)
      .replace('#include <project_vertex>', IMPOSTOR_VERTEX_TRANSFORM);

    // Replace fragment shader chunks
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', IMPOSTOR_FRAGMENT_PARAMS)
      .replace('#include <normal_fragment_begin>', IMPOSTOR_NORMAL_FRAGMENT)
      .replace('#include <normal_fragment_maps>', '// #include <normal_fragment_maps>')
      .replace('#include <map_fragment>', IMPOSTOR_MAP_FRAGMENT);

    // Call original onBeforeCompile if it exists
    originalOnBeforeCompile?.call(material, shader, renderer);
  };

  // Setup custom program cache key for proper shader caching
  const originalCustomProgramCacheKey = material.customProgramCacheKey;

  material.customProgramCacheKey = () => {
    const defines = material.octahedralImpostorDefines!;
    const hemiOcta = !!defines.OCTAHEDRAL_USE_HEMI_OCTAHEDRON;
    const useNormal = !!defines.OCTAHEDRAL_USE_NORMAL;
    const useOrm = !!defines.OCTAHEDRAL_USE_ORM;
    const transparent = !!material.transparent;

    const baseKey = originalCustomProgramCacheKey?.call(material) ?? '';
    return `octahedral_${hemiOcta}_${transparent}_${useNormal}_${useOrm}_${baseKey}`;
  };
}

// ============================================================================
// OCTAHEDRAL IMPOSTOR CLASS
// ============================================================================

/** Shared plane geometry for all impostor instances */
const IMPOSTOR_PLANE_GEOMETRY = new PlaneGeometry();

/**
 * Octahedral impostor mesh class.
 * Combines a plane geometry with an octahedral impostor material to create
 * efficient billboard representations of complex 3D objects.
 */
export class OctahedralImpostor<M extends Material = Material> extends Mesh<PlaneGeometry, M> {
  /**
   * Creates a new octahedral impostor.
   * 
   * @param materialOrParams - Either a pre-configured impostor material or parameters to create one
   */
  constructor(materialOrParams: M | CreateOctahedralImpostor<M>) {
    super(IMPOSTOR_PLANE_GEOMETRY, null!);

    if (!(materialOrParams as M).isOctahedralImpostorMaterial) {
      // Material needs to be created from parameters
      const params = materialOrParams as CreateOctahedralImpostor<M>;
      const boundingSphere = computeObjectBoundingSphere(params.target, new Sphere(), true);

      // Scale impostor to match target object size
      this.scale.multiplyScalar(boundingSphere.radius * 2);
      this.position.copy(boundingSphere.center);

      // Set scale and translation for instanced mesh support
      params.scale = boundingSphere.radius * 2;
      params.translation = boundingSphere.center.clone();

      // Create the material
      this.material = createOctahedralImpostorMaterial(params);
    } else {
      // Material is already configured
      this.material = materialOrParams as M;
    }
  }

  /**
   * Creates a clone of this impostor with the same material and transform.
   * 
   * @returns Cloned impostor instance
   */
  public override clone(): this {
    const impostor = new OctahedralImpostor(this.material);
    impostor.scale.copy(this.scale);
    impostor.position.copy(this.position);
    impostor.rotation.copy(this.rotation);
    impostor.quaternion.copy(this.quaternion);
    return impostor as this;
  }

  /**
   * Updates the impostor material uniforms for dynamic modifications.
   * Useful for runtime changes to transformation, blending, etc.
   */
  public updateUniforms(updates: Partial<{
    transform: Matrix4;
    spritesPerSide: number;
    alphaClamp: number;
    disableBlending: boolean;
    hybridDistance: number;
  }>): void {
    const material = this.material as any;
    const uniforms = material.octahedralImpostorUniforms;
    
    if (uniforms) {
      if (updates.transform && uniforms.transform) {
        uniforms.transform.value.copy(updates.transform);
      }
      if (updates.spritesPerSide && uniforms.spritesPerSide) {
        uniforms.spritesPerSide.value = updates.spritesPerSide;
      }
      if (updates.alphaClamp && uniforms.alphaClamp) {
        uniforms.alphaClamp.value = updates.alphaClamp;
      }
      if (updates.disableBlending !== undefined && uniforms.disableBlending) {
        uniforms.disableBlending.value = updates.disableBlending ? 1.0 : 0.0;
      }
      if (updates.hybridDistance !== undefined && uniforms.hybridDistance) {
        uniforms.hybridDistance.value = updates.hybridDistance;
      }
    }
  }
}
/**
 * Texture atlas generation for octahedral impostors
 * Contains all the complex render target management and atlas creation logic
 */

import {
  OrthographicCamera,
  PerspectiveCamera,
  Camera,
  Sphere,
  Vector4,
  Vector2,
  WebGLRenderer,
  Object3D,
  WebGLRenderTarget,
  LinearFilter,
  NearestFilter,
  UnsignedByteType,
  HalfFloatType,
  LinearSRGBColorSpace,
  ShaderMaterial,
  GLSL3,
  Material,
  Mesh,
  Vector3,
  IUniform
} from 'three';

import { computeObjectBoundingSphere, hemiOctaGridToDir, octaGridToDir } from './octahedral-utils.js';
import { CreateTextureAtlasParams, TextureAtlas, DEFAULT_CONFIG, OctahedralMode, CameraType } from './octahedral-utils.js';

// ============================================================================
// ATLAS GENERATION SHADERS
// ============================================================================

/**
 * Fragment shader for atlas generation.
 * Outputs albedo and packed normal-depth information to separate render targets.
 */
const ATLAS_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  precision highp int;

  uniform float alphaTest;
  uniform mat3 normalMatrix;
  uniform sampler2D map;
  uniform vec3 diffuse;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec2 vHighPrecisionZW;

  layout(location = 0) out vec4 gAlbedo;
  layout(location = 1) out vec4 gNormalDepth;

  void main() {
    vec4 albedo = vec4(diffuse, 1.0);
    
    #ifdef HAS_MAP
      vec4 texColor = texture(map, vUv);
      albedo = vec4(diffuse * texColor.rgb, texColor.a);
    #endif
    
    if (albedo.a < alphaTest) discard;

    vec3 normal = normalize(vNormal);
    
    #ifdef DOUBLE_SIDED
      float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
      normal *= faceDirection;
    #endif
    
    normal = normalize(normalMatrix * normal);
    float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;

    gAlbedo = linearToOutputTexel(albedo);
    gNormalDepth = vec4(normal, 1.0 - fragCoordZ);
  }
`;

/**
 * Vertex shader for atlas generation.
 * Transforms vertices and passes through UV coordinates and normals.
 */
const ATLAS_VERTEX_SHADER = /* glsl */ `
  precision highp float;
  precision highp int;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec2 vHighPrecisionZW;

  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * vec3(normal));

    vec4 mvPosition = vec4(position, 1.0);
    mvPosition = modelViewMatrix * mvPosition;
    gl_Position = projectionMatrix * mvPosition;

    vHighPrecisionZW = gl_Position.zw;
  }
`;

// ============================================================================
// ATLAS GENERATION SHARED RESOURCES
// ============================================================================

const ATLAS_RESOURCES = {
  orthographicCamera: new OrthographicCamera(),
  perspectiveCamera: new PerspectiveCamera(75, 1, 0.001, 1000),
  boundingSphere: new Sphere(),
  oldScissor: new Vector4(),
  oldViewport: new Vector4(),
  coordinates: new Vector2(),
  MATERIAL_KEY: 'octahedral_originalMaterial'
} as const;

// ============================================================================
// ATLAS GENERATION MAIN FUNCTION
// ============================================================================

/**
 * Creates a texture atlas by rendering the target object from multiple octahedral directions.
 * Generates both albedo and normal-depth textures for use in impostor rendering.
 * 
 * @param params - Configuration parameters for atlas generation
 * @returns Generated texture atlas with albedo and normal-depth textures
 */
export function createTextureAtlas(params: CreateTextureAtlasParams): TextureAtlas {
  const { renderer, target, octahedralMode } = params;
  
  // Validate required parameters
  if (!renderer) throw new Error('Parameter "renderer" is required');
  if (!target) throw new Error('Parameter "target" is required');
  if (!octahedralMode) throw new Error('Parameter "octahedralMode" is required');

  // Extract configuration with defaults
  const atlasSize = params.textureSize ?? DEFAULT_CONFIG.ATLAS_SIZE;
  const spritesPerSide = params.spritesPerSide ?? DEFAULT_CONFIG.SPRITES_PER_SIDE;
  const cameraFactor = params.cameraFactor ?? DEFAULT_CONFIG.CAMERA_FACTOR;
  const cameraType = params.cameraType ?? DEFAULT_CONFIG.CAMERA_TYPE;
  
  const spritesPerSideMinusOne = spritesPerSide - 1;
  const spriteSize = atlasSize / spritesPerSide;

  // Compute bounding sphere and setup camera
  computeObjectBoundingSphere(target, ATLAS_RESOURCES.boundingSphere, true);
  const camera = cameraType === CameraType.PERSPECTIVE 
    ? ATLAS_RESOURCES.perspectiveCamera 
    : ATLAS_RESOURCES.orthographicCamera;
  updateAtlasCamera(camera, ATLAS_RESOURCES.boundingSphere, cameraFactor, cameraType);

  // Setup rendering environment
  const renderState = setupAtlasRenderer(renderer, atlasSize);
  overrideTargetMaterials(target);

  // Render all atlas views
  for (let row = 0; row < spritesPerSide; row++) {
    for (let col = 0; col < spritesPerSide; col++) {
      renderAtlasView(col, row, {
        renderer,
        target,
        octahedralMode,
        spritesPerSide,
        spritesPerSideMinusOne,
        spriteSize,
        atlasSize,
        cameraFactor,
        camera
      });
    }
  }

  // Cleanup and restore state
  restoreAtlasRenderer(renderer, renderState);
  restoreTargetMaterials(target);

  return {
    renderTarget: renderState.renderTarget,
    albedo: renderState.renderTarget.textures[0],
    normalDepth: renderState.renderTarget.textures[1]
  };
}

// ============================================================================
// ATLAS GENERATION HELPER FUNCTIONS
// ============================================================================

/**
 * Updates the atlas camera configuration based on the bounding sphere.
 */
function updateAtlasCamera(camera: Camera, boundingSphere: Sphere, cameraFactor: number, cameraType: CameraType): void {
  const { radius } = boundingSphere;
  
  if (cameraType === CameraType.PERSPECTIVE) {
    const perspectiveCamera = camera as PerspectiveCamera;
    const fovRadians = (75 * Math.PI) / 180;
    
    // Calculate optimal distance to maximize texture space usage
    // Use radius directly (not radius * sqrt(2)) for tighter framing
    // Add small padding factor (1.1) to prevent edge clipping
    const minDistance = (radius * 1.1) / Math.tan(fovRadians / 2);
    
    // Apply camera factor to the calculated distance
    const cameraDistance = minDistance * cameraFactor;
    
    perspectiveCamera.fov = 75;
    perspectiveCamera.aspect = 1;
    perspectiveCamera.near = 0.001;
    perspectiveCamera.far = cameraDistance + radius + 0.001;
    perspectiveCamera.updateProjectionMatrix();
    
    // Store the calculated distance factor for use in renderAtlasView
    (perspectiveCamera as any).computedDistanceFactor = cameraDistance / radius;
  } else {
    const orthographicCamera = camera as OrthographicCamera;
    orthographicCamera.left = -radius;
    orthographicCamera.right = radius;
    orthographicCamera.top = radius;
    orthographicCamera.bottom = -radius;
    orthographicCamera.zoom = cameraFactor;
    orthographicCamera.near = 0.001;
    orthographicCamera.far = radius * 2 + 0.001;
    orthographicCamera.updateProjectionMatrix();
  }
}

/**
 * Interface for render view parameters.
 */
interface RenderViewParams {
  renderer: WebGLRenderer;
  target: Object3D;
  octahedralMode: OctahedralMode;
  spritesPerSide: number;
  spritesPerSideMinusOne: number;
  spriteSize: number;
  atlasSize: number;
  cameraFactor: number;
  camera: Camera;
}

/**
 * Renders a single view of the atlas at the specified grid position.
 */
function renderAtlasView(col: number, row: number, params: RenderViewParams): void {
  const { 
    renderer, target, octahedralMode, spritesPerSideMinusOne, 
    spriteSize, atlasSize, cameraFactor, camera 
  } = params;
  
  const { boundingSphere, coordinates } = ATLAS_RESOURCES;
  
  // Calculate grid coordinates and direction
  coordinates.set(col / spritesPerSideMinusOne, row / spritesPerSideMinusOne);
  
  if (octahedralMode === OctahedralMode.HEMISPHERICAL) {
    hemiOctaGridToDir(coordinates, camera.position);
  } else {
    octaGridToDir(coordinates, camera.position);
  }

  // Position camera and set viewport
  const isPerspective = (camera as any).computedDistanceFactor !== undefined;
  const distanceFactor = isPerspective 
    ? (camera as any).computedDistanceFactor 
    : cameraFactor;
  
  camera.position.setLength(boundingSphere.radius * distanceFactor).add(boundingSphere.center);
  camera.lookAt(boundingSphere.center);

  const xOffset = (col / params.spritesPerSide) * atlasSize;
  const yOffset = (row / params.spritesPerSide) * atlasSize;
  
  renderer.setViewport(xOffset, yOffset, spriteSize, spriteSize);
  renderer.setScissor(xOffset, yOffset, spriteSize, spriteSize);
  renderer.render(target, camera);
}

/**
 * Interface for renderer state during atlas generation.
 */
interface AtlasRendererState {
  renderTarget: WebGLRenderTarget;
  oldPixelRatio: number;
  oldScissorTest: boolean;
  oldClearAlpha: number;
}

/**
 * Sets up the renderer for atlas generation and returns the state for restoration.
 */
function setupAtlasRenderer(renderer: WebGLRenderer, atlasSize: number): AtlasRendererState {
  const oldPixelRatio = renderer.getPixelRatio();
  const oldScissorTest = renderer.getScissorTest();
  const oldClearAlpha = renderer.getClearAlpha();
  
  renderer.getScissor(ATLAS_RESOURCES.oldScissor);
  renderer.getViewport(ATLAS_RESOURCES.oldViewport);

  // Create multi-target render target
  const renderTarget = new WebGLRenderTarget(atlasSize, atlasSize, { 
    count: 2, 
    generateMipmaps: false 
  });

  // Configure albedo texture (attachment 0)
  renderTarget.textures[0].minFilter = LinearFilter;
  renderTarget.textures[0].magFilter = LinearFilter;
  renderTarget.textures[0].type = UnsignedByteType;
  renderTarget.textures[0].colorSpace = renderer.outputColorSpace;

  // Configure normal-depth texture (attachment 1)
  renderTarget.textures[1].minFilter = NearestFilter;
  renderTarget.textures[1].magFilter = NearestFilter;
  renderTarget.textures[1].type = HalfFloatType;
  renderTarget.textures[1].colorSpace = LinearSRGBColorSpace;

  // Apply renderer settings
  renderer.setRenderTarget(renderTarget);
  renderer.setScissorTest(true);
  renderer.setPixelRatio(1);
  renderer.setClearAlpha(0);

  return { renderTarget, oldPixelRatio, oldScissorTest, oldClearAlpha };
}

/**
 * Restores the renderer to its previous state after atlas generation.
 */
function restoreAtlasRenderer(renderer: WebGLRenderer, state: AtlasRendererState): void {
  const { oldPixelRatio, oldScissorTest, oldClearAlpha } = state;
  const { oldScissor, oldViewport } = ATLAS_RESOURCES;
  
  renderer.setRenderTarget(null);
  renderer.setScissorTest(oldScissorTest);
  renderer.setViewport(oldViewport.x, oldViewport.y, oldViewport.z, oldViewport.w);
  renderer.setScissor(oldScissor.x, oldScissor.y, oldScissor.z, oldScissor.w);
  renderer.setPixelRatio(oldPixelRatio);
  renderer.setClearAlpha(oldClearAlpha);
}

/**
 * Overrides materials on all meshes in the target object for atlas rendering.
 */
function overrideTargetMaterials(target: Object3D): void {
  target.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.material) {
      mesh.userData[ATLAS_RESOURCES.MATERIAL_KEY] = mesh.material;
      mesh.material = Array.isArray(mesh.material) 
        ? mesh.material.map(createAtlasMaterial)
        : createAtlasMaterial(mesh.material);
    }
  });
}

/**
 * Restores original materials on all meshes in the target object.
 */
function restoreTargetMaterials(target: Object3D): void {
  target.traverse((object) => {
    const mesh = object as Mesh;
    const originalMaterial = mesh.userData[ATLAS_RESOURCES.MATERIAL_KEY];
    if (originalMaterial) {
      mesh.material = originalMaterial;
      delete mesh.userData[ATLAS_RESOURCES.MATERIAL_KEY];
    }
  });
}

/**
 * Creates a shader material for atlas rendering from an existing material.
 */
function createAtlasMaterial(sourceMaterial: Material): ShaderMaterial {
  const source = sourceMaterial as any;
  
  // Extract diffuse map from various material types
  const diffuseMap = source.map || source.baseColorTexture || null;
  
  // Extract diffuse color from various material types
  const diffuseColor = extractDiffuseColor(source);
  
  // Use original alpha test or default
  const alphaTest = source.alphaTest ?? DEFAULT_CONFIG.ALPHA_TEST;
  
  const uniforms: Record<string, IUniform> = {
    map: { value: diffuseMap },
    diffuse: { value: diffuseColor },
    alphaTest: { value: alphaTest }
  };

  const defines: Record<string, boolean> = {};
  if (diffuseMap) {
    defines.HAS_MAP = true;
  }

  return new ShaderMaterial({
    uniforms,
    vertexShader: ATLAS_VERTEX_SHADER,
    fragmentShader: ATLAS_FRAGMENT_SHADER,
    defines,
    glslVersion: GLSL3,
    side: sourceMaterial.side,
    transparent: sourceMaterial.transparent
  });
}

/**
 * Extracts diffuse color from various material types.
 */
function extractDiffuseColor(material: any): Vector3 {
  if (material.color) {
    return new Vector3(material.color.r, material.color.g, material.color.b);
  } else if (material.diffuse) {
    return new Vector3(material.diffuse.r, material.diffuse.g, material.diffuse.b);
  } else if (material.baseColorFactor) {
    const [r, g, b] = material.baseColorFactor;
    return new Vector3(r, g, b);
  }
  return new Vector3(1, 1, 1); // Default white
}
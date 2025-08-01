import { 
  FloatType, GLSL3, IUniform, LinearFilter, Material, Mesh, MeshStandardMaterial, 
  NearestFilter, NoColorSpace, Object3D, OrthographicCamera, PlaneGeometry, ShaderMaterial, 
  Sphere, Texture, UnsignedByteType, Vector2, Vector3, Vector4, WebGLRenderer, WebGLRenderTarget 
} from 'three';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Computes the bounding sphere of a 3D object hierarchy
 */
const tempSphere = new Sphere();

export function computeObjectBoundingSphere(obj: Object3D, target = new Sphere(), forceComputeBoundingSphere = false): Sphere {
  target.makeEmpty();
  traverse(obj);
  return target;

  function traverse(obj: Object3D): void {
    if ((obj as Mesh).isMesh) {
      const geometry = (obj as Mesh).geometry;
      if (forceComputeBoundingSphere || !geometry.boundingSphere) geometry.computeBoundingSphere();

      tempSphere.copy(geometry.boundingSphere).applyMatrix4(obj.matrixWorld);
      target.union(tempSphere);
    }

    for (const child of obj.children) {
      traverse(child);
    }
  }
}

/**
 * Octahedron mapping utilities
 */
const absolute = new Vector3();
const octant = new Vector3();
const octahedron = new Vector3();

export function hemiOctaGridToDir(grid: Vector2, target = new Vector3()): Vector3 {
  target.set(grid.x - grid.y, 0, -1 + grid.x + grid.y);
  target.y = 1 - Math.abs(target.x) - Math.abs(target.z);
  return target;
}

export function octaGridToDir(grid: Vector2, target = new Vector3()): Vector3 {
  target.set(2 * (grid.x - 0.5), 0, 2 * (grid.y - 0.5));
  absolute.set(Math.abs(target.x), 0, Math.abs(target.z));
  target.y = 1 - absolute.x - absolute.z;

  if (target.y < 0) {
    target.x = Math.sign(target.x) * (1 - absolute.z);
    target.z = Math.sign(target.z) * (1 - absolute.x);
  }

  return target;
}

export function hemiOctaDirToGrid(dir: Vector3, target = new Vector2()): Vector2 {
  octant.set(Math.sign(dir.x), Math.sign(dir.y), Math.sign(dir.z));
  const sum = dir.dot(octant);
  octahedron.copy(dir).divideScalar(sum);

  return target.set(
    (1 + octahedron.x + octahedron.z) * 0.5,
    (1 + octahedron.z - octahedron.x) * 0.5
  );
}

/**
 * Export texture from render target to downloadable image
 */
export function exportTextureFromRenderTarget(renderer: WebGLRenderer, renderTarget: WebGLRenderTarget, fileName: string, textureIndex: number): void {
  const width = renderTarget.texture.image.width;
  const height = renderTarget.texture.image.height;
  const readBuffer = new Uint8Array(width * height * 4);

  (renderer as any).readRenderTargetPixels(renderTarget, 0, 0, width, height, readBuffer, undefined, textureIndex);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  const imageDataArray = imageData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dest = (x + y * width) * 4;
      const src = (x + (height - y - 1) * width) * 4; // vertical flip

      imageDataArray[dest] = readBuffer[src];
      imageDataArray[dest + 1] = readBuffer[src + 1];
      imageDataArray[dest + 2] = readBuffer[src + 2];
      imageDataArray[dest + 3] = readBuffer[src + 3];
    }
  }

  ctx.putImageData(imageData, 0, 0);

  const dataURL = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = dataURL;
  link.download = `${fileName}.png`;
  link.click();
}

// ============================================================================
// TEXTURE ATLAS CREATION
// ============================================================================

const atlasFragmentShader = `
precision highp float;
precision highp int;

uniform mat3 normalMatrix;
uniform sampler2D u_albedo_tex;

varying vec2 vUv;
varying vec3 vNormal;
varying vec2 vHighPrecisionZW;

layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormalDepth;

void main() {
    vec4 albedo = texture(u_albedo_tex, vUv);

    vec3 normal = normalize( vNormal );
    #ifdef DOUBLE_SIDED
        float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
        normal *= faceDirection;
    #endif

    normal = normalize(normalMatrix * normal);

    float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;

    if(albedo.a < 0.5)
        discard;

    gAlbedo = linearToOutputTexel(albedo);
    gNormalDepth = vec4(normal, 1.0 - fragCoordZ);
}`;

const atlasVertexShader = `
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
}`;

export interface CreateTextureAtlasParams {
  renderer: WebGLRenderer;
  useHemiOctahedron: boolean;
  target: Object3D;
  textureSize?: number;
  spritesPerSide?: number;
  cameraFactor?: number;
}

export interface TextureAtlas {
  renderTarget: WebGLRenderTarget;
  albedo: Texture;
  normalDepth: Texture;
}

const atlasCamera = new OrthographicCamera();
const atlasBSphere = new Sphere();
const atlasOldScissor = new Vector4();
const atlasOldViewport = new Vector4();
const atlasCoords = new Vector2();
const userDataMaterialKey = 'ez_originalMaterial';

export function createTextureAtlas(params: CreateTextureAtlasParams): TextureAtlas {
  const { renderer, target, useHemiOctahedron } = params;

  if (!renderer) throw new Error('"renderer" is mandatory.');
  if (!target) throw new Error('"target" is mandatory.');
  if (useHemiOctahedron == null) throw new Error('"useHemiOctahedron" is mandatory.');

  const atlasSize = params.textureSize ?? 2048;
  const countPerSide = params.spritesPerSide ?? 16;
  const countPerSideMinusOne = countPerSide - 1;
  const spriteSize = atlasSize / countPerSide;

  computeObjectBoundingSphere(target, atlasBSphere, true);

  const cameraFactor = params.cameraFactor ?? 1;
  updateCamera();

  const { renderTarget, oldPixelRatio, oldScissorTest, oldClearAlpha } = setupRenderer();
  overrideTargetMaterial(target);

  for (let row = 0; row < countPerSide; row++) {
    for (let col = 0; col < countPerSide; col++) {
      renderView(col, row);
    }
  }

  restoreRenderer();
  restoreTargetMaterial(target);

  return {
    renderTarget,
    albedo: renderTarget.textures[0],
    normalDepth: renderTarget.textures[1]
  };

  function overrideTargetMaterial(target: Object3D): void {
    target.traverse((mesh) => {
      if ((mesh as Mesh).material) {
        const material = (mesh as Mesh).material;
        mesh.userData[userDataMaterialKey] = material;
        const overrideMaterial = Array.isArray(material) ? material.map((mat) => createMaterial(mat)) : createMaterial(material);
        (mesh as Mesh).material = overrideMaterial;
      }
    });
  }

  function createMaterial(material: Material): ShaderMaterial {
    const uniforms: { [uniform: string]: IUniform } = {
      u_albedo_tex: { value: (material as MeshStandardMaterial).map }
    };

    return new ShaderMaterial({
      uniforms,
      vertexShader: atlasVertexShader,
      fragmentShader: atlasFragmentShader,
      glslVersion: GLSL3
    });
  }

  function restoreTargetMaterial(target: Object3D): void {
    target.traverse((mesh) => {
      if (mesh.userData[userDataMaterialKey]) {
        (mesh as Mesh).material = mesh.userData[userDataMaterialKey];
        delete mesh.userData[userDataMaterialKey];
      }
    });
  }

  function renderView(col: number, row: number): void {
    atlasCoords.set(col / (countPerSideMinusOne), row / (countPerSideMinusOne));

    if (useHemiOctahedron) hemiOctaGridToDir(atlasCoords, atlasCamera.position);
    else octaGridToDir(atlasCoords, atlasCamera.position);

    atlasCamera.position.setLength(atlasBSphere.radius * cameraFactor).add(atlasBSphere.center);
    atlasCamera.lookAt(atlasBSphere.center);

    const xOffset = (col / countPerSide) * atlasSize;
    const yOffset = (row / countPerSide) * atlasSize;
    renderer.setViewport(xOffset, yOffset, spriteSize, spriteSize);
    renderer.setScissor(xOffset, yOffset, spriteSize, spriteSize);
    renderer.render(target, atlasCamera);
  }

  function updateCamera(): void {
    atlasCamera.left = -atlasBSphere.radius;
    atlasCamera.right = atlasBSphere.radius;
    atlasCamera.top = atlasBSphere.radius;
    atlasCamera.bottom = -atlasBSphere.radius;

    atlasCamera.zoom = cameraFactor;
    atlasCamera.near = 0.001;
    atlasCamera.far = atlasBSphere.radius * 2 + 0.001;

    atlasCamera.updateProjectionMatrix();
  }

  function setupRenderer() {
    const oldPixelRatio = renderer.getPixelRatio();
    const oldScissorTest = renderer.getScissorTest();
    const oldClearAlpha = renderer.getClearAlpha();
    renderer.getScissor(atlasOldScissor);
    renderer.getViewport(atlasOldViewport);

    const renderTarget = new WebGLRenderTarget(atlasSize, atlasSize, { count: 2, generateMipmaps: false });

    const albedo = 0;
    const normalDepth = 1;

    renderTarget.textures[albedo].minFilter = LinearFilter;
    renderTarget.textures[albedo].magFilter = LinearFilter;
    renderTarget.textures[albedo].type = UnsignedByteType;
    renderTarget.textures[albedo].colorSpace = renderer.outputColorSpace;

    renderTarget.textures[normalDepth].minFilter = NearestFilter;
    renderTarget.textures[normalDepth].magFilter = NearestFilter;
    renderTarget.textures[normalDepth].type = FloatType;
    renderTarget.textures[albedo].colorSpace = NoColorSpace;

    renderer.setRenderTarget(renderTarget);
    renderer.setScissorTest(true);
    renderer.setPixelRatio(1);
    renderer.setClearAlpha(0);

    return { renderTarget, oldPixelRatio, oldScissorTest, oldClearAlpha };
  }

  function restoreRenderer(): void {
    renderer.setRenderTarget(null);
    renderer.setScissorTest(oldScissorTest);
    renderer.setViewport(atlasOldViewport.x, atlasOldViewport.y, atlasOldViewport.z, atlasOldViewport.w);
    renderer.setScissor(atlasOldScissor.x, atlasOldScissor.y, atlasOldScissor.z, atlasOldScissor.w);
    renderer.setPixelRatio(oldPixelRatio);
    renderer.setClearAlpha(oldClearAlpha);
  }
}

// ============================================================================
// OCTAHEDRAL IMPOSTOR MATERIAL
// ============================================================================

const shaderChunkMapFragment = `
//#include <map_fragment>
float spriteSize = 1.0 / spritesPerSide;

vec2 uv1 = parallaxUV(vSpriteUV1, vSprite1, vSpriteViewDir1, spriteSize, vSpritesWeight.x);
vec2 uv2 = parallaxUV(vSpriteUV2, vSprite2, vSpriteViewDir2, spriteSize, vSpritesWeight.y);
vec2 uv3 = parallaxUV(vSpriteUV3, vSprite3, vSpriteViewDir3, spriteSize, vSpritesWeight.z);

vec4 blendedColor = blendImpostorSamples(uv1, uv2, uv3);

if(blendedColor.a <= alphaClamp) discard;

#ifndef EZ_TRANSPARENT
blendedColor = vec4(vec3(blendedColor.rgb) / blendedColor.a, 1.0);
#endif

diffuseColor *= blendedColor;
`;

const shaderChunkNormalFragmentBegin = `
// #include <normal_fragment_begin>
vec3 normal = blendNormals(uv1, uv2, uv3);
vec3 nonPerturbedNormal = normal;
`;

const shaderChunkParamsFragment = `
#include <clipping_planes_pars_fragment>

uniform float spritesPerSide;
uniform float parallaxScale;
uniform float alphaClamp;

#ifdef EZ_USE_NORMAL
uniform mat3 normalMatrix;
#endif

#ifdef EZ_USE_ORM
uniform sampler2D ormMap;
#endif

flat varying vec4 vSpritesWeight;
flat varying vec2 vSprite1;
flat varying vec2 vSprite2;
flat varying vec2 vSprite3;
varying vec2 vSpriteUV1;
varying vec2 vSpriteUV2;
varying vec2 vSpriteUV3;
varying vec2 vSpriteViewDir1;
varying vec2 vSpriteViewDir2;
varying vec2 vSpriteViewDir3;

#ifdef EZ_USE_NORMAL
flat varying vec3 vSpriteNormal1;
flat varying vec3 vSpriteNormal2;
flat varying vec3 vSpriteNormal3;
#endif

vec4 blendImpostorSamples(vec2 uv1, vec2 uv2, vec2 uv3) {
  vec4 sprite1 = texture(map, uv1);
  vec4 sprite2 = texture(map, uv2);
  vec4 sprite3 = texture(map, uv3);

  return sprite1 * vSpritesWeight.x + sprite2 * vSpritesWeight.y + sprite3 * vSpritesWeight.z;
}

vec3 blendNormals(vec2 uv1, vec2 uv2, vec2 uv3) {
  vec4 normalDepth1 = texture2D(normalMap, uv1);
  vec4 normalDepth2 = texture2D(normalMap, uv2);
  vec4 normalDepth3 = texture2D(normalMap, uv3);

  return normalize(normalDepth1.xyz * vSpritesWeight.x + normalDepth2.xyz * vSpritesWeight.y + normalDepth3.xyz * vSpritesWeight.z);
}

vec2 parallaxUV(vec2 uv_f, vec2 frame, vec2 xy_f, float frame_size, float weight) {
  uv_f = clamp(uv_f, vec2(0), vec2(1));
	vec2 uv_quad = frame_size * (frame + uv_f);
  float n_depth = max(0.0, 0.5 - texture(normalMap, uv_quad).a);

  uv_f = xy_f * n_depth * parallaxScale * (1.0 - weight) + uv_f;
	uv_f = clamp(uv_f, vec2(0), vec2(1));
	uv_f =  frame_size * (frame + uv_f);
	return clamp(uv_f, vec2(0), vec2(1));
}
`;

const shaderChunkParamsVertex = `
#include <clipping_planes_pars_vertex>

uniform float spritesPerSide;

flat varying vec4 vSpritesWeight;
flat varying vec2 vSprite1;
flat varying vec2 vSprite2;
flat varying vec2 vSprite3;
varying vec2 vSpriteUV1;
varying vec2 vSpriteUV2;
varying vec2 vSpriteUV3;
varying vec2 vSpriteViewDir1;
varying vec2 vSpriteViewDir2;
varying vec2 vSpriteViewDir3;

#ifdef EZ_USE_NORMAL
flat varying vec3 vSpriteNormal1;
flat varying vec3 vSpriteNormal2;
flat varying vec3 vSpriteNormal3;
#endif

vec2 encodeDirection(vec3 direction) {
  #ifdef EZ_USE_HEMI_OCTAHEDRON

  vec3 octahedron = direction / dot(direction, sign(direction));
  return vec2(1.0 + octahedron.x + octahedron.z, 1.0 + octahedron.z - octahedron.x) * 0.5;

  #else

  // TODO: Implement full octahedral encoding

  #endif
}

vec3 decodeDirection(vec2 gridIndex, vec2 spriteCountMinusOne) {
  vec2 gridUV = gridIndex / spriteCountMinusOne;

  #ifdef EZ_USE_HEMI_OCTAHEDRON

  vec3 position = vec3(gridUV.x - gridUV.y, 0.0, -1.0 + gridUV.x + gridUV.y);
  position.y = 1.0 - abs(position.x) - abs(position.z);

  #else

    // TODO: Implement full octahedral decoding

  #endif

  return normalize(position);
}

void computePlaneBasis(vec3 normal, out vec3 tangent, out vec3 bitangent) {
  vec3 up = vec3(0.0, 1.0, 0.0);

  if(normal.y > 0.999)
    up = vec3(-1.0, 0.0, 0.0);

  #ifndef EZ_USE_HEMI_OCTAHEDRON
  if(normal.y < -0.999)
    up = vec3(1.0, 0.0, 0.0);
  #endif

  tangent = normalize(cross(up, normal));
  bitangent = cross(normal, tangent);
}

vec3 projectVertex(vec3 normal) {
  vec3 x, y;
  computePlaneBasis(normal, x, y);
  return x * position.x + y * position.y;
}

void computeSpritesWeight(vec2 gridFract) {
  vSpritesWeight = vec4(min(1.0 - gridFract.x, 1.0 - gridFract.y), abs(gridFract.x - gridFract.y), min(gridFract.x, gridFract.y), ceil(gridFract.x - gridFract.y));
}

vec2 projectToPlaneUV(vec3 normal, vec3 tangent, vec3 bitangent, vec3 cameraPosition, vec3 viewDir) {
  float denom = dot(viewDir, normal);
  float t = -dot(cameraPosition, normal) / denom;

  vec3 hit = cameraPosition + viewDir * t;
  vec2 uv = vec2(dot(tangent, hit), dot(bitangent, hit));
  return uv + 0.5;
}

vec3 projectDirectionToBasis(vec3 dir, vec3 normal, vec3 tangent, vec3 bitangent) {
  return vec3(dot(dir, tangent), dot(dir, bitangent), dot(dir, normal));
}
`;

const shaderChunkVertex = `
// #include <project_vertex>

vec2 spritesMinusOne = vec2(spritesPerSide - 1.0);

vec3 cameraPosLocal = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
vec3 cameraDir = normalize(cameraPosLocal);

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

#ifdef EZ_USE_NORMAL
vSpriteNormal1 = spriteNormal1;
vSpriteNormal2 = spriteNormal2;
vSpriteNormal3 = spriteNormal3;
#endif

vec3 planeX1, planeY1, planeX2, planeY2, planeX3, planeY3;
computePlaneBasis(spriteNormal1, planeX1, planeY1);
computePlaneBasis(spriteNormal2, planeX2, planeY2);
computePlaneBasis(spriteNormal3, planeX3, planeY3);

vSpriteUV1 = projectToPlaneUV(spriteNormal1, planeX1, planeY1, cameraPosLocal, viewDirLocal);
vSpriteUV2 = projectToPlaneUV(spriteNormal2, planeX2, planeY2, cameraPosLocal, viewDirLocal);
vSpriteUV3 = projectToPlaneUV(spriteNormal3, planeX3, planeY3, cameraPosLocal, viewDirLocal);

vSpriteViewDir1 = projectDirectionToBasis(-viewDirLocal, spriteNormal1, planeX1, planeY1).xy;
vSpriteViewDir2 = projectDirectionToBasis(-viewDirLocal, spriteNormal2, planeX2, planeY2).xy;
vSpriteViewDir3 = projectDirectionToBasis(-viewDirLocal, spriteNormal3, planeX3, planeY3).xy;

vec4 mvPosition = modelViewMatrix * vec4(projectedVertex, 1.0);

gl_Position = projectionMatrix * mvPosition;
`;

export type OctahedralImpostorDefinesKeys = 'EZ_USE_HEMI_OCTAHEDRON' | 'EZ_USE_NORMAL' | 'EZ_USE_ORM' | 'EZ_TRANSPARENT';
export type OctahedralImpostorDefines = { [key in OctahedralImpostorDefinesKeys]?: boolean };

export type UniformValue<T> = T extends IUniform<infer U> ? U : never;
export type MaterialConstructor<T extends Material> = new () => T;

export interface OctahedralImpostorUniforms {
  spritesPerSide: IUniform<number>;
  parallaxScale: IUniform<number>;
  alphaClamp: IUniform<number>;
}

export interface CreateOctahedralImpostor<T extends Material> extends OctahedralImpostorMaterial, CreateTextureAtlasParams {
  baseType: MaterialConstructor<T>;
}

export interface OctahedralImpostorMaterial {
  transparent?: boolean;
  parallaxScale?: number;
  alphaClamp?: number;
}

declare module 'three' {
  interface Material extends OctahedralImpostorMaterial {
    isOctahedralImpostorMaterial: boolean;
    ezImpostorUniforms?: OctahedralImpostorUniforms;
    ezImpostorDefines?: OctahedralImpostorDefines;
  }
}

export function createOctahedralImpostorMaterial<T extends Material>(parameters: CreateOctahedralImpostor<T>): T {
  if (!parameters) throw new Error('createOctahedralImpostorMaterial: parameters is required.');
  if (!parameters.baseType) throw new Error('createOctahedralImpostorMaterial: baseType is required.');
  if (!parameters.useHemiOctahedron) throw new Error('createOctahedralImpostorMaterial: useHemiOctahedron is required.');

  const { albedo, normalDepth } = createTextureAtlas(parameters);

  const material = new parameters.baseType();
  material.isOctahedralImpostorMaterial = true;
  material.transparent = parameters.transparent ?? false;
  (material as any).map = albedo;
  (material as any).normalMap = normalDepth;

  material.ezImpostorDefines = {};

  if (parameters.useHemiOctahedron) material.ezImpostorDefines.EZ_USE_HEMI_OCTAHEDRON = true;
  if (parameters.transparent) material.ezImpostorDefines.EZ_TRANSPARENT = true;
  material.ezImpostorDefines.EZ_USE_NORMAL = true;

  material.ezImpostorUniforms = {
    spritesPerSide: { value: parameters.spritesPerSide ?? 16 },
    parallaxScale: { value: parameters.parallaxScale ?? 0.1 },
    alphaClamp: { value: parameters.alphaClamp ?? 0.5 }
  };

  overrideMaterialCompilation(material);

  return material;
}

function overrideMaterialCompilation(material: Material): void {
  const onBeforeCompileBase = material.onBeforeCompile;

  material.onBeforeCompile = (shader, renderer) => {
    shader.defines = { ...shader.defines, ...material.ezImpostorDefines };
    shader.uniforms = { ...shader.uniforms, ...material.ezImpostorUniforms };

    shader.vertexShader = shader.vertexShader
      .replace('#include <clipping_planes_pars_vertex>', shaderChunkParamsVertex)
      .replace('#include <project_vertex>', shaderChunkVertex);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', shaderChunkParamsFragment)
      .replace('#include <normal_fragment_begin>', shaderChunkNormalFragmentBegin)
      .replace('#include <normal_fragment_maps>', '// #include <normal_fragment_maps>')
      .replace('#include <map_fragment>', shaderChunkMapFragment);

    onBeforeCompileBase?.call(material, shader, renderer);
  };

  const customProgramCacheKeyBase = material.customProgramCacheKey;

  material.customProgramCacheKey = () => {
    const hemiOcta = !!material.ezImpostorDefines.EZ_USE_HEMI_OCTAHEDRON;
    const useNormal = !!material.ezImpostorDefines.EZ_USE_NORMAL;
    const useOrm = !!material.ezImpostorDefines.EZ_USE_ORM;
    const transparent = !!material.transparent;

    return `ez_${hemiOcta}_${transparent}_${useNormal}_${useOrm}_${customProgramCacheKeyBase.call(material)}`;
  };
}

// ============================================================================
// OCTAHEDRAL IMPOSTOR CLASS
// ============================================================================

const planeGeometry = new PlaneGeometry();

export class OctahedralImpostor<M extends Material = Material> extends Mesh<PlaneGeometry, M> {
  constructor(materialOrParams: M | CreateOctahedralImpostor<M>) {
    super(planeGeometry, null);

    if (!(materialOrParams as M).isOctahedralImpostorMaterial) {
      const mesh = (materialOrParams as CreateOctahedralImpostor<M>).target;
      const sphere = computeObjectBoundingSphere(mesh, new Sphere(), true);

      this.scale.multiplyScalar(sphere.radius * 2);
      this.position.copy(sphere.center);

      materialOrParams = createOctahedralImpostorMaterial(materialOrParams as CreateOctahedralImpostor<M>);
    }

    this.material = materialOrParams as M;
  }

  public override clone(): this {
    const impostor = new OctahedralImpostor(this.material);
    impostor.scale.copy(this.scale);
    impostor.position.copy(this.position);
    return impostor as this;
  }
}

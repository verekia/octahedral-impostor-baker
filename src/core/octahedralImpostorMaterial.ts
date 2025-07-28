import { IUniform, Material } from 'three';
import { createTextureAtlas, CreateTextureAtlasParams } from '../utils/createTextureAtlas.js';

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
uniform mat3 normalMatrix; // this can be already used with same shader
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
  vec4 normalDepth1 = texture2D(normalMap, uv1); // lo stiamo leggendo due volte, migliorare perchè lo leggiamo per il depth anche
  vec4 normalDepth2 = texture2D(normalMap, uv2);
  vec4 normalDepth3 = texture2D(normalMap, uv3);

  return normalize(normalDepth1.xyz * vSpritesWeight.x + normalDepth2.xyz * vSpritesWeight.y + normalDepth3.xyz * vSpritesWeight.z);
}

vec2 parallaxUV(vec2 uv_f, vec2 frame, vec2 xy_f, float frame_size, float weight) {
  // vec2 spriteUv = frame_size * (frame + uv_f);
  // float depth = texture(normalMap, spriteUv).a;
  // vec2 parallaxOffset = xy_f * depth * parallaxScale; // * weight;
  // uv_f = clamp(uv_f + parallaxOffset, vec2(0.0), vec2(1.0));
  // return frame_size * (frame + uv_f);

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
  
  // // Avoid division by zero when view direction is parallel to plane
  // if (abs(denom) < 1e-6) {
  //   return vec2(0.5); // Return center UV as fallback
  // }
  
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

// TODO: fix normal from top
// TODO: use not standard normalMap uniform
// TODO: use define to avoid paralax mapping if useless

export type OctahedralImpostorDefinesKeys = 'EZ_USE_HEMI_OCTAHEDRON' | 'EZ_USE_NORMAL' | 'EZ_USE_ORM' | 'EZ_TRANSPARENT';
export type OctahedralImpostorDefines = { [key in OctahedralImpostorDefinesKeys]?: boolean };

export type UniformValue<T> = T extends IUniform<infer U> ? U : never;
export type MaterialConstructor<T extends Material> = new () => T;

export interface OctahedralImpostorUniforms {
  spritesPerSide: IUniform<number>;
  // ormMap: IUniform<Texture>;
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

  const { albedo, normalDepth } = createTextureAtlas(parameters); // TODO normal only if lights

  const material = new parameters.baseType();
  material.isOctahedralImpostorMaterial = true;
  material.transparent = parameters.transparent ?? false;
  (material as any).map = albedo; // TODO remove any
  (material as any).normalMap = normalDepth; // TODO only if lights

  material.ezImpostorDefines = {};

  if (parameters.useHemiOctahedron) material.ezImpostorDefines.EZ_USE_HEMI_OCTAHEDRON = true;
  if (parameters.transparent) material.ezImpostorDefines.EZ_TRANSPARENT = true;
  material.ezImpostorDefines.EZ_USE_NORMAL = true; // TODO only if lights
  // material.ezImpostorDefines.EZ_USE_ORM = true; // TODO only if lights

  material.ezImpostorUniforms = {
    spritesPerSide: { value: parameters.spritesPerSide ?? 16 }, // TODO config default value
    // ormMap: { value: null },
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

// export class OctahedralImpostorMaterial extends ShaderMaterial {

//   // @ts-expect-error: It's defined as a property in class, but is overridden here as an accessor.
//   public override get transparent(): boolean { return this._transparent; }
//   public override set transparent(value) {
//     this._transparent = value;
//     this.depthWrite = !value;
//     this.updateDefines(value, 'EZ_TRANSPARENT');
//   }

//   public get parallaxScale(): number { return this.uniforms.parallaxScale.value; }
//   public set parallaxScale(value) { this.setUniform('parallaxScale', value); }

//   public get alphaClamp(): number { return this.uniforms.alphaClamp.value; }
//   public set alphaClamp(value) { this.setUniform('alphaClamp', value); }

//   protected setUniform<T extends keyof OctahedralImpostorUniforms>(key: T, value: UniformValue<OctahedralImpostorUniforms[T]>): void {
//     if (!this.uniforms) return;

//     if (!this.uniforms[key]) {
//       this.uniforms[key] = { value } as IUniform;
//       return;
//     }

//     this.uniforms[key].value = value;
//   }

//   protected updateDefines(value: unknown, key: OctahedralImpostorDefines): void {
//     if (!this.defines) return;

//     this.needsUpdate = true;
//     if (value) this.defines[key] = '';
//     else delete this.defines[key];
//   }

//   // @ts-expect-error Property 'clone' is not assignable to the same property in base type 'ShaderMaterial'.
//   public override clone(): OctahedralImpostorMaterial {
//     return new OctahedralImpostorMaterial({
//       spritesPerSide: this.spritesPerSide,
//       useHemiOctahedron: this.useHemiOctahedron,
//       albedo: this.albedo,
//       normalDepthMap: this.normalDepthMap,
//       ormMap: this.ormMap,
//       transparent: this.transparent,
//       parallaxScale: this.parallaxScale,
//       alphaClamp: this.alphaClamp
//     });
//   }
// }

/**
 * Texture export utilities for saving render targets and textures as PNG files
 */

import {
  WebGLRenderer,
  WebGLRenderTarget,
  Texture,
  PlaneGeometry,
  ShaderMaterial,
  Mesh,
  Scene,
  OrthographicCamera
} from 'three';

// ============================================================================
// TEXTURE EXPORT UTILITIES
// ============================================================================

/**
 * Exports a render target texture as a downloadable PNG image.
 * 
 * @param renderer - WebGL renderer instance
 * @param renderTarget - Source render target
 * @param fileName - Output filename (without extension)
 * @param textureIndex - Index of texture attachment to export
 */
export function exportTextureFromRenderTarget(
  renderer: WebGLRenderer,
  renderTarget: WebGLRenderTarget,
  fileName: string,
  textureIndex: number
): void {
  const { width, height } = renderTarget.texture.image;
  const pixelBuffer = new Uint8Array(width * height * 4);
  
  // Read pixels from render target
  (renderer as any).readRenderTargetPixels(
    renderTarget, 0, 0, width, height, pixelBuffer, undefined, textureIndex
  );
  
  // Create canvas and flip image vertically
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  
  const context = canvas.getContext('2d')!;
  const imageData = context.createImageData(width, height);
  const { data: imageDataArray } = imageData;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const destIndex = (x + y * width) * 4;
      const srcIndex = (x + (height - y - 1) * width) * 4; // Vertical flip
      
      imageDataArray[destIndex] = pixelBuffer[srcIndex];
      imageDataArray[destIndex + 1] = pixelBuffer[srcIndex + 1];
      imageDataArray[destIndex + 2] = pixelBuffer[srcIndex + 2];
      imageDataArray[destIndex + 3] = pixelBuffer[srcIndex + 3];
    }
  }
  
  context.putImageData(imageData, 0, 0);
  
  // Trigger download
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = `${fileName}.png`;
  link.click();
}

/**
 * Exports a Three.js texture as a downloadable PNG image.
 * Creates a temporary render target to facilitate the export process.
 * 
 * @param renderer - WebGL renderer instance
 * @param texture - Source texture to export
 * @param fileName - Output filename (without extension)
 */
export function exportTextureAsPNG(
  renderer: WebGLRenderer,
  texture: Texture,
  fileName: string
): void {
  const { width, height } = texture.image;
  
  if (!width || !height) {
    console.warn('Texture export failed: Invalid dimensions');
    return;
  }
  
  // Create temporary rendering setup
  const renderTarget = new WebGLRenderTarget(width, height);
  const geometry = new PlaneGeometry(2, 2);
  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tTexture;
      void main() {
        vec2 uv = gl_FragCoord.xy / vec2(${width}.0, ${height}.0);
        gl_FragColor = texture2D(tTexture, uv);
      }
    `,
    uniforms: { tTexture: { value: texture } }
  });
  
  const mesh = new Mesh(geometry, material);
  const scene = new Scene();
  scene.add(mesh);
  
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  
  // Render and export
  const previousTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(renderTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(previousTarget);
  
  exportTextureFromRenderTarget(renderer, renderTarget, fileName, 0);
  
  // Cleanup
  renderTarget.dispose();
  geometry.dispose();
  material.dispose();
}
import { Mesh, MeshNormalMaterial, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTextureAtlas, exportTextureFromRenderTarget, OctahedralMode } from '../src/index.js';

// Setup renderer
const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(512, 512); // Set a reasonable size for export

// Load GLTF model
const loader = new GLTFLoader();
loader.load(
  'battleaxe.glb', // Use local asset
  (gltf) => {
    const mesh = gltf.scene;
    
    // Apply normal material for consistent export
    mesh.traverse((child) => {
      if (child instanceof Mesh) {
        child.material = new MeshNormalMaterial();
      }
    });

    mesh.updateMatrixWorld(true);

    const atlas = createTextureAtlas({ 
      renderer, 
      target: mesh, 
      octahedralMode: OctahedralMode.HEMISPHERICAL, 
      textureSize: 4096,
      spritesPerSide: 32 
    });

    exportTextureFromRenderTarget(renderer, atlas.renderTarget, 'albedo', 0);
    exportTextureFromRenderTarget(renderer, atlas.renderTarget, 'normalDepth', 1);
    
    console.log('Texture atlas exported successfully');
  },
  (progress) => {
    console.log('Loading progress:', (progress.loaded / progress.total * 100) + '%');
  },
  (error) => {
    console.error('Error loading GLTF model:', error);
  }
);

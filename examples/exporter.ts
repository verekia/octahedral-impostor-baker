import { BufferGeometryLoader, Mesh, MeshNormalMaterial, WebGLRenderer } from 'three';
import { createTextureAtlas, exportTextureFromRenderTarget } from '../src/index.js';

// Setup renderer
const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(512, 512); // Set a reasonable size for export

// Load geometry
const loader = new BufferGeometryLoader();
loader.load('https://threejs.org/examples/models/json/suzanne_buffergeometry.json', (geometry) => {
  geometry.computeVertexNormals();
  const target = new Mesh(geometry, new MeshNormalMaterial());

  target.updateMatrixWorld(true);

  const atlas = createTextureAtlas({ renderer, target, useHemiOctahedron: true, spritesPerSide: 16 });

  exportTextureFromRenderTarget(renderer, atlas.renderTarget, 'albedo', 0);
  exportTextureFromRenderTarget(renderer, atlas.renderTarget, 'normalDepth', 1);
});

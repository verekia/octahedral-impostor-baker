import { Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import Stats from 'stats.js';
import { createTextureAtlas, OctahedralMode } from '../src/index.js';

// Setup renderer
const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor('cyan');
document.body.appendChild(renderer.domElement);

// Setup stats
const stats = new Stats();
document.body.appendChild(stats.dom);

// Setup camera
const aspect = window.innerWidth / window.innerHeight;
const frustumSize = 20;
const camera = new OrthographicCamera(
  frustumSize * aspect / -2, frustumSize * aspect / 2,
  frustumSize / 2, frustumSize / -2,
  1, 1000
);
camera.position.z = 100;

const scene = new Scene();
const controls = new OrbitControls(camera, renderer.domElement);
controls.update();

// Load GLTF model
const loader = new GLTFLoader();
loader.load('battleaxe.glb', (gltf) => {
  const mesh = gltf.scene;
  scene.add(mesh);

  // Animation loop
  function animate() {
    stats.begin();
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    stats.end();
  }
  animate();

  const result = createTextureAtlas({ 
    renderer: renderer, 
    target: mesh, 
    octahedralMode: OctahedralMode.HEMISPHERICAL,
    textureSize: 4096,
    spritesPerSide: 32
  });
  mesh.visible = false;

  const plane = new Mesh(new PlaneGeometry(10, 10), new MeshBasicMaterial({ transparent: true, map: result.albedo }));
  const plane2 = new Mesh(new PlaneGeometry(10, 10), new MeshBasicMaterial({ transparent: true, map: result.normalDepth })).translateY(11);

  scene.add(plane, plane2);
});

// Handle window resize
window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = frustumSize * aspect / -2;
  camera.right = frustumSize * aspect / 2;
  camera.top = frustumSize / 2;
  camera.bottom = frustumSize / -2;
  camera.updateProjectionMatrix();
  
  renderer.setSize(window.innerWidth, window.innerHeight);
});

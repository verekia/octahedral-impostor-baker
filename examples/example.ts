import { DirectionalLight, MeshLambertMaterial, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'lil-gui';
import Stats from 'stats.js';
import { OctahedralImpostor, exportTextureAsPNG } from '../src/index.js';

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
controls.maxPolarAngle = Math.PI / 2;
controls.update();

// Load GLTF model
const loader = new GLTFLoader();
loader.load('tree.glb', (gltf) => {
  const mesh = gltf.scene;

  const directionalLight = new DirectionalLight('white', 3);

  const lightPosition = {
    azimuth: 0,
    elevation: 45,
    update: function () {
      const azRad = this.azimuth * Math.PI / 180;
      const elRad = this.elevation * Math.PI / 180;

      const x = Math.cos(elRad) * Math.sin(azRad);
      const y = Math.sin(elRad);
      const z = Math.cos(elRad) * Math.cos(azRad);

      directionalLight.position.set(x, y, z);
      directionalLight.lookAt(0, 0, 0);
    }
  };

  scene.add(mesh, directionalLight);

  // Configuration for texture atlas generation
  const atlasConfig = {
    textureSize: 2048,
    spritesPerSide: 12,
    useHemiOctahedron: true,
    regenerate: () => {
      regenerateImpostor();
    }
  };

  // Dynamic material settings (no regeneration needed)
  const materialConfig = {
    transparent: true,
    disableBlending: false
  };
  
  // Info display
  const infoDisplay = {
    totalAngles: atlasConfig.spritesPerSide * atlasConfig.spritesPerSide,
    atlasInfo: `${atlasConfig.textureSize}px, ${atlasConfig.spritesPerSide}x${atlasConfig.spritesPerSide}`,
    updateInfo: function() {
      this.totalAngles = atlasConfig.spritesPerSide * atlasConfig.spritesPerSide;
      this.atlasInfo = `${atlasConfig.textureSize}px, ${atlasConfig.spritesPerSide}x${atlasConfig.spritesPerSide}`;
    }
  };

  let impostor = new OctahedralImpostor({
    renderer: renderer,
    target: mesh,
    useHemiOctahedron: atlasConfig.useHemiOctahedron,
    transparent: materialConfig.transparent,
    disableBlending: materialConfig.disableBlending,
    spritesPerSide: atlasConfig.spritesPerSide,
    textureSize: atlasConfig.textureSize,
    baseType: MeshLambertMaterial
  });
  scene.add(impostor);

  mesh.visible = false;

  let alphaClampController: any;
  let transparentController: any;
  let hybridDistanceController: any;

  function regenerateImpostor() {
    console.log('Starting regeneration...');
    
    // Store hybridDistance value before removing old impostor
    const currentHybridDistance = impostor.material.octahedralImpostorUniforms?.hybridDistance?.value ?? 2.5;
    
    // Remove old impostor
    scene.remove(impostor);
    
    // Dispose of old material and textures
    if (impostor.material.map) impostor.material.map.dispose();
    if (impostor.material.normalMap) impostor.material.normalMap.dispose();
    impostor.material.dispose();
    
    // Ensure mesh is visible during texture atlas generation
    mesh.visible = true;
    mesh.updateMatrixWorld(true);
    
    try {
      // Create new impostor with updated settings
      impostor = new OctahedralImpostor({
        renderer: renderer,
        target: mesh,
        useHemiOctahedron: atlasConfig.useHemiOctahedron,
        transparent: materialConfig.transparent,
        disableBlending: materialConfig.disableBlending,
        spritesPerSide: atlasConfig.spritesPerSide,
        textureSize: atlasConfig.textureSize,
        baseType: MeshLambertMaterial
      });
      
      scene.add(impostor);
      
      // Hide original mesh and show impostor based on config
      mesh.visible = !config.showImpostor;
      impostor.visible = config.showImpostor;
      
      // Update GUI controllers to reference new material
      if (alphaClampController) {
        alphaClampController.object = impostor.material.octahedralImpostorUniforms.alphaClamp;
      }
      if (hybridDistanceController) {
        hybridDistanceController.object = impostor.material.octahedralImpostorUniforms.hybridDistance;
      }
      
      // Apply current material settings to new impostor
      impostor.material.transparent = materialConfig.transparent;
      impostor.material.octahedralImpostorUniforms.disableBlending.value = materialConfig.disableBlending ? 1.0 : 0.0;
      impostor.material.octahedralImpostorUniforms.hybridDistance.value = currentHybridDistance;
      impostor.material.needsUpdate = true;
      
      // Update info display
      infoDisplay.updateInfo();
      
      console.log(`✅ Regenerated texture atlas: ${atlasConfig.textureSize}px, ${atlasConfig.spritesPerSide}x${atlasConfig.spritesPerSide} frames (${atlasConfig.spritesPerSide * atlasConfig.spritesPerSide} total angles)`);
    } catch (error) {
      console.error('❌ Error during regeneration:', error);
      // Fallback: ensure mesh is visible if impostor creation fails
      mesh.visible = true;
    }
  }

  // Animation loop
  function animate() {
    stats.begin();
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    stats.end();
  }
  animate();

  const config = { showImpostor: true };
  const gui = new GUI();
  
  // Texture Atlas Generation Settings
  const atlasFolder = gui.addFolder('Texture Atlas Settings');
  atlasFolder.add(atlasConfig, 'textureSize', [128, 256, 512, 1024, 2048, 4096, 8192]).name('Resolution (px)').onChange(() => {
    infoDisplay.updateInfo();
    console.log(`Texture size changed to: ${atlasConfig.textureSize}px`);
  });
  atlasFolder.add(atlasConfig, 'spritesPerSide', [4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64]).name('Frames per Side').onChange(() => {
    infoDisplay.updateInfo();
    const totalFrames = atlasConfig.spritesPerSide * atlasConfig.spritesPerSide;
    console.log(`Frames changed to: ${atlasConfig.spritesPerSide}x${atlasConfig.spritesPerSide} (${totalFrames} angles)`);
  });
  atlasFolder.add(atlasConfig, 'useHemiOctahedron').name('Use Hemi-Octahedron');
  atlasFolder.add(infoDisplay, 'totalAngles').name('📊 Total Angles').listen().disable();
  atlasFolder.add(infoDisplay, 'atlasInfo').name('📏 Current Atlas').listen().disable();
  atlasFolder.add(atlasConfig, 'regenerate').name('🔄 Regenerate Atlas');
  atlasFolder.open();
  
  // Material Settings
  const materialFolder = gui.addFolder('Material Settings');
  alphaClampController = materialFolder.add(impostor.material.octahedralImpostorUniforms.alphaClamp, 'value', 0, 0.5, 0.01).name('Alpha Clamp');
  
  // Dynamic material controls (no regeneration needed)
  materialFolder.add(materialConfig, 'transparent').name('Transparent').onChange((value) => {
    impostor.material.transparent = value;
    impostor.material.needsUpdate = true;
  });
  materialFolder.add(materialConfig, 'disableBlending').name('Disable Triplanar Blending').onChange((value) => {
    impostor.material.octahedralImpostorUniforms.disableBlending.value = value ? 1.0 : 0.0;
  });
  
  hybridDistanceController = materialFolder.add(impostor.material.octahedralImpostorUniforms.hybridDistance, 'value', 0, 10, 0.1).name('Elevation Threshold');
  
  materialFolder.add(config, 'showImpostor').onChange((value) => {
    mesh.visible = !value;
    impostor.visible = value;
  });
  
  // Export functionality
  const exportFolder = gui.addFolder('Export Texture Atlas');
  const exportConfig = {
    exportAlbedo: () => {
      const albedoTexture = impostor.material.map;
      if (albedoTexture) {
        exportTextureAsPNG(renderer, albedoTexture, `albedo_${atlasConfig.textureSize}px_${atlasConfig.spritesPerSide}x${atlasConfig.spritesPerSide}`);
      } else {
        console.warn('Albedo texture not available for export');
      }
    },
    exportNormalDepth: () => {
      const normalTexture = impostor.material.normalMap;
      if (normalTexture) {
        exportTextureAsPNG(renderer, normalTexture, `normalDepth_${atlasConfig.textureSize}px_${atlasConfig.spritesPerSide}x${atlasConfig.spritesPerSide}`);
      } else {
        console.warn('Normal/Depth texture not available for export');
      }
    }
  };
  exportFolder.add(exportConfig, 'exportAlbedo').name('📤 Export Albedo PNG');
  exportFolder.add(exportConfig, 'exportNormalDepth').name('📤 Export Normal/Depth PNG');
  
  const lightFolder = gui.addFolder('Directional Light');
  lightFolder.add(directionalLight, 'intensity', 0, 10, 0.01).name('Intensity');
  lightFolder.add(lightPosition, 'azimuth', -180, 180, 1).name('Azimuth').onChange(() => lightPosition.update());
  lightFolder.add(lightPosition, 'elevation', -90, 90, 1).name('Elevation').onChange(() => lightPosition.update());

  // mesh.querySelectorAll('Mesh').forEach((m) => { m.material = new MeshNormalMaterial() }); // todo remove
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

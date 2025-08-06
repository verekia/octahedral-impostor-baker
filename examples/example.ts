import * as THREE from 'three';
import { DirectionalLight, MeshLambertMaterial, OrthographicCamera, Scene, WebGLRenderer, TextureLoader, Texture, Matrix4, BoxGeometry, Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'lil-gui';
import Stats from 'stats.js';
import { 
  OctahedralImpostor, 
  exportTextureAsPNG, 
  createOctahedralImpostorMaterial, 
  OctahedralMode, 
  CameraType,
  ImpostorPositioningMode,
  FramingMode,
  ViewingAngle,
  FRAMING_PRESETS,
  calculateOptimalFraming,
  applyCameraFraming,
  animateCameraToFraming,
  centerOrbitalCamera,
  calculateOptimalViewingDistance
} from '../src/index.js';

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

// Global variables for dynamic loading
let currentMesh: any = null;
let impostor: any = null;
let gui: GUI;
let alphaClampController: any;
let transparentController: any;
let hybridDistanceController: any;

// Extend window type for animation flag
declare global {
  interface Window {
    animationStarted?: boolean;
  }
}

// Create GUI first (before loading any model)
createGUI();

// Load default GLTF model
const loader = new GLTFLoader();

async function generateImpostorFromTextures(): Promise<void> {
  if (!textureImportConfig.albedoTexture || !textureImportConfig.normalTexture) {
    alert('Please import both albedo and normal textures first!');
    return;
  }

  try {
    // Clean up previous impostor
    if (impostor) {
      scene.remove(impostor);
      if (impostor.material.map) impostor.material.map.dispose();
      if (impostor.material.normalMap) impostor.material.normalMap.dispose();
      impostor.material.dispose();
    }

    // Hide current mesh if any
    if (currentMesh) {
      currentMesh.visible = false;
    }

    // Create a dummy target object for material creation
    const dummyGeometry = new BoxGeometry(1, 1, 1);
    const dummyMaterial = new MeshLambertMaterial();
    const dummyTarget = new Mesh(dummyGeometry, dummyMaterial);

    // Create impostor material using the standard creation process
    const material = createOctahedralImpostorMaterial({
      renderer: renderer,
      target: dummyTarget,
      baseType: MeshLambertMaterial,
      spritesPerSide: textureImportConfig.framesPerSide,
      octahedralMode: textureImportConfig.octahedralMode,
      cameraType: textureImportConfig.cameraType,
      transparent: materialConfig.transparent,
      disableBlending: materialConfig.disableBlending,
      scale: 5,
      translation: new THREE.Vector3(0, 0, 0)
    });

    // Override the generated textures with our imported ones
    if (material.map) material.map.dispose();
    if (material.normalMap) material.normalMap.dispose();
    
    material.map = textureImportConfig.albedoTexture;
    material.normalMap = textureImportConfig.normalTexture;
    material.needsUpdate = true;

    // Create impostor mesh
    impostor = new OctahedralImpostor(material);
    impostor.position.set(0, 0, 0);
    impostor.scale.setScalar(5); // Default scale for imported textures
    
    scene.add(impostor);

    // Update controllers if they exist
    updateGUIControllers();

    console.log('✅ Successfully created impostor from imported textures');
  } catch (error) {
    console.error('❌ Failed to create impostor from textures:', error);
    alert('Failed to create impostor from textures');
  }
}

async function loadModelFromFile(file: File): Promise<void> {
  const url = URL.createObjectURL(file);
  
  try {
    const gltf = await new Promise<any>((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    });
    
    // Clean up previous model and impostor
    if (currentMesh) {
      scene.remove(currentMesh);
    }
    if (impostor) {
      scene.remove(impostor);
      if (impostor.material.map) impostor.material.map.dispose();
      if (impostor.material.normalMap) impostor.material.normalMap.dispose();
      impostor.material.dispose();
    }
    
    currentMesh = gltf.scene;
    initializeModelAndImpostor(currentMesh);
    
    console.log('✅ Successfully loaded model:', file.name);
  } catch (error) {
    console.error('❌ Failed to load model:', file.name, error);
    alert(`Failed to load model: ${file.name}`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Global configurations
const atlasConfig = {
  textureSize: 4096,
  spritesPerSide: 32,
  octahedralMode: OctahedralMode.HEMISPHERICAL,
  cameraType: CameraType.ORTHOGRAPHIC,
  regenerate: () => regenerateImpostor()
};

const materialConfig = {
  transparent: true,
  disableBlending: true
};

// Smart positioning configuration
const smartConfig = {
  positioningMode: ImpostorPositioningMode.SMART,
  framingPreset: 'PRODUCT' as keyof typeof FRAMING_PRESETS,
  autoScale: true,
  scaleMultiplier: 1.0,
  alignToGround: false,
  groundY: 0,
  frameCamera: () => frameCameraToImpostor()
};

// Apply initial orbital control restrictions based on default config
updateOrbitalControlRestrictions();

// Configuration for texture import
const textureImportConfig = {
  albedoTexture: null as Texture | null,
  normalTexture: null as Texture | null,
  resolution: 4096,
  framesPerSide: 32,
  octahedralMode: OctahedralMode.HEMISPHERICAL,
  cameraType: CameraType.ORTHOGRAPHIC,
  generateFromTextures: () => generateImpostorFromTextures()
};

const infoDisplay = {
  totalAngles: atlasConfig.spritesPerSide * atlasConfig.spritesPerSide,
  atlasInfo: `${atlasConfig.textureSize}px, ${atlasConfig.spritesPerSide}x${atlasConfig.spritesPerSide}`,
  updateInfo: function() {
    this.totalAngles = atlasConfig.spritesPerSide * atlasConfig.spritesPerSide;
    this.atlasInfo = `${atlasConfig.textureSize}px, ${atlasConfig.spritesPerSide}x${atlasConfig.spritesPerSide}`;
  }
};

const config = { showImpostor: true };

// Helper function to update orbital control restrictions based on impostor mode
function updateOrbitalControlRestrictions() {
  if (atlasConfig.octahedralMode === OctahedralMode.HEMISPHERICAL) {
    // In hemispherical mode, restrict orbital controls to not go below the model
    controls.minPolarAngle = 0; // Can look straight down from above
    controls.maxPolarAngle = Math.PI / 2; // Cannot go below horizontal plane
  } else {
    // In spherical mode, allow full rotation
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
  }
}

// Smart camera framing function
function frameCameraToImpostor() {
  if (!impostor || !currentMesh) {
    console.warn('Cannot frame camera: no impostor or mesh loaded');
    return;
  }

  try {
    // Get the smart framing result from the impostor
    const framingResult = impostor.getFramingResult();
    
    if (framingResult) {
      // Use the stored framing result
      animateCameraToFraming(camera, framingResult, {
        duration: 1000,
        easing: 'ease-in-out'
      }).then(() => {
        console.log('✅ Camera framed to impostor using smart positioning');
      });
    } else {
      // Calculate new framing for the current mesh
      const framingPreset = FRAMING_PRESETS[smartConfig.framingPreset];
      const optimalFraming = calculateOptimalFraming(currentMesh, camera, framingPreset);
      
      animateCameraToFraming(camera, optimalFraming, {
        duration: 1000,
        easing: 'ease-in-out'
      }).then(() => {
        console.log('✅ Camera framed to object using calculated positioning');
      });
    }
  } catch (error) {
    console.error('❌ Failed to frame camera:', error);
  }
}

function initializeModelAndImpostor(mesh: any) {
  currentMesh = mesh;

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

  impostor = new OctahedralImpostor({
    renderer: renderer,
    target: mesh,
    octahedralMode: atlasConfig.octahedralMode,
    cameraType: atlasConfig.cameraType,
    transparent: materialConfig.transparent,
    disableBlending: materialConfig.disableBlending,
    spritesPerSide: atlasConfig.spritesPerSide,
    textureSize: atlasConfig.textureSize,
    baseType: MeshLambertMaterial,
    smartConfig: {
      positioningMode: smartConfig.positioningMode,
      framingPreset: smartConfig.framingPreset,
      autoScale: smartConfig.autoScale,
      scaleMultiplier: smartConfig.scaleMultiplier,
      alignToGround: smartConfig.alignToGround,
      groundY: smartConfig.groundY
    }
  });
  scene.add(impostor);

  mesh.visible = false;

  // Center the orbital camera on the impostor with optimal distance
  const impostorCenter = impostor.position.clone();
  const boundingSphere = impostor.smartPositioning?.boundingSphere;
  const framingPreset = FRAMING_PRESETS[smartConfig.framingPreset];
  const paddingFactor = framingPreset.customPadding || 1.5;
  centerOrbitalCamera(controls, impostorCenter, boundingSphere, camera, paddingFactor);

  // Apply orbital control restrictions based on impostor mode
  updateOrbitalControlRestrictions();

  // Update GUI controllers if they exist
  updateGUIControllers();

  // Start animation loop if not already running
  if (!window.animationStarted) {
    animate();
    window.animationStarted = true;
  }
}

function regenerateImpostor() {
  if (!currentMesh || !impostor) {
    console.warn('Cannot regenerate: no mesh or impostor loaded');
    return;
  }

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
  currentMesh.visible = true;
  currentMesh.updateMatrixWorld(true);
  
  try {
    // Create new impostor with updated settings
    impostor = new OctahedralImpostor({
      renderer: renderer,
      target: currentMesh,
      octahedralMode: atlasConfig.octahedralMode,
      cameraType: atlasConfig.cameraType,
      transparent: materialConfig.transparent,
      disableBlending: materialConfig.disableBlending,
      spritesPerSide: atlasConfig.spritesPerSide,
      textureSize: atlasConfig.textureSize,
      baseType: MeshLambertMaterial,
      smartConfig: {
        positioningMode: smartConfig.positioningMode,
        framingPreset: smartConfig.framingPreset,
        autoScale: smartConfig.autoScale,
        scaleMultiplier: smartConfig.scaleMultiplier,
        alignToGround: smartConfig.alignToGround,
        groundY: smartConfig.groundY
      }
    });
    
    scene.add(impostor);
    
    // Hide original mesh and show impostor based on config
    currentMesh.visible = !config.showImpostor;
    impostor.visible = config.showImpostor;
    
    // Center the orbital camera on the impostor with optimal distance
    const impostorCenter = impostor.position.clone();
    const boundingSphere = impostor.smartPositioning?.boundingSphere;
    const framingPreset = FRAMING_PRESETS[smartConfig.framingPreset];
    const paddingFactor = framingPreset.customPadding || 1.5;
    centerOrbitalCamera(controls, impostorCenter, boundingSphere, camera, paddingFactor);
    
    // Update GUI controllers
    updateGUIControllers();
    
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
    currentMesh.visible = true;
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

function updateGUIControllers() {
  if (!impostor) return;
  
  if (alphaClampController) {
    alphaClampController.object = impostor.material.octahedralImpostorUniforms.alphaClamp;
  }
  if (hybridDistanceController) {
    hybridDistanceController.object = impostor.material.octahedralImpostorUniforms.hybridDistance;
  }
}

function createGUI() {
  gui = new GUI();
  
  // File Import Controls
  const importFolder = gui.addFolder('📁 Model Import');
  
  // Create hidden file input
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.glb,.gltf';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);
  
  fileInput.addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      await loadModelFromFile(file);
    }
  });
  
  importFolder.add({
    selectFile: () => fileInput.click()
  }, 'selectFile').name('📂 Select GLB/GLTF File');
  
  // Drag and drop info
  importFolder.add({
    info: 'Drag & drop GLB/GLTF files anywhere!'
  }, 'info').name('💡').disable();
  
  importFolder.open();
  
  // Texture Import Controls
  const textureImportFolder = gui.addFolder('🖼️ Texture Import');
  
  // Create texture loader
  const textureLoader = new TextureLoader();
  
  // Create hidden file inputs for textures
  const albedoFileInput = document.createElement('input');
  albedoFileInput.type = 'file';
  albedoFileInput.accept = 'image/*';
  albedoFileInput.style.display = 'none';
  document.body.appendChild(albedoFileInput);
  
  const normalFileInput = document.createElement('input');
  normalFileInput.type = 'file';
  normalFileInput.accept = 'image/*';
  normalFileInput.style.display = 'none';
  document.body.appendChild(normalFileInput);
  
  // Albedo texture input
  albedoFileInput.addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      try {
        textureImportConfig.albedoTexture = await textureLoader.loadAsync(url);
        console.log('✅ Albedo texture loaded:', file.name);
      } catch (error) {
        console.error('❌ Failed to load albedo texture:', error);
        alert('Failed to load albedo texture');
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  });
  
  // Normal texture input
  normalFileInput.addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      try {
        textureImportConfig.normalTexture = await textureLoader.loadAsync(url);
        console.log('✅ Normal texture loaded:', file.name);
      } catch (error) {
        console.error('❌ Failed to load normal texture:', error);
        alert('Failed to load normal texture');
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  });
  
  textureImportFolder.add({
    selectAlbedo: () => albedoFileInput.click()
  }, 'selectAlbedo').name('📂 Select Albedo Map');
  
  textureImportFolder.add({
    selectNormal: () => normalFileInput.click()
  }, 'selectNormal').name('📂 Select Normal Map');
  
  // Resolution and frames settings for imported textures
  textureImportFolder.add(textureImportConfig, 'resolution', [128, 256, 512, 1024, 2048, 4096, 8192]).name('Resolution (px)');
  textureImportFolder.add(textureImportConfig, 'framesPerSide', [4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64]).name('Frames per Side');
  textureImportFolder.add(textureImportConfig, 'octahedralMode', {
    'Hemispherical': OctahedralMode.HEMISPHERICAL,
    'Spherical': OctahedralMode.SPHERICAL
  }).name('Octahedral Mode');
  textureImportFolder.add(textureImportConfig, 'cameraType', {
    'Orthographic': CameraType.ORTHOGRAPHIC,
    'Perspective': CameraType.PERSPECTIVE
  }).name('Camera Type');
  
  // Generate button
  textureImportFolder.add(textureImportConfig, 'generateFromTextures').name('🚀 Generate Impostor');
  
  textureImportFolder.open();

  // Smart Positioning Controls
  const smartPositioningFolder = gui.addFolder('🎯 Smart Positioning');
  
  smartPositioningFolder.add(smartConfig, 'positioningMode', {
    'Automatic': ImpostorPositioningMode.AUTO,
    'Smart Framing': ImpostorPositioningMode.SMART,
    'Manual': ImpostorPositioningMode.MANUAL
  }).name('Positioning Mode').onChange(() => {
    if (impostor && currentMesh) {
      impostor.updateSmartPositioning(currentMesh, {
        positioningMode: smartConfig.positioningMode,
        framingPreset: smartConfig.framingPreset,
        autoScale: smartConfig.autoScale,
        scaleMultiplier: smartConfig.scaleMultiplier,
        alignToGround: smartConfig.alignToGround,
        groundY: smartConfig.groundY
      });
      
      // Re-center camera on impostor with optimal distance
      const impostorCenter = impostor.position.clone();
      const boundingSphere = impostor.smartPositioning?.boundingSphere;
      const framingPreset = FRAMING_PRESETS[smartConfig.framingPreset];
      const paddingFactor = framingPreset.customPadding || 1.5;
      centerOrbitalCamera(controls, impostorCenter, boundingSphere, camera, paddingFactor);
      
      console.log(`Positioning mode changed to: ${smartConfig.positioningMode}`);
    }
  });
  
  smartPositioningFolder.add(smartConfig, 'framingPreset', {
    'Product': 'PRODUCT',
    'Technical': 'TECHNICAL',
    'Cinematic': 'CINEMATIC',
    'Inspection': 'INSPECTION'
  }).name('Framing Style').onChange(() => {
    if (impostor && currentMesh && smartConfig.positioningMode === ImpostorPositioningMode.SMART) {
      impostor.updateSmartPositioning(currentMesh, {
        positioningMode: smartConfig.positioningMode,
        framingPreset: smartConfig.framingPreset,
        autoScale: smartConfig.autoScale,
        scaleMultiplier: smartConfig.scaleMultiplier,
        alignToGround: smartConfig.alignToGround,
        groundY: smartConfig.groundY
      });
      
      // Re-center camera on impostor with optimal distance
      const impostorCenter = impostor.position.clone();
      const boundingSphere = impostor.smartPositioning?.boundingSphere;
      const framingPreset = FRAMING_PRESETS[smartConfig.framingPreset];
      const paddingFactor = framingPreset.customPadding || 1.5;
      centerOrbitalCamera(controls, impostorCenter, boundingSphere, camera, paddingFactor);
      
      console.log(`Framing preset changed to: ${smartConfig.framingPreset}`);
    }
  });
  
  smartPositioningFolder.add(smartConfig, 'scaleMultiplier', 0.1, 3.0, 0.1).name('Scale Multiplier').onChange(() => {
    if (impostor && currentMesh) {
      impostor.updateSmartPositioning(currentMesh, {
        positioningMode: smartConfig.positioningMode,
        framingPreset: smartConfig.framingPreset,
        autoScale: smartConfig.autoScale,
        scaleMultiplier: smartConfig.scaleMultiplier,
        alignToGround: smartConfig.alignToGround,
        groundY: smartConfig.groundY
      });
    }
  });
  
  smartPositioningFolder.add(smartConfig, 'alignToGround').name('Align to Ground').onChange(() => {
    if (impostor && currentMesh) {
      impostor.updateSmartPositioning(currentMesh, {
        positioningMode: smartConfig.positioningMode,
        framingPreset: smartConfig.framingPreset,
        autoScale: smartConfig.autoScale,
        scaleMultiplier: smartConfig.scaleMultiplier,
        alignToGround: smartConfig.alignToGround,
        groundY: smartConfig.groundY
      });
    }
  });
  
  smartPositioningFolder.add(smartConfig, 'groundY', -10, 10, 0.1).name('Ground Y Position').onChange(() => {
    if (impostor && currentMesh && smartConfig.alignToGround) {
      impostor.updateSmartPositioning(currentMesh, {
        positioningMode: smartConfig.positioningMode,
        framingPreset: smartConfig.framingPreset,
        autoScale: smartConfig.autoScale,
        scaleMultiplier: smartConfig.scaleMultiplier,
        alignToGround: smartConfig.alignToGround,
        groundY: smartConfig.groundY
      });
    }
  });
  
  smartPositioningFolder.add(smartConfig, 'frameCamera').name('🎬 Frame Camera');
  
  smartPositioningFolder.open();
  
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
  atlasFolder.add(atlasConfig, 'octahedralMode', {
    'Hemispherical': OctahedralMode.HEMISPHERICAL,
    'Spherical': OctahedralMode.SPHERICAL
  }).name('Octahedral Mode').onChange((value: OctahedralMode) => {
    const mode = value === OctahedralMode.HEMISPHERICAL ? 'Hemispherical (upper hemisphere only)' : 'Full Spherical (360° coverage)';
    console.log(`Octahedral mode changed to: ${mode}`);
    
    // Update orbital control restrictions
    updateOrbitalControlRestrictions();
    controls.update();
  });
  atlasFolder.add(atlasConfig, 'cameraType', {
    'Orthographic': CameraType.ORTHOGRAPHIC,
    'Perspective': CameraType.PERSPECTIVE
  }).name('Camera Type');
  atlasFolder.add(infoDisplay, 'totalAngles').name('📊 Total Angles').listen().disable();
  atlasFolder.add(infoDisplay, 'atlasInfo').name('📏 Current Atlas').listen().disable();
  atlasFolder.add(atlasConfig, 'regenerate').name('🔄 Regenerate Atlas');
  atlasFolder.open();
  
  // Material Settings
  const materialFolder = gui.addFolder('Material Settings');
  
  // These will be set up when impostor is created
  materialFolder.add(materialConfig, 'transparent').name('Transparent').onChange((value) => {
    if (impostor) {
      impostor.material.transparent = value;
      impostor.material.needsUpdate = true;
    }
  });
  
  materialFolder.add(materialConfig, 'disableBlending').name('Disable Blending').onChange((value) => {
    if (impostor) {
      impostor.material.octahedralImpostorUniforms.disableBlending.value = value ? 1.0 : 0.0;
      impostor.material.needsUpdate = true;
    }
  });
  
  // Display Controls  
  materialFolder.add(config, 'showImpostor').name('Show Impostor').onChange((value) => {
    if (impostor) impostor.visible = value;
    if (currentMesh) currentMesh.visible = !value;
  });
  
  materialFolder.open();
  
  // Export Controls
  const exportFolder = gui.addFolder('Export');
  exportFolder.add({
    exportAlbedo: () => {
      if (impostor) {
        exportTextureAsPNG(renderer, impostor.material.map, 'octahedral_albedo');
      }
    }
  }, 'exportAlbedo').name('💾 Export Albedo');
  
  exportFolder.add({
    exportNormal: () => {
      if (impostor) {
        exportTextureAsPNG(renderer, impostor.material.normalMap, 'octahedral_normal');
      }
    }
  }, 'exportNormal').name('💾 Export Normal/Depth');
  
  // Setup drag and drop after GUI is created
  setupDragAndDrop();
}

function setupDragAndDrop() {
  // Prevent default drag behaviors
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    document.addEventListener(eventName, preventDefaults, false);
    document.body.addEventListener(eventName, preventDefaults, false);
  });

  // Highlight drop area
  ['dragenter', 'dragover'].forEach(eventName => {
    document.addEventListener(eventName, highlight, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    document.addEventListener(eventName, unhighlight, false);
  });

  // Handle dropped files
  document.addEventListener('drop', handleDrop, false);

  function preventDefaults(e: Event) {
    e.preventDefault();
    e.stopPropagation();
  }

  function highlight(e: Event) {
    document.body.style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
  }

  function unhighlight(e: Event) {
    document.body.style.backgroundColor = '';
  }

  async function handleDrop(e: DragEvent) {
    const dt = e.dataTransfer;
    const files = dt?.files;

    if (files?.length) {
      const file = files[0];
      if (file.name.toLowerCase().endsWith('.glb') || file.name.toLowerCase().endsWith('.gltf')) {
        await loadModelFromFile(file);
      } else {
        alert('Please drop a .glb or .gltf file');
      }
    }
  }
}

// Load default model and start
loader.load('battleaxe.glb', (gltf) => {
  initializeModelAndImpostor(gltf.scene);
  
  // Set up dynamic GUI controllers after impostor is created
  setTimeout(() => {
    if (impostor) {
      // Add alpha clamp controller
      const materialFolder = gui.folders.find((f: any) => f._title === 'Material Settings');
      if (materialFolder) {
        alphaClampController = materialFolder.add(impostor.material.octahedralImpostorUniforms.alphaClamp, 'value', 0, 0.5, 0.01).name('Alpha Clamp');
        hybridDistanceController = materialFolder.add(impostor.material.octahedralImpostorUniforms.hybridDistance, 'value', 0, 5, 0.1).name('Hybrid Distance');
      }
    }
  }, 100);
}, 
undefined, // onProgress
(error) => {
  console.warn('Could not load default battleaxe.glb:', error);
  console.log('🎯 Ready for file import! Use the "📂 Select GLB/GLTF File" button or drag & drop a .glb/.gltf file');
  
  // Start animation loop even without a model
  if (!window.animationStarted) {
    animate();
    window.animationStarted = true;
  }
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

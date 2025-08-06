import * as THREE from 'three';
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
import { FPSController } from './controllers/FPSController.js';
import { createGround } from './objects/Ground.js';
import { setupLights } from './utils/Lights.js';
import { InputHandler } from './input/InputHandler.js';

// Import Rapier directly - the plugins will handle the WASM loading
import RAPIER from '@dimforge/rapier3d-compat';

// Camera control modes
enum ControlMode {
  FPS = 'fps',
  ORBITAL = 'orbital'
}

// Initialize scene, camera, and renderer
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);

// Two cameras for different modes
const fpsCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const aspect = window.innerWidth / window.innerHeight;
const frustumSize = 20;
const orbitalCamera = new THREE.OrthographicCamera(
  frustumSize * aspect / -2, frustumSize * aspect / 2,
  frustumSize / 2, frustumSize / -2,
  1, 1000
);
orbitalCamera.position.z = 100;

// Active camera reference
let camera: THREE.Camera = fpsCamera;

const renderer = new THREE.WebGLRenderer({ 
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance' 
});
renderer.setClearColor(0x87CEEB, 1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// Initialize stats.js
const stats = new Stats();
stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
document.body.appendChild(stats.dom);

// Initialize Rapier physics
let physics: {
  world: RAPIER.World;
  rigidBodies: Map<THREE.Object3D, RAPIER.RigidBody>;
};

// Ground mesh reference
let groundMesh: THREE.Object3D | null = null;

// Control mode state
let currentControlMode: ControlMode = ControlMode.ORBITAL; // Changed to orbital by default
let fpsController: FPSController;
let orbitControls: OrbitControls;
let inputHandler: InputHandler;
let lastTime = 0;
let impostor: OctahedralImpostor<THREE.MeshLambertMaterial>;
let currentMesh: THREE.Object3D | null = null;
let currentAtlasConfig: any = null;
let updateDebugWireframe: (() => void) | null = null;
let updateStatusIndicator: (() => void) | null = null;

// Preset models configuration
const PRESET_MODELS = [
  { name: "BattleAxe", filename: "battleaxe.glb" },
  { name: "Sword", filename: "sword.glb" },
  { name: "Shield", filename: "shield.glb" },
  { name: "House", filename: "house.glb" },
  { name: "Tree", filename: "tree.glb" },
  { name: "JungleTree", filename: "jungletree.glb" },
  { name: "PirateShip", filename: "pirateship.glb" }
];

// Default atlas configuration (updated to match requirements)
const DEFAULT_ATLAS_CONFIG = {
  textureSize: 4096, // 4k resolution
  spritesPerSide: 32, // 32 frames per side
  octahedralMode: OctahedralMode.HEMISPHERICAL, // Hemispherical mode
  cameraType: CameraType.ORTHOGRAPHIC, // Camera type for atlas generation
  disableBlending: true // Triplanar blending disabled by default
};

// Configuration for texture import
const textureImportConfig = {
  albedoTexture: null as THREE.Texture | null,
  normalTexture: null as THREE.Texture | null,
  resolution: 4096, // Updated to 4k
  framesPerSide: 32, // Updated to 32
  octahedralMode: OctahedralMode.HEMISPHERICAL, // Updated to hemispherical
  cameraType: CameraType.ORTHOGRAPHIC, // Camera type for atlas generation
  generateFromTextures: () => generateImpostorFromTextures()
};



// Initialize the game
async function init() {
  // First initialize RAPIER
  await RAPIER.init();
  
  // Create physics world
  physics = {
    world: new RAPIER.World({ x: 0, y: -9.81, z: 0 }),
    rigidBodies: new Map()
  };

  // Create ground
  groundMesh = createGround(physics);
  scene.add(groundMesh);

  // Setup lights (will be replaced with proper directional light in setupGUI)
  setupLights(scene);

  // Setup FPS controller
  fpsController = new FPSController(fpsCamera, physics, renderer.domElement);
  fpsController.position.set(0, 5, 10);
  scene.add(fpsController.object);
  
  // Set the scene reference in the controller
  fpsController.setScene(scene);

  // Setup orbital controls
  orbitControls = new OrbitControls(orbitalCamera, renderer.domElement);
  orbitControls.enabled = false; // Start disabled

  // Initialize input handler
  inputHandler = new InputHandler();

  // Start with orbital mode
  switchControlMode(ControlMode.ORBITAL);

  // Add help message to console
  console.log("Controls:");
  console.log("- WASD/Arrow Keys: Move");
  console.log("- Space: Jump");
  console.log("- Mouse: Look around (click to lock pointer)");

  // Handle window resize
  window.addEventListener('resize', onWindowResize);

  // Load the default BattleAxe model using preset system
  try {
    await loadPresetModel('battleaxe.glb');
  } catch (error) {
    console.log('🎯 Ready for file import! Use the "📂 Select GLB/GLTF File" button or drag & drop a .glb/.gltf file');
  }

  // Setup GUI (always called regardless of model loading success)
  updateDebugWireframe = setupGUI(currentMesh, impostor, currentAtlasConfig);

  // Start animation loop
  requestAnimationFrame(animate);
}

// Helper function to update orbital control restrictions based on impostor mode
function updateOrbitalControlRestrictions() {
  // Use currentAtlasConfig if available, otherwise fall back to DEFAULT_ATLAS_CONFIG
  const atlasConfig = currentAtlasConfig || DEFAULT_ATLAS_CONFIG;
  
  if (atlasConfig.octahedralMode === OctahedralMode.HEMISPHERICAL) {
    // In hemispherical mode, restrict orbital controls to not go below the model
    orbitControls.minPolarAngle = 0; // Can look straight down from above
    orbitControls.maxPolarAngle = Math.PI / 2; // Cannot go below horizontal plane
    console.log('🔒 Orbital controls restricted for hemispherical mode');
  } else {
    // In spherical mode, allow full rotation
    orbitControls.minPolarAngle = 0;
    orbitControls.maxPolarAngle = Math.PI;
    console.log('🔓 Orbital controls unrestricted for spherical mode');
  }
}

// Function to switch between control modes
function switchControlMode(mode: ControlMode) {
  currentControlMode = mode;
  
  if (mode === ControlMode.FPS) {
    // Switch to FPS mode
    camera = fpsCamera;
    orbitControls.enabled = false;
    
    // Show ground mesh and physics
    if (groundMesh) {
      groundMesh.visible = true;
    }
    
    // Set background for FPS mode
    scene.background = new THREE.Color(0x87CEEB);
    renderer.setClearColor(0x87CEEB, 1);
    
    console.log("Switched to FPS mode - Click to enable mouse look");
  } else {
    // Switch to orbital mode  
    camera = orbitalCamera;
    orbitControls.enabled = true;
    
    // Apply restrictions based on impostor mode
    updateOrbitalControlRestrictions();
    
    // Center camera on impostor if one exists
    if (impostor) {
      const impostorCenter = impostor.position.clone();
      const boundingSphere = impostor.smartPositioning?.boundingSphere;
      const paddingFactor = 1.5; // Default comfortable padding for FPS mode
      centerOrbitalCamera(orbitControls, impostorCenter, boundingSphere, orbitalCamera, paddingFactor);
    } else {
      orbitControls.update();
    }
    
    // Hide ground mesh for better orbital viewing
    if (groundMesh) {
      groundMesh.visible = false;
    }
    
    // Set background for orbital mode (like the original example)
    scene.background = new THREE.Color('cyan');
    renderer.setClearColor('cyan');
    
    // Exit pointer lock if active
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    
    console.log("Switched to Orbital mode");
  }
  
  // Update status indicator if available
  if (updateStatusIndicator) {
    updateStatusIndicator();
  }
}

async function loadModelFromFile(file: File, oldMesh: THREE.Object3D, oldImpostor: OctahedralImpostor<THREE.MeshLambertMaterial>, atlasConfig: any): Promise<void> {
  const loader = new GLTFLoader();
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
    
    const mesh = gltf.scene;
    
    // Calculate the bounding box to position the model correctly on the ground
    const box = new THREE.Box3().setFromObject(mesh);
    const groundOffset = -box.min.y; // Offset to place bottom at y=0
    
    // Position the original mesh so its bottom sits on the ground
    mesh.position.set(0, groundOffset, 0);
    
    // Update the mesh's world matrix after positioning so bounding calculations are correct
    mesh.updateMatrixWorld(true);
    scene.add(mesh);

    // Update global references
    currentMesh = mesh;

    // Create new impostor with current settings
    impostor = new OctahedralImpostor({
      renderer: renderer,
      target: mesh,
      octahedralMode: currentAtlasConfig.octahedralMode,
      cameraType: currentAtlasConfig.cameraType,
      transparent: true,
      disableBlending: false,
      spritesPerSide: currentAtlasConfig.spritesPerSide,
      textureSize: currentAtlasConfig.textureSize,
      baseType: THREE.MeshLambertMaterial,
      smartConfig: {
        positioningMode: ImpostorPositioningMode.SMART,
        framingPreset: 'PRODUCT',
        autoScale: true,
        scaleMultiplier: 1.0,
        alignToGround: true,
        groundY: 0
      }
    });
    
    scene.add(impostor);

    // Hide original mesh, show impostor
    mesh.visible = false;
    impostor.visible = true;
    
    // If in orbital mode, center camera on impostor
    if (currentControlMode === ControlMode.ORBITAL) {
      const impostorCenter = impostor.position.clone();
      const boundingSphere = impostor.smartPositioning?.boundingSphere;
      const paddingFactor = 1.5; // Default comfortable padding for FPS mode
      centerOrbitalCamera(orbitControls, impostorCenter, boundingSphere, orbitalCamera, paddingFactor);
    }

    console.log('✅ Successfully loaded model:', file.name);
    
  } catch (error) {
    console.error('❌ Failed to load model:', file.name, error);
    alert(`Failed to load model: ${file.name}`);
  } finally {
    URL.revokeObjectURL(url);
  }
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
        await loadModelFromFile(file, currentMesh, impostor, currentAtlasConfig);
      } else {
        alert('Please drop a .glb or .gltf file');
      }
    }
  }
}

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
    const dummyGeometry = new THREE.BoxGeometry(1, 1, 1);
    const dummyMaterial = new THREE.MeshLambertMaterial();
    const dummyTarget = new THREE.Mesh(dummyGeometry, dummyMaterial);

    // Create impostor material using the standard creation process
    const material = createOctahedralImpostorMaterial({
      renderer: renderer,
      target: dummyTarget,
      baseType: THREE.MeshLambertMaterial,
      spritesPerSide: textureImportConfig.framesPerSide,
      octahedralMode: textureImportConfig.octahedralMode,
      cameraType: textureImportConfig.cameraType,
      transparent: true,
      disableBlending: false,
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
    const impostorScale = 5;
    impostor.scale.setScalar(impostorScale);
    
    // Position so bottom edge is flush with ground (y=0)
    // Since the plane is centered, move it up by half its height
    impostor.position.set(0, impostorScale / 2, 0);
    
    scene.add(impostor);

    console.log('✅ Successfully created impostor from imported textures');
  } catch (error) {
    console.error('❌ Failed to create impostor from textures:', error);
    alert('Failed to create impostor from textures');
  }
}



// Function to load a preset model
async function loadPresetModel(filename: string) {
  const loader = new GLTFLoader();
  
  try {
    console.log(`Loading preset model: ${filename}`);
    
    // Remove existing mesh and impostor if they exist
    if (currentMesh) {
      scene.remove(currentMesh);
    }
    if (impostor) {
      scene.remove(impostor);
      // Dispose of textures and material
      if (impostor.material.map) impostor.material.map.dispose();
      if (impostor.material.normalMap) impostor.material.normalMap.dispose();
      impostor.material.dispose();
    }
    
    const gltf = await new Promise<any>((resolve, reject) => {
      loader.load(filename, resolve, undefined, reject);
    });
    
    const mesh = gltf.scene;
    
    // Calculate the bounding box to position the model correctly on the ground
    const box = new THREE.Box3().setFromObject(mesh);
    const groundOffset = -box.min.y; // Offset to place bottom at y=0
    
    // Position the original mesh so its bottom sits on the ground
    mesh.position.set(0, groundOffset, 0);
    
    // Update the mesh's world matrix after positioning so bounding calculations are correct
    mesh.updateMatrixWorld(true);
    scene.add(mesh);

    // Configuration for texture atlas generation 
    // Preserve current GUI settings if they exist, otherwise use defaults
    const atlasConfig = {
      textureSize: currentAtlasConfig?.textureSize || DEFAULT_ATLAS_CONFIG.textureSize,
      spritesPerSide: currentAtlasConfig?.spritesPerSide || DEFAULT_ATLAS_CONFIG.spritesPerSide,
      octahedralMode: currentAtlasConfig?.octahedralMode || DEFAULT_ATLAS_CONFIG.octahedralMode,
      cameraType: currentAtlasConfig?.cameraType || DEFAULT_ATLAS_CONFIG.cameraType,
    };
    
    console.log(`📋 Using atlas config for ${filename}:`, atlasConfig);

    // Set global references
    currentMesh = mesh;
    currentAtlasConfig = atlasConfig;

    // Create impostor AFTER the mesh is correctly positioned
    impostor = new OctahedralImpostor({
      renderer: renderer,
      target: mesh,
      octahedralMode: atlasConfig.octahedralMode,
      cameraType: atlasConfig.cameraType,
      transparent: true,
      disableBlending: DEFAULT_ATLAS_CONFIG.disableBlending,
      spritesPerSide: atlasConfig.spritesPerSide,
      textureSize: atlasConfig.textureSize,
      baseType: THREE.MeshLambertMaterial,
      smartConfig: {
        positioningMode: ImpostorPositioningMode.SMART,
        framingPreset: 'PRODUCT',
        autoScale: true,
        scaleMultiplier: 1.0,
        alignToGround: true,
        groundY: 0
      }
    });
    
    scene.add(impostor);

    // Hide original mesh, show impostor
    mesh.visible = false;
    impostor.visible = true;
    
    // If in orbital mode, center camera on impostor and apply restrictions
    if (currentControlMode === ControlMode.ORBITAL) {
      const impostorCenter = impostor.position.clone();
      const boundingSphere = impostor.smartPositioning?.boundingSphere;
      const paddingFactor = 1.5; // Default comfortable padding for FPS mode
      centerOrbitalCamera(orbitControls, impostorCenter, boundingSphere, orbitalCamera, paddingFactor);
      
      // Apply orbital control restrictions based on impostor mode
      updateOrbitalControlRestrictions();
    }

    console.log(`✅ Preset model "${filename}" loaded and impostor created`);
    
  } catch (error) {
    console.error(`Failed to load preset model "${filename}":`, error);
  }
}

function setupGUI(mesh: THREE.Object3D | null, impostorParam: OctahedralImpostor<THREE.MeshLambertMaterial> | null, atlasConfig: any) {
  const gui = new GUI();
  
  let alphaClampController: any;
  let hybridDistanceController: any;
  let debugWireframe: THREE.LineSegments | null = null;

  // Preset Models Section
  const presetFolder = gui.addFolder('Examples');
  
  // Model source links (hardcoded for now, can be easily swapped later)
  const MODEL_SOURCES = {
    'BattleAxe': 'https://sketchfab.com/3d-models/double-handed-axe-8a6f6cf656f2434cbc46d2f845d80446',
    'Sword': 'https://sketchfab.com/3d-models/medieval-sword-da574cba504e4b83a3293f3d3bd067fb',
    'Shield': 'https://sketchfab.com/3d-models/scutum-e84a98aa81a04c9b909f32fff917427f',
    'House': 'https://sketchfab.com/3d-models/medieval-watchtower-house-4099fd90094c400e987deb240078c38e',
    'Tree': 'https://sketchfab.com/3d-models/stylized-tree-8daa312234f04a59a216682981af500d',
    'JungleTree': 'https://sketchfab.com/3d-models/stylized-tree-113e4e48d4214b958d017157aeb6c8dd',
    'PirateShip': 'https://sketchfab.com/3d-models/pirate-ship-fe0ea2cee119476fb1a7524d5ff380dc'
  };

  // Create preset selection object
  const presetConfig = {
    selectedPreset: 'BattleAxe', // Default selection
    sourceLink: MODEL_SOURCES['BattleAxe'] // Initialize with default selection's link
  };
  
  // Create dropdown for preset selection
  const presetNames = PRESET_MODELS.reduce((acc, model) => {
    acc[model.name] = model.name;
    return acc;
  }, {} as Record<string, string>);
  
  presetFolder.add(presetConfig, 'selectedPreset', presetNames).name('Select Model').onChange((value) => {
    const selected = PRESET_MODELS.find(model => model.name === value);
    if (selected) {
      loadPresetModel(selected.filename);
      // Update the source link dynamically
      presetConfig.sourceLink = MODEL_SOURCES[value as keyof typeof MODEL_SOURCES];
    }
  });
  
  // Add dynamic source link text field (highlighted and clickable)
  const sourceLinkController = presetFolder.add(presetConfig, 'sourceLink').name('🔗 Model Source').listen();
  
  // Make only the label clickable to open the link (not the text field)
  const labelElement = sourceLinkController.domElement.querySelector('.name') as HTMLElement;
  const inputElement = sourceLinkController.domElement.querySelector('input') as HTMLInputElement;
  
  if (labelElement) {
    labelElement.addEventListener('click', () => {
      if (presetConfig.sourceLink) {
        window.open(presetConfig.sourceLink, '_blank');
      }
    });
    
    // Style only the label to look clickable
    labelElement.style.cursor = 'pointer';
    labelElement.style.color = '#4A90E2';
    labelElement.style.textDecoration = 'underline';
  }
  
  if (inputElement) {
    // Style the text field to be shadowed/low opacity but still interactable
    inputElement.style.opacity = '0.6';
    inputElement.style.cursor = 'text'; // Keep text cursor for interactability
  }
  
  presetFolder.open(); // Open by default

  // File Import Controls
  const importFolder = gui.addFolder('Custom Model');
  
  // Create hidden file input
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.glb,.gltf';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);
  
  fileInput.addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      await loadModelFromFile(file, currentMesh, impostor, currentAtlasConfig);
    }
  });
  
  importFolder.add({
    selectFile: () => fileInput.click()
  }, 'selectFile').name('📂 Select GLB/GLTF File');
  
  // Drag and drop info
  importFolder.add({
    info: 'Drag & drop GLB/GLTF files anywhere!'
  }, 'info').name('💡').disable();
  
  importFolder.close(); // Explicitly collapse

  // Texture Import Controls
  const textureImportFolder = gui.addFolder('Impostor Import');
  
  // Create texture loader
  const textureLoader = new THREE.TextureLoader();
  
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
  
  // Generate button
  textureImportFolder.add(textureImportConfig, 'generateFromTextures').name('🚀 Generate Impostor');
  
  textureImportFolder.close(); // Explicitly collapse

  // Setup drag and drop
  setupDragAndDrop();
  
  // Add proper directional light for orbital mode (like the original example)
  const directionalLight = new THREE.DirectionalLight('white', 3);
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
  lightPosition.update(); // Initialize light position
  scene.add(directionalLight);
  
  function createDebugWireframe() {
    // Create a wireframe geometry that matches the impostor plane
    const geometry = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1));
    const material = new THREE.LineBasicMaterial({ 
      color: 0xff0000, 
      linewidth: 2,
      transparent: true,
      opacity: 0.8
    });
    
    const wireframe = new THREE.LineSegments(geometry, material);
    
    // Match the impostor's transform
    wireframe.position.copy(impostor.position);
    wireframe.scale.copy(impostor.scale);
    wireframe.rotation.copy(impostor.rotation);
    
    return wireframe;
  }
  
  function updateDebugWireframe() {
    if (debugWireframe) {
      debugWireframe.position.copy(impostor.position);
      debugWireframe.scale.copy(impostor.scale);
      
      // Calculate the rotation to face the camera horizontally (same as impostor)
      const cameraPos = fpsController.position;
      const impostorPos = impostor.position;
      
      // Get horizontal direction from impostor to camera (Y = 0)
      const direction = new THREE.Vector3(
        cameraPos.x - impostorPos.x,
        0,
        cameraPos.z - impostorPos.z
      ).normalize();
      
      // Calculate Y rotation to face the camera
      const targetRotationY = Math.atan2(direction.x, direction.z);
      
      // Apply the rotation
      debugWireframe.rotation.set(0, targetRotationY, 0);
    }
  }
  
  function regenerateImpostor() {
    if (!currentMesh || !impostor || !currentAtlasConfig) {
      console.warn('Cannot regenerate: no mesh, impostor, or atlas config loaded');
      return;
    }

    console.log('Starting regeneration...');
    
    // Store hybridDistance value before removing old impostor
    const currentHybridDistance = impostor.material.octahedralImpostorUniforms?.hybridDistance?.value ?? 2.0;
    
    // Remove old impostor and debug wireframe
    scene.remove(impostor);
    if (debugWireframe) {
      scene.remove(debugWireframe);
      debugWireframe = null;
    }
    
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
        octahedralMode: currentAtlasConfig.octahedralMode,
        cameraType: currentAtlasConfig.cameraType,
        transparent: materialConfig.transparent,
        disableBlending: materialConfig.disableBlending,
        spritesPerSide: currentAtlasConfig.spritesPerSide,
        textureSize: currentAtlasConfig.textureSize,
        baseType: THREE.MeshLambertMaterial,
        smartConfig: {
          positioningMode: ImpostorPositioningMode.SMART,
          framingPreset: 'PRODUCT',
          autoScale: true,
          scaleMultiplier: 1.0,
          alignToGround: true,
          groundY: 0
        }
      });
      
      scene.add(impostor);
      
      // Recreate debug wireframe if it was enabled
      if (debugConfig.showQuadOutline) {
        debugWireframe = createDebugWireframe();
        scene.add(debugWireframe);
      }
      
      // Hide original mesh and show impostor based on config
      currentMesh.visible = !config.showImpostor;
      impostor.visible = config.showImpostor;
      
      // If in orbital mode, center camera on impostor
      if (currentControlMode === ControlMode.ORBITAL) {
        const impostorCenter = impostor.position.clone();
        const boundingSphere = impostor.smartPositioning?.boundingSphere;
        const paddingFactor = 1.5; // Default comfortable padding for FPS mode
        centerOrbitalCamera(orbitControls, impostorCenter, boundingSphere, orbitalCamera, paddingFactor);
      }
      
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
      
      console.log(`✅ Regenerated texture atlas: ${currentAtlasConfig.textureSize}px, ${currentAtlasConfig.spritesPerSide}x${currentAtlasConfig.spritesPerSide} frames (${currentAtlasConfig.spritesPerSide * currentAtlasConfig.spritesPerSide} total angles)`);
    } catch (error) {
      console.error('❌ Error during regeneration:', error);
      // Fallback: ensure mesh is visible if impostor creation fails
      currentMesh.visible = true;
    }
  }
  
  // Add regenerate function to currentAtlasConfig if it exists, otherwise create it if needed
  if (currentAtlasConfig) {
    currentAtlasConfig.regenerate = regenerateImpostor;
  } else if (atlasConfig) {
    atlasConfig.regenerate = regenerateImpostor;
    currentAtlasConfig = atlasConfig;
  }
  
  // Info display
  const infoDisplay = {
    totalAngles: (currentAtlasConfig || atlasConfig)?.spritesPerSide * (currentAtlasConfig || atlasConfig)?.spritesPerSide || 0,
    atlasInfo: currentAtlasConfig || atlasConfig ? `${(currentAtlasConfig || atlasConfig).textureSize}px, ${(currentAtlasConfig || atlasConfig).spritesPerSide}x${(currentAtlasConfig || atlasConfig).spritesPerSide}` : 'No model loaded',
    octahedralMode: (currentAtlasConfig || atlasConfig)?.octahedralMode === OctahedralMode.HEMISPHERICAL ? 'Hemispherical' : 'Full Spherical',
    updateInfo: function() {
      const config = currentAtlasConfig || atlasConfig;
      if (config) {
        this.totalAngles = config.spritesPerSide * config.spritesPerSide;
        this.atlasInfo = `${config.textureSize}px, ${config.spritesPerSide}x${config.spritesPerSide}`;
        this.octahedralMode = config.octahedralMode === OctahedralMode.HEMISPHERICAL ? 'Hemispherical' : 'Full Spherical';
      } else {
        this.totalAngles = 0;
        this.atlasInfo = 'No model loaded';
        this.octahedralMode = 'N/A';
      }
    }
  };
  
  // Dynamic material settings (no regeneration needed)
  const materialConfig = {
    transparent: true,
    disableBlending: DEFAULT_ATLAS_CONFIG.disableBlending
  };
  
  // Debug configuration
  const debugConfig = {
    showQuadOutline: false
  };
  
  // Display controls
  const config = { 
    showImpostor: true
  };
  
  // Texture Atlas Generation Settings
  const atlasFolder = gui.addFolder('Texture Atlas Settings');
  
  // Use currentAtlasConfig if available, otherwise create default values for GUI
  const atlasConfigForGUI = currentAtlasConfig || atlasConfig || {
    textureSize: 4096,
    spritesPerSide: 32,
    octahedralMode: OctahedralMode.HEMISPHERICAL,
    regenerate: () => {
      if (currentAtlasConfig && currentAtlasConfig.regenerate) {
        currentAtlasConfig.regenerate();
      } else {
        console.warn('No model loaded to regenerate');
      }
    }
  };
  
  atlasFolder.add(atlasConfigForGUI, 'textureSize', [128, 256, 512, 1024, 2048, 4096, 8192]).name('Resolution (px)').onChange(() => {
    if (currentAtlasConfig) currentAtlasConfig.textureSize = atlasConfigForGUI.textureSize;
    infoDisplay.updateInfo();
    console.log(`Texture size changed to: ${atlasConfigForGUI.textureSize}px`);
  });
  atlasFolder.add(atlasConfigForGUI, 'spritesPerSide', [4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64]).name('Frames per Side').onChange(() => {
    if (currentAtlasConfig) currentAtlasConfig.spritesPerSide = atlasConfigForGUI.spritesPerSide;
    infoDisplay.updateInfo();
    const totalFrames = atlasConfigForGUI.spritesPerSide * atlasConfigForGUI.spritesPerSide;
    console.log(`Frames changed to: ${atlasConfigForGUI.spritesPerSide}x${atlasConfigForGUI.spritesPerSide} (${totalFrames} angles)`);
  });
  atlasFolder.add(atlasConfigForGUI, 'octahedralMode', {
    'Hemispherical': OctahedralMode.HEMISPHERICAL,
    'Spherical': OctahedralMode.SPHERICAL
  }).name('Octahedral Mode').onChange((value: OctahedralMode) => {
    if (currentAtlasConfig) currentAtlasConfig.octahedralMode = value;
    const mode = value === OctahedralMode.HEMISPHERICAL ? 'Hemispherical (upper hemisphere only)' : 'Full Spherical (360° coverage)';
    console.log(`Octahedral mode changed to: ${mode}`);
    infoDisplay.updateInfo();
    
    // Update orbital controls restrictions if in orbital mode
    if (currentControlMode === ControlMode.ORBITAL) {
      updateOrbitalControlRestrictions();
      orbitControls.update();
    }
  });
  
  // Add cameraType to atlasConfigForGUI if it doesn't exist
  if (!('cameraType' in atlasConfigForGUI)) {
    atlasConfigForGUI.cameraType = CameraType.ORTHOGRAPHIC;
  }
  
  atlasFolder.add(atlasConfigForGUI, 'cameraType', {
    'Orthographic': CameraType.ORTHOGRAPHIC,
    'Perspective': CameraType.PERSPECTIVE
  }).name('Camera Type').onChange((value: CameraType) => {
    if (currentAtlasConfig) currentAtlasConfig.cameraType = value;
    const type = value === CameraType.ORTHOGRAPHIC ? 'Orthographic (no perspective distortion)' : 'Perspective (with perspective distortion)';
    console.log(`Camera type changed to: ${type}`);
  });
  atlasFolder.add(infoDisplay, 'totalAngles').name('📊 Total Angles').listen().disable();
  atlasFolder.add(infoDisplay, 'atlasInfo').name('📏 Current Atlas').listen().disable();
  atlasFolder.add(infoDisplay, 'octahedralMode').name('🌐 Mode').listen().disable();
  atlasFolder.add(atlasConfigForGUI, 'regenerate').name('🔄 Regenerate Atlas');
  atlasFolder.open(); // Keep open for easy access
  
  // Material Settings
  const materialFolder = gui.addFolder('Render settings');
  
  // Only add impostor-specific controls if impostor exists
  if (impostor) {
    alphaClampController = materialFolder.add(impostor.material.octahedralImpostorUniforms.alphaClamp, 'value', 0, 0.5, 0.01).name('Alpha Clamp');
    
    // Only show elevation threshold in FPS mode (not in orbital mode)
    if (currentControlMode === ControlMode.FPS) {
      hybridDistanceController = materialFolder.add(impostor.material.octahedralImpostorUniforms.hybridDistance, 'value', 0, 10, 0.1).name('Elevation Threshold');
    }
  }
  
  // Dynamic material controls (no regeneration needed)
  materialFolder.add(materialConfig, 'transparent').name('Transparent').onChange((value) => {
    if (impostor) {
      impostor.material.transparent = value;
      impostor.material.needsUpdate = true;
    }
  });
  materialFolder.add(materialConfig, 'disableBlending').name('Disable Triplanar Blending').onChange((value) => {
    if (impostor) {
      impostor.material.octahedralImpostorUniforms.disableBlending.value = value ? 1.0 : 0.0;
    }
  });
  
  materialFolder.add(config, 'showImpostor').onChange((value) => {
    if (currentMesh) currentMesh.visible = !value;
    if (impostor) impostor.visible = value;
  });
  
  // Export functionality
  const exportFolder = gui.addFolder('Export Texture Atlas');
  const exportConfig = {
    exportAlbedo: () => {
      if (!impostor) {
        console.warn('No impostor loaded for export');
        return;
      }
      const albedoTexture = impostor.material.map;
      if (albedoTexture && currentAtlasConfig) {
        exportTextureAsPNG(renderer, albedoTexture, `albedo_${currentAtlasConfig.textureSize}px_${currentAtlasConfig.spritesPerSide}x${currentAtlasConfig.spritesPerSide}`);
      } else {
        console.warn('Albedo texture not available for export');
      }
    },
    exportNormalDepth: () => {
      if (!impostor) {
        console.warn('No impostor loaded for export');
        return;
      }
      const normalTexture = impostor.material.normalMap;
      if (normalTexture && currentAtlasConfig) {
        exportTextureAsPNG(renderer, normalTexture, `normalDepth_${currentAtlasConfig.textureSize}px_${currentAtlasConfig.spritesPerSide}x${currentAtlasConfig.spritesPerSide}`);
      } else {
        console.warn('Normal/Depth texture not available for export');
      }
    }
  };
  exportFolder.add(exportConfig, 'exportAlbedo').name('📤 Export Albedo PNG');
  exportFolder.add(exportConfig, 'exportNormalDepth').name('📤 Export Normal/Depth PNG');
  
  // Camera Control Mode
  const controlConfig = {
    controlMode: currentControlMode,
    switchMode: (mode: string) => {
      switchControlMode(mode as ControlMode);
      controlConfig.controlMode = mode as ControlMode;
    }
  };
  
  const controlFolder = gui.addFolder('Orbit/First person');
  controlFolder.add(controlConfig, 'controlMode', [ControlMode.FPS, ControlMode.ORBITAL]).name('Control Mode').onChange((value) => {
    controlConfig.switchMode(value);
  });
  
  // FPS Camera controls (integrated)
  if (fpsController) {
    controlFolder.add(fpsController, 'moveSpeed', 1, 20, 0.5).name('Move Speed');
    controlFolder.add(fpsController, 'jumpVelocity', 5, 50, 0.5).name('Jump Velocity');
    controlFolder.add(fpsController, 'gravityForce', 10, 50, 1).name('Gravity');
  }
  
  controlFolder.close(); // Explicitly collapse

  // Directional Light controls (for orbital mode, like the original example)
  const lightFolder = gui.addFolder('Lighting');
  lightFolder.add(directionalLight, 'intensity', 0, 10, 0.01).name('Intensity');
  lightFolder.add(lightPosition, 'azimuth', -180, 180, 1).name('Azimuth').onChange(() => lightPosition.update());
  lightFolder.add(lightPosition, 'elevation', -90, 90, 1).name('Elevation').onChange(() => lightPosition.update());
  lightFolder.close(); // Explicitly collapse

  // Debug controls
  const debugFolder = gui.addFolder('Debug');
  debugFolder.add(debugConfig, 'showQuadOutline').name('Show Impostor Outline').onChange((value) => {
    if (value) {
      if (!debugWireframe) {
        debugWireframe = createDebugWireframe();
        scene.add(debugWireframe);
      }
    } else {
      if (debugWireframe) {
        scene.remove(debugWireframe);
        debugWireframe = null;
      }
    }
  });
  
  // Fix pointer lock issue with GUI
  setupGUIPointerLockFix(gui);
  
  // Update debug wireframe in animation loop
  return updateDebugWireframe;
}

function setupGUIPointerLockFix(gui: GUI) {
  const guiDomElement = gui.domElement;
  let isGUIActive = false;
  

  
  // Update status indicator based on current mode
  function updateStatusIndicatorLocal() {
    // Status indicator removed
  }

  // Track GUI interaction more robustly
  function setGUIActive(active: boolean) {
    isGUIActive = active;
    if (active) {
      // Exit pointer lock when GUI becomes active
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    }
  }
  
  // Assign to global variable so it can be called from switchControlMode
  updateStatusIndicator = updateStatusIndicatorLocal;
  
  // Track mouse over GUI with improved detection
  guiDomElement.addEventListener('mouseenter', () => setGUIActive(true));
  guiDomElement.addEventListener('mouseleave', () => setGUIActive(false));
  
  // Also track focus events on GUI inputs
  guiDomElement.addEventListener('focusin', () => setGUIActive(true));
  guiDomElement.addEventListener('focusout', () => setGUIActive(false));
  
  // Prevent pointer lock when clicking on GUI
  guiDomElement.addEventListener('click', (event) => {
    event.stopPropagation();
    setGUIActive(true);
  });
  
  // Global click handler for pointer lock (only in FPS mode)
  document.addEventListener('click', (event) => {
    // Don't request pointer lock if clicking on GUI, GUI is active, or not in FPS mode
    if (isGUIActive || guiDomElement.contains(event.target as Node) || currentControlMode !== ControlMode.FPS) {
      return;
    }
    
    // Request pointer lock only in FPS mode
    renderer.domElement.requestPointerLock();
  });
  

  
  // ESC key to exit pointer lock
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Escape' && document.pointerLockElement) {
      document.exitPointerLock();
    }
  });
  
  // Override FPS controller's pointer lock to disable automatic locking
  fpsController.setupPointerLock = function() {
    const lockChangeEvent = () => {
      const doc = this.domElement.ownerDocument;
      if (doc.pointerLockElement === this.domElement) {
        this.isLocked = true;
      } else {
        this.isLocked = false;
      }
    };

    const moveCallback = (event: MouseEvent) => {
      if (!this.isLocked) return;

      const movementX = event.movementX || 0;
      const movementY = event.movementY || 0;

      this.yawObject.rotation.y -= movementX * 0.002;
      this.pitchObject.rotation.x -= movementY * 0.002;
      
      // Clamp the pitch to avoid flipping
      this.pitchObject.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitchObject.rotation.x));
    };

    document.addEventListener('pointerlockchange', lockChangeEvent, false);
    document.addEventListener('mousemove', moveCallback, false);
  };
  
  // Re-setup pointer lock with the new logic
  fpsController.setupPointerLock();
}

function animate(time: number) {
  // Begin stats measurement
  stats.begin();

  const deltaTime = (time - lastTime) / 1000;
  lastTime = time;

  // Step physics world
  physics.world.step();

  // Update based on control mode
  if (currentControlMode === ControlMode.FPS) {
    // Update input handler
    inputHandler.update();

    // Update FPS controller
    fpsController.update(deltaTime);

    // Update debug wireframe position to match impostor (FPS mode uses FPS controller position)
    if (updateDebugWireframe) {
      updateDebugWireframe();
    }


  } else {
    // Update orbital controls
    orbitControls.update();


  }

  // Render scene
  renderer.render(scene, camera);

  // End stats measurement
  stats.end();

  requestAnimationFrame(animate);
}

function onWindowResize() {
  const aspect = window.innerWidth / window.innerHeight;
  
  // Update FPS camera (perspective)
  fpsCamera.aspect = aspect;
  fpsCamera.updateProjectionMatrix();
  
  // Update orbital camera (orthographic)
  orbitalCamera.left = frustumSize * aspect / -2;
  orbitalCamera.right = frustumSize * aspect / 2;
  orbitalCamera.top = frustumSize / 2;
  orbitalCamera.bottom = frustumSize / -2;
  orbitalCamera.updateProjectionMatrix();
  
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Start the game
init().catch(console.error);
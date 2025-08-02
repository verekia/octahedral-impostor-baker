import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'lil-gui';
import Stats from 'stats.js';
import { OctahedralImpostor, exportTextureAsPNG } from '../src/index.js';
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

// Control mode state
let currentControlMode: ControlMode = ControlMode.FPS;
let fpsController: FPSController;
let orbitControls: OrbitControls;
let inputHandler: InputHandler;
let lastTime = 0;
let impostor: OctahedralImpostor<THREE.MeshLambertMaterial>;
let updateDebugWireframe: (() => void) | null = null;
let updateStatusIndicator: (() => void) | null = null;

// Add debug stats display
const statsContainer = document.createElement('div');
statsContainer.style.position = 'absolute';
statsContainer.style.bottom = '10px';
statsContainer.style.right = '10px';
statsContainer.style.color = 'white';
statsContainer.style.fontFamily = 'monospace';
statsContainer.style.fontSize = '12px';
statsContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
statsContainer.style.padding = '5px';
statsContainer.style.borderRadius = '3px';
document.body.appendChild(statsContainer);

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
  const ground = createGround(physics);
  scene.add(ground);

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
  orbitControls.maxPolarAngle = Math.PI / 2;
  orbitControls.enabled = false; // Start disabled

  // Initialize input handler
  inputHandler = new InputHandler();

  // Start with FPS mode
  switchControlMode(ControlMode.FPS);

  // Add help message to console
  console.log("Controls:");
  console.log("- WASD/Arrow Keys: Move");
  console.log("- Space: Jump");
  console.log("- Mouse: Look around (click to lock pointer)");

  // Handle window resize
  window.addEventListener('resize', onWindowResize);

  // Load the tree model and create impostor
  await loadTreeAndCreateImpostor();

  // Start animation loop
  requestAnimationFrame(animate);
}

// Function to switch between control modes
function switchControlMode(mode: ControlMode) {
  currentControlMode = mode;
  
  if (mode === ControlMode.FPS) {
    // Switch to FPS mode
    camera = fpsCamera;
    orbitControls.enabled = false;
    
    // Set background for FPS mode
    scene.background = new THREE.Color(0x87CEEB);
    renderer.setClearColor(0x87CEEB, 1);
    
    console.log("Switched to FPS mode - Click to enable mouse look");
  } else {
    // Switch to orbital mode  
    camera = orbitalCamera;
    orbitControls.enabled = true;
    orbitControls.update();
    
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

async function loadTreeAndCreateImpostor() {
  const loader = new GLTFLoader();
  
  try {
    const gltf = await new Promise<any>((resolve, reject) => {
      loader.load('tree.glb', resolve, undefined, reject);
    });
    
    const mesh = gltf.scene;
    
    // Calculate the bounding box to position the tree correctly on the ground
    const box = new THREE.Box3().setFromObject(mesh);
    const groundOffset = -box.min.y; // Offset to place bottom at y=0
    
    // Position the original mesh so its bottom sits on the ground
    mesh.position.set(0, groundOffset, 0);
    
    // Update the mesh's world matrix after positioning so bounding calculations are correct
    mesh.updateMatrixWorld(true);
    scene.add(mesh);

    // Configuration for texture atlas generation (matching original example)
    const atlasConfig = {
      textureSize: 8192,
      spritesPerSide: 16,
      useHemiOctahedron: true,
    };

    // Create impostor AFTER the mesh is correctly positioned
    // This way the bounding sphere calculation will use the correct position
    impostor = new OctahedralImpostor({
      renderer: renderer,
      target: mesh,
      useHemiOctahedron: atlasConfig.useHemiOctahedron,
      transparent: true,
      disableBlending: false,
      spritesPerSide: atlasConfig.spritesPerSide,
      textureSize: atlasConfig.textureSize,
      baseType: THREE.MeshLambertMaterial
    });
    
    scene.add(impostor);

    // Hide original mesh, show impostor
    mesh.visible = false;
    impostor.visible = true;

    console.log('Octahedral impostor created at world origin');
    
    // Setup GUI and get debug wireframe update function
    updateDebugWireframe = setupGUI(mesh, impostor, atlasConfig);
    
  } catch (error) {
    console.error('Failed to load tree model:', error);
  }
}

function setupGUI(mesh: THREE.Object3D, impostor: OctahedralImpostor<THREE.MeshLambertMaterial>, atlasConfig: any) {
  const gui = new GUI();
  
  let alphaClampController: any;
  let hybridDistanceController: any;
  let debugWireframe: THREE.LineSegments | null = null;
  
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
    console.log('Starting regeneration...');
    
    // Store hybridDistance value before removing old impostor
    const currentHybridDistance = impostor.material.octahedralImpostorUniforms?.hybridDistance?.value ?? 2.5;
    
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
        baseType: THREE.MeshLambertMaterial
      });
      
      scene.add(impostor);
      
      // Recreate debug wireframe if it was enabled
      if (debugConfig.showQuadOutline) {
        debugWireframe = createDebugWireframe();
        scene.add(debugWireframe);
      }
      
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
  
  // Add regenerate function to atlasConfig
  atlasConfig.regenerate = regenerateImpostor;
  
  // Info display
  const infoDisplay = {
    totalAngles: atlasConfig.spritesPerSide * atlasConfig.spritesPerSide,
    atlasInfo: `${atlasConfig.textureSize}px, ${atlasConfig.spritesPerSide}x${atlasConfig.spritesPerSide}`,
    octahedralMode: atlasConfig.useHemiOctahedron ? 'Hemispherical' : 'Full Spherical',
    updateInfo: function() {
      this.totalAngles = atlasConfig.spritesPerSide * atlasConfig.spritesPerSide;
      this.atlasInfo = `${atlasConfig.textureSize}px, ${atlasConfig.spritesPerSide}x${atlasConfig.spritesPerSide}`;
      this.octahedralMode = atlasConfig.useHemiOctahedron ? 'Hemispherical' : 'Full Spherical';
    }
  };
  
  // Dynamic material settings (no regeneration needed)
  const materialConfig = {
    transparent: true,
    disableBlending: false
  };
  
  // Debug configuration
  const debugConfig = {
    showQuadOutline: false
  };
  
  // Display controls
  const config = { 
    showImpostor: true
  };
  
  // Camera Control Mode
  const controlConfig = {
    controlMode: currentControlMode,
    switchMode: (mode: string) => {
      switchControlMode(mode as ControlMode);
      controlConfig.controlMode = mode;
    }
  };
  
  const controlFolder = gui.addFolder('Camera Controls');
  controlFolder.add(controlConfig, 'controlMode', [ControlMode.FPS, ControlMode.ORBITAL]).name('Control Mode').onChange((value) => {
    controlConfig.switchMode(value);
  });
  controlFolder.open();
  
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
  atlasFolder.add(atlasConfig, 'useHemiOctahedron').name('Hemispherical Mode').onChange(() => {
    const mode = atlasConfig.useHemiOctahedron ? 'Hemispherical (upper hemisphere only)' : 'Full Spherical (360° coverage)';
    console.log(`Octahedral mode changed to: ${mode}`);
    infoDisplay.updateInfo();
  });
  atlasFolder.add(infoDisplay, 'totalAngles').name('📊 Total Angles').listen().disable();
  atlasFolder.add(infoDisplay, 'atlasInfo').name('📏 Current Atlas').listen().disable();
  atlasFolder.add(infoDisplay, 'octahedralMode').name('🌐 Mode').listen().disable();
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
  
  hybridDistanceController = materialFolder.add(impostor.material.octahedralImpostorUniforms.hybridDistance, 'value', 0, 50, 0.5).name('Hybrid Distance');
  
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
  
  // Directional Light controls (for orbital mode, like the original example)
  const lightFolder = gui.addFolder('Directional Light');
  lightFolder.add(directionalLight, 'intensity', 0, 10, 0.01).name('Intensity');
  lightFolder.add(lightPosition, 'azimuth', -180, 180, 1).name('Azimuth').onChange(() => lightPosition.update());
  lightFolder.add(lightPosition, 'elevation', -90, 90, 1).name('Elevation').onChange(() => lightPosition.update());

  // Camera controls
  const cameraFolder = gui.addFolder('FPS Camera');
  cameraFolder.add(fpsController, 'moveSpeed', 1, 20, 0.5).name('Move Speed');
  cameraFolder.add(fpsController, 'jumpVelocity', 5, 50, 0.5).name('Jump Velocity');
  cameraFolder.add(fpsController, 'gravityForce', 10, 50, 1).name('Gravity');
  
  // Fix pointer lock issue with GUI
  setupGUIPointerLockFix(gui);
  
  // Update debug wireframe in animation loop
  return updateDebugWireframe;
}

function setupGUIPointerLockFix(gui: GUI) {
  const guiDomElement = gui.domElement;
  let isGUIActive = false;
  
  // Create status indicator
  const statusIndicator = document.createElement('div');
  statusIndicator.style.position = 'absolute';
  statusIndicator.style.top = '10px';
  statusIndicator.style.left = '10px';
  statusIndicator.style.padding = '8px 12px';
  statusIndicator.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  statusIndicator.style.color = 'white';
  statusIndicator.style.fontFamily = 'monospace';
  statusIndicator.style.fontSize = '12px';
  statusIndicator.style.borderRadius = '4px';
  statusIndicator.style.zIndex = '10000';
  statusIndicator.textContent = 'Click to enable mouse look';
  document.body.appendChild(statusIndicator);
  
  // Update status indicator based on current mode
  function updateStatusIndicatorLocal() {
    if (currentControlMode === ControlMode.FPS) {
      if (isGUIActive) {
        statusIndicator.textContent = 'GUI Active - Click outside to enable mouse look';
        statusIndicator.style.backgroundColor = 'rgba(255, 165, 0, 0.7)';
      } else if (document.pointerLockElement === renderer.domElement) {
        statusIndicator.textContent = 'FPS Mode - Mouse Look Active (ESC to exit)';
        statusIndicator.style.backgroundColor = 'rgba(0, 128, 0, 0.7)';
      } else {
        statusIndicator.textContent = 'FPS Mode - Click to enable mouse look';
        statusIndicator.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
      }
    } else {
      statusIndicator.textContent = 'Orbital Mode - Use mouse to orbit camera';
      statusIndicator.style.backgroundColor = 'rgba(0, 100, 200, 0.7)';
    }
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
    updateStatusIndicatorLocal();
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
  
  // Update status based on pointer lock state
  document.addEventListener('pointerlockchange', () => {
    updateStatusIndicatorLocal();
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

    // Update stats display
    const playerPos = fpsController.position;
    statsContainer.innerHTML = 
      `FPS: ${Math.round(1 / deltaTime)}<br>` +
      `Mode: FPS<br>` +
      `Position: ${playerPos.x.toFixed(1)}, ${playerPos.y.toFixed(1)}, ${playerPos.z.toFixed(1)}<br>` +
      `Physics Bodies: ${physics.rigidBodies.size}`;
  } else {
    // Update orbital controls
    orbitControls.update();

    // Update stats display
    const cameraPos = camera.position;
    statsContainer.innerHTML = 
      `FPS: ${Math.round(1 / deltaTime)}<br>` +
      `Mode: Orbital<br>` +
      `Camera: ${cameraPos.x.toFixed(1)}, ${cameraPos.y.toFixed(1)}, ${cameraPos.z.toFixed(1)}`;
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
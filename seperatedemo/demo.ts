import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'lil-gui';
import Stats from 'stats.js';
import { OctahedralImpostor, createOctahedralImpostorMaterial } from './octahedral-rendering.js';
import { FPSController } from './src/controllers/FPSController.js';
import { createGround } from './src/objects/Ground.js';
import { setupLights } from './src/utils/Lights.js';
import { InputHandler } from './src/input/InputHandler.js';

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
let impostor: OctahedralImpostor<THREE.MeshLambertMaterial> | null = null;
let updateDebugWireframe: (() => void) | null = null;
let updateStatusIndicator: (() => void) | null = null;

// Texture loading state
let albedoTexture: THREE.Texture | null = null;
let normalDepthTexture: THREE.Texture | null = null;
let texturesLoaded = false;

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

  // Setup GUI
  setupGUI();

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

// Load texture files
async function loadTextures(albedoPath: string, normalDepthPath: string): Promise<void> {
  const textureLoader = new THREE.TextureLoader();
  
  return new Promise((resolve, reject) => {
    let loadedCount = 0;
    const totalTextures = 2;
    
    function onLoad() {
      loadedCount++;
      if (loadedCount === totalTextures) {
        texturesLoaded = true;
        console.log('✅ Textures loaded successfully');
        resolve();
      }
    }
    
    function onError(error: any) {
      console.error('❌ Failed to load texture:', error);
      reject(error);
    }
    
    // Load albedo texture
    textureLoader.load(
      albedoPath,
      (texture) => {
        albedoTexture = texture;
        onLoad();
      },
      undefined,
      onError
    );
    
    // Load normal-depth texture
    textureLoader.load(
      normalDepthPath,
      (texture) => {
        normalDepthTexture = texture;
        onLoad();
      },
      undefined,
      onError
    );
  });
}

// Create impostor with loaded textures
function createImpostor() {
  if (!texturesLoaded || !albedoTexture || !normalDepthTexture) {
    console.warn('❌ Cannot create impostor: textures not loaded');
    return;
  }

  // Remove old impostor if it exists
  if (impostor) {
    scene.remove(impostor);
    if (impostor.material.map) impostor.material.map.dispose();
    if (impostor.material.normalMap) impostor.material.normalMap.dispose();
    impostor.material.dispose();
  }

  try {
    // Configuration for impostor creation
    const config = {
      useHemiOctahedron: true,
      spritesPerSide: 12, // This should match your pregenerated atlas
      transparent: true,
      disableBlending: false,
      alphaClamp: 0.1,
      hybridDistance: 0.1
    };

    // Create impostor using static method
    impostor = OctahedralImpostor.createWithTextures(
      {
        baseType: THREE.MeshLambertMaterial,
        useHemiOctahedron: config.useHemiOctahedron,
        spritesPerSide: config.spritesPerSide,
        transparent: config.transparent,
        disableBlending: config.disableBlending,
        alphaClamp: config.alphaClamp,
        hybridDistance: config.hybridDistance
      },
      albedoTexture,
      normalDepthTexture,
      4, // Scale factor - adjust as needed
      { x: 0, y: 2, z: 0 } // Position at origin, slightly elevated
    );
    
    scene.add(impostor);
    
    console.log('✅ Octahedral impostor created at origin');
    
  } catch (error) {
    console.error('❌ Error creating impostor:', error);
  }
}

function setupGUI() {
  const gui = new GUI();
  
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
    if (!impostor) return null;
    
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
  
  function updateDebugWireframeFunc() {
    if (debugWireframe && impostor) {
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
  
  updateDebugWireframe = updateDebugWireframeFunc;
  
  // Camera Control Mode
  const controlConfig = {
    controlMode: currentControlMode,
    switchMode: (mode: string) => {
      switchControlMode(mode as ControlMode);
      controlConfig.controlMode = mode as ControlMode;
    }
  };
  
  const controlFolder = gui.addFolder('Camera Controls');
  controlFolder.add(controlConfig, 'controlMode', [ControlMode.FPS, ControlMode.ORBITAL]).name('Control Mode').onChange((value) => {
    controlConfig.switchMode(value);
  });
  controlFolder.open();
  
  // Texture Loading Settings
  const textureConfig = {
    albedoPath: './textures/albedo_2048px_12x12.png',
    normalDepthPath: './textures/normalDepth_2048px_12x12.png',
    loadTextures: async () => {
      try {
        console.log('🔄 Loading textures...');
        await loadTextures(textureConfig.albedoPath, textureConfig.normalDepthPath);
        console.log('✅ Textures loaded');
      } catch (error) {
        console.error('❌ Failed to load textures:', error);
      }
    },
    renderImpostor: () => {
      createImpostor();
    }
  };
  
  const textureFolder = gui.addFolder('Texture Loading');
  textureFolder.add(textureConfig, 'albedoPath').name('Albedo Texture Path');
  textureFolder.add(textureConfig, 'normalDepthPath').name('Normal/Depth Texture Path');
  textureFolder.add(textureConfig, 'loadTextures').name('🔄 Load Textures');
  textureFolder.add(textureConfig, 'renderImpostor').name('🎯 Render Impostor');
  textureFolder.open();
  
  // Material Settings (only available after impostor is created)
  const materialFolder = gui.addFolder('Material Settings');
  
  const materialConfig = {
    get alphaClamp() {
      return impostor?.material.octahedralImpostorUniforms?.alphaClamp?.value ?? 0.1;
    },
    set alphaClamp(value: number) {
      if (impostor?.material.octahedralImpostorUniforms?.alphaClamp) {
        impostor.material.octahedralImpostorUniforms.alphaClamp.value = value;
      }
    },
    get transparent() {
      return impostor?.material.transparent ?? true;
    },
    set transparent(value: boolean) {
      if (impostor) {
        impostor.material.transparent = value;
        impostor.material.needsUpdate = true;
      }
    },
    get disableBlending() {
      return impostor?.material.octahedralImpostorUniforms?.disableBlending?.value === 1.0;
    },
    set disableBlending(value: boolean) {
      if (impostor?.material.octahedralImpostorUniforms?.disableBlending) {
        impostor.material.octahedralImpostorUniforms.disableBlending.value = value ? 1.0 : 0.0;
      }
    },
    get hybridDistance() {
      return impostor?.material.octahedralImpostorUniforms?.hybridDistance?.value ?? 0.1;
    },
    set hybridDistance(value: number) {
      if (impostor?.material.octahedralImpostorUniforms?.hybridDistance) {
        impostor.material.octahedralImpostorUniforms.hybridDistance.value = value;
      }
    },
    get visible() {
      return impostor?.visible ?? false;
    },
    set visible(value: boolean) {
      if (impostor) {
        impostor.visible = value;
      }
    }
  };
  
  materialFolder.add(materialConfig, 'alphaClamp', 0, 0.5, 0.01).name('Alpha Clamp');
  materialFolder.add(materialConfig, 'transparent').name('Transparent');
  materialFolder.add(materialConfig, 'disableBlending').name('Disable Triplanar Blending');
  materialFolder.add(materialConfig, 'hybridDistance', 0, 10, 0.1).name('Elevation Threshold');
  materialFolder.add(materialConfig, 'visible').name('Show Impostor');
  
  // Debug controls
  const debugConfig = {
    showQuadOutline: false
  };
  
  const debugFolder = gui.addFolder('Debug');
  debugFolder.add(debugConfig, 'showQuadOutline').name('Show Impostor Outline').onChange((value) => {
    if (value) {
      if (!debugWireframe && impostor) {
        debugWireframe = createDebugWireframe();
        if (debugWireframe) {
          scene.add(debugWireframe);
        }
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
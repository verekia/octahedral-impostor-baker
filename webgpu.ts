import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  uniform,
  texture,
  uv,
  mix,
  normalize,
  dot,
  clamp,
  vec3,
  vec2,
  vec4,
  float,
  mul,
  add,
  sub,
  length,
  fract,
  step,
  Fn,
  positionLocal,
  transformedNormalView,
  cameraPosition,
  modelWorldMatrix,
  instanceIndex,
} from "three/tsl";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface SimpleImpostorUniforms {
  spritesPerSide: { value: number };
  alphaClamp: { value: number };
  disableBlending: { value: number };
  hybridDistance: { value: number };
}

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGPURenderer;
let controls: OrbitControls;
let impostor: THREE.Sprite | null = null;
let currentAlbedoTexture: THREE.Texture | null = null;
let currentNormalTexture: THREE.Texture | null = null;
let usingDemoTextures = true;

// Configuration
const config = {
  spritesPerSide: 32,
  alphaClamp: 0.1,
  disableBlending: false,
  hybridDistance: 2.0,
  showWireframe: false,
  isHemispherical: true, // Track if we're in hemispherical mode
  restrictCameraBelow: true, // Restrict camera movement below Y=0 in hemispherical mode
};

// ============================================================================
// TSL SHADER NODES FOR OCTAHEDRAL IMPOSTOR
// ============================================================================

// Simplified octahedral impostor implementation using TSL
// Complex shader functions removed to focus on basic functionality

// ============================================================================
// MATERIAL CREATION
// ============================================================================

/**
 * Creates an octahedral impostor material using TSL nodes with SpriteNodeMaterial
 */
const createOctahedralImpostorMaterial = (
  albedoTexture: THREE.Texture,
  normalTexture: THREE.Texture,
  isHemispherical: boolean = true
): THREE.SpriteNodeMaterial => {
  const material = new THREE.SpriteNodeMaterial();

  // Create TSL uniforms for impostor parameters
  const spritesPerSideUniform = uniform(config.spritesPerSide);
  const albedoTextureNode = texture(albedoTexture);

  // Create a simple octahedral impostor using TSL
  const impostorColorNode = Fn(() => {
    // Get camera direction (simplified approach for sprites)
    const cameraDir = normalize(cameraPosition);

    // Simple octahedral encoding for hemispherical mode
    const absDir = cameraDir.abs();
    const octSum = absDir.x.add(absDir.y).add(absDir.z);
    const normalizedDir = cameraDir.div(octSum);

    // Project to 2D octahedral coordinates
    const encoded = normalizedDir.xz.mul(0.5).add(0.5);

    // Calculate grid coordinates
    const spritesMinusOne = spritesPerSideUniform.sub(1.0);
    const grid = encoded.mul(spritesMinusOne);
    const gridFloor = clamp(grid.floor(), vec2(0.0), spritesMinusOne);

    // Calculate frame size and UV coordinates
    const frameSize = float(1.0).div(spritesPerSideUniform);
    const frameOffset = gridFloor.mul(frameSize);
    const frameUV = frameOffset.add(uv().mul(frameSize));

    // Sample the texture
    return albedoTextureNode.sample(frameUV);
  })();

  // Apply the custom color node
  material.colorNode = impostorColorNode;

  // Set transparency settings
  material.transparent = true;
  material.alphaTest = config.alphaClamp;

  console.log("Octahedral impostor material created with TSL nodes");

  return material;
};

// ============================================================================
// SCENE SETUP
// ============================================================================

/**
 * Initialize the WebGPU renderer and scene
 */
const init = async (): Promise<void> => {
  const canvas = document.createElement("canvas");
  canvas.style.position = "fixed";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.zIndex = "1";
  document.body.appendChild(canvas);

  // Check WebGPU support
  if (!navigator.gpu) {
    showWebGPUError();
    return;
  }

  try {
    // Create WebGPU renderer
    renderer = new THREE.WebGPURenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });

    // Initialize renderer
    await renderer.init();
    console.log("✅ WebGPU renderer initialized successfully");

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
  } catch (error) {
    console.error("Failed to initialize WebGPU:", error);
    showWebGPUError();
    return;
  }

  // Create scene
  scene = new THREE.Scene();

  // Load skybox texture (same as GLSL demo)
  const textureLoader = new THREE.TextureLoader();
  textureLoader.load(
    "/skybox.webp",
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = texture;
      scene.environment = texture; // Also set as environment for realistic lighting
      console.log("✅ Skybox loaded successfully");
    },
    undefined,
    (error) => {
      console.warn("⚠️ Failed to load skybox, using fallback color:", error);
      scene.background = new THREE.Color(0x87ceeb); // Sky blue fallback
    }
  );

  // Create camera
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 0, 5);

  // Setup controls
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // Add lights
  setupLighting();

  // Setup event listeners
  setupEventListeners();

  // Test cube removed - impostor will be centered in scene

  // Load demo textures automatically
  await loadDemoTextures();

  // Hide loading message
  hideLoading();

  // Start render loop
  animate();
};

/**
 * Setup scene lighting
 */
const setupLighting = (): void => {
  // Ambient light
  const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
  scene.add(ambientLight);

  // Main directional light
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
  directionalLight.position.set(5, 10, 5);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  scene.add(directionalLight);

  // Fill light
  const fillLight = new THREE.DirectionalLight(0x8899ff, 0.3);
  fillLight.position.set(-5, 0, -5);
  scene.add(fillLight);
};

// ============================================================================
// TEXTURE LOADING
// ============================================================================

/**
 * Load texture from file
 */
const loadTextureFromFile = (file: File): Promise<THREE.Texture> => {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const loader = new THREE.TextureLoader();

    loader.load(
      url,
      (texture) => {
        URL.revokeObjectURL(url);
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        resolve(texture);
      },
      undefined,
      (error) => {
        URL.revokeObjectURL(url);
        reject(error);
      }
    );
  });
};

/**
 * Load texture from URL path
 */
const loadTextureFromPath = (path: string): Promise<THREE.Texture> => {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();

    loader.load(
      path,
      (texture) => {
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        resolve(texture);
      },
      undefined,
      (error) => {
        reject(error);
      }
    );
  });
};

/**
 * Load demo textures automatically
 */
const loadDemoTextures = async (): Promise<void> => {
  try {
    console.log("Loading demo textures...");

    const [albedoTexture, normalTexture] = await Promise.all([
      loadTextureFromPath("/exported-textures/albedo_demo.png"),
      loadTextureFromPath("/exported-textures/normal_demo.png"),
    ]);

    currentAlbedoTexture = albedoTexture;
    currentNormalTexture = normalTexture;
    usingDemoTextures = true;

    console.log("✅ Demo textures loaded successfully");
    updateImpostor();
  } catch (error) {
    console.warn("⚠️ Could not load demo textures:", error);
    console.log("Demo textures not found - please upload your own textures");
  }
};

/**
 * Create and update impostor when both textures are loaded
 */
const updateImpostor = (): void => {
  if (!currentAlbedoTexture || !currentNormalTexture) {
    return;
  }

  // Remove existing impostor
  if (impostor) {
    scene.remove(impostor);
    impostor.material.dispose();
    impostor = null;
  }

  // Create new impostor material with fallback
  let material;
  try {
    material = createOctahedralImpostorMaterial(
      currentAlbedoTexture,
      currentNormalTexture,
      config.isHemispherical // Use config setting for hemisphere mode
    );
  } catch (error) {
    console.warn(
      "Failed to create octahedral material, using fallback:",
      error
    );
    // Fallback to a simple colored material if texture loading fails
    material = new THREE.SpriteNodeMaterial({
      color: 0x00ff00, // Green color for debugging
      transparent: false,
    });
  }

  // Create impostor sprite (automatically faces camera)
  impostor = new THREE.Sprite(material);
  impostor.position.set(0, 0, 0); // Center the impostor in the scene
  impostor.scale.set(4, 4, 1); // Set size for good visibility

  scene.add(impostor);

  console.log(
    "✅ Basic material created with WebGPU + TSL (octahedral logic coming next)"
  );
  console.log("Impostor position:", impostor.position);
  console.log("Impostor visible:", impostor.visible);
  console.log("Material:", material);
};

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Setup all event listeners
 */
const setupEventListeners = (): void => {
  // Window resize
  window.addEventListener("resize", onWindowResize);

  // File inputs
  const albedoInput = document.getElementById(
    "albedo-input"
  ) as HTMLInputElement;
  const normalInput = document.getElementById(
    "normal-input"
  ) as HTMLInputElement;

  albedoInput?.addEventListener("change", async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      try {
        // Switch away from demo textures when user uploads their own
        usingDemoTextures = false;
        currentAlbedoTexture = await loadTextureFromFile(file);
        console.log("✅ User albedo texture loaded");
        updateImpostor();
      } catch (error) {
        console.error("❌ Failed to load albedo texture:", error);
      }
    }
  });

  normalInput?.addEventListener("change", async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      try {
        // Switch away from demo textures when user uploads their own
        usingDemoTextures = false;
        currentNormalTexture = await loadTextureFromFile(file);
        console.log("✅ User normal texture loaded");
        updateImpostor();
      } catch (error) {
        console.error("❌ Failed to load normal texture:", error);
      }
    }
  });

  // Controls
  const alphaSlider = document.getElementById(
    "alpha-clamp"
  ) as HTMLInputElement;
  const alphaValue = document.getElementById("alpha-value") as HTMLSpanElement;
  const blendingCheckbox = document.getElementById(
    "disable-blending"
  ) as HTMLInputElement;
  const hemisphereCheckbox = document.getElementById(
    "hemispherical-mode"
  ) as HTMLInputElement;
  const restrictCameraCheckbox = document.getElementById(
    "restrict-camera"
  ) as HTMLInputElement;
  const elevationSlider = document.getElementById(
    "elevation-threshold"
  ) as HTMLInputElement;
  const elevationValue = document.getElementById(
    "elevation-value"
  ) as HTMLSpanElement;
  const resetCameraBtn = document.getElementById(
    "reset-camera"
  ) as HTMLButtonElement;
  const toggleWireframeBtn = document.getElementById(
    "toggle-wireframe"
  ) as HTMLButtonElement;

  alphaSlider?.addEventListener("input", (event) => {
    const value = parseFloat((event.target as HTMLInputElement).value);
    config.alphaClamp = value;
    if (alphaValue) alphaValue.textContent = value.toFixed(2);
    // Note: Real-time uniform updates will be implemented later
  });

  blendingCheckbox?.addEventListener("change", (event) => {
    config.disableBlending = (event.target as HTMLInputElement).checked;
    // Note: Real-time uniform updates will be implemented later
  });

  hemisphereCheckbox?.addEventListener("change", (event) => {
    config.isHemispherical = (event.target as HTMLInputElement).checked;
    console.log(`Hemispherical mode: ${config.isHemispherical ? "ON" : "OFF"}`);

    // If switching to spherical mode, allow camera below Y=0
    if (!config.isHemispherical) {
      config.restrictCameraBelow = false;
      if (restrictCameraCheckbox) restrictCameraCheckbox.checked = false;
    } else {
      // If switching to hemispherical, enable restriction by default
      config.restrictCameraBelow = true;
      if (restrictCameraCheckbox) restrictCameraCheckbox.checked = true;
    }
  });

  restrictCameraCheckbox?.addEventListener("change", (event) => {
    config.restrictCameraBelow = (event.target as HTMLInputElement).checked;
    console.log(
      `Camera restriction below Y=0: ${
        config.restrictCameraBelow ? "ON" : "OFF"
      }`
    );
  });

  elevationSlider?.addEventListener("input", (event) => {
    const value = parseFloat((event.target as HTMLInputElement).value);
    config.hybridDistance = value;
    if (elevationValue) elevationValue.textContent = value.toFixed(1);
    // Note: Real-time uniform updates will be implemented later
  });

  resetCameraBtn?.addEventListener("click", () => {
    camera.position.set(0, 0, 5);
    controls.target.set(0, 0, 0);
    controls.update();
  });

  toggleWireframeBtn?.addEventListener("click", () => {
    config.showWireframe = !config.showWireframe;
    // Note: Wireframe mode for sprites will be implemented differently
  });
};

/**
 * Handle window resize
 */
const onWindowResize = (): void => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Show WebGPU error message
 */
const showWebGPUError = (): void => {
  const errorDiv = document.getElementById("webgpu-error");
  const loadingDiv = document.getElementById("loading");

  if (errorDiv) errorDiv.style.display = "block";
  if (loadingDiv) loadingDiv.style.display = "none";
};

/**
 * Hide loading message
 */
const hideLoading = (): void => {
  const loadingDiv = document.getElementById("loading");
  if (loadingDiv) loadingDiv.style.display = "none";
};

// ============================================================================
// ANIMATION LOOP
// ============================================================================

/**
 * Main animation loop
 */
const animate = (): void => {
  controls.update();

  // Restrict camera movement for hemispherical mode
  if (config.isHemispherical && config.restrictCameraBelow) {
    // Prevent camera from going below Y=0 to avoid octahedral impostor artifacts
    if (camera.position.y < 0) {
      camera.position.y = 0;
      camera.updateMatrixWorld();
    }
  }

  // Sprites automatically face the camera, so no rotation needed for now
  // Later we'll add octahedral impostor logic here

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
};

// ============================================================================
// INITIALIZATION
// ============================================================================

// Start the application
document.addEventListener("DOMContentLoaded", () => {
  init().catch(console.error);
});

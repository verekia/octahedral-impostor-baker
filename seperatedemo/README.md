# Octahedral Impostor - Standalone Demo

A standalone demonstration of octahedral impostor rendering using pregenerated texture atlases. This demo provides the same Three.js world and FPS controls as the main project, but loads pregenerated texture atlases instead of generating them at runtime.

## Features

- 🎮 Full FPS controller with Rapier physics
- 🌍 Basic Three.js world with ground plane
- 🖼️ Pregenerated texture atlas loading
- 🎛️ lil-gui controls for material parameters
- 📊 Performance monitoring with stats.js
- 🎯 Octahedral impostor rendering with billboard behavior

## Getting Started

### 1. Installation

```bash
npm install
```

### 2. Prepare Texture Atlases

Place your pregenerated texture atlases in the `textures/` folder:

```
textures/
├── albedo_2048px_12x12.png      # RGB albedo texture atlas
└── normalDepth_2048px_12x12.png # RGBA normal-depth texture atlas
```

**Expected format:**
- **Resolution:** 2048x2048 pixels
- **Frames per side:** 12x12 (144 total viewing angles)
- **Albedo:** RGB format containing diffuse color information
- **Normal-Depth:** RGBA format where XYZ = world-space normals, W = depth

### 3. Run the Demo

```bash
npm run dev
```

This will start a local development server at `http://localhost:3000`

## Usage

1. **Load Textures:** Use the GUI to specify texture paths and click "Load Textures"
2. **Render Impostor:** Click "Render Impostor" to create the octahedral impostor at origin
3. **Explore:** Use FPS controls to move around and observe the impostor behavior

### Controls

- **WASD / Arrow Keys:** Move character
- **Space:** Jump  
- **Mouse:** Look around (click to lock pointer)
- **ESC:** Exit pointer lock
- **V:** Toggle debug view (if implemented)

### GUI Settings

- **Camera Controls:** Switch between FPS and Orbital camera modes
- **Texture Loading:** Specify paths and load pregenerated atlases
- **Material Settings:** Adjust alpha clamp, transparency, blending, elevation threshold
- **Debug:** Show impostor outline wireframe
- **Lighting:** Control directional light for orbital mode
- **FPS Camera:** Adjust movement speed, jump velocity, gravity

## Project Structure

```
seperatedemo/
├── src/
│   ├── types.ts                 # Type definitions
│   ├── octahedral-utils.ts      # Utility functions  
│   ├── controllers/
│   │   └── FPSController.ts     # First-person character controller
│   ├── objects/
│   │   └── Ground.ts            # Ground plane creation
│   ├── utils/
│   │   └── Lights.ts            # Scene lighting setup
│   └── input/
│       └── InputHandler.ts      # Input handling
├── textures/                    # Place your texture atlases here
├── octahedral-rendering.ts      # Core impostor rendering system
├── demo.ts                      # Main demo application
├── index.html                   # Entry point
├── package.json                 # Dependencies
├── vite.config.js              # Vite configuration
└── tsconfig.json               # TypeScript configuration
```

## Key Differences from Main Project

This standalone demo differs from the main project in several ways:

1. **No Atlas Generation:** Uses pregenerated texture atlases instead of runtime generation
2. **Simplified API:** Streamlined material creation with `OctahedralImpostor.createWithTextures()`
3. **Texture Loading:** Includes texture loading utilities via Three.js TextureLoader
4. **Minimal Dependencies:** Only includes essential octahedral rendering components

## Texture Atlas Generation

To generate texture atlases for use with this demo, you can use the main project's atlas generation functionality:

1. Run the main project demo
2. Configure your 3D model and atlas settings
3. Use the "Export Texture Atlas" functions in the GUI
4. Copy the exported `albedo_*.png` and `normalDepth_*.png` files to this demo's `textures/` folder

## Performance Notes

- The demo is optimized for real-time rendering with minimal overhead
- Pregenerated textures eliminate runtime atlas generation costs
- Physics and rendering are separated for consistent performance
- Use the orbital camera mode for performance analysis without physics updates

## Troubleshooting

### Textures Not Loading
- Check that texture files exist in the `textures/` folder
- Verify file paths in the GUI match your actual file names
- Check browser console for loading errors

### Impostor Not Visible
- Ensure both albedo and normal-depth textures are loaded successfully
- Check that "Show Impostor" is enabled in Material Settings
- Verify the impostor scale and position settings

### Performance Issues
- Check stats.js display for frame rate information
- Switch to orbital camera mode to isolate physics performance
- Reduce texture resolution if needed

## Building for Production

```bash
npm run build
```

This creates an optimized build in the `dist/` folder ready for deployment.

## Dependencies

- **Three.js 0.178.0:** 3D graphics library
- **@dimforge/rapier3d-compat 0.18.0:** Physics engine
- **lil-gui 0.20.0:** GUI controls
- **stats.js 0.17.0:** Performance monitoring
- **Vite 7.0.6:** Build tool and development server
- **TypeScript 5.9.2:** Type checking and compilation
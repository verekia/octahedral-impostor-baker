/**
 * Real-time texture atlas sampling visualization
 * Shows the generated albedo atlas with dynamic sampling indicators
 */

import * as THREE from 'three';
import { 
  WebGLRenderer, 
  Texture, 
  Material,
  Vector2,
  Vector3
} from 'three';
import { OctahedralImpostor } from './impostor-rendering.js';
import { octaDirToGrid, hemiOctaDirToGrid, OctahedralMode } from './octahedral-utils.js';

export interface AtlasVisualizationConfig {
  /** Canvas size for the preview */
  canvasSize: number;
  /** Whether to show sprite boundaries */
  showGrid: boolean;
  /** Color of the sampling indicator */
  indicatorColor: string;
  /** Line width for the sampling indicator */
  indicatorLineWidth: number;
  /** Update frequency in milliseconds */
  updateFrequency: number;
}

export const DEFAULT_VISUALIZATION_CONFIG: AtlasVisualizationConfig = {
  canvasSize: 150, // Will be calculated responsively for snug fit
  showGrid: true,
  indicatorColor: '#ff0000',
  indicatorLineWidth: 2,
  updateFrequency: 16 // ~60fps
};

export class AtlasVisualization {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private config: AtlasVisualizationConfig;
  private impostor: OctahedralImpostor<any> | null = null;
  private camera: THREE.Camera | null = null;
  private lastUpdateTime = 0;
  private atlasTexture: Texture | null = null;
  private atlasImage: HTMLImageElement | null = null;
  private spritesPerSide = 32;
  private octahedralMode = OctahedralMode.HEMISPHERICAL;
  private isInitialized = false;
  
  // Resize functionality
  private resizeHandle: HTMLElement | null = null;
  private isResizing = false;
  private resizeStartPos = { x: 0, y: 0 };
  private resizeStartSize = 0;
  
  // Drag functionality
  private isDragging = false;
  private dragStartPos = { x: 0, y: 0 };
  private containerStartPos = { x: 0, y: 0 };

  constructor(config: Partial<AtlasVisualizationConfig> = {}) {
    // Calculate responsive size if not provided
    const responsiveConfig = { ...DEFAULT_VISUALIZATION_CONFIG, ...config };
    if (!config.canvasSize) {
      responsiveConfig.canvasSize = this.calculateResponsiveSize();
    }
    
    this.config = responsiveConfig;
    this.canvas = this.createCanvas();
    this.ctx = this.canvas.getContext('2d')!;
    this.setupCanvas();
    
    // Add window resize listener for responsive behavior
    window.addEventListener('resize', this.handleWindowResize);
  }

  private createCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = this.config.canvasSize;
    canvas.height = this.config.canvasSize;
    canvas.style.cssText = `
      border: 2px solid #444;
      border-radius: 8px;
      background: #000;
      image-rendering: pixelated;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      display: block;
      max-width: 90vw;
      max-height: 90vh;
      width: auto;
      height: auto;
    `;
    return canvas;
  }

  private setupCanvas(): void {
    this.ctx.imageSmoothingEnabled = false; // Crisp pixel rendering
  }

  private calculateResponsiveSize(): number {
    // Calculate optimal size based on available space below GUI
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // GUI panel dimensions (lil-gui is typically at top-right)
    const guiWidth = 300;
    const guiHeight = 400; // Estimate typical GUI height
    const padding = 10; // Small padding for flush positioning
    
    // Available space calculation
    // Width: viewport minus GUI width and padding
    const containerPadding = 15; // Container internal padding
    const flushPadding = 10; // Distance from edges
    const availableWidth = viewportWidth - guiWidth - (flushPadding * 2) - (containerPadding * 2);
    
    // Height: viewport minus GUI height and container overhead (title + padding)
    const containerOverhead = 40; // title height + spacing
    const availableHeight = viewportHeight - guiHeight - (flushPadding * 2) - (containerPadding * 2) - containerOverhead;
    
    // Use smaller dimension to maintain square aspect ratio
    const maxCanvasSize = Math.min(availableWidth, availableHeight);
    
    // Apply constraints with much smaller minimum for mobile
    return Math.max(60, Math.min(320, Math.floor(maxCanvasSize)));
  }

  private handleWindowResize = (): void => {
    // Debounce resize events
    clearTimeout((this as any).resizeTimeout);
    (this as any).resizeTimeout = setTimeout(() => {
      this.updateResponsiveLayout();
    }, 150);
  };

  private updateResponsiveLayout(): void {
    // Recalculate size based on new viewport
    const newSize = this.calculateResponsiveSize();
    
    // Only update if size changed significantly (avoid jitter)
    if (Math.abs(newSize - this.config.canvasSize) > 20) {
      this.updateCanvasSize(newSize);
    }
    
    // Reposition container to ensure it stays in bounds
    this.repositionContainer();
  }

  private repositionContainer(): void {
    const container = (this as any).container as HTMLElement;
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Check if container is out of bounds and reposition if needed
    let newX = parseInt(container.style.left || '0');
    let newY = parseInt(container.style.top || '0');
    
    const maxX = viewportWidth - rect.width - 20; // 20px padding
    const maxY = viewportHeight - rect.height - 20;
    
    if (newX > maxX) newX = maxX;
    if (newY > maxY) newY = maxY;
    if (newX < 0) newX = 0;
    if (newY < 0) newY = 0;
    
    container.style.left = `${newX}px`;
    container.style.top = `${newY}px`;
  }

  private calculateSmartPosition(): { top?: number; bottom?: number; left?: number; right?: number } {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // GUI panel width (lil-gui is typically at top-right)
    const guiWidth = 300;
    const guiHeight = 400; // Estimate typical GUI height
    const flushPadding = 10; // Small padding for flush look
    
    // Calculate actual container size based on styling
    const containerPadding = 15; // padding: 15px
    const titleHeight = 14 + 12; // font-size + margin-bottom  
    const containerWidth = this.config.canvasSize + (containerPadding * 2);
    const containerHeight = this.config.canvasSize + (containerPadding * 2) + titleHeight;
    
    // Position flush with bottom-right, but below GUI
    // Check if we have enough vertical space below the GUI
    const availableVerticalSpace = viewportHeight - guiHeight;
    
    if (availableVerticalSpace >= containerHeight + flushPadding) {
      // Position in bottom-right corner, flush
      return {
        bottom: flushPadding,
        right: flushPadding
      };
    } else {
      // If not enough space, position as close as possible
      return {
        bottom: flushPadding,
        right: flushPadding
      };
    }
  }

  private createResizeHandle(): HTMLElement {
    const handle = document.createElement('div');
    handle.style.cssText = `
      position: absolute;
      top: 0px;
      left: 0px;
      width: 16px;
      height: 16px;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 3px;
      cursor: nw-resize;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.7;
      transition: opacity 0.2s ease;
      z-index: 1001;
    `;
    
    // Add L-shaped resize icon (90° angle arrow)
    handle.innerHTML = `
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="pointer-events: none;">
        <path d="M2 8L2 2L8 2" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    
    // Hover effects
    handle.addEventListener('mouseenter', () => {
      handle.style.opacity = '1';
      handle.style.background = 'rgba(255, 255, 255, 0.3)';
    });
    
    handle.addEventListener('mouseleave', () => {
      if (!this.isResizing) {
        handle.style.opacity = '0.7';
        handle.style.background = 'rgba(255, 255, 255, 0.2)';
      }
    });
    
    return handle;
  }

  private setupResizeHandlers(): void {
    if (!this.resizeHandle) return;

    this.resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      
      this.isResizing = true;
      this.resizeStartPos = { x: e.clientX, y: e.clientY };
      this.resizeStartSize = this.config.canvasSize;
      
      document.addEventListener('mousemove', this.handleResize);
      document.addEventListener('mouseup', this.handleResizeEnd);
      
      // Add visual feedback
      if (this.resizeHandle) {
        this.resizeHandle.style.opacity = '1';
        this.resizeHandle.style.background = 'rgba(255, 255, 255, 0.4)';
      }
    });
  }

  private handleResize = (e: MouseEvent): void => {
    if (!this.isResizing) return;

    const container = (this as any).container as HTMLElement;
    if (!container) return;

    // Calculate resize delta - top-left corner behavior
    const deltaX = e.clientX - this.resizeStartPos.x;
    const deltaY = e.clientY - this.resizeStartPos.y;
    
    // For top-left corner: drag UP/LEFT = bigger, drag DOWN/RIGHT = smaller
    const avgDelta = (deltaX + deltaY) / 2;
    
    // Calculate new size with constraints (note the minus for top-left behavior)
    const newSize = Math.max(60, Math.min(800, this.resizeStartSize - avgDelta));
    
    // Calculate size change before updating
    const sizeDelta = newSize - this.config.canvasSize;
    
    // Update canvas size
    this.updateCanvasSize(newSize);
    
    // If container is using left/top positioning (after drag), we need to adjust position
    // to keep bottom-right corner in the same place
    if (container.style.left && container.style.left !== 'auto') {
      const currentLeft = parseInt(container.style.left);
      const currentTop = parseInt(container.style.top);
      
      // Adjust position to keep bottom-right corner fixed
      container.style.left = `${currentLeft - sizeDelta}px`;
      container.style.top = `${currentTop - sizeDelta}px`;
    }
  };

  private handleResizeEnd = (): void => {
    this.isResizing = false;
    document.removeEventListener('mousemove', this.handleResize);
    document.removeEventListener('mouseup', this.handleResizeEnd);
    
    // Remove visual feedback
    if (this.resizeHandle) {
      this.resizeHandle.style.opacity = '0.7';
      this.resizeHandle.style.background = 'rgba(255, 255, 255, 0.2)';
    }
  };

  private updateCanvasSize(newSize: number): void {
    this.config.canvasSize = newSize;
    this.canvas.width = newSize;
    this.canvas.height = newSize;
    this.setupCanvas();
    
    // Re-render if initialized
    if (this.isInitialized) {
      this.render();
    }
  }



  private setupDragHandlers(dragHandle: HTMLElement, container: HTMLElement): void {
    dragHandle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      this.isDragging = true;
      this.dragStartPos = { x: e.clientX, y: e.clientY };
      
      // Get current container position
      const rect = container.getBoundingClientRect();
      this.containerStartPos = { x: rect.left, y: rect.top };
      
      document.addEventListener('mousemove', this.handleDrag);
      document.addEventListener('mouseup', this.handleDragEnd);
      
      // Add visual feedback
      dragHandle.style.background = 'rgba(255, 255, 255, 0.2)';
    });
  }

  private handleDrag = (e: MouseEvent): void => {
    if (!this.isDragging) return;

    const deltaX = e.clientX - this.dragStartPos.x;
    const deltaY = e.clientY - this.dragStartPos.y;
    
    const newX = this.containerStartPos.x + deltaX;
    const newY = this.containerStartPos.y + deltaY;
    
    // Constrain to viewport bounds
    const container = (this as any).container as HTMLElement;
    if (container) {
      const rect = container.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width;
      const maxY = window.innerHeight - rect.height;
      
      const constrainedX = Math.max(0, Math.min(newX, maxX));
      const constrainedY = Math.max(0, Math.min(newY, maxY));
      
      container.style.left = `${constrainedX}px`;
      container.style.top = `${constrainedY}px`;
      container.style.right = 'auto';
      container.style.bottom = 'auto';
    }
  };

  private handleDragEnd = (): void => {
    this.isDragging = false;
    document.removeEventListener('mousemove', this.handleDrag);
    document.removeEventListener('mouseup', this.handleDragEnd);
    
    // Remove visual feedback
    const container = (this as any).container as HTMLElement;
    if (container) {
      const title = container.querySelector('div');
      if (title) {
        title.style.background = 'transparent';
      }
    }
  };

  /**
   * Attach the visualization canvas to the document (positioned to avoid GUI collision)
   */
  public attachTo(parent?: HTMLElement): void {
    // Calculate smart positioning to avoid GUI collision
    const smartPosition = this.calculateSmartPosition();
    
    // Create a container with title
    const container = document.createElement('div');
    container.style.cssText = `
      position: fixed;
      ${smartPosition.bottom ? `bottom: ${smartPosition.bottom}px;` : `top: ${smartPosition.top}px;`}
      ${smartPosition.right ? `right: ${smartPosition.right}px;` : `left: ${smartPosition.left}px;`}
      padding: 15px;
      background: rgba(0, 0, 0, 0.9);
      border-radius: 12px;
      text-align: center;
      z-index: 1000;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
    `;

    const title = document.createElement('div');
    title.textContent = 'Atlas Sampling Visualization';
    title.style.cssText = `
      color: white;
      font-family: monospace;
      font-size: 14px;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      font-weight: bold;
      cursor: move;
      user-select: none;
      padding: 4px;
      border-radius: 4px;
      transition: background 0.2s ease;
    `;

    // Add canvas wrapper
    const canvasWrapper = document.createElement('div');
    canvasWrapper.style.position = 'relative';
    canvasWrapper.style.display = 'inline-block';
    canvasWrapper.appendChild(this.canvas);

    container.appendChild(title);
    container.appendChild(canvasWrapper);
    
    // Create resize handle (positioned on container)
    this.resizeHandle = this.createResizeHandle();
    container.appendChild(this.resizeHandle);
    
    // Setup resize and drag functionality
    this.setupResizeHandlers();
    this.setupDragHandlers(title, container);
    
    // Attach directly to document body for fixed positioning
    document.body.appendChild(container);
    
    // Store reference for cleanup
    (this as any).container = container;
  }

  /**
   * Set the impostor to visualize
   */
  public setImpostor(impostor: OctahedralImpostor<any> | null, camera: THREE.Camera | null, renderer?: WebGLRenderer): void {
    this.impostor = impostor;
    this.camera = camera;
    
    if (impostor) {
      // Extract atlas information from the impostor
      this.atlasTexture = impostor.material.map;
      this.extractImpostorConfig(impostor);
      this.loadAtlasTexture(renderer);
    } else {
      this.atlasTexture = null;
      this.atlasImage = null;
      this.isInitialized = false;
      this.clearCanvas();
    }
  }

  private extractImpostorConfig(impostor: OctahedralImpostor<any>): void {
    const material = impostor.material as any;
    const uniforms = material.octahedralImpostorUniforms;
    
    if (uniforms?.spritesPerSide) {
      this.spritesPerSide = uniforms.spritesPerSide.value;
    }

    // Extract octahedral mode from shader defines
    const defines = material.octahedralImpostorDefines;
    if (defines?.OCTAHEDRAL_USE_HEMI_OCTAHEDRON) {
      this.octahedralMode = OctahedralMode.HEMISPHERICAL;
    } else {
      this.octahedralMode = OctahedralMode.SPHERICAL;
    }
  }

  private async loadAtlasTexture(renderer?: WebGLRenderer): Promise<void> {
    if (!this.atlasTexture) return;

    try {
      // Extract the texture data from WebGL texture
      await this.extractTextureData(renderer);
      this.isInitialized = true;
      this.render();
      
      console.log('✅ Atlas visualization initialized');
    } catch (error) {
      console.error('❌ Failed to load atlas texture for visualization:', error);
      // Fallback to grid-only display
      this.isInitialized = true;
      this.drawAtlasGrid();
    }
  }

  private async extractTextureData(renderer?: WebGLRenderer): Promise<void> {
    if (!this.atlasTexture) return;

    console.log('🔍 Attempting to extract atlas texture data...');
    console.log('Texture properties:', {
      isTexture: this.atlasTexture.isTexture,
      isRenderTargetTexture: (this.atlasTexture as any).isRenderTargetTexture,
      hasImage: !!this.atlasTexture.image,
      hasSource: !!(this.atlasTexture as any).source,
      format: this.atlasTexture.format,
      type: this.atlasTexture.type
    });

    try {
      // First, try to get image data directly from the texture
      if ((this.atlasTexture as any).source?.data instanceof HTMLImageElement) {
        console.log('✅ Found image in texture.source.data');
        this.atlasImage = (this.atlasTexture as any).source.data;
        return;
      } else if ((this.atlasTexture as any).image instanceof HTMLImageElement) {
        console.log('✅ Found image in texture.image');
        this.atlasImage = (this.atlasTexture as any).image;
        return;
      }

      // If renderer is available, try to extract pixel data from WebGL
      if (renderer) {
        console.log('🔧 Attempting WebGL extraction...');
        await this.extractTextureFromWebGL(renderer);
      } else {
        console.log('📋 Atlas texture is not an image and no renderer provided, using grid-only display');
        this.atlasImage = null;
      }
    } catch (error) {
      console.warn('❌ Failed to extract texture data:', error);
      this.atlasImage = null;
    }
  }

  private async extractTextureFromWebGL(renderer: WebGLRenderer): Promise<void> {
    if (!this.atlasTexture) return;

    try {
      const gl = renderer.getContext();
      
      // Get the WebGL texture object
      const webglTexture = (renderer.properties.get(this.atlasTexture) as any)?.__webglTexture;
      if (!webglTexture) {
        console.warn('No WebGL texture found for atlas texture');
        this.atlasImage = null;
        return;
      }

      // Determine texture size - try multiple sources
      let textureSize = 4096; // default atlas size
      
      // First try to get from texture properties
      if (this.atlasTexture.image?.width) {
        textureSize = this.atlasTexture.image.width;
      } else if ((this.atlasTexture as any).source?.data?.width) {
        textureSize = (this.atlasTexture as any).source.data.width;
      } 
      // Try to get from render target dimensions if this is a render target texture
      else if ((this.atlasTexture as any).isRenderTargetTexture) {
        // Try to find the render target this texture belongs to
        const renderTargetSize = this.guessRenderTargetSize();
        if (renderTargetSize > 0) {
          textureSize = renderTargetSize;
        }
      }
      // Fall back to calculating from sprites per side
      else if (this.impostor) {
        const material = this.impostor.material as any;
        if (material.octahedralImpostorUniforms?.spritesPerSide) {
          // Use the sprites per side to calculate total atlas size
          // This should match the actual atlas generation size
          textureSize = 4096; // Default atlas size from DEFAULT_CONFIG
        }
      }

      console.log(`📏 Using texture size: ${textureSize}x${textureSize}`);

      // Create a temporary render target to extract the texture
      const tempTarget = new THREE.WebGLRenderTarget(textureSize, textureSize, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType
      });

      // Create a simple material to copy the texture
      const copyMaterial = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: this.atlasTexture }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          varying vec2 vUv;
          void main() {
            gl_FragColor = texture2D(tDiffuse, vUv);
          }
        `
      });

      // Create a plane geometry and mesh
      const geometry = new THREE.PlaneGeometry(2, 2);
      const mesh = new THREE.Mesh(geometry, copyMaterial);

      // Create an orthographic camera
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      
      // Create a simple scene
      const scene = new THREE.Scene();
      scene.add(mesh);

      // Render to the temporary target
      const oldRenderTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(tempTarget);
      renderer.render(scene, camera);

      // Read pixels from the render target
      const pixels = new Uint8Array(textureSize * textureSize * 4);
      renderer.readRenderTargetPixels(tempTarget, 0, 0, textureSize, textureSize, pixels);

      // Create a canvas and draw the pixels
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = textureSize;
      tempCanvas.height = textureSize;
      const ctx = tempCanvas.getContext('2d')!;

      // Create image data
      const imageData = ctx.createImageData(textureSize, textureSize);
      
      // Three.js pixels are read bottom-to-top, so we need to flip them
      for (let y = 0; y < textureSize; y++) {
        for (let x = 0; x < textureSize; x++) {
          const srcIndex = ((textureSize - 1 - y) * textureSize + x) * 4;
          const dstIndex = (y * textureSize + x) * 4;
          
          imageData.data[dstIndex] = pixels[srcIndex];     // R
          imageData.data[dstIndex + 1] = pixels[srcIndex + 1]; // G
          imageData.data[dstIndex + 2] = pixels[srcIndex + 2]; // B
          imageData.data[dstIndex + 3] = pixels[srcIndex + 3]; // A
        }
      }

      ctx.putImageData(imageData, 0, 0);

      // Convert to image
      this.atlasImage = new Image();
      this.atlasImage.onload = () => {
        console.log('✅ Successfully extracted and loaded atlas texture');
        // Re-render with the newly loaded image
        if (this.isInitialized) {
          this.render();
        }
      };
      this.atlasImage.src = tempCanvas.toDataURL();

      // Cleanup
      renderer.setRenderTarget(oldRenderTarget);
      tempTarget.dispose();
      copyMaterial.dispose();
      geometry.dispose();
      
    } catch (error) {
      console.warn('Failed to extract texture from WebGL:', error);
      this.atlasImage = null;
    }
  }

  private guessRenderTargetSize(): number {
    // Try to get size from current atlas config
    if (this.impostor) {
      const material = this.impostor.material as any;
      if (material.octahedralImpostorUniforms?.spritesPerSide) {
        // For now, return the standard atlas size
        // In the future, this could be made more sophisticated
        return 4096;
      }
    }
    return 0;
  }

  private clearCanvas(): void {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private drawAtlasGrid(): void {
    if (!this.config.showGrid) return;

    const spriteSize = this.canvas.width / this.spritesPerSide;
    
    // Use different grid styles based on whether we have atlas texture
    if (this.atlasImage) {
      // Subtle grid when atlas is shown
      this.ctx.strokeStyle = '#ffffff40';
      this.ctx.lineWidth = 0.5;
    } else {
      // More prominent grid when no atlas
      this.ctx.strokeStyle = '#333';
      this.ctx.lineWidth = 1;
    }
    
    // Draw grid lines
    for (let i = 0; i <= this.spritesPerSide; i++) {
      const pos = i * spriteSize;
      
      // Vertical lines
      this.ctx.beginPath();
      this.ctx.moveTo(pos, 0);
      this.ctx.lineTo(pos, this.canvas.height);
      this.ctx.stroke();
      
      // Horizontal lines
      this.ctx.beginPath();
      this.ctx.moveTo(0, pos);
      this.ctx.lineTo(this.canvas.width, pos);
      this.ctx.stroke();
    }
  }

  /**
   * Update the visualization with current sampling information
   */
  public update(currentTime: number): void {
    if (!this.impostor || !this.camera) return;
    if (currentTime - this.lastUpdateTime < this.config.updateFrequency) return;

    this.lastUpdateTime = currentTime;
    this.render();
  }

  private render(): void {
    if (!this.isInitialized) return;

    // Clear and redraw base
    this.clearCanvas();
    
    // Draw the atlas texture if available
    this.drawAtlasTexture();
    
    // Draw grid on top of texture
    this.drawAtlasGrid();
    
    // Calculate current sampling coordinates
    const samplingInfo = this.calculateCurrentSampling();
    if (samplingInfo) {
      this.drawSamplingIndicators(samplingInfo);
    }
  }

  private drawAtlasTexture(): void {
    if (!this.atlasImage) return;

    try {
      // Draw the atlas texture to fill the entire canvas
      this.ctx.drawImage(
        this.atlasImage,
        0, 0,
        this.canvas.width, this.canvas.height
      );
    } catch (error) {
      console.warn('Failed to draw atlas texture:', error);
    }
  }

  private calculateCurrentSampling(): SamplingInfo | null {
    if (!this.impostor || !this.camera) return null;

    try {
      // Get camera direction relative to impostor
      const impostorPos = this.impostor.position;
      const cameraPos = this.camera.position;
      
      // Calculate direction from impostor to camera
      const direction = new Vector3()
        .copy(cameraPos)
        .sub(impostorPos)
        .normalize();

      // Handle hemispherical mode constraints
      if (this.octahedralMode === OctahedralMode.HEMISPHERICAL && direction.y < 0) {
        direction.y = 0;
        direction.normalize();
      }

      // Convert to grid coordinates
      const gridCoords = new Vector2();
      if (this.octahedralMode === OctahedralMode.HEMISPHERICAL) {
        hemiOctaDirToGrid(direction, gridCoords);
      } else {
        octaDirToGrid(direction, gridCoords);
      }

      // Calculate sprite grid position
      const spritesMinusOne = this.spritesPerSide - 1;
      const grid = new Vector2(
        gridCoords.x * spritesMinusOne,
        gridCoords.y * spritesMinusOne
      );

      const gridFloor = new Vector2(
        Math.min(Math.floor(grid.x), spritesMinusOne),
        Math.min(Math.floor(grid.y), spritesMinusOne)
      );

      const gridFract = new Vector2(
        grid.x - gridFloor.x,
        grid.y - gridFloor.y
      );

      // Calculate the three sprites and their weights (triplanar blending)
      const weights = this.computeSpritesWeight(gridFract);
      
      const sprite1 = gridFloor.clone();
      const sprite2 = new Vector2(
        Math.min(sprite1.x + (weights.w > 0.5 ? 1.0 : 0.0), spritesMinusOne),
        Math.min(sprite1.y + (weights.w > 0.5 ? 0.0 : 1.0), spritesMinusOne)
      );
      const sprite3 = new Vector2(
        Math.min(sprite1.x + 1.0, spritesMinusOne),
        Math.min(sprite1.y + 1.0, spritesMinusOne)
      );

      return {
        sprite1,
        sprite2,
        sprite3,
        weights: new Vector3(weights.x, weights.y, weights.z),
        gridFract
      };
    } catch (error) {
      console.warn('Failed to calculate sampling info:', error);
      return null;
    }
  }

  private computeSpritesWeight(gridFract: Vector2): { x: number; y: number; z: number; w: number } {
    // This matches the shader logic in impostor-rendering.ts
    return {
      x: Math.min(1.0 - gridFract.x, 1.0 - gridFract.y),
      y: Math.abs(gridFract.x - gridFract.y),
      z: Math.min(gridFract.x, gridFract.y),
      w: Math.ceil(gridFract.x - gridFract.y)
    };
  }

  private drawSamplingIndicators(samplingInfo: SamplingInfo): void {
    const spriteSize = this.canvas.width / this.spritesPerSide;
    
    // Draw each sprite with opacity based on weight
    this.drawSpriteIndicator(samplingInfo.sprite1, samplingInfo.weights.x, spriteSize, '#ff0000');
    this.drawSpriteIndicator(samplingInfo.sprite2, samplingInfo.weights.y, spriteSize, '#ff4444');
    this.drawSpriteIndicator(samplingInfo.sprite3, samplingInfo.weights.z, spriteSize, '#ff8888');
  }

  private drawSpriteIndicator(sprite: Vector2, weight: number, spriteSize: number, color: string): void {
    if (weight < 0.01) return; // Skip very low weights

    const x = sprite.x * spriteSize;
    const y = sprite.y * spriteSize;
    
    // Use different styles when atlas texture is present
    if (this.atlasImage) {
      // More prominent indicators on top of texture
      const alpha = Math.floor(Math.max(0.3, weight) * 255).toString(16).padStart(2, '0');
      
      // Draw filled rectangle with minimum visibility
      this.ctx.fillStyle = color + alpha;
      this.ctx.fillRect(x, y, spriteSize, spriteSize);
      
      // Draw thick outline for visibility
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = Math.max(2, this.config.indicatorLineWidth);
      this.ctx.strokeRect(x, y, spriteSize, spriteSize);
      
      // Add inner outline for better contrast
      this.ctx.strokeStyle = '#ffffff';
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(x + 1, y + 1, spriteSize - 2, spriteSize - 2);
      
    } else {
      // Standard indicators for grid-only display
      this.ctx.fillStyle = color + Math.floor(weight * 100).toString(16).padStart(2, '0');
      this.ctx.fillRect(x, y, spriteSize, spriteSize);
      
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = this.config.indicatorLineWidth;
      this.ctx.strokeRect(x, y, spriteSize, spriteSize);
    }
    
    // Draw weight text with better contrast
    if (weight > 0.1) {
      const textX = x + spriteSize / 2;
      const textY = y + spriteSize / 2;
      
      // Scale font size based on sprite size for better readability
      const fontSize = Math.max(9, Math.min(20, spriteSize / 6));
      const bgWidth = fontSize * 2.5;
      const bgHeight = fontSize * 1.2;
      
      // Add text background for readability
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      this.ctx.fillRect(textX - bgWidth/2, textY - bgHeight/2, bgWidth, bgHeight);
      
      // Draw weight text
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = `bold ${fontSize}px monospace`;
      this.ctx.textAlign = 'center';
      this.ctx.fillText(
        (weight * 100).toFixed(0) + '%',
        textX,
        textY + fontSize/3
      );
    }
  }

  /**
   * Get the canvas element for external manipulation
   */
  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<AtlasVisualizationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    if (newConfig.canvasSize) {
      this.updateCanvasSize(newConfig.canvasSize);
    }
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.impostor = null;
    this.camera = null;
    this.atlasTexture = null;
    this.atlasImage = null;
    
    // Clean up resize event listeners
    if (this.isResizing) {
      document.removeEventListener('mousemove', this.handleResize);
      document.removeEventListener('mouseup', this.handleResizeEnd);
      this.isResizing = false;
    }
    
    // Clean up drag event listeners
    if (this.isDragging) {
      document.removeEventListener('mousemove', this.handleDrag);
      document.removeEventListener('mouseup', this.handleDragEnd);
      this.isDragging = false;
    }
    
    // Clean up window resize listener
    window.removeEventListener('resize', this.handleWindowResize);
    
    // Clear any pending resize timeout
    if ((this as any).resizeTimeout) {
      clearTimeout((this as any).resizeTimeout);
    }
    
    this.resizeHandle = null;
    
    // Clean up the container from document body
    const container = (this as any).container;
    if (container && container.parentElement) {
      container.parentElement.removeChild(container);
    }
  }
}

interface SamplingInfo {
  sprite1: Vector2;
  sprite2: Vector2;
  sprite3: Vector2;
  weights: Vector3;
  gridFract: Vector2;
}

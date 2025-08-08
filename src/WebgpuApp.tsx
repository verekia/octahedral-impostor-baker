import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Texture,
  PerspectiveCamera,
  Sprite,
  Scene,
  DirectionalLight,
  AmbientLight,
  Color,
  TextureLoader,
  ACESFilmicToneMapping,
  EquirectangularReflectionMapping,
} from 'three'
import { WebGPURenderer, SpriteNodeMaterial } from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  uniform,
  texture as tslTexture,
  uv,
  normalize,
  clamp,
  vec2,
  vec4,
  float,
  Fn,
  cameraPosition,
  modelWorldMatrix,
} from 'three/tsl'

type TexturePair = {
  albedo: Texture | null
  normal: Texture | null
}

type Config = {
  spritesPerSide: number
  alphaClamp: number
  disableBlending: boolean
  hybridDistance: number
  showWireframe: boolean
  isHemispherical: boolean
  restrictCameraBelow: boolean
}

const useThree = (config: Config, textures: TexturePair) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<WebGPURenderer | null>(null)
  const sceneRef = useRef<Scene | null>(null)
  const cameraRef = useRef<PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const spriteRef = useRef<Sprite | null>(null)
  const rafRef = useRef<number | null>(null)
  const [isReady, setIsReady] = useState(false)

  const initThree = useMemo(
    () => async () => {
      if (!canvasRef.current) return

      if (!navigator.gpu) throw new Error('WebGPU not supported')

      const renderer = new WebGPURenderer({
        canvas: canvasRef.current,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      })
      await renderer.init()
      renderer.setSize(window.innerWidth, window.innerHeight)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.toneMapping = ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.0
      rendererRef.current = renderer

      const scene = new Scene()
      sceneRef.current = scene

      const textureLoader = new TextureLoader()
      textureLoader.load(
        '/skybox.webp',
        t => {
          t.mapping = EquirectangularReflectionMapping
          scene.background = t
          scene.environment = t
        },
        undefined,
        () => {
          scene.background = new Color(0x87ceeb)
        }
      )

      const camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
      camera.position.set(0, 0, 5)
      cameraRef.current = camera

      const controls = new OrbitControls(camera, canvasRef.current)
      controls.enableDamping = true
      controls.dampingFactor = 0.05
      controlsRef.current = controls

      const ambientLight = new AmbientLight(0x404040, 0.6)
      scene.add(ambientLight)
      const directionalLight = new DirectionalLight(0xffffff, 1.0)
      directionalLight.position.set(5, 10, 5)
      directionalLight.castShadow = true
      directionalLight.shadow.mapSize.width = 2048
      directionalLight.shadow.mapSize.height = 2048
      scene.add(directionalLight)
      const fillLight = new DirectionalLight(0x8899ff, 0.3)
      fillLight.position.set(-5, 0, -5)
      scene.add(fillLight)

      const onResize = () => {
        if (!rendererRef.current || !cameraRef.current) return
        cameraRef.current.aspect = window.innerWidth / window.innerHeight
        cameraRef.current.updateProjectionMatrix()
        rendererRef.current.setSize(window.innerWidth, window.innerHeight)
      }
      window.addEventListener('resize', onResize)

      const animate = () => {
        if (!rendererRef.current || !sceneRef.current || !cameraRef.current || !controlsRef.current) return
        controlsRef.current.update()
        if (config.isHemispherical && config.restrictCameraBelow) {
          if (cameraRef.current.position.y < 0) {
            cameraRef.current.position.y = 0
            cameraRef.current.updateMatrixWorld()
          }
        }
        rendererRef.current.render(sceneRef.current, cameraRef.current)
        rafRef.current = requestAnimationFrame(animate)
      }
      animate()
      setIsReady(true)

      return () => {
        window.removeEventListener('resize', onResize)
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        controlsRef.current?.dispose()
        rendererRef.current?.dispose()
        setIsReady(false)
      }
    },
    [config.isHemispherical, config.restrictCameraBelow]
  )

  const createMaterial = useMemo(() => {
    return (albedo: Texture, normal: Texture) => {
      const material = new SpriteNodeMaterial()
      const spritesPerSideUniform = uniform(config.spritesPerSide)
      const albedoNode = tslTexture(albedo)

      const colorNode = Fn(() => {
        const spriteWorldPos = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0)).xyz
        const viewDir = normalize(cameraPosition.sub(spriteWorldPos))
        const absDir = viewDir.abs()
        const denom = absDir.x.add(absDir.y).add(absDir.z)
        const n = viewDir.div(denom)
        const encX = n.x.add(n.z)
        const encY = n.z.sub(n.x)
        const encoded = vec2(encX, encY).add(1.0).mul(0.5)
        const spritesMinusOne = spritesPerSideUniform.sub(1.0)
        const grid = encoded.mul(spritesMinusOne)
        const gridFloor = clamp(grid.floor(), vec2(0.0), spritesMinusOne)
        const frameSize = float(1.0).div(spritesPerSideUniform)
        const frameOffset = gridFloor.mul(frameSize)
        const frameUV = frameOffset.add(uv().mul(frameSize))
        return albedoNode.sample(frameUV)
      })()

      material.colorNode = colorNode
      material.transparent = true
      material.alphaTest = config.alphaClamp
      return material
    }
  }, [config.alphaClamp, config.spritesPerSide])

  useEffect(() => {
    let cleanup: (() => void) | undefined
    initThree()
      .then(fn => {
        cleanup = fn
      })
      .catch(() => {})
    return () => cleanup?.()
  }, [initThree])

  useEffect(() => {
    if (!isReady) return
    const scene = sceneRef.current
    if (!scene) return

    // remove old sprite
    if (spriteRef.current) {
      scene.remove(spriteRef.current)
      spriteRef.current.material.dispose()
      spriteRef.current = null
    }

    if (!textures.albedo || !textures.normal) return

    const material = createMaterial(textures.albedo, textures.normal)
    const sprite = new Sprite(material)
    sprite.position.set(0, 0, 0)
    sprite.scale.set(4, 4, 1)
    scene.add(sprite)
    spriteRef.current = sprite
  }, [textures.albedo, textures.normal, createMaterial, isReady])

  const resetCamera = () => {
    if (!cameraRef.current || !controlsRef.current) return
    cameraRef.current.position.set(0, 0, 5)
    controlsRef.current.target.set(0, 0, 0)
    controlsRef.current.update()
  }

  return { canvasRef, resetCamera, isReady }
}

const useDemoTextures = () => {
  const [textures, setTextures] = useState<TexturePair>({ albedo: null, normal: null })
  const [usingDemo, setUsingDemo] = useState(true)

  useEffect(() => {
    let cancelled = false
    const loader = new TextureLoader()
    const load = (path: string) =>
      new Promise<Texture>((resolve, reject) => {
        loader.load(
          path,
          t => resolve(t),
          undefined,
          e => reject(e)
        )
      })
    Promise.all([load('/exported-textures/albedo_demo.png'), load('/exported-textures/normal_demo.png')])
      .then(([albedo, normal]) => {
        if (cancelled) return
        setTextures({ albedo, normal })
        setUsingDemo(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const setAlbedoFile = (file: File) => {
    const url = URL.createObjectURL(file)
    new TextureLoader().load(url, t => {
      URL.revokeObjectURL(url)
      setTextures(prev => ({ ...prev, albedo: t }))
      setUsingDemo(false)
    })
  }

  const setNormalFile = (file: File) => {
    const url = URL.createObjectURL(file)
    new TextureLoader().load(url, t => {
      URL.revokeObjectURL(url)
      setTextures(prev => ({ ...prev, normal: t }))
      setUsingDemo(false)
    })
  }

  return { textures, usingDemo, setAlbedoFile, setNormalFile }
}

export const WebgpuApp = () => {
  const [config, setConfig] = useState<Config>({
    spritesPerSide: 32,
    alphaClamp: 0.1,
    disableBlending: false,
    hybridDistance: 2.0,
    showWireframe: false,
    isHemispherical: true,
    restrictCameraBelow: true,
  })

  const { textures, setAlbedoFile, setNormalFile } = useDemoTextures()
  const { canvasRef, resetCamera, isReady } = useThree(config, textures)

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 1 }} />

      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          color: 'white',
          background: 'rgba(0,0,0,0.7)',
          padding: 10,
          borderRadius: 5,
          zIndex: 2,
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        <strong>Octahedral Impostor - WebGPU Demo</strong>
        <br />
        Using js WebGPURenderer + TSL Nodes
        <br />
        <br />
        <div style={{ margin: '5px 0' }}>
          <label>
            Albedo Texture:
            <input
              type="file"
              accept="image/*"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) setAlbedoFile(file)
              }}
              style={{ marginLeft: 10 }}
            />
          </label>
          <small style={{ color: '#aaa', display: 'block', marginTop: 2 }}>
            Auto-loads demo texture or upload your own
          </small>
        </div>
        <div style={{ margin: '5px 0' }}>
          <label>
            Normal Map:
            <input
              type="file"
              accept="image/*"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) setNormalFile(file)
              }}
              style={{ marginLeft: 10 }}
            />
          </label>
          <small style={{ color: '#aaa', display: 'block', marginTop: 2 }}>
            Auto-loads demo texture or upload your own
          </small>
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={{ margin: '10px 0' }}>
            <label>
              Alpha Clamp: <span>{config.alphaClamp.toFixed(2)}</span>
            </label>
            <br />
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.01}
              value={config.alphaClamp}
              onChange={e => setConfig(prev => ({ ...prev, alphaClamp: parseFloat(e.target.value) }))}
              style={{ width: 200 }}
            />
          </div>

          <div style={{ margin: '10px 0' }}>
            <label>
              <input
                type="checkbox"
                checked={config.disableBlending}
                onChange={e => setConfig(prev => ({ ...prev, disableBlending: e.target.checked }))}
              />{' '}
              Disable Triplanar Blending
            </label>
          </div>

          <div style={{ margin: '10px 0' }}>
            <label>
              <input
                type="checkbox"
                checked={config.isHemispherical}
                onChange={e => {
                  const isHemispherical = e.target.checked
                  setConfig(prev => ({
                    ...prev,
                    isHemispherical,
                    restrictCameraBelow: isHemispherical ? true : false,
                  }))
                }}
              />{' '}
              Hemispherical Mode
            </label>
          </div>

          <div style={{ margin: '10px 0' }}>
            <label>
              <input
                type="checkbox"
                checked={config.restrictCameraBelow}
                onChange={e => setConfig(prev => ({ ...prev, restrictCameraBelow: e.target.checked }))}
                disabled={!config.isHemispherical}
              />{' '}
              Restrict Camera Below Y=0
            </label>
            <small style={{ color: '#aaa', display: 'block', marginTop: 2 }}>
              Prevents camera artifacts in hemispherical mode
            </small>
          </div>

          <div style={{ margin: '10px 0' }}>
            <label>
              Elevation Threshold: <span>{config.hybridDistance.toFixed(1)}</span>
            </label>
            <br />
            <input
              type="range"
              min={0}
              max={10}
              step={0.1}
              value={config.hybridDistance}
              onChange={e => setConfig(prev => ({ ...prev, hybridDistance: parseFloat(e.target.value) }))}
              style={{ width: 200 }}
            />
          </div>

          <div style={{ margin: '10px 0' }}>
            <button onClick={resetCamera}>Reset Camera</button>
            <button onClick={() => setConfig(prev => ({ ...prev, showWireframe: !prev.showWireframe }))}>
              Toggle Wireframe
            </button>
          </div>
        </div>
        <div style={{ marginTop: 15, fontSize: 11, opacity: 0.8 }}>
          Mouse: Orbit camera
          <br />
          Scroll: Zoom
          <br />
          Requires albedo + normal textures to render impostor
        </div>
      </div>
    </div>
  )
}

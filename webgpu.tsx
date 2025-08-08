import { createRoot } from 'react-dom/client'
import { StrictMode } from 'react'
import { WebgpuApp } from './src/WebgpuApp'

const container = document.getElementById('root')!
createRoot(container).render(
  <StrictMode>
    <WebgpuApp />
  </StrictMode>
)

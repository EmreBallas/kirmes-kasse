import './assets/kasse.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const wurzel = document.getElementById('root')
if (wurzel === null) {
  throw new Error('Element #root fehlt in index.html')
}

createRoot(wurzel).render(
  <StrictMode>
    <App />
  </StrictMode>
)

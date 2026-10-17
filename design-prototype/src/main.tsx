import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'

/* Design system layers, in cascade order:
   tokens (the identity) -> base (reset, type, layout) -> components (the whole
   product's shared surface) -> entry (splash, welcome, introduction, auth). */
import './tokens.css'
import './base.css'
import './components.css'
import './entry.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './index.css'

registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    window.dispatchEvent(
      new CustomEvent('plantick:pwa-ready', {
        detail: {
          registered: Boolean(registration),
        },
      }),
    )
  },
  onRegisterError() {
    window.dispatchEvent(
      new CustomEvent('plantick:pwa-ready', {
        detail: {
          registered: false,
        },
      }),
    )
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)

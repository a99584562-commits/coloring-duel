import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// No StrictMode: it double-invokes effects in dev, which would create the
// PeerJS connection twice and break the WebRTC handshake.
createRoot(document.getElementById('root')).render(<App />)

// PRIMERO: lee un enlace de Supabase Auth (invitación, recuperación) y lo saca
// de la URL antes de que se creen el cliente y el router. Ver capturarCallback.ts.
import '@/services/auth/capturarCallback'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import { aplicarAparienciaInicial } from '@/features/apariencia/opciones'
import '@/styles/global.css'

// Última apariencia conocida del usuario con sesión, antes del primer render:
// evita el destello del tema original mientras llega el perfil.
aplicarAparienciaInicial()

const contenedor = document.getElementById('root')
if (!contenedor) throw new Error('No se encontró #root en index.html')

createRoot(contenedor).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

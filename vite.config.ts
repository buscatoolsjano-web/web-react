/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// La aplicación vive en https://app.buscatools.com, un dominio propio, así que
// se sirve desde la RAÍZ. Antes era /web-react/ porque GitHub Pages publicaba
// bajo el nombre del repositorio.
//
// El cambio de dominio no es cosmético: separar el origen del legacy es lo que
// impide que éste lea `bt-auth`. Ver docs/security/SHARED_ORIGIN_RISK.md.
//
// `VITE_BASE_PATH` queda como escape hatch por si alguna vez hay que volver a
// publicar bajo un subdirectorio.
const DEFAULT_BASE = '/'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = mode === 'production' ? (env.VITE_BASE_PATH ?? DEFAULT_BASE) : '/'

  return {
    base,
    plugins: [react()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port: 5173, strictPort: true },
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
      target: 'es2022',
      rollupOptions: {
        output: {
          // Vite 8 (Rolldown) sólo acepta la forma de función.
          // Separar los vendors permite que el navegador los cachee entre
          // deploys: cambiar código de la app no invalida React ni Supabase.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined
            if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom)[\\/]/.test(id))
              return 'vendor-react'
            if (/[\\/]node_modules[\\/](@tanstack|@supabase)[\\/]/.test(id)) return 'vendor-data'
            return undefined
          },
        },
      },
      chunkSizeWarningLimit: 600,
    },
    test: {
      // jsdom sólo donde hace falta: los tests de lógica pura —que son la
      // mayoría— corren en node, que arranca bastante más rápido. Un test de
      // componente lo pide con `// @vitest-environment jsdom` en su primera
      // línea.
      environment: 'node',
      globals: true,
      setupFiles: ['src/test/setup.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
    },
  }
})

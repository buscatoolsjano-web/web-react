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
    // Id único por build: lo usa la caché persistida como `buster`, así un
    // deploy nuevo descarta la caché guardada en vez de re-hidratarla con una
    // forma de dato vieja. Ver src/lib/persistCache.ts.
    define: { __BUILD_ID__: JSON.stringify(String(Date.now())) },
    plugins: [react()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port: 5173, strictPort: true },
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
      target: 'es2022',
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              // Separar los vendors permite que el navegador los cachee entre
              // deploys: cambiar código de la app no invalida React ni Supabase.
              {
                name: 'vendor-react',
                test: /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
                priority: 3,
              },
              { name: 'vendor-data', test: /[\\/]node_modules[\\/](@tanstack|@supabase)[\\/]/, priority: 2 },
              // El código propio que comparten dos o más pantallas, en UN
              // archivo. Sin esto Rolldown hacía un chunk por cada combinación
              // de pantallas que comparte un módulo: abrir Cotizaciones bajaba
              // 34 archivos de 0–8 kB, y GitHub Pages los sirve de a pocos —
              // ~250 ms cada uno, en cola—, así que la pantalla tardaba ~4,5 s
              // en tener su código antes de pedir un solo dato.
              //
              // Sólo módulos chicos (≤ 40 kB): uno grande y usado en pocas
              // pantallas (el PDF, el Excel) sigue yendo aparte y a pedido.
              // Lo que necesita el arranque queda con el arranque: sin este
              // grupo, el de abajo mezclaba código de pantallas en los
              // archivos que baja el login.
              { name: 'app-inicio', test: /[\\/]src[\\/]/, tags: ['$initial'], priority: 1.5 },
              {
                name: 'app-comun',
                test: /[\\/]src[\\/]/,
                minShareCount: 2,
                maxModuleSize: 40 * 1024,
                entriesAware: true,
                entriesAwareMergeThreshold: 12 * 1024,
                priority: 1,
              },
            ],
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
      // También la lógica PURA de las Edge Functions (Fase 30 · E2). Vivía sin
      // ninguna prueba: vitest sólo miraba `src/`. Los módulos que no importan
      // nada de Deno se pueden correr acá igual, y es donde conviene que
      // estén, porque son los que deciden si un PDF mal leído entra al sistema.
      include: ['src/**/*.{test,spec}.{ts,tsx}', 'supabase/functions/**/*.{test,spec}.ts'],
      // Fase 30: la suite pasó de ~100 archivos a 175 y volvió a pasar lo
      // mismo que en la Fase 14, un escalón más arriba. Tres tests de páginas
      // pesadas —crear cotización, crear pedido, el diálogo de apariencia—
      // empezaron a cortarse en 15 s bajo carga, y los tres pasan en 300 ms
      // corridos solos. No es lógica: es contención de CPU.
      //
      // Sube a 25 s. Sigue cortando un cuelgue real —un test colgado tarda
      // para siempre, no 20 s— y deja de fallar el deploy por una carrera de
      // la máquina. La alternativa de fondo es `isolate: false`, que vitest
      // sugiere y ahorraría ~30 s, pero comparte estado entre archivos y esta
      // suite usa `vi.mock` en todos lados: el riesgo de contaminación
      // cruzada es peor que el problema.
      //
      // Fase 14: con ~100 archivos en paralelo, el PRIMER test de un archivo
      // jsdom pesado (shell, Inicio, diálogo de apariencia) llegó a 5 s por pura
      // contención de CPU; solo tarda ~0,3 s. Ver arriba: ahora son 25.
      testTimeout: 25_000,
      // El reporter, fijado a mano, y no es cosmético.
      //
      // Cuando la salida NO es una terminal —CI, o cualquier cosa que
      // redirija— vitest elige el reporter mínimo, que esconde la consola de
      // los tests que PASAN. Y hay avisos que salen justamente de un test que
      // pasa: los `act(...)` de React, los rechazos sin dueño, los
      // `console.error` de un fallo que el código decidió no mostrar en
      // pantalla. Veintisiete avisos de act vivieron escondidos ahí.
      //
      // Fijándolo acá vale para `npm test`, para CI y para cualquier
      // `npx vitest run` a mano, que es lo que importa: no depende de cómo se
      // lo invoque. El precio es un log de CI más largo.
      reporters: ['default'],
    },
  }
})

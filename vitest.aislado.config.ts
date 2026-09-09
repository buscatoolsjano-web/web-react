import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

/**
 * Suite AISLADA: corre los tests como si no existiera `.env`.
 *
 * Existe por un bug real. Un test importó, sin querer, un módulo de
 * `services/` que a su vez importa el cliente de Supabase. Ese cliente
 * llama a `getEnv()` al importarse, así que el test pasó a exigir
 * variables de entorno. En local pasaba —hay `.env`—; en CI el paso de
 * tests no recibe secrets y el deploy se cayó.
 *
 * El truco es `envDir`: apuntándolo a una carpeta sin archivos `.env`,
 * Vite no inyecta ninguna variable `VITE_*`. Cualquier test que dependa
 * de ellas falla acá, que es exactamente lo que queremos.
 *
 * No renombra ni borra archivos: sirve igual en Windows, en Linux y en CI.
 *
 *   npm run test:isolated
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // `scripts/` no tiene ningún .env — de ahí no se carga nada.
  envDir: 'scripts',
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})

import { defineConfig } from 'vite'

/**
 * Los tests del backend corren aparte de los del front: son Node puro, sin
 * jsdom y sin las variables VITE_*.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
})

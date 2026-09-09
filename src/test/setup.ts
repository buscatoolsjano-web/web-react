import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

/**
 * Setup común de los tests.
 *
 * `cleanup` desmonta lo que quedó montado entre un test y el siguiente. En
 * entorno `node` no hay nada que limpiar y la llamada es inofensiva, así que
 * el mismo archivo sirve para los dos entornos.
 */
afterEach(() => {
  cleanup()
})

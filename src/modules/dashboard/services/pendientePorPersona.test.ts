import { describe, expect, it, vi } from 'vitest'
import {
  documentosSinAutor,
  separarMiFila,
  totalDe,
  totalHecho,
  type PendienteDePersona,
} from './pendientePorPersona'

/* Lo que se prueba acá son funciones puras, pero viven en el mismo módulo que
   la consulta, que importa el cliente de Supabase y valida el entorno al
   cargarse. `vi.mock` se eleva arriba de los imports, así que el cliente queda
   reemplazado antes de que el módulo se cargue. Sin esto el test exige
   variables VITE_* y falla en la suite aislada y en CI, donde no existen.
   Ver ADR-019. */
vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

const fila = (p: Partial<PendienteDePersona> & { nombre: string }): PendienteDePersona => ({
  userId: p.nombre.toLowerCase(),
  rol: 'employee',
  esMio: false,
  correos: 0,
  cotizaciones: 0,
  pedidos: 0,
  hecho: { cotizaciones: 0, pedidos: 0, entregas: 0, correos: 0 },
  ...p,
})

const NADIE = fila({
  nombre: 'Sin asignar',
  userId: null,
  rol: '',
  correos: 717,
  cotizaciones: 143,
  pedidos: 28,
  hecho: { cotizaciones: 9, pedidos: 4, entregas: 4, correos: 0 },
})

describe('separarMiFila', () => {
  it('saca mi fila del resto en vez de dejarla dos veces', () => {
    const yo = fila({ nombre: 'Jano', esMio: true })
    const otro = fila({ nombre: 'Norberto' })

    const { mio, resto } = separarMiFila([otro, yo, NADIE])

    expect(mio).toBe(yo)
    expect(resto).toEqual([otro, NADIE])
  })

  it('sin fila marcada devuelve null y el resto entero', () => {
    const filas = [fila({ nombre: 'Norberto' }), NADIE]
    const { mio, resto } = separarMiFila(filas)

    expect(mio).toBeNull()
    expect(resto).toEqual(filas)
  })

  /*
   * «Sin asignar» es `userId: null` y nunca `esMio`, así que siempre cae del
   * lado del resto. Es importante: es el montón que no repartió nadie, y es el
   * dato que hay que seguir viendo abajo.
   */
  it('la fila de nadie nunca es la mía', () => {
    const { mio, resto } = separarMiFila([fila({ nombre: 'Jano', esMio: true }), NADIE])

    expect(mio?.nombre).toBe('Jano')
    expect(resto).toEqual([NADIE])
  })

  it('no toca la lista que recibe', () => {
    const filas = [fila({ nombre: 'Jano', esMio: true }), NADIE]
    separarMiFila(filas)
    expect(filas).toHaveLength(2)
  })
})

describe('documentosSinAutor', () => {
  /* Los tres tipos de la fila «Sin asignar»: 9 + 4 + 4. */
  it('suma los documentos del mes que no registran autor', () => {
    expect(documentosSinAutor([fila({ nombre: 'Jano', esMio: true }), NADIE])).toBe(17)
  })

  /*
   * El correo NO entra: un correo enviado siempre sabe quién lo mandó, así que
   * no hay correo «sin autor» que explicar. Si se colara, el pie diría un
   * número más grande que los documentos que efectivamente faltan.
   */
  it('no cuenta el correo', () => {
    const conCorreo = { ...NADIE, hecho: { ...NADIE.hecho, correos: 50 } }
    expect(documentosSinAutor([conCorreo])).toBe(17)
  })

  it('sin fila de nadie no hay nada que explicar', () => {
    expect(documentosSinAutor([fila({ nombre: 'Jano', esMio: true })])).toBe(0)
    expect(documentosSinAutor([])).toBe(0)
  })
})

describe('totalDe y totalHecho', () => {
  it('el pendiente suma correos y pedidos, NO las cotizaciones (Fase 117)', () => {
    // NADIE = 717 correos + 143 cotizaciones + 28 pedidos; las cotizaciones no
    // cuentan (una que el cliente nunca contesta quedaría colgada para siempre).
    expect(totalDe(NADIE)).toBe(745)
  })

  it('lo hecho suma los tres documentos Y el correo', () => {
    expect(
      totalHecho(fila({ nombre: 'Jano', hecho: { cotizaciones: 3, pedidos: 1, entregas: 2, correos: 5 } })),
    ).toBe(11)
  })

  it('sin movimientos da cero, no NaN', () => {
    expect(totalDe(fila({ nombre: 'Nadie' }))).toBe(0)
    expect(totalHecho(fila({ nombre: 'Nadie' }))).toBe(0)
  })
})

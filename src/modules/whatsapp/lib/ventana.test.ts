import { describe, expect, it } from 'vitest'
import { presentarVentana } from './ventana'
import { nombreVisible } from './nombre'
import { nombreDeTipo, presentarEstado, seDibuja } from './estados'

const AHORA = new Date('2026-09-16T12:00:00.000Z')
const enHoras = (h: number) => new Date(AHORA.getTime() + h * 3_600_000).toISOString()

describe('ventana de servicio', () => {
  it('abierta: se puede escribir y dice hasta cuándo', () => {
    const v = presentarVentana(enHoras(10), AHORA)
    expect(v.estado).toBe('abierta')
    expect(v.puedeEscribir).toBe(true)
    expect(v.texto).toMatch(/hasta las \d{2}:\d{2}/)
  })

  it('por cerrar: avisa cuánto falta, pero deja escribir', () => {
    const v = presentarVentana(enHoras(1), AHORA)
    expect(v.estado).toBe('por_cerrar')
    expect(v.puedeEscribir).toBe(true)
    expect(v.texto).toContain('faltan')
  })

  it('cerrada: no deja escribir y nombra la plantilla', () => {
    const v = presentarVentana(enHoras(-1), AHORA)
    expect(v.estado).toBe('cerrada')
    expect(v.puedeEscribir).toBe(false)
    expect(v.texto).toContain('plantilla')
  })

  it('el borde exacto cuenta como cerrada: no se manda al filo', () => {
    expect(presentarVentana(AHORA.toISOString(), AHORA).puedeEscribir).toBe(false)
  })

  it('sin ningún entrante no se puede iniciar la conversación', () => {
    const v = presentarVentana(null, AHORA)
    expect(v.estado).toBe('sin_contacto')
    expect(v.puedeEscribir).toBe(false)
  })

  it('nombra el día cuando el vencimiento no es hoy', () => {
    expect(presentarVentana(enHoras(23), AHORA).texto).toContain('mañana a las')
    expect(presentarVentana(enHoras(4), AHORA).texto).toMatch(/hasta las \d{2}:\d{2}/)
  })

  it('una fecha rota se trata como cerrada, nunca como abierta', () => {
    expect(presentarVentana('no-es-una-fecha', AHORA).puedeEscribir).toBe(false)
  })
})

describe('estado de un mensaje', () => {
  it('cada estado tiene palabra propia: nunca sólo un ícono', () => {
    for (const e of ['pending', 'sending', 'sent', 'delivered', 'read', 'failed', 'received']) {
      expect(presentarEstado(e).etiqueta.length).toBeGreaterThan(2)
    }
  })

  it('sólo el fallo se marca como error', () => {
    expect(presentarEstado('failed').esError).toBe(true)
    expect(presentarEstado('read').esError).toBe(false)
    expect(presentarEstado('delivered').esError).toBe(false)
  })

  it('un estado desconocido no rompe la burbuja', () => {
    expect(presentarEstado('vino_de_marte').etiqueta).toBe('En cola')
    expect(presentarEstado(null).etiqueta).toBe('En cola')
  })
})

describe('tipos de mensaje', () => {
  it('todo tipo se puede nombrar, se dibuje o no', () => {
    for (const t of ['text', 'image', 'location', 'contacts', 'order', 'unknown', 'algo_nuevo']) {
      expect(nombreDeTipo(t).length).toBeGreaterThan(3)
    }
  })

  it('los que hoy no se dibujan quedan marcados como tales', () => {
    expect(seDibuja('text')).toBe(true)
    expect(seDibuja('image')).toBe(true)
    expect(seDibuja('location')).toBe(false)
    expect(seDibuja('unknown')).toBe(false)
  })
})

describe('nombre de la conversación', () => {
  it('el cliente le gana al perfil, y el perfil al número', () => {
    expect(nombreVisible({ clienteNombre: 'Mirgor', perfil: 'Juan', telefono: '+5491111' })).toBe('Mirgor')
    expect(nombreVisible({ clienteNombre: null, perfil: 'Juan', telefono: '+5491111' })).toBe('Juan')
    expect(nombreVisible({ clienteNombre: null, perfil: null, telefono: '+5491111' })).toBe('+5491111')
    expect(nombreVisible({ clienteNombre: null, perfil: null, telefono: null })).toBe('Sin identificar')
  })
})

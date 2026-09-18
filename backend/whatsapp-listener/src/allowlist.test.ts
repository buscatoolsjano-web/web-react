import { describe, expect, it } from 'vitest'
import { PoliticaViva, gruposVigentes, type FuenteDeAllowlist } from './allowlist.js'
import { RegistroEnMemoria } from './registro.js'
import type { GrupoAutorizado } from './politica.js'

/**
 * La allowlist que se lee de la base.
 *
 * Lo que se prueba acá no es «lee una tabla»: es qué pasa cuando **no** la
 * puede leer. Un listener que ante un error de red se pone a guardar todo es
 * un incidente de privacidad; uno que corta al primer hipo pierde conversación
 * que no vuelve, porque WhatsApp no reenvía a un dispositivo vinculado.
 */

const grupo = (id: string, habilitado = true, ia = false): GrupoAutorizado => ({
  idExterno: id,
  habilitado,
  iaHabilitada: ia,
})

/** Una fuente que se puede romper y arreglar desde el test. */
class FuenteFalsa implements FuenteDeAllowlist {
  lecturas = 0
  constructor(
    public grupos: GrupoAutorizado[] = [],
    public falla = false,
  ) {}
  leer(): Promise<GrupoAutorizado[]> {
    this.lecturas += 1
    if (this.falla) return Promise.reject(new Error('supabase no contesta'))
    return Promise.resolve(this.grupos)
  }
}

describe('Qué grupos valen ahora', () => {
  const G = [grupo('120@g.us')]

  it('si nunca se pudo leer, NADA está autorizado', () => {
    expect(gruposVigentes({ grupos: [], leidoEn: null }, 1000, 60_000)).toEqual([])
    // Ni siquiera si por algún motivo quedaron grupos en memoria sin lectura.
    expect(gruposVigentes({ grupos: G, leidoEn: null }, 1000, 60_000)).toEqual([])
  })

  it('una lectura reciente vale', () => {
    expect(gruposVigentes({ grupos: G, leidoEn: 1000 }, 2000, 60_000)).toEqual(G)
  })

  it('una lectura vieja NO vale: pasado el margen se deniega todo', () => {
    expect(gruposVigentes({ grupos: G, leidoEn: 1000 }, 1000 + 60_001, 60_000)).toEqual([])
  })

  it('justo en el límite todavía vale', () => {
    expect(gruposVigentes({ grupos: G, leidoEn: 1000 }, 1000 + 60_000, 60_000)).toEqual(G)
  })
})

describe('La política viva', () => {
  const armar = (fuente: FuenteFalsa, opciones = {}) => {
    const registro = new RegistroEnMemoria()
    let reloj = 1_000_000
    const p = new PoliticaViva(
      fuente,
      { listenerHabilitado: true, refrescoMs: 60_000, maxAntiguedadMs: 10 * 60_000, ahora: () => reloj, ...opciones },
      registro,
    )
    return { p, registro, avanzar: (ms: number) => { reloj += ms } }
  }

  it('antes de la primera lectura no hay nada autorizado', () => {
    const { p } = armar(new FuenteFalsa([grupo('120@g.us')]))
    expect(p.politica().grupos).toEqual([])
    expect(p.autorizados).toBe(0)
  })

  it('después de leer, los grupos habilitados valen', async () => {
    const { p } = armar(new FuenteFalsa([grupo('120@g.us'), grupo('999@g.us', false)]))
    await p.refrescar()
    expect(p.politica().grupos).toHaveLength(2)
    expect(p.autorizados).toBe(1)
  })

  it('un grupo que se deshabilita en la tabla deja de valer SIN reiniciar', async () => {
    const fuente = new FuenteFalsa([grupo('120@g.us')])
    const { p } = armar(fuente)
    await p.refrescar()
    expect(p.autorizados).toBe(1)

    fuente.grupos = [grupo('120@g.us', false)]
    await p.refrescar()
    expect(p.autorizados).toBe(0)
    // Y sigue en la lista: «deshabilitado» no es «no existe».
    expect(p.politica().grupos).toHaveLength(1)
  })

  it('y volver a habilitarlo lo devuelve, tampoco hace falta reiniciar', async () => {
    const fuente = new FuenteFalsa([grupo('120@g.us', false)])
    const { p } = armar(fuente)
    await p.refrescar()
    expect(p.autorizados).toBe(0)

    fuente.grupos = [grupo('120@g.us', true)]
    await p.refrescar()
    expect(p.autorizados).toBe(1)
  })

  it('si la base NUNCA contestó, se deniega todo', async () => {
    const { p, registro } = armar(new FuenteFalsa([], true))
    await p.refrescar()
    expect(p.politica().grupos).toEqual([])
    expect(registro.texto).toContain('allowlist_no_leida')
    expect(registro.texto).toContain('siguenVigentes=0')
  })

  it('si dejó de contestar, la última lista buena aguanta un rato', async () => {
    const fuente = new FuenteFalsa([grupo('120@g.us')])
    const { p, avanzar } = armar(fuente)
    await p.refrescar()

    fuente.falla = true
    avanzar(60_000)
    await p.refrescar()
    expect(p.autorizados, 'un minuto después sigue valiendo').toBe(1)
  })

  it('pero pasado el margen se corta la ingesta', async () => {
    const fuente = new FuenteFalsa([grupo('120@g.us')])
    const { p, avanzar, registro } = armar(fuente)
    await p.refrescar()

    fuente.falla = true
    avanzar(10 * 60_000 + 1)
    await p.refrescar()
    expect(p.autorizados).toBe(0)
    expect(registro.texto).toContain('siguenVigentes=0')
  })

  it('y cuando la base vuelve, la ingesta vuelve', async () => {
    const fuente = new FuenteFalsa([grupo('120@g.us')])
    const { p, avanzar } = armar(fuente)
    await p.refrescar()
    fuente.falla = true
    avanzar(10 * 60_000 + 1)
    await p.refrescar()
    expect(p.autorizados).toBe(0)

    fuente.falla = false
    await p.refrescar()
    expect(p.autorizados).toBe(1)
  })

  it('el kill switch manda por encima de la allowlist', async () => {
    const { p } = armar(new FuenteFalsa([grupo('120@g.us')]), { listenerHabilitado: false })
    await p.refrescar()
    expect(p.politica().listenerHabilitado).toBe(false)
  })

  it('no registra una línea por minuto si nada cambió', async () => {
    const fuente = new FuenteFalsa([grupo('120@g.us')])
    const { p, registro } = armar(fuente)
    await p.refrescar()
    await p.refrescar()
    await p.refrescar()
    expect(registro.lineas.filter((l) => l.tipo === 'allowlist_actualizada')).toHaveLength(1)
  })

  it('pero sí cuando cambia', async () => {
    const fuente = new FuenteFalsa([grupo('120@g.us')])
    const { p, registro } = armar(fuente)
    await p.refrescar()
    fuente.grupos = [grupo('120@g.us'), grupo('777@g.us')]
    await p.refrescar()
    expect(registro.lineas.filter((l) => l.tipo === 'allowlist_actualizada')).toHaveLength(2)
  })

  it('el log de la allowlist no lleva nombres de grupo, sólo cuentas', async () => {
    const { p, registro } = armar(new FuenteFalsa([grupo('120363412822972580@g.us')]))
    await p.refrescar()
    expect(registro.texto).not.toContain('120363412822972580')
  })
})

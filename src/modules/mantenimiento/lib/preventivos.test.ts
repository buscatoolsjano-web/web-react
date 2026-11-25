import { describe, expect, it } from 'vitest'
import { preventivosAAvisar, type OrdenParaPreventivo } from './preventivos'

const HOY = '2026-11-25'

function orden(p: Partial<OrdenParaPreventivo> & { assetId: string }): OrdenParaPreventivo {
  return { creada: '2026-01-01T10:00:00Z', cerrada: true, proximoPreventivo: null, ...p }
}

describe('preventivosAAvisar', () => {
  it('avisa los vencidos y los que vencen dentro de 30 días, lo más urgente primero', () => {
    const r = preventivosAAvisar(
      [
        orden({ assetId: 'a', proximoPreventivo: '2026-12-10' }),
        orden({ assetId: 'b', proximoPreventivo: '2026-11-01' }),
        orden({ assetId: 'c', proximoPreventivo: '2027-03-01' }),
        orden({ assetId: 'd', proximoPreventivo: HOY }),
      ],
      HOY,
    )
    expect(r.map((x) => [x.assetId, x.dias, x.vencido])).toEqual([
      ['b', -24, true],
      ['d', 0, false],
      ['a', 15, false],
    ])
  })

  it('manda la última orden: una abierta silencia, una cerrada sin fecha también', () => {
    const r = preventivosAAvisar(
      [
        orden({ assetId: 'a', creada: '2026-01-01', proximoPreventivo: '2026-06-01' }),
        orden({ assetId: 'a', creada: '2026-11-20', cerrada: false }),
        orden({ assetId: 'b', creada: '2026-01-01', proximoPreventivo: '2026-06-01' }),
        orden({ assetId: 'b', creada: '2026-08-01', proximoPreventivo: null }),
      ],
      HOY,
    )
    expect(r).toEqual([])
  })

  it('la fecha nueva reemplaza a la vieja', () => {
    const r = preventivosAAvisar(
      [
        orden({ assetId: 'a', creada: '2025-01-01', proximoPreventivo: '2025-06-01' }),
        orden({ assetId: 'a', creada: '2026-05-01', proximoPreventivo: '2027-05-01' }),
      ],
      HOY,
    )
    expect(r).toEqual([])
  })
})

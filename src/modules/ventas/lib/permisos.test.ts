import { describe, expect, it } from 'vitest'
import { escribeVentas } from './permisos'

describe('escribeVentas', () => {
  it('sólo admin y employee (el conjunto de app.current_writer_company_ids)', () => {
    expect(escribeVentas('admin')).toBe(true)
    expect(escribeVentas('employee')).toBe(true)
    for (const rol of ['salesperson', 'technician', 'customer', 'distributor', '', null, undefined]) {
      expect(escribeVentas(rol)).toBe(false)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { ConfigInvalida, configParaLog, leerConfig } from './config.js'

/**
 * La config.
 *
 * Dos cosas que se prueban acá y que no son detalles: que el listener **nace
 * apagado** si nadie lo encendió, y que la config que se loguea al arrancar no
 * lleva el service role adentro.
 */

const MINIMO = {
  SUPABASE_URL: 'https://uaxcfufvapzulqvynanp.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sbp_ejemplo_de_prueba_que_no_es_una_clave',
  INTERNAL_WHATSAPP_COMPANY_ID: '11111111-2222-3333-4444-555555555555',
  INTERNAL_WHATSAPP_ACCOUNT_ID: '66666666-7777-8888-9999-000000000000',
}

/** Con base de verdad. Sin esto, el repositorio es el de memoria. */
const CON_BASE = { ...MINIMO, WHATSAPP_REPOSITORIO: 'supabase' }

describe('Leer la config del entorno', () => {
  it('con lo mínimo alcanza', () => {
    const c = leerConfig({ ...CON_BASE })
    expect(c.companyId).toBe(MINIMO.INTERNAL_WHATSAPP_COMPANY_ID)
    expect(c.accountId).toBe(MINIMO.INTERNAL_WHATSAPP_ACCOUNT_ID)
  })

  it('sin base no se piden las variables de la base: vincular el teléfono no necesita Supabase', () => {
    const c = leerConfig({})
    expect(c.repositorio).toBe('memoria')
    expect(c.accountId).toBe('')
  })

  it('pero apenas se dice «supabase», se exigen las cuatro', () => {
    expect(() => leerConfig({ WHATSAPP_REPOSITORIO: 'supabase' })).toThrow(ConfigInvalida)
  })

  it('si no dijeron que sí, arranca APAGADO', () => {
    expect(leerConfig({ ...CON_BASE }).listenerHabilitado).toBe(false)
    expect(leerConfig({ ...CON_BASE, LISTENER_ENABLED: '' }).listenerHabilitado).toBe(false)
    expect(leerConfig({ ...CON_BASE, LISTENER_ENABLED: '1' }).listenerHabilitado).toBe(false)
    expect(leerConfig({ ...CON_BASE, LISTENER_ENABLED: 'yes' }).listenerHabilitado).toBe(false)
    expect(leerConfig({ ...CON_BASE, LISTENER_ENABLED: 'si' }).listenerHabilitado).toBe(false)
  })

  it('se enciende sólo con un "true" explícito', () => {
    expect(leerConfig({ ...CON_BASE, LISTENER_ENABLED: 'true' }).listenerHabilitado).toBe(true)
    expect(leerConfig({ ...CON_BASE, LISTENER_ENABLED: ' TRUE ' }).listenerHabilitado).toBe(true)
  })

  it('la sesión y el puerto tienen default', () => {
    const c = leerConfig({ ...CON_BASE })
    expect(c.rutaDeSesion).toBe('.whatsapp-auth')
    expect(c.puertoDeSalud).toBe(8081)
  })

  it('un puerto que no es número no deja el proceso sin puerto', () => {
    expect(leerConfig({ ...CON_BASE, HEALTH_PORT: 'ocho mil' }).puertoDeSalud).toBe(8081)
    expect(leerConfig({ ...CON_BASE, HEALTH_PORT: '9090' }).puertoDeSalud).toBe(9090)
  })

  it('falta una variable: falla al arrancar, no a la hora de escribir', () => {
    const sinCuenta = { ...CON_BASE, INTERNAL_WHATSAPP_ACCOUNT_ID: '' }
    expect(() => leerConfig(sinCuenta)).toThrow(ConfigInvalida)
    try {
      leerConfig(sinCuenta)
    } catch (e) {
      expect((e as ConfigInvalida).faltantes).toEqual(['INTERNAL_WHATSAPP_ACCOUNT_ID'])
    }
  })

  it('el error nombra todo lo que falta, no sólo lo primero', () => {
    try {
      leerConfig({ WHATSAPP_REPOSITORIO: 'supabase' })
      expect.unreachable('tenía que fallar')
    } catch (e) {
      expect((e as ConfigInvalida).faltantes).toHaveLength(4)
    }
  })
})

describe('La config que se loguea', () => {
  it('no lleva el service role adentro', () => {
    const texto = JSON.stringify(configParaLog(leerConfig({ ...CON_BASE })))
    expect(texto).not.toContain(MINIMO.SUPABASE_SERVICE_ROLE_KEY)
    expect(texto.toLowerCase()).not.toContain('service')
  })

  it('los uuid van cortados: alcanzan para correlacionar, no para copiar', () => {
    const log = configParaLog(leerConfig({ ...CON_BASE }))
    expect(log['companyId']).toBe('11111111…')
    expect(String(log['accountId'])).not.toContain('000000000000')
  })
})

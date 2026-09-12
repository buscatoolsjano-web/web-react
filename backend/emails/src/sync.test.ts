/**
 * El algoritmo de sincronización, probado entero sin tocar Gmail.
 *
 * Lo que más importa acá es el último bloque: **un resync completo no puede
 * borrar el estado del ERP**. Es la lección de las 91 filas del legacy, y es lo
 * único de este módulo que, si se rompe, pierde datos que nadie puede
 * reconstruir.
 */
import { describe, it, expect } from 'vitest'
import { sincronizar, historyIdMayor, filaDesdeHilo } from './sync.js'
import { AlmacenMemoria, GmailFalso, cuentaDePrueba, hilo } from './pruebas/dobles.js'

const BUZON = 'buzon@prueba.invalid'

function armar(opciones: { historyIdInicial?: string | null } = {}) {
  // `??` no sirve acá: convertiría `null` en '1000' y el caso «cuenta sin
  // cursor» —el primer sync de todos— nunca se probaría. Hay que preguntar si
  // la clave vino, no si el valor es nulo.
  const historyIdInicial =
    'historyIdInicial' in opciones ? (opciones.historyIdInicial ?? null) : '1000'
  const cuenta = cuentaDePrueba({ email_address: BUZON, last_history_id: historyIdInicial })
  const almacen = new AlmacenMemoria(cuenta)
  const gmail = new GmailFalso()
  return { cuenta, almacen, gmail }
}

describe('historyIdMayor', () => {
  it('compara como número, no como texto', () => {
    // Como texto, '9' > '10'. Ese bug haría retroceder el cursor.
    expect(historyIdMayor('9', '10')).toBe(true)
    expect(historyIdMayor('10', '9')).toBe(false)
  })

  it('trata null como «no hay cursor todavía»', () => {
    expect(historyIdMayor(null, '5')).toBe(true)
    expect(historyIdMayor('5', null)).toBe(false)
  })

  it('no explota con basura', () => {
    expect(historyIdMayor('abc', 'def')).toBe(false)
  })
})

describe('filaDesdeHilo', () => {
  it('saca metadata y NINGÚN cuerpo', () => {
    const { cuenta } = armar()
    const h = hilo({
      id: 't1', historyId: '1001', asunto: 'Presupuesto',
      de: 'Ana <ana@cliente.invalid>', para: BUZON, cuando: 1_700_000_000_000,
    })
    const fila = filaDesdeHilo(cuenta, h)

    expect(fila.gmail_thread_id).toBe('t1')
    expect(fila.subject).toBe('Presupuesto')
    expect(fila.snippet).toBe('extracto de Presupuesto')
    expect(fila.participants).toContain('ana@cliente.invalid')
    expect(fila.participants).toContain(BUZON)
    expect(fila.message_count).toBe(1)
    // Nada que se parezca a un cuerpo.
    expect(Object.keys(fila)).not.toContain('body_html')
    expect(Object.keys(fila)).not.toContain('body_text')
  })

  it('marca la dirección: si el último mensaje es nuestro, es saliente', () => {
    const { cuenta } = armar()
    const entrante = filaDesdeHilo(cuenta, hilo({
      id: 't1', historyId: '1', asunto: 'a', de: 'x@cliente.invalid', para: BUZON, cuando: 1,
    }))
    const saliente = filaDesdeHilo(cuenta, hilo({
      id: 't2', historyId: '1', asunto: 'b', de: BUZON, para: 'x@cliente.invalid', cuando: 1,
    }))
    expect(entrante.last_message_dir).toBe('in')
    expect(saliente.last_message_dir).toBe('out')
  })
})

describe('sincronización incremental', () => {
  it('trae los hilos tocados y avanza el cursor', async () => {
    const { cuenta, almacen, gmail } = armar()
    gmail.agregar(hilo({ id: 't1', historyId: '1001', asunto: 'Uno', de: 'a@x.invalid', para: BUZON, cuando: 1 }), '1001')
    gmail.agregar(hilo({ id: 't2', historyId: '1002', asunto: 'Dos', de: 'b@x.invalid', para: BUZON, cuando: 2 }), '1002')

    const r = await sincronizar({
      cuenta, gmail, almacen, duenoLease: 'w1', historyIdEvento: '1002', origen: 'push',
    })

    expect(r.hilosTocados).toBe(2)
    expect(r.resyncCompleto).toBe(false)
    expect(almacen.hilos.size).toBe(2)
    expect((await almacen.cuentaPorId(cuenta.id))?.last_history_id).toBe('1002')
  })

  it('es idempotente: el mismo evento dos veces deja el mismo resultado', async () => {
    const { cuenta, almacen, gmail } = armar()
    gmail.agregar(hilo({ id: 't1', historyId: '1001', asunto: 'Uno', de: 'a@x.invalid', para: BUZON, cuando: 1 }), '1001')

    await sincronizar({ cuenta, gmail, almacen, duenoLease: 'w1', historyIdEvento: '1001', origen: 'push' })
    const trasPrimero = almacen.hilos.size

    const cuenta2 = (await almacen.cuentaPorId(cuenta.id))!
    await sincronizar({ cuenta: cuenta2, gmail, almacen, duenoLease: 'w1', historyIdEvento: '1001', origen: 'push' })

    expect(almacen.hilos.size).toBe(trasPrimero)
    expect(almacen.hilos.size).toBe(1)
  })

  it('NO retrocede el cursor con un evento viejo', async () => {
    const { cuenta, almacen, gmail } = armar({ historyIdInicial: '2000' })
    gmail.historyIdActual = '2000'

    const r = await sincronizar({
      cuenta, gmail, almacen, duenoLease: 'w1', historyIdEvento: '1500', origen: 'push',
    })

    expect(r.hilosTocados).toBe(0)
    expect((await almacen.cuentaPorId(cuenta.id))?.last_history_id).toBe('2000')
    // Ni siquiera pidió el historial: salió antes de gastar cuota.
    expect(gmail.llamadas).toHaveLength(0)
  })

  it('sale sin trabajar si otro proceso tiene el lease', async () => {
    const { cuenta, almacen, gmail } = armar()
    gmail.agregar(hilo({ id: 't1', historyId: '1001', asunto: 'Uno', de: 'a@x.invalid', para: BUZON, cuando: 1 }), '1001')

    // Otro worker se lo lleva primero.
    await almacen.tomarLease(cuenta.id, 'otro-worker')

    const r = await sincronizar({
      cuenta, gmail, almacen, duenoLease: 'w1', historyIdEvento: '1001', origen: 'push',
    })

    expect(r.omitidoPorLease).toBe(true)
    expect(almacen.hilos.size).toBe(0)
  })

  it('el lease se suelta al terminar, así el siguiente evento entra', async () => {
    const { cuenta, almacen, gmail } = armar()
    gmail.agregar(hilo({ id: 't1', historyId: '1001', asunto: 'Uno', de: 'a@x.invalid', para: BUZON, cuando: 1 }), '1001')

    await sincronizar({ cuenta, gmail, almacen, duenoLease: 'w1', historyIdEvento: '1001', origen: 'push' })
    const c = await almacen.cuentaPorId(cuenta.id)
    expect(c?.sync_lock_until).toBeNull()
    expect(c?.sync_lock_owner).toBeNull()
  })

  it('saltea un hilo que se borró entre el evento y la lectura', async () => {
    const { cuenta, almacen, gmail } = armar()
    // El historial lo menciona, pero el hilo ya no está.
    gmail.historial.set('1001', ['fantasma'])
    gmail.historyIdActual = '1001'

    const r = await sincronizar({
      cuenta, gmail, almacen, duenoLease: 'w1', historyIdEvento: '1001', origen: 'push',
    })

    expect(r.hilosTocados).toBe(1)
    expect(almacen.hilos.size).toBe(0)
  })

  it('registra la corrida en el log de sync', async () => {
    const { cuenta, almacen, gmail } = armar()
    gmail.agregar(hilo({ id: 't1', historyId: '1001', asunto: 'Uno', de: 'a@x.invalid', para: BUZON, cuando: 1 }), '1001')

    await sincronizar({ cuenta, gmail, almacen, duenoLease: 'w1', historyIdEvento: '1001', origen: 'push' })

    expect(almacen.logs).toHaveLength(1)
    expect(almacen.logs[0]?.kind).toBe('push')
    expect(almacen.logs[0]?.historial_vencido).toBe(false)
  })
})

describe('historial vencido', () => {
  it('404 dispara resync completo y lo deja anotado', async () => {
    const { cuenta, almacen, gmail } = armar()
    gmail.agregar(hilo({ id: 't1', historyId: '1001', asunto: 'Uno', de: 'a@x.invalid', para: BUZON, cuando: 1 }), '1001')
    gmail.agregar(hilo({ id: 't2', historyId: '1002', asunto: 'Dos', de: 'b@x.invalid', para: BUZON, cuando: 2 }), '1002')
    gmail.vencerHistorial = true

    const r = await sincronizar({
      cuenta, gmail, almacen, duenoLease: 'w1', historyIdEvento: '9999', origen: 'push',
    })

    expect(r.historialVencido).toBe(true)
    expect(r.resyncCompleto).toBe(true)
    expect(almacen.hilos.size).toBe(2)
    expect(almacen.logs.at(-1)?.kind).toBe('resync_completo')
    expect(almacen.logs.at(-1)?.historial_vencido).toBe(true)
  })

  it('la primera sincronización, sin cursor, es completa', async () => {
    const { cuenta, almacen, gmail } = armar({ historyIdInicial: null })
    gmail.agregar(hilo({ id: 't1', historyId: '1001', asunto: 'Uno', de: 'a@x.invalid', para: BUZON, cuando: 1 }), '1001')

    const r = await sincronizar({ cuenta, gmail, almacen, duenoLease: 'w1', origen: 'manual' })

    expect(r.resyncCompleto).toBe(true)
    expect(r.historialVencido).toBe(false)
    expect(almacen.hilos.size).toBe(1)
  })

  it('el resync toma el historyId ANTES de listar, para no saltear cambios', async () => {
    const { cuenta, almacen, gmail } = armar({ historyIdInicial: null })
    gmail.agregar(hilo({ id: 't1', historyId: '1001', asunto: 'Uno', de: 'a@x.invalid', para: BUZON, cuando: 1 }), '1001')

    await sincronizar({ cuenta, gmail, almacen, duenoLease: 'w1', origen: 'manual' })

    // `perfil` antes que `listarHilos`: si fuera al revés, lo que entrara
    // durante el listado quedaría por debajo del cursor y se perdería.
    expect(gmail.llamadas.indexOf('perfil')).toBeLessThan(gmail.llamadas.indexOf('listarHilos'))
  })
})

describe('EL RESYNC NO PUEDE BORRAR EL ESTADO DEL ERP', () => {
  it('conserva assigned_to y workflow_status al rehacer el índice', async () => {
    const { cuenta, almacen, gmail } = armar()
    gmail.agregar(hilo({ id: 't1', historyId: '1001', asunto: 'Uno', de: 'a@x.invalid', para: BUZON, cuando: 1 }), '1001')

    // Alguien ya trabajó este hilo: lo asignó y lo puso en proceso.
    almacen.estados.set(`${cuenta.id}|t1`, { workflow_status: 'en_proceso', assigned_to: 'juan' })

    gmail.vencerHistorial = true
    const r = await sincronizar({
      cuenta, gmail, almacen, duenoLease: 'w1', historyIdEvento: '9999', origen: 'push',
    })

    expect(r.resyncCompleto).toBe(true)
    // El índice se rehízo…
    expect(almacen.hilos.size).toBe(1)
    // …y el estado sigue intacto, con sus dos campos.
    expect(almacen.estados.get(`${cuenta.id}|t1`)).toEqual({
      workflow_status: 'en_proceso',
      assigned_to: 'juan',
    })
  })

  it('conserva el estado de un hilo que ya NO existe en Gmail', async () => {
    const { cuenta, almacen, gmail } = armar()
    // Un hilo que el ERP trabajó y que en Gmail ya no está.
    almacen.estados.set(`${cuenta.id}|viejo`, { workflow_status: 'resuelto', assigned_to: 'ana' })
    gmail.vencerHistorial = true

    await sincronizar({ cuenta, gmail, almacen, duenoLease: 'w1', historyIdEvento: '9999', origen: 'push' })

    // No se borra: el índice hace upsert, nunca delete.
    expect(almacen.estados.get(`${cuenta.id}|viejo`)).toEqual({
      workflow_status: 'resuelto',
      assigned_to: 'ana',
    })
  })
})

describe('el resync se acota, porque el buzón real tiene 26.833 mensajes', () => {
  it('respeta el tope de hilos por corrida', async () => {
    const { cuenta, almacen, gmail } = armar({ historyIdInicial: null })
    for (let i = 0; i < 12; i++) {
      gmail.agregar(
        hilo({ id: `t${i}`, historyId: '1001', asunto: `H${i}`, de: 'a@x.invalid', para: BUZON, cuando: i }),
        '1001',
      )
    }

    const r = await sincronizar({
      cuenta, gmail, almacen, duenoLease: 'w1', origen: 'manual', maxHilosResync: 5,
    })

    // Cortar no es perder: el índice es descartable y la próxima corrida
    // vuelve a listar. Exceder el timeout a mitad de camino sí sería un problema.
    expect(r.hilosTocados).toBe(5)
    expect(almacen.hilos.size).toBe(5)
  })

  it('le pasa la ventana a Gmail en vez de traer el buzón entero', async () => {
    const { cuenta, almacen, gmail } = armar({ historyIdInicial: null })
    gmail.agregar(hilo({ id: 't1', historyId: '1001', asunto: 'Uno', de: 'a@x.invalid', para: BUZON, cuando: 1 }), '1001')

    await sincronizar({
      cuenta, gmail, almacen, duenoLease: 'w1', origen: 'manual', ventanaResync: 'newer_than:7d',
    })

    expect(gmail.llamadas).toContain('listarHilos:newer_than:7d')
  })

  it('el sync incremental NO usa ventana: el cursor ya lo acota', async () => {
    const { cuenta, almacen, gmail } = armar()
    gmail.agregar(hilo({ id: 't1', historyId: '1001', asunto: 'Uno', de: 'a@x.invalid', para: BUZON, cuando: 1 }), '1001')

    await sincronizar({
      cuenta, gmail, almacen, duenoLease: 'w1', historyIdEvento: '1001', origen: 'push',
      ventanaResync: 'newer_than:7d',
    })

    expect(gmail.llamadas.some((l) => l.startsWith('listarHilos'))).toBe(false)
    expect(gmail.llamadas).toContain('historial:1000')
  })
})

describe('has_attachments sale de una búsqueda, no de las partes', () => {
  it('marca el hilo que Gmail reporta con adjunto', async () => {
    const { cuenta, almacen, gmail } = armar()
    gmail.agregar(hilo({ id: 't1', historyId: '1001', asunto: 'Con', de: 'a@x.invalid', para: BUZON, cuando: 1 }), '1001')
    gmail.agregar(hilo({ id: 't2', historyId: '1001', asunto: 'Sin', de: 'b@x.invalid', para: BUZON, cuando: 2 }), '1001')
    gmail.conAdjunto = new Set(['t1'])

    await sincronizar({ cuenta, gmail, almacen, duenoLease: 'w1', historyIdEvento: '1001', origen: 'push' })

    expect(almacen.hilos.get(`${cuenta.id}|t1`)?.has_attachments).toBe(true)
    expect(almacen.hilos.get(`${cuenta.id}|t2`)?.has_attachments).toBe(false)
  })

  it('la búsqueda es UNA sola por corrida, no una por hilo', async () => {
    const { cuenta, almacen, gmail } = armar()
    for (let i = 0; i < 5; i++) {
      gmail.agregar(hilo({ id: `t${i}`, historyId: '1001', asunto: `H${i}`, de: 'a@x.invalid', para: BUZON, cuando: i }), '1001')
    }

    await sincronizar({ cuenta, gmail, almacen, duenoLease: 'w1', historyIdEvento: '1001', origen: 'push' })

    expect(gmail.llamadas.filter((l) => l.startsWith('conAdjunto:'))).toHaveLength(1)
  })

  it('si la búsqueda falla, el sync sigue sin el flag en vez de romperse', async () => {
    const { cuenta, almacen, gmail } = armar()
    gmail.agregar(hilo({ id: 't1', historyId: '1001', asunto: 'Uno', de: 'a@x.invalid', para: BUZON, cuando: 1 }), '1001')
    gmail.hilosConAdjunto = async () => { throw new Error('Gmail caído') }

    const r = await sincronizar({ cuenta, gmail, almacen, duenoLease: 'w1', historyIdEvento: '1001', origen: 'push' })

    expect(r.hilosTocados).toBe(1)
    expect(almacen.hilos.get(`${cuenta.id}|t1`)?.has_attachments).toBe(false)
  })
})

import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { ETIQUETA_CLASE, presentarSugerencias } from '../lib/formato'
import {
  useBuscarClientes,
  useClienteVinculado,
  useSugerencias,
  useVincular,
} from '../hooks/useEmails'
import type { EstadoHilo, HiloIndice } from '../types'
import styles from './Emails.module.css'

export interface PanelClienteProps {
  hilo: HiloIndice
  estado: EstadoHilo | undefined
}

const ORIGEN: Record<string, string> = {
  exacto: 'por coincidencia exacta',
  sugerido_dominio: 'por dominio',
  ambiguo: 'entre varias opciones',
  manual: 'a mano',
}

/**
 * El vínculo con el CRM.
 *
 * Con cliente: su nombre, un acceso a la ficha y hasta cinco contactos. No se
 * intenta meter el CRM entero acá.
 *
 * Sin cliente: las sugerencias —ninguna se aplica sola— y un buscador para
 * vincular a mano. La base rechaza un cliente de otra empresa.
 */
export function PanelCliente({ hilo, estado }: PanelClienteProps) {
  const clienteId = estado?.clienteId ?? null
  const cliente = useClienteVinculado(clienteId)
  const sugerencias = useSugerencias(hilo, !!estado && !clienteId)
  const vincular = useVincular(hilo)
  const idBuscar = useId()
  const [texto, setTexto] = useState('')
  const [consulta, setConsulta] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setConsulta(texto), 300)
    return () => clearTimeout(t)
  }, [texto])
  const encontrados = useBuscarClientes(consulta)

  return (
    <section className={styles.panel} aria-labelledby={`${idBuscar}-t`}>
      <h2 id={`${idBuscar}-t`} className={styles.panelTitulo}>
        Cliente
      </h2>

      {!estado ? (
        <p className={styles.nota}>Cargando…</p>
      ) : clienteId ? (
        <>
          {cliente.isPending ? (
            <p className={styles.nota}>Cargando…</p>
          ) : cliente.data ? (
            <>
              <Link to={`/clientes/${cliente.data.id}`} className={styles.enlace}>
                {cliente.data.nombre}
              </Link>
              <p className={styles.nota}>
                {cliente.data.referencia ? `${cliente.data.referencia} · ` : ''}
                Vinculado {ORIGEN[estado.vinculoOrigen ?? 'manual'] ?? ''}
              </p>
              {cliente.data.contactos.length > 0 ? (
                <ul className={styles.contactos} aria-label="Contactos del cliente">
                  {cliente.data.contactos.map((c) => (
                    <li key={c.id} className={styles.nota}>
                      <strong>{c.nombre}</strong>
                      {c.email ? ` · ${c.email}` : ''}
                      {c.telefono ? ` · ${c.telefono}` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className={styles.nota}>El cliente vinculado no está disponible.</p>
          )}
          <button
            type="button"
            className={styles.boton}
            disabled={vincular.isPending}
            onClick={() => vincular.mutate(null)}
          >
            Desvincular cliente
          </button>
        </>
      ) : (
        <>
          {sugerencias.isPending ? (
            <p className={styles.nota}>Buscando coincidencias…</p>
          ) : (sugerencias.data ?? []).length === 0 ? (
            <p className={styles.nota}>No hay coincidencias con clientes por dirección ni por dominio.</p>
          ) : (
            <ul className={styles.sugerencias} aria-label="Sugerencias de cliente">
              {presentarSugerencias(sugerencias.data ?? []).map((s) => (
                <li key={`${s.clienteId}|${s.contactoId ?? ''}|${s.direccion}`} className={styles.sugerencia}>
                  <span className={styles.sugerenciaTexto}>
                    <span>
                      {s.clienteNombre}
                      {s.recomendada ? ' ★' : ''}
                    </span>
                    <span className={styles.nota}>
                      {ETIQUETA_CLASE[s.clase]} · {s.direccion}
                      {s.contactoNombre ? ` · ${s.contactoNombre}` : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={s.recomendada ? styles.botonPrimario : styles.boton}
                    disabled={vincular.isPending}
                    aria-label={`Vincular ${s.clienteNombre}`}
                    onClick={() => vincular.mutate({ id: s.clienteId, contactoId: s.contactoId, origen: s.clase })}
                  >
                    Vincular
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label className={styles.campo} htmlFor={idBuscar}>
            Vincular a mano
            <input
              id={idBuscar}
              type="search"
              className={styles.buscador}
              placeholder="Razón social o referencia…"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
          </label>
          {consulta.trim().length >= 2 ? (
            encontrados.isPending ? (
              <p className={styles.nota}>Buscando…</p>
            ) : (encontrados.data ?? []).length === 0 ? (
              <p className={styles.nota}>Sin resultados.</p>
            ) : (
              <ul className={styles.sugerencias} aria-label="Clientes encontrados">
                {(encontrados.data ?? []).map((c) => (
                  <li key={c.id} className={styles.sugerencia}>
                    <span className={styles.sugerenciaTexto}>
                      <span>{c.nombre}</span>
                      {c.referencia ? <span className={styles.nota}>{c.referencia}</span> : null}
                    </span>
                    <button
                      type="button"
                      className={styles.boton}
                      disabled={vincular.isPending}
                      aria-label={`Vincular ${c.nombre}`}
                      onClick={() => {
                        vincular.mutate({ id: c.id, contactoId: null, origen: 'manual' })
                        setTexto('')
                      }}
                    >
                      Vincular
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </>
      )}

      {vincular.error ? (
        <p className={styles.nota} role="alert">
          {vincular.error.message}
        </p>
      ) : null}
    </section>
  )
}

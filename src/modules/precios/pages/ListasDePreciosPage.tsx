import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { ImagenProducto } from '@/modules/catalogo/components/ImagenProducto'
import tabla from '@/components/tables/Tabla.module.css'
import { useFuentesDeListas, usePlanillaDePrecios, useVersionesDeLista } from '../hooks/useListas'
import { formatearPct, variacionEntre } from '../lib/comparativa'
import styles from './ListasDePreciosPage.module.css'

const POR_PAGINA = 25

const fecha = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' })

const importe = (n: number | null | undefined) =>
  n === null || n === undefined
    ? null
    : n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Listas de precios (Fase 49 · planilla en la Fase 50).
 *
 * La planilla ADENTRO: una fila por referencia y una columna por fecha, como
 * la hoja que se lleva a mano. La primera versión mostraba un enlace al Excel
 * del Drive y no servía para nada — lo que hace falta es leer los precios sin
 * salir del ERP y ver la progresión de un vistazo.
 *
 * **No es la pantalla de precios de venta.** Esos los llena STEL y viven en el
 * Catálogo; `product_prices` es de sólo lectura para el ERP. Acá se registra
 * lo que manda el fabricante.
 *
 * Las columnas salen de la lista de VERSIONES, no de las claves del jsonb de
 * precios: el orden de las claves de un jsonb lo normaliza Postgres, y confiar
 * en él ya costó una vez (Fase 43).
 */
export function ListasDePreciosPage() {
  const fuentes = useFuentesDeListas()
  const [fuenteId, setFuenteId] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [buscado, setBuscado] = useState('')
  const [pagina, setPagina] = useState(1)

  const elegida = fuenteId ?? fuentes.data?.[0]?.id ?? null
  const versiones = useVersionesDeLista(elegida)
  const planilla = usePlanillaDePrecios(elegida, { texto: buscado, pagina, porPagina: POR_PAGINA })

  // Se espera a que pare de tipear: con miles de referencias, una consulta
  // por tecla son diez viajes a São Paulo para mostrar un resultado.
  useEffect(() => {
    const t = setTimeout(() => {
      setBuscado((b) => (b === texto ? b : texto))
      setPagina(1)
    }, 300)
    return () => clearTimeout(t)
  }, [texto])

  /**
   * Las fechas, de la MÁS NUEVA a la más vieja.
   *
   * El precio vigente es el que se busca el 90 % de las veces, así que va en
   * la primera columna y la historia se extiende hacia la derecha. Con diez
   * listas, el orden inverso dejaría el precio de hoy fuera de la pantalla.
   */
  const fechas = useMemo(
    () => (versiones.data ?? []).map((v) => v.fecha),
    [versiones.data],
  )
  const moneda = versiones.data?.[0]?.moneda ?? ''

  const paginas = Math.max(1, Math.ceil((planilla.data?.total ?? 0) / POR_PAGINA))

  const elegirFuente = (id: string) => {
    setFuenteId(id)
    setPagina(1)
    setTexto('')
    setBuscado('')
  }

  return (
    <div className={styles.pagina}>
      <PageHeader
        title="Listas de precios"
        subtitle="Lo que manda cada marca, con el precio de cada lista al lado del anterior."
      />

      <Alert tone="info" title="Esto no cambia los precios del catálogo">
        <p>
          Los precios de venta los sigue manejando STEL. Acá queda registrado lo que llega de
          cada fabricante, con su archivo y su fecha, para ver cuánto aumentó y decidir qué
          actualizar.
        </p>
      </Alert>

      {fuentes.isPending ? (
        <SkeletonRows rows={3} columns={3} label="Cargando listas…" />
      ) : (fuentes.data ?? []).length === 0 ? (
        <EmptyState
          title="Todavía no hay listas cargadas"
          description="Las listas se cargan desde los archivos del Drive. Cuando haya una, aparece acá con su historial."
        />
      ) : (
        <>
          <div className={styles.fuentes} role="tablist" aria-label="Marcas con lista de precios">
            {(fuentes.data ?? []).map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={f.id === elegida}
                className={f.id === elegida ? `${styles.fuente} ${styles.activa}` : styles.fuente}
                onClick={() => elegirFuente(f.id)}
              >
                <span className={styles.fuenteNombre}>{f.nombre}</span>
                <span className={styles.fuenteDato}>
                  {f.versiones === 1 ? '1 lista' : `${f.versiones} listas`}
                </span>
              </button>
            ))}
          </div>

          <div className={styles.barra}>
            <Field label="Buscar por referencia o descripción" hideLabel className={styles.campoBuscar}>
              <Input
                type="search"
                value={texto}
                placeholder="Buscar por referencia o descripción…"
                onChange={(e) => setTexto(e.target.value)}
              />
            </Field>
            <span className={styles.nota}>
              {planilla.isPending
                ? 'Buscando…'
                : `${(planilla.data?.total ?? 0).toLocaleString('es-AR')} referencias`}
              {fechas.length > 0 ? ` · ${fechas.length === 1 ? '1 lista' : `${fechas.length} listas`} · ${moneda}` : ''}
            </span>
          </div>

          {planilla.error ? (
            <Alert tone="danger" role="alert" title="No se pudo leer la lista">
              <p>{planilla.error.message}</p>
            </Alert>
          ) : planilla.isPending ? (
            <SkeletonRows rows={10} columns={5} label="Cargando la planilla…" />
          ) : (planilla.data?.filas ?? []).length === 0 ? (
            <EmptyState
              title="Ninguna referencia coincide"
              description="Probá con parte de la referencia o del nombre del producto."
            />
          ) : (
            <>
              <div className={tabla.contenedor}>
                <table className={`${tabla.tabla} ${styles.planilla}`}>
                  <caption className="sr-only">Precios por referencia y por fecha de lista</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={styles.colFoto}>
                        <span className="sr-only">Foto</span>
                      </th>
                      <th scope="col">Referencia</th>
                      <th scope="col">Descripción</th>
                      {fechas.map((f, i) => (
                        <th key={f} scope="col" className={`${tabla.num} ${i === 0 ? styles.colVigente : ''}`}>
                          {fecha(f)}
                          {i === 0 ? <span className={styles.vigente}>vigente</span> : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(planilla.data?.filas ?? []).map((fila) => (
                      <tr key={fila.reference}>
                        <td className={styles.colFoto}>
                          <ImagenProducto imagen={fila.imagen} alt="" tamano="thumb" prioridad="eager" />
                        </td>
                        <td className={tabla.nowrap}>
                          <code className={styles.ref}>{fila.reference}</code>
                          {fila.sku !== null ? (
                            <span className={styles.sku}>{fila.sku}</span>
                          ) : (
                            <span className={styles.sinProducto}>no está en el catálogo</span>
                          )}
                        </td>
                        <td className={styles.colDesc}>
                          {fila.description ?? <span className={tabla.secundario}>—</span>}
                        </td>
                        {fechas.map((f, i) => {
                          const valor = fila.precios[f]
                          const previa = i + 1 < fechas.length ? fila.precios[fechas[i + 1]!] : undefined
                          const pct = variacionEntre(valor, previa)
                          const texto = importe(valor)
                          return (
                            <td key={f} className={`${tabla.num} ${i === 0 ? styles.colVigente : ''}`}>
                              {texto === null ? (
                                /* Vacía a propósito: no estaba en esa lista.
                                   Un cero diría que valía cero. */
                                <span className={styles.ausente} title="No estaba en esta lista">
                                  —
                                </span>
                              ) : (
                                <>
                                  <span className={styles.precio}>{texto}</span>
                                  {pct !== null && pct !== 0 ? (
                                    <span className={pct > 0 ? styles.sube : styles.baja}>
                                      {formatearPct(pct)}
                                    </span>
                                  ) : null}
                                </>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {fechas.length === 1 ? (
                /* Decirlo en vez de dejar una sola columna sin explicación. */
                <p className={styles.nota}>
                  Hay una sola lista de esta marca, así que todavía no hay con qué comparar. Cuando
                  se cargue la siguiente aparece como una columna más, con el porcentaje al lado.
                </p>
              ) : null}

              {paginas > 1 ? (
                <div className={styles.paginador}>
                  <Button variant="secondary" size="sm" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
                    Anterior
                  </Button>
                  <span className={styles.nota}>
                    Página {pagina} de {paginas}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pagina >= paginas}
                    onClick={() => setPagina(pagina + 1)}
                  >
                    Siguiente
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  )
}

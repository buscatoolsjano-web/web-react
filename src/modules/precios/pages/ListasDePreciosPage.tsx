import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { SkeletonRows } from '@/components/ui/Skeleton'
import tabla from '@/components/tables/Tabla.module.css'
import { useCambiosDeVersion, useFuentesDeListas, useVersionesDeLista } from '../hooks/useListas'
import {
  ETIQUETA,
  formatearPct,
  ordenarParaMirar,
  resumir,
  tonoDe,
} from '../lib/comparativa'
import styles from './ListasDePreciosPage.module.css'

/** Cuántos renglones se listan: el resumen se calcula sobre TODOS igual. */
const EN_PANTALLA = 200

const fecha = (iso: string | null) =>
  iso === null ? '—' : new Date(`${iso}T12:00:00`).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })

const importe = (n: number | null, moneda: string) =>
  n === null ? '—' : `${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moneda}`

/**
 * Listas de precios (Fase 49).
 *
 * Qué mandó cada marca, cuándo, y cuánto cambió respecto de la vez anterior.
 *
 * **No es la pantalla de precios de venta.** Esos los llena STEL y viven en el
 * Catálogo; `product_prices` es de sólo lectura para el ERP. Acá se registra
 * lo que llega del fabricante, que es el dato con el que se decide si hay que
 * actualizar algo allá.
 *
 * La comparativa necesita DOS listas de la misma marca. Mientras haya una
 * sola, la pantalla lo dice en lugar de mostrar un 0 % que parecería un dato.
 */
export function ListasDePreciosPage() {
  const fuentes = useFuentesDeListas()
  const [fuenteId, setFuenteId] = useState<string | null>(null)
  const [versionId, setVersionId] = useState<string | null>(null)

  const elegida = fuenteId ?? fuentes.data?.[0]?.id ?? null
  const versiones = useVersionesDeLista(elegida)
  const versionElegida = versionId ?? versiones.data?.[0]?.id ?? null
  const version = versiones.data?.find((v) => v.id === versionElegida) ?? null
  const cambios = useCambiosDeVersion(versionElegida)

  const { resumen, filas, esPrimera } = useMemo(() => {
    const lista = cambios.data ?? []
    const primera = lista.length > 0 && lista.every((c) => c.movimiento === 'primera lista')
    return { resumen: resumir(lista), filas: ordenarParaMirar(lista), esPrimera: primera }
  }, [cambios.data])

  const elegirFuente = (id: string) => {
    setFuenteId(id)
    setVersionId(null)
  }

  return (
    <div className={styles.pagina}>
      <PageHeader
        title="Listas de precios"
        subtitle="Lo que manda cada marca, y cuánto cambió respecto de la lista anterior."
      />

      {/* Lo primero que hay que entender de esta pantalla, porque si no se
          confunde con los precios del Catálogo. */}
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
                  {f.versiones === 1 ? '1 lista' : `${f.versiones} listas`} · {fecha(f.ultima)}
                </span>
              </button>
            ))}
          </div>

          {versiones.isPending ? (
            <SkeletonRows rows={2} columns={4} label="Cargando versiones…" />
          ) : (
            <>
              <div className={styles.versiones}>
                {(versiones.data ?? []).map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={v.id === versionElegida ? `${styles.version} ${styles.activa}` : styles.version}
                    onClick={() => setVersionId(v.id)}
                  >
                    <strong>{fecha(v.fecha)}</strong>
                    <span className={styles.secundario}>
                      {v.renglones.toLocaleString('es-AR')} renglones · {v.moneda}
                    </span>
                  </button>
                ))}
              </div>

              {version ? (
                <section className={styles.ficha} aria-label="Detalle de la lista">
                  <dl className={styles.datos}>
                    <div>
                      <dt>Archivo</dt>
                      <dd>
                        {version.enlace ? (
                          <a href={version.enlace} target="_blank" rel="noreferrer">
                            {version.archivo ?? 'ver'}
                          </a>
                        ) : (
                          (version.archivo ?? '—')
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Columna que se compara</dt>
                      <dd>{version.columnaAncla}</dd>
                    </div>
                    <div>
                      <dt>Cruzan con el catálogo</dt>
                      <dd>
                        {version.cruzan.toLocaleString('es-AR')} de {version.renglones.toLocaleString('es-AR')}
                        {version.renglones > 0 ? (
                          <span className={styles.secundario}>
                            {' '}
                            ({Math.round((version.cruzan / version.renglones) * 100)} %)
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  </dl>
                  {version.nota ? <p className={styles.nota}>{version.nota}</p> : null}
                </section>
              ) : null}

              {cambios.isPending ? (
                <SkeletonRows rows={8} columns={5} label="Armando la comparativa…" />
              ) : cambios.error ? (
                <Alert tone="danger" role="alert" title="No se pudo armar la comparativa">
                  <p>{cambios.error.message}</p>
                </Alert>
              ) : esPrimera ? (
                /* Decirlo en vez de mostrar un 0 %: un cero acá parecería que
                   los precios no se movieron, cuando lo que pasa es que no hay
                   con qué compararlos. */
                <Alert tone="info" title="Es la primera lista de esta marca">
                  <p>
                    No hay una lista anterior con la que comparar. En cuanto se cargue la
                    siguiente, acá vas a ver cuánto cambió cada producto.
                  </p>
                </Alert>
              ) : (
                <>
                  <div className={styles.resumen}>
                    <Tarjeta valor={formatearPct(resumen.medianaPct)} rotulo="Mediana del cambio" destacada />
                    <Tarjeta valor={formatearPct(resumen.promedioPct)} rotulo="Promedio" />
                    <Tarjeta valor={String(resumen.subieron)} rotulo="Subieron" />
                    <Tarjeta valor={String(resumen.bajaron)} rotulo="Bajaron" />
                    <Tarjeta valor={String(resumen.iguales)} rotulo="Sin cambio" />
                    <Tarjeta valor={String(resumen.entraron)} rotulo="Nuevos" />
                    <Tarjeta valor={String(resumen.salieron)} rotulo="Ya no están" />
                  </div>

                  {/* La mediana y el promedio juntos, y la explicación de por
                      qué pueden no parecerse: un solo renglón mal cargado se
                      come el promedio y la mediana lo aguanta. */}
                  {resumen.medianaPct !== null &&
                  resumen.promedioPct !== null &&
                  Math.abs(resumen.promedioPct - resumen.medianaPct) > 10 ? (
                    <Alert tone="warning" title="El promedio y la mediana no se parecen">
                      <p>
                        Suele significar que unos pocos renglones se movieron muchísimo —a veces
                        porque el precio anterior estaba mal cargado—. La mediana es la que
                        describe lo que pasó con la mayoría; mirá los extremos de la tabla.
                      </p>
                    </Alert>
                  ) : null}

                  <div className={tabla.contenedor}>
                    <table className={tabla.tabla}>
                      <caption className="sr-only">Cambios respecto de la lista anterior</caption>
                      <thead>
                        <tr>
                          <th scope="col">Referencia</th>
                          <th scope="col">Descripción</th>
                          <th scope="col" className={tabla.num}>Anterior</th>
                          <th scope="col" className={tabla.num}>Ahora</th>
                          <th scope="col" className={tabla.num}>Cambio</th>
                          <th scope="col">Movimiento</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filas.slice(0, EN_PANTALLA).map((c) => (
                          <tr key={c.reference}>
                            <td className={tabla.nowrap}>
                              <code className={styles.ref}>{c.reference}</code>
                              {c.productId === null ? (
                                <Badge tone="neutral">No está en el catálogo</Badge>
                              ) : null}
                            </td>
                            <td>{c.description ?? <span className={tabla.secundario}>—</span>}</td>
                            <td className={tabla.num}>{importe(c.precioAnterior, version?.moneda ?? '')}</td>
                            <td className={tabla.num}>{importe(c.precio, version?.moneda ?? '')}</td>
                            <td className={`${tabla.num} ${styles[tonoDe(c.movimiento)]}`}>
                              {formatearPct(c.porcentaje)}
                            </td>
                            <td className={tabla.nowrap}>{ETIQUETA[c.movimiento]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {filas.length > EN_PANTALLA ? (
                    <p className={styles.nota}>
                      Se muestran los {EN_PANTALLA} que más se movieron, de {filas.length.toLocaleString('es-AR')}.
                      Los números de arriba están calculados sobre todos.
                    </p>
                  ) : null}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function Tarjeta({ valor, rotulo, destacada = false }: { valor: string; rotulo: string; destacada?: boolean }) {
  return (
    <div className={destacada ? `${styles.tarjeta} ${styles.destacada}` : styles.tarjeta}>
      <span className={styles.tarjetaValor}>{valor}</span>
      <span className={styles.tarjetaRotulo}>{rotulo}</span>
    </div>
  )
}

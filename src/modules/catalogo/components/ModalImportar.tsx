import { useId, useRef, useState } from 'react'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Spinner } from '@/components/ui/Spinner'
import { useModalAccesible } from '@/components/modals/useModalAccesible'
import { parsearCatalogo, type CatalogoParseado } from '../lib/importarCatalogo'
import { aplicarImportacion, type ResultadoImport } from '../services/importarCatalogo'
import type { DefinicionAtributo } from '../types'
import styles from './ModalExportar.module.css'
import imp from './ModalImportar.module.css'

/**
 * Importar un CSV para ACTUALIZAR el catálogo (Fase 111).
 *
 * Mismo formato que produce «Exportar». Detecta todas las columnas del archivo,
 * deja destildar las que no se quieran aplicar, matchea por Referencia (SKU) y
 * reporta qué se actualizó, qué referencias no existen y qué falló. No crea
 * productos ni toca precio/stock.
 */
export function ModalImportar({
  companyId,
  definiciones,
  onCerrar,
  onImportado,
}: {
  companyId: string
  definiciones: readonly DefinicionAtributo[]
  onCerrar: () => void
  onImportado: () => void
}) {
  const idTitulo = useId()
  const caja = useRef<HTMLDivElement>(null)
  useModalAccesible(caja, { onClose: onCerrar })

  const [parseado, setParseado] = useState<CatalogoParseado | null>(null)
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null)
  const [elegidas, setElegidas] = useState<ReadonlySet<string>>(new Set())
  const [aplicando, setAplicando] = useState(false)
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null)
  const [resultado, setResultado] = useState<ResultadoImport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const alLeerArchivo = async (archivo: File) => {
    setError(null); setResultado(null)
    try {
      const texto = await archivo.text()
      const p = parsearCatalogo(texto, definiciones)
      setParseado(p)
      setNombreArchivo(archivo.name)
      // Por omisión se aplican TODAS las columnas elegibles; el usuario destilda.
      setElegidas(new Set(p.columnas.filter((c) => c.elegible).map((c) => c.clave)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.')
    }
  }

  const alternar = (clave: string) =>
    setElegidas((s) => {
      const n = new Set(s)
      if (n.has(clave)) n.delete(clave)
      else n.add(clave)
      return n
    })

  const elegibles = parseado?.columnas.filter((c) => c.elegible) ?? []
  const ignoradas = parseado?.columnas.filter((c) => c.destino.tipo === 'ignorada') ?? []
  const nElegidas = elegibles.filter((c) => elegidas.has(c.clave)).length
  // La Referencia (la llave) va primera, después las columnas que se pueden
  // aplicar. Las ignoradas no se muestran en la previsualización.
  const esLlaveDestino = (tipo: string) => tipo === 'match' || tipo === 'match-id'
  const columnasMostradas = parseado
    ? parseado.columnas.filter((c) => esLlaveDestino(c.destino.tipo) || c.elegible)
    : []
  // El valor de la PRIMERA fila del archivo, como ejemplo de qué es cada columna.
  const ejemplo = parseado?.filas[0]?.valores ?? {}

  const aplicar = async () => {
    if (!parseado) return
    setAplicando(true); setError(null); setAvance({ hechas: 0, total: parseado.filas.length })
    try {
      const r = await aplicarImportacion(companyId, parseado, elegidas, (hechas, total) => setAvance({ hechas, total }))
      setResultado(r)
      if (r.actualizados > 0) onImportado()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo importar.')
    } finally {
      setAplicando(false); setAvance(null)
    }
  }

  return (
    <div className={styles.fondo}>
      <div ref={caja} className={`${styles.modal} ${imp.ancho}`} role="dialog" aria-modal="true" aria-labelledby={idTitulo} tabIndex={-1}>
        <header className={styles.barra}>
          <h2 className={styles.titulo} id={idTitulo}>Importar para actualizar</h2>
          <IconButton icon="x" aria-label="Cerrar" onClick={onCerrar} />
        </header>

        <div className={styles.cuerpo}>
          {resultado ? (
            <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
              <Alert tone="success">
                Actualizados: <b>{resultado.actualizados}</b>. Sin cambios: {resultado.sinCambios}.
              </Alert>
              {resultado.noEncontrados.length > 0 ? (
                <Alert tone="warning">
                  {resultado.noEncontrados.length} referencia(s) no existen en el catálogo (no se crea nada):{' '}
                  {resultado.noEncontrados.slice(0, 20).join(', ')}
                  {resultado.noEncontrados.length > 20 ? '…' : ''}
                </Alert>
              ) : null}
              {resultado.errores.length > 0 ? (
                <Alert tone="danger">
                  {resultado.errores.length} fila(s) con error:
                  <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                    {resultado.errores.slice(0, 15).map((e) => (
                      <li key={e.sku}>{e.sku}: {e.motivo}</li>
                    ))}
                  </ul>
                </Alert>
              ) : null}
            </div>
          ) : (
            <>
              <p className={imp.intro}>
                Subí un CSV exportado del catálogo (editado en Excel). Se matchea por <b>Referencia</b> y se
                actualiza lo que elijas. <b>Nunca crea productos</b> (es para actualizar) ni toca precio o stock.
              </p>

              <input
                type="file"
                accept=".csv,text/csv"
                aria-label="Archivo CSV"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void alLeerArchivo(f) }}
              />

              {error ? <div style={{ marginTop: 'var(--space-3)' }}><Alert tone="danger">{error}</Alert></div> : null}

              {parseado ? (
                parseado.sinReferencia ? (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <Alert tone="danger">El archivo no tiene ni «ID interno» ni «Referencia». Sin una de las dos no se puede matchear.</Alert>
                  </div>
                ) : (
                  <div>
                    <p className={imp.resumen}>
                      <b>{nombreArchivo}</b> · {parseado.filas.length} fila(s). Mirá el ejemplo de la primera fila y
                      destildá las columnas que no quieras aplicar:
                    </p>

                    {/* Previsualización: las columnas una al lado de otra, con el
                        valor de la primera fila debajo, como una planilla. La
                        fila va rotulada «Ejemplo» y sobre un fondo distinto para
                        que se lea como muestra, no como un dato editable. */}
                    <div className={imp.preview}>
                      <div className={imp.previewBarra}>
                        <span className={imp.previewTitulo}>Vista previa de columnas</span>
                        <span className={imp.previewBadge}>Primera fila, a modo de ejemplo</span>
                      </div>
                      <div className={imp.scroll}>
                        <table className={imp.tabla}>
                          <thead>
                            <tr>
                              <th className={imp.thStub} aria-hidden="true" />
                              {columnasMostradas.map((c) => {
                                const esLlave = esLlaveDestino(c.destino.tipo)
                                const aplicada = esLlave || elegidas.has(c.clave)
                                return (
                                  <th key={c.clave} className={aplicada ? imp.th : `${imp.th} ${imp.thApagada}`}>
                                    {esLlave ? (
                                      <span className={imp.etiqueta}>
                                        {c.etiqueta} <span className={imp.llave}>llave</span>
                                      </span>
                                    ) : (
                                      <label className={imp.etiqueta}>
                                        <input type="checkbox" checked={elegidas.has(c.clave)} onChange={() => alternar(c.clave)} />
                                        {c.etiqueta}
                                      </label>
                                    )}
                                  </th>
                                )
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            <tr className={imp.filaEjemplo}>
                              <td className={imp.tdStub}>Ejemplo</td>
                              {columnasMostradas.map((c) => {
                                const aplicada = esLlaveDestino(c.destino.tipo) || elegidas.has(c.clave)
                                const valor = ejemplo[c.clave]?.trim()
                                return (
                                  <td key={c.clave} className={aplicada ? imp.td : `${imp.td} ${imp.tdApagada}`} title={valor || ''}>
                                    {valor || <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                                  </td>
                                )
                              })}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {ignoradas.length > 0 ? (
                      <p className={imp.nota}>
                        No se importan: {ignoradas.map((c) => c.etiqueta).join(', ')}
                        {' '}(precio: lo administra STEL; stock: por movimientos).
                      </p>
                    ) : null}
                    {parseado.desconocidas.length > 0 ? (
                      <p className={imp.nota}>Columnas no reconocidas (se ignoran): {parseado.desconocidas.join(', ')}</p>
                    ) : null}
                  </div>
                )
              ) : null}
            </>
          )}
        </div>

        <footer className={styles.pie}>
          {avance ? <span className={styles.conteo}><Spinner size={16} /> {avance.hechas}/{avance.total}</span> : <span />}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="ghost" onClick={onCerrar}>{resultado ? 'Cerrar' : 'Cancelar'}</Button>
            {!resultado ? (
              <Button
                onClick={() => void aplicar()}
                disabled={!parseado || parseado.sinReferencia || nElegidas === 0 || parseado.filas.length === 0 || aplicando}
              >
                {aplicando ? 'Importando…' : `Aplicar a ${parseado?.filas.length ?? 0} fila(s)`}
              </Button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  )
}

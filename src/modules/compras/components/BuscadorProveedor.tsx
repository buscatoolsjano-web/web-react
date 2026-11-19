import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { buscarProveedores, type ProveedorBuscado } from '../services/catalogo'
import { useCrearProveedor } from '../hooks/useEdicionProveedores'
import { permisosDe } from '../lib/permisos'
import { PROVEEDOR_VACIO } from '../lib/validacion'
import styles from './BuscadorProveedor.module.css'

export interface BuscadorProveedorProps {
  /** El proveedor ya elegido, para mostrarlo sin volver a buscarlo. */
  elegido: ProveedorBuscado | null
  deshabilitado?: boolean
  error?: string | null
  onElegir: (p: ProveedorBuscado) => void
  onLimpiar: () => void
  /** Para ubicarlo en la grilla de la cabecera (Fase 235). */
  className?: string | undefined
  /**
   * `hoja`: dentro de la vista previa (Fase 241), sin rótulo y del tamaño
   * del texto de la hoja, como el buscador de clientes en Ventas.
   */
  apariencia?: 'erp' | 'hoja' | undefined
}

/**
 * Buscador de proveedores, contra el servidor.
 *
 * Un `<select>` con los 142 ya sería incómodo, y con 500 sería el error que
 * cometimos en Ventas: un desplegable de 1.010 clientes que había que
 * reemplazar. Se busca por razón social, nombre comercial y referencia, y
 * vuelven como mucho 20 filas.
 *
 * Los dados de baja y los inactivos **no aparecen**: para eso sirve la baja
 * lógica. Un pedido viejo los sigue nombrando igual.
 */
export function BuscadorProveedor({
  elegido,
  deshabilitado = false,
  error = null,
  onElegir,
  onLimpiar,
  className,
  apariencia = 'erp',
}: BuscadorProveedorProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const id = useId()
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [consulta, setConsulta] = useState('')
  // Alta rápida sin salir del pedido: antes había que ir a Proveedores en otra
  // pestaña, crear el proveedor y volver a buscarlo.
  const puedeCrear = permisosDe(activa).crearProveedor
  const crear = useCrearProveedor()
  const [altaRapida, setAltaRapida] = useState(false)
  const [nuevo, setNuevo] = useState({ razonSocial: '', cuit: '', email: '', moneda: '' })
  const abrirAlta = () => {
    setNuevo({ razonSocial: texto.trim(), cuit: '', email: '', moneda: '' })
    crear.reset()
    setAltaRapida(true)
  }
  const confirmarAlta = () => {
    if (nuevo.razonSocial.trim() === '') return
    crear.mutate(
      {
        ...PROVEEDOR_VACIO,
        razonSocial: nuevo.razonSocial,
        cuit: nuevo.cuit,
        email: nuevo.email,
        monedaPorDefecto: nuevo.moneda,
      },
      {
        onSuccess: (r) => {
          onElegir({
            id: r.id,
            referencia: r.referencia,
            razonSocial: nuevo.razonSocial.trim(),
            nombreComercial: null,
            formaPago: null,
            moneda: nuevo.moneda || null,
          })
          setAltaRapida(false)
          setAbierto(false)
        },
      },
    )
  }

  // Se espera a que la persona pare de tipear.
  useEffect(() => {
    const t = setTimeout(() => setConsulta(texto), 300)
    return () => clearTimeout(t)
  }, [texto])

  const { data, isFetching } = useQuery({
    queryKey: ['compras', companyId, 'buscar-proveedor', consulta],
    queryFn: () => buscarProveedores(companyId!, consulta),
    enabled: companyId !== null && abierto,
    staleTime: 30_000,
  })

  if (elegido && !abierto) {
    return (
      <div
        className={[styles.campo, apariencia === 'hoja' ? styles.enHoja : null, className]
          .filter(Boolean)
          .join(' ')}
      >
        <span className={styles.etiqueta}>Proveedor</span>
        <div className={styles.elegido}>
          <span className={styles.nombre}>{elegido.razonSocial}</span>
          {elegido.referencia ? <span className={styles.ref}>{elegido.referencia}</span> : null}
          {!deshabilitado ? (
            <button
              type="button"
              className={styles.cambiar}
              onClick={() => {
                setAbierto(true)
                setTexto('')
                setConsulta('')
              }}
            >
              Cambiar
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div
      className={[styles.campo, apariencia === 'hoja' ? styles.enHoja : null, className]
        .filter(Boolean)
        .join(' ')}
    >
      <label className={styles.etiqueta} htmlFor={id}>
        Proveedor
      </label>
      <input
        id={id}
        type="search"
        className={styles.control}
        placeholder="Razón social, nombre comercial o PROV00…"
        value={texto}
        disabled={deshabilitado}
        aria-invalid={error ? true : undefined}
        onFocus={() => setAbierto(true)}
        onChange={(e) => setTexto(e.target.value)}
      />

      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}

      {abierto ? (
        <div className={styles.panel}>
          {isFetching ? (
            <p className={styles.nota}>Buscando…</p>
          ) : (data ?? []).length === 0 ? (
            <p className={styles.nota}>Sin resultados.</p>
          ) : (
            <ul className={styles.lista}>
              {(data ?? []).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={styles.fila}
                    onClick={() => {
                      onElegir(p)
                      setAbierto(false)
                    }}
                  >
                    <span className={styles.filaRef}>{p.referencia ?? '—'}</span>
                    <span className={styles.filaNombre}>{p.razonSocial}</span>
                    <span className={styles.filaExtra}>{p.formaPago ?? ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {altaRapida ? (
            <div className={styles.altaRapida}>
              <input
                className={styles.control}
                autoFocus
                placeholder="Razón social"
                aria-label="Razón social del proveedor nuevo"
                value={nuevo.razonSocial}
                onChange={(e) => setNuevo((x) => ({ ...x, razonSocial: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarAlta() } }}
              />
              <input
                className={styles.control}
                placeholder="CUIT (opcional)"
                aria-label="CUIT del proveedor nuevo"
                value={nuevo.cuit}
                onChange={(e) => setNuevo((x) => ({ ...x, cuit: e.target.value }))}
              />
              <input
                className={styles.control}
                type="email"
                placeholder="Email para mandarle los pedidos (opcional)"
                aria-label="Email del proveedor nuevo"
                value={nuevo.email}
                onChange={(e) => setNuevo((x) => ({ ...x, email: e.target.value }))}
              />
              <select
                className={styles.control}
                aria-label="Moneda en que cotiza"
                value={nuevo.moneda}
                onChange={(e) => setNuevo((x) => ({ ...x, moneda: e.target.value }))}
              >
                <option value="">Moneda (opcional)</option>
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
              {crear.error ? (
                <span className={styles.error} role="alert">
                  {crear.error.message}
                </span>
              ) : null}
              <div className={styles.acciones}>
                <button
                  type="button"
                  className={styles.cerrar}
                  onClick={confirmarAlta}
                  disabled={nuevo.razonSocial.trim() === '' || crear.isPending}
                >
                  {crear.isPending ? 'Creando…' : 'Crear y elegir'}
                </button>
                <button type="button" className={styles.cerrar} onClick={() => setAltaRapida(false)} disabled={crear.isPending}>
                  Volver
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.acciones}>
              {puedeCrear ? (
                <button type="button" className={styles.cerrar} onClick={abrirAlta}>
                  + Nuevo proveedor
                </button>
              ) : null}
              <button
                type="button"
                className={styles.cerrar}
                onClick={() => {
                  setAbierto(false)
                  if (!elegido) onLimpiar()
                }}
              >
                Cerrar
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

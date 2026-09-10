import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { ChipFactura } from '../components/ChipEstado'
import { Paginador } from '../components/Paginador'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { OPCIONES_ESTADO_FACTURA } from '../lib/estados'
import { permisosDe } from '../lib/permisos'
import { useFacturas, useFiltrosFacturas, useMonedasDeFacturas } from '../hooks/useFacturas'
import { useProveedores } from '../hooks/useProveedores'
import { FILTROS_INICIALES, type FiltrosFacturas, type OrdenFacturas } from '../types'
import filtros_ from '../components/FiltrosPedidos.module.css'
import listado from '../components/ListadoPedidos.module.css'
import styles from './ProveedoresPage.module.css'

/** Cuántos filtros hay puestos, sin contar el buscador que está a la vista. */
function contarActivos(f: FiltrosFacturas): number {
  return [
    f.proveedorId !== null,
    f.estado !== '',
    f.moneda !== '',
    f.desde !== '',
    f.hasta !== '',
  ].filter(Boolean).length
}

const COLUMNAS: { clave: OrdenFacturas; etiqueta: string }[] = [
  { clave: 'numeroProveedor', etiqueta: 'Nº del proveedor' },
  { clave: 'numero', etiqueta: 'Referencia' },
  { clave: 'fecha', etiqueta: 'Fecha' },
  { clave: 'proveedor', etiqueta: 'Proveedor' },
  { clave: 'total', etiqueta: 'Total' },
]

function flecha(activa: boolean, direccion: 'asc' | 'desc'): string {
  if (!activa) return ''
  return direccion === 'asc' ? ' ↑' : ' ↓'
}

/**
 * El listado de facturas de proveedor.
 *
 * La primera columna es el **número real del proveedor**, que es el que figura
 * en el papel; la referencia interna `FP` va al lado. Son dos cosas distintas
 * y el schema las tiene separadas desde la entrega 1.
 *
 * Cada importe lleva su moneda: acá conviven USD, ARS y EUR y no hay ninguna
 * fila de total general.
 */
export function FacturasPage() {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosFacturas()
  const { data, isPending, isFetching, error } = useFacturas(filtros)
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const isMobile = useIsMobile()
  const monedas = useMonedasDeFacturas()
  const proveedores = useProveedores({
    ...FILTROS_INICIALES,
    porPagina: 100,
    orden: 'nombre',
    direccion: 'asc',
  })

  const [desplegado, setDesplegado] = useState(false)
  const [texto, setTexto] = useState(filtros.q)

  // Si el filtro cambia desde afuera hay que reflejarlo en el input. Se ajusta
  // DURANTE el render, no en un useEffect.
  const [qPrevia, setQPrevia] = useState(filtros.q)
  if (qPrevia !== filtros.q) {
    setQPrevia(filtros.q)
    setTexto(filtros.q)
  }

  useEffect(() => {
    if (texto === filtros.q) return
    const id = setTimeout(() => aplicar({ q: texto }), 300)
    return () => clearTimeout(id)
  }, [texto, filtros.q, aplicar])

  const ordenar = (columna: OrdenFacturas) =>
    aplicar(
      columna === filtros.orden
        ? { direccion: filtros.direccion === 'asc' ? 'desc' : 'asc' }
        : { orden: columna, direccion: 'desc' },
    )

  if (!permisos.verProveedores) {
    return (
      <div className={styles.page}>
        <h1 className={styles.titulo}>Facturas de proveedor</h1>
        <p className={styles.error} role="note">
          Tu rol no tiene acceso a Compras. La sección es de administradores y empleados.
        </p>
      </div>
    )
  }

  const total = data?.total ?? 0
  const activos = contarActivos(filtros)
  const mostrarTodos = !isMobile || desplegado
  const filas = data?.filas ?? []

  return (
    <div className={styles.page}>
      <header className={styles.encabezado}>
        <div>
          <h1 className={styles.titulo}>Facturas de proveedor</h1>
          <p className={styles.subtitulo}>
            {isPending ? 'Cargando…' : `${total} ${total === 1 ? 'factura' : 'facturas'}`}
          </p>
        </div>
        <div className={styles.acciones}>
          {permisos.crearProveedor ? (
            <Link to="/compras/facturas/nueva" className={styles.nuevo}>
              + Nueva factura
            </Link>
          ) : null}
        </div>
      </header>

      <div className={filtros_.barra}>
        <input
          type="search"
          className={filtros_.buscador}
          placeholder="Número del proveedor o referencia FP…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          aria-label="Buscar factura"
        />

        {isMobile ? (
          <button
            type="button"
            className={filtros_.desplegar}
            aria-expanded={desplegado}
            onClick={() => setDesplegado((v) => !v)}
          >
            {desplegado ? 'Ocultar filtros' : 'Filtros'}
            {activos > 0 ? <span className={filtros_.contador}>{activos}</span> : null}
          </button>
        ) : null}

        {mostrarTodos ? (
          <>
            <select
              className={filtros_.select}
              value={filtros.proveedorId ?? ''}
              onChange={(e) => aplicar({ proveedorId: e.target.value || null })}
              aria-label="Proveedor"
            >
              <option value="">Todos los proveedores</option>
              {(proveedores.data?.filas ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.razonSocial}
                </option>
              ))}
            </select>

            <select
              className={filtros_.select}
              value={filtros.estado}
              onChange={(e) => aplicar({ estado: e.target.value })}
              aria-label="Estado"
            >
              <option value="">Todos los estados</option>
              {OPCIONES_ESTADO_FACTURA.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.etiqueta}
                </option>
              ))}
            </select>

            {(monedas.data ?? []).length > 1 ? (
              <select
                className={filtros_.select}
                value={filtros.moneda}
                onChange={(e) => aplicar({ moneda: e.target.value })}
                aria-label="Moneda"
              >
                <option value="">Todas las monedas</option>
                {(monedas.data ?? []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : null}

            <label className={filtros_.fecha}>
              <span className={filtros_.fechaLabel}>Desde</span>
              <input
                type="date"
                className={filtros_.select}
                value={filtros.desde}
                onChange={(e) => aplicar({ desde: e.target.value })}
              />
            </label>
            <label className={filtros_.fecha}>
              <span className={filtros_.fechaLabel}>hasta</span>
              <input
                type="date"
                className={filtros_.select}
                value={filtros.hasta}
                onChange={(e) => aplicar({ hasta: e.target.value })}
              />
            </label>
          </>
        ) : null}

        {hayFiltros ? (
          <button type="button" className={filtros_.limpiar} onClick={limpiar}>
            Limpiar
          </button>
        ) : null}
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          No se pudo leer el listado: {error.message}
        </p>
      ) : !isPending && filas.length === 0 ? (
        <p className={listado.vacio}>No hay facturas que coincidan con estos filtros.</p>
      ) : isMobile ? (
        <ul className={listado.tarjetas}>
          {filas.map((f) => (
            <li key={f.id}>
              <Link to={`/compras/facturas/${f.id}`} className={listado.tarjeta}>
                <span className={listado.tarjetaNumero}>{f.numeroProveedor ?? f.numero}</span>
                <span className={listado.tarjetaFecha}>{formatearFecha(f.fecha)}</span>
                <span className={listado.tarjetaProveedor}>{f.proveedor}</span>
                <span className={listado.tarjetaTotal}>
                  {formatearImporte(f.total, f.moneda)}
                </span>
                <span className={listado.tarjetaDato}>
                  {f.numeroProveedor ? `Ref. ${f.numero} · ` : 'sin número del proveedor · '}
                  {f.lineas} {f.lineas === 1 ? 'línea' : 'líneas'}
                  {f.recepciones > 0
                    ? ` · ${f.recepciones} ${f.recepciones === 1 ? 'recepción' : 'recepciones'}`
                    : ''}
                </span>
                <span className={listado.tarjetaChips}>
                  <ChipFactura estado={f.estado} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className={listado.scroll}>
          <table className={listado.tabla}>
            <thead>
              <tr>
                {COLUMNAS.map((c) => (
                  <th
                    key={c.clave}
                    scope="col"
                    className={c.clave === 'total' ? listado.derecha : undefined}
                    aria-sort={
                      filtros.orden === c.clave
                        ? filtros.direccion === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    <button
                      type="button"
                      className={listado.thBoton}
                      onClick={() => ordenar(c.clave)}
                    >
                      {c.etiqueta}
                      {flecha(filtros.orden === c.clave, filtros.direccion)}
                    </button>
                  </th>
                ))}
                <th scope="col">Moneda</th>
                <th scope="col">Estado</th>
                <th scope="col" className={listado.derecha}>
                  Líneas
                </th>
                <th scope="col" className={listado.derecha}>
                  Recepciones
                </th>
                <th scope="col">Creada por</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td className={listado.numero}>
                    <Link to={`/compras/facturas/${f.id}`} className={listado.enlace}>
                      {f.numeroProveedor ?? <span className={listado.falta}>sin número</span>}
                    </Link>
                  </td>
                  <td className={listado.numero}>{f.numero}</td>
                  <td className={listado.numero}>{formatearFecha(f.fecha)}</td>
                  <td className={listado.recorta} title={f.proveedor}>
                    <Link
                      to={`/compras/proveedores/${f.proveedorId}`}
                      className={listado.enlaceSuave}
                    >
                      {f.proveedor}
                    </Link>
                  </td>
                  <td className={listado.derecha}>{formatearImporte(f.total, f.moneda)}</td>
                  <td className={listado.numero}>{f.moneda}</td>
                  <td>
                    <ChipFactura estado={f.estado} />
                  </td>
                  <td className={listado.derecha}>{f.lineas}</td>
                  <td className={listado.derecha}>{f.recepciones}</td>
                  <td className={listado.recorta} title={f.autor ?? undefined}>
                    {f.autor ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error ? null : (
        <Paginador
          pagina={filtros.pagina}
          porPagina={filtros.porPagina}
          total={total}
          cargando={isFetching}
          onIr={(pagina) => aplicar({ pagina })}
          onTamano={(porPagina) => aplicar({ porPagina })}
        />
      )}
    </div>
  )
}

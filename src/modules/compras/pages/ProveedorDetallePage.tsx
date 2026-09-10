import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { FormularioProveedor } from '../components/FormularioProveedor'
import { PanelAdjuntos } from '../components/PanelAdjuntos'
import { PanelCompras } from '../components/PanelCompras'
import { PanelHistorial } from '../components/PanelHistorial'
import { explicarMotivo } from '../lib/motivos'
import {
  ETIQUETA_NOMBRE_COMERCIAL,
  etiquetaDeEstado,
  formatearCuit,
  formatearFecha,
  nombreDePais,
  nombreVisible,
} from '../lib/formato'
import { permisosDe } from '../lib/permisos'
import type { DatosProveedor } from '../lib/validacion'
import {
  useComprasDelProveedor,
  useHistorialDeProveedor,
  useProveedor,
} from '../hooks/useProveedores'
import {
  useActualizarProveedor,
  useBajaProveedor,
  useResolverRevisionProveedor,
} from '../hooks/useEdicionProveedores'
import type { ProveedorDetalle } from '../types'
import styles from './ProveedorDetallePage.module.css'

type Pestana = 'informacion' | 'compras' | 'adjuntos' | 'historial'

const PESTANAS: { clave: Pestana; etiqueta: string }[] = [
  { clave: 'informacion', etiqueta: 'Información' },
  { clave: 'compras', etiqueta: 'Compras relacionadas' },
  { clave: 'adjuntos', etiqueta: 'Adjuntos' },
  { clave: 'historial', etiqueta: 'Historial' },
]

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className={styles.dato}>
      <dt className={styles.datoEtiqueta}>{etiqueta}</dt>
      <dd className={styles.datoValor}>{children}</dd>
    </div>
  )
}

/** Un dato que no está se muestra como faltante, no como vacío. */
function Falta({ children }: { children: ReactNode }) {
  return <span className={styles.falta}>{children}</span>
}

function aFormulario(p: ProveedorDetalle): DatosProveedor {
  return {
    razonSocial: p.razonSocial,
    nombreComercial: p.nombreComercial ?? '',
    cuit: p.cuit ?? '',
    email: p.email ?? '',
    telefono: p.telefono ?? '',
    direccion: p.direccion ?? '',
    pais: p.pais ?? '',
    actividad: p.actividad ?? '',
    agente: p.agente ?? '',
    formaPago: p.formaPago ?? '',
    monedaPorDefecto: p.monedaPorDefecto ?? '',
    notas: p.notas ?? '',
  }
}

/**
 * La ficha del proveedor.
 *
 * Cuatro secciones. «Compras relacionadas» está vacía a propósito: el
 * circuito existe en la base desde la entrega 1 pero no tiene pantalla, así
 * que no hay ni un documento. Se dice eso, no se inventan datos ni se muestra
 * un «próximamente».
 */
export function ProveedorDetallePage() {
  const { id } = useParams<{ id: string }>()
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const { data: proveedor, isPending, error } = useProveedor(id)
  const compras = useComprasDelProveedor(id)
  const historial = useHistorialDeProveedor(id)
  const [pestana, setPestana] = useState<Pestana>('informacion')
  const [editando, setEditando] = useState(false)
  const [confirmandoBaja, setConfirmandoBaja] = useState(false)

  const guardar = useActualizarProveedor(id ?? '')
  const baja = useBajaProveedor(id ?? '')
  const revision = useResolverRevisionProveedor(id ?? '')

  if (isPending) return <p className={styles.nota}>Cargando…</p>

  if (error) {
    return (
      <p className={styles.error} role="alert">
        No se pudo leer el proveedor: {error.message}
      </p>
    )
  }

  if (!proveedor) {
    return (
      <div className={styles.page}>
        <p className={styles.nota}>
          No se encontró el proveedor. Puede que no exista o que no tengas acceso: Compras es
          de administradores y empleados.
        </p>
        <Link to="/compras/proveedores" className={styles.volver}>
          ← Volver al listado
        </Link>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <Link to="/compras/proveedores" className={styles.volver}>
        ← Proveedores
      </Link>

      <header className={styles.encabezado}>
        <div className={styles.identidad}>
          <h1 className={styles.titulo}>{nombreVisible(proveedor.razonSocial)}</h1>
          <p className={styles.subtitulo}>{proveedor.referencia ?? 'sin referencia'}</p>
          <div className={styles.chips}>
            {proveedor.dadoDeBaja ? <span className={styles.chipBaja}>Dado de baja</span> : null}
            {proveedor.esHistorico ? (
              <span className={styles.historico}>Migrado del sistema anterior</span>
            ) : null}
          </div>
        </div>

        {!editando ? (
          <div className={styles.acciones}>
            {permisos.editarProveedor && !proveedor.dadoDeBaja ? (
              <button
                type="button"
                className={styles.secundario}
                onClick={() => setEditando(true)}
              >
                Editar
              </button>
            ) : null}
            {permisos.darDeBaja && proveedor.dadoDeBaja ? (
              <button
                type="button"
                className={styles.secundario}
                disabled={baja.reactivar.isPending}
                onClick={() => baja.reactivar.mutate()}
              >
                {baja.reactivar.isPending ? 'Reactivando…' : 'Reactivar'}
              </button>
            ) : null}
            {permisos.darDeBaja && !proveedor.dadoDeBaja ? (
              confirmandoBaja ? (
                <>
                  <button
                    type="button"
                    className={styles.peligro}
                    disabled={baja.dar.isPending}
                    onClick={() =>
                      baja.dar.mutate(undefined, { onSuccess: () => setConfirmandoBaja(false) })
                    }
                  >
                    {baja.dar.isPending ? 'Dando de baja…' : 'Confirmar baja'}
                  </button>
                  <button
                    type="button"
                    className={styles.secundario}
                    onClick={() => setConfirmandoBaja(false)}
                  >
                    No
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.secundario}
                  onClick={() => setConfirmandoBaja(true)}
                >
                  Dar de baja
                </button>
              )
            ) : null}
          </div>
        ) : null}
      </header>

      {proveedor.dadoDeBaja ? (
        <p className={styles.avisoBaja} role="note">
          Este proveedor está dado de baja: <strong>no se ofrece</strong> al armar un pedido de
          compra nuevo. Sus documentos anteriores lo siguen nombrando igual y su ficha sigue
          accesible.
        </p>
      ) : null}

      {baja.dar.error || baja.reactivar.error ? (
        <p className={styles.error} role="alert">
          {baja.dar.error?.message ?? baja.reactivar.error?.message}
        </p>
      ) : null}

      {proveedor.necesitaRevision ? (
        <div className={styles.revision} role="note">
          <strong>Este proveedor quedó marcado para revisión.</strong>
          <ul className={styles.motivos}>
            {proveedor.motivosRevision.map((m) => (
              <li key={m}>{explicarMotivo(m)}</li>
            ))}
          </ul>
          {permisos.resolverRevision ? (
            <button
              type="button"
              className={styles.resolver}
              disabled={revision.isPending}
              onClick={() => revision.mutate()}
            >
              {revision.isPending ? 'Guardando…' : 'Dar por revisado'}
            </button>
          ) : null}
          {revision.error ? (
            <p className={styles.error} role="alert">
              {revision.error.message}
            </p>
          ) : null}
        </div>
      ) : null}

      <nav className={styles.pestanas} aria-label="Secciones de la ficha">
        {PESTANAS.map((p) => (
          <button
            key={p.clave}
            type="button"
            className={p.clave === pestana ? styles.pestanaActiva : styles.pestana}
            aria-current={p.clave === pestana ? 'true' : undefined}
            onClick={() => setPestana(p.clave)}
          >
            {p.etiqueta}
            {p.clave === 'historial' && (historial.data?.length ?? 0) > 0
              ? ` (${historial.data!.length})`
              : ''}
          </button>
        ))}
      </nav>

      <section className={styles.bloque}>
        {pestana === 'informacion' && editando ? (
          <FormularioProveedor
            valores={aFormulario(proveedor)}
            cuitOriginal={proveedor.cuit}
            referencia={proveedor.referencia}
            guardando={guardar.isPending}
            errorAlGuardar={guardar.error?.message ?? null}
            etiquetaGuardar="Guardar cambios"
            onGuardar={(datos) => guardar.mutate(datos, { onSuccess: () => setEditando(false) })}
            onCancelar={() => setEditando(false)}
          />
        ) : null}

        {pestana === 'informacion' && !editando ? (
          <>
            <dl className={styles.datos}>
              <Dato etiqueta="Razón social">{proveedor.razonSocial}</Dato>
              <Dato etiqueta={ETIQUETA_NOMBRE_COMERCIAL}>
                {proveedor.nombreComercial ?? <Falta>sin dato</Falta>}
              </Dato>
              <Dato etiqueta="Referencia">
                {proveedor.referencia ?? <Falta>sin referencia</Falta>}
              </Dato>
              <Dato etiqueta="CUIT">
                {proveedor.cuit ? formatearCuit(proveedor.cuit) : <Falta>sin CUIT</Falta>}
              </Dato>
              <Dato etiqueta="Teléfono">
                {proveedor.telefono ?? <Falta>sin teléfono</Falta>}
              </Dato>
              <Dato etiqueta="Email">
                {proveedor.email ? (
                  <a className={styles.enlace} href={`mailto:${proveedor.email}`}>
                    {proveedor.email}
                  </a>
                ) : (
                  <Falta>sin email</Falta>
                )}
              </Dato>
              <Dato etiqueta="País">
                {proveedor.pais ? nombreDePais(proveedor.pais) : <Falta>sin país</Falta>}
              </Dato>
              <Dato etiqueta="Forma de pago">
                {proveedor.formaPago ?? <Falta>no definida</Falta>}
              </Dato>
              <Dato etiqueta="Moneda por defecto">
                {proveedor.monedaPorDefecto ?? <Falta>no definida</Falta>}
              </Dato>
              <Dato etiqueta="Actividad">
                {proveedor.actividad ?? <Falta>sin actividad</Falta>}
              </Dato>
              <Dato etiqueta="Agente">{proveedor.agente ?? <Falta>sin agente</Falta>}</Dato>
              <Dato etiqueta="Estado">
                {etiquetaDeEstado(proveedor.estado, proveedor.dadoDeBaja)}
              </Dato>
              <Dato etiqueta="Alta">{formatearFecha(proveedor.creadoEn)}</Dato>
            </dl>

            <dl className={styles.datos} style={{ marginTop: 'var(--space-4)' }}>
              <Dato etiqueta="Dirección">
                {proveedor.direccion ?? <Falta>sin dirección</Falta>}
              </Dato>
            </dl>

            {proveedor.notas ? (
              <>
                <p className={styles.datoEtiqueta} style={{ marginTop: 'var(--space-4)' }}>
                  Notas
                </p>
                <p className={styles.notas}>{proveedor.notas}</p>
              </>
            ) : null}
          </>
        ) : null}

        {pestana === 'compras' ? (
          <PanelCompras
            proveedorId={proveedor.id}
            datos={compras.data}
            cargando={compras.isPending}
          />
        ) : null}

        {pestana === 'adjuntos' ? (
          <PanelAdjuntos
            proveedorId={proveedor.id}
            puedeEditar={permisos.editarAdjuntos && !proveedor.dadoDeBaja}
          />
        ) : null}

        {pestana === 'historial' ? (
          <PanelHistorial
            eventos={historial.data ?? []}
            cargando={historial.isPending}
            esHistorico={proveedor.esHistorico}
          />
        ) : null}
      </section>
    </div>
  )
}

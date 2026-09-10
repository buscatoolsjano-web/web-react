import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { EditorContactos } from '../components/EditorContactos'
import { EditorDirecciones } from '../components/EditorDirecciones'
import { FormularioCliente } from '../components/FormularioCliente'
import { PanelHistorial } from '../components/PanelHistorial'
import { PanelRelacionados } from '../components/PanelRelacionados'
import { explicarMotivo } from '../lib/motivos'
import { formatearCuit, formatearFecha, nombreVisible } from '../lib/formato'
import { permisosDe } from '../lib/permisos'
import type { DatosCliente } from '../lib/validacion'
import { useCliente, useContactos, useHistorial, useRelacionados } from '../hooks/useClientes'
import {
  useActualizarCliente,
  useBajaCliente,
  useResolverRevision,
} from '../hooks/useEdicionClientes'
import type { ClienteDetalle } from '../types'
import styles from './ClienteDetallePage.module.css'

type Pestana = 'informacion' | 'contactos' | 'direcciones' | 'historial' | 'relacionados'

const PESTANAS: { clave: Pestana; etiqueta: string }[] = [
  { clave: 'informacion', etiqueta: 'Información' },
  { clave: 'contactos', etiqueta: 'Contactos' },
  { clave: 'direcciones', etiqueta: 'Direcciones' },
  { clave: 'historial', etiqueta: 'Historial' },
  { clave: 'relacionados', etiqueta: 'Relacionados' },
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

function aFormulario(c: ClienteDetalle): DatosCliente {
  return {
    razonSocial: c.razonSocial,
    nombreComercial: c.nombreComercial ?? '',
    cuit: c.cuit ?? '',
    emails: [...c.emails],
    dominios: [...c.dominios],
    rubro: c.rubro ?? '',
    telefono: c.telefono ?? '',
    tipo: c.tipo,
    condicionDePago: c.condicionDePago ?? '',
    monedaPorDefecto: c.monedaPorDefecto ?? '',
    notas: c.notas ?? '',
  }
}

/**
 * La ficha del cliente.
 *
 * El legacy tenía cinco pestañas; acá están las que se pueden mostrar con lo
 * que hay migrado, más Direcciones, que ahora se cargan a mano. **Memoria de
 * precios** no está: el legacy la guardaba en `localStorage` y lo que vale es
 * el precio de cada cotización, así que se deriva de `sales_quote_lines`
 * cuando le toque su entrega, no de una copia paralela.
 */
export function ClienteDetallePage() {
  const { id } = useParams<{ id: string }>()
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const { data: cliente, isPending, error } = useCliente(id)
  const contactos = useContactos(id)
  const historial = useHistorial(id)
  const relacionados = useRelacionados(id)
  const [pestana, setPestana] = useState<Pestana>('informacion')
  const [editando, setEditando] = useState(false)
  const [confirmandoBaja, setConfirmandoBaja] = useState(false)

  const guardar = useActualizarCliente(id ?? '')
  const baja = useBajaCliente(id ?? '')
  const revision = useResolverRevision(id ?? '')

  if (isPending) return <p className={styles.nota}>Cargando…</p>

  if (error) {
    return (
      <p className={styles.error} role="alert">
        No se pudo leer el cliente: {error.message}
      </p>
    )
  }

  if (!cliente) {
    return (
      <div className={styles.page}>
        <p className={styles.nota}>
          No se encontró el cliente. Puede que no exista o que no tengas acceso.
        </p>
        <Link to="/clientes" className={styles.volver}>
          ← Volver al listado
        </Link>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <Link to="/clientes" className={styles.volver}>
        ← Clientes
      </Link>

      <header className={styles.encabezado}>
        <div className={styles.identidad}>
          <h1 className={styles.titulo}>
            {nombreVisible(cliente.razonSocial, cliente.nombreComercial)}
          </h1>
          <p className={styles.subtitulo}>
            {cliente.nombreComercial ? `${cliente.razonSocial} · ` : ''}
            {cliente.referencia ?? 'sin referencia'}
          </p>
          <div className={styles.chips}>
            {cliente.dadoDeBaja ? <span className={styles.chipBaja}>Dado de baja</span> : null}
            {cliente.esHistorico ? (
              <span className={styles.historico}>
                Migrado del sistema anterior
                {cliente.origenLegacy === 'erp_contactos' ? ' (agenda de contactos)' : ''}
              </span>
            ) : null}
          </div>
        </div>

        {!editando ? (
          <div className={styles.acciones}>
            {permisos.editarCliente && !cliente.dadoDeBaja ? (
              <button
                type="button"
                className={styles.secundario}
                onClick={() => setEditando(true)}
              >
                Editar
              </button>
            ) : null}
            {permisos.darDeBaja && cliente.dadoDeBaja ? (
              <button
                type="button"
                className={styles.secundario}
                disabled={baja.reactivar.isPending}
                onClick={() => baja.reactivar.mutate()}
              >
                {baja.reactivar.isPending ? 'Reactivando…' : 'Reactivar'}
              </button>
            ) : null}
            {permisos.darDeBaja && !cliente.dadoDeBaja ? (
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

      {cliente.dadoDeBaja ? (
        <p className={styles.avisoBaja} role="note">
          Este cliente está dado de baja: <strong>no se ofrece</strong> al armar un
          documento nuevo. Sus documentos anteriores lo siguen nombrando igual y su
          historial sigue accesible.
        </p>
      ) : null}

      {baja.dar.error || baja.reactivar.error ? (
        <p className={styles.error} role="alert">
          {baja.dar.error?.message ?? baja.reactivar.error?.message}
        </p>
      ) : null}

      {cliente.necesitaRevision ? (
        <div className={styles.revision} role="note">
          <strong>Este cliente quedó marcado para revisión.</strong>
          <ul className={styles.motivos}>
            {cliente.motivosRevision.map((m) => (
              <li key={m}>
                {explicarMotivo(m)}
                {permisos.resolverRevision ? (
                  <button
                    type="button"
                    className={styles.resolver}
                    disabled={revision.isPending}
                    onClick={() => revision.mutate([m])}
                  >
                    Dar por revisado
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
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
            {p.clave === 'contactos' && (contactos.data?.length ?? 0) > 0
              ? ` (${contactos.data!.length})`
              : ''}
            {p.clave === 'direcciones' && (relacionados.data?.direcciones.length ?? 0) > 0
              ? ` (${relacionados.data!.direcciones.length})`
              : ''}
            {p.clave === 'historial' && (historial.data?.length ?? 0) > 0
              ? ` (${historial.data!.length})`
              : ''}
          </button>
        ))}
      </nav>

      <section className={styles.bloque}>
        {pestana === 'informacion' && editando ? (
          <FormularioCliente
            valores={aFormulario(cliente)}
            cuitOriginal={cliente.cuit}
            referencia={cliente.referencia}
            guardando={guardar.isPending}
            errorAlGuardar={guardar.error?.message ?? null}
            etiquetaGuardar="Guardar cambios"
            onGuardar={(datos) =>
              guardar.mutate(datos, { onSuccess: () => setEditando(false) })
            }
            onCancelar={() => setEditando(false)}
          />
        ) : null}

        {pestana === 'informacion' && !editando ? (
          <>
            <dl className={styles.datos}>
              <Dato etiqueta="Razón social">{cliente.razonSocial}</Dato>
              <Dato etiqueta="Nombre comercial">
                {cliente.nombreComercial ?? <Falta>sin nombre comercial</Falta>}
              </Dato>
              <Dato etiqueta="Referencia">
                {cliente.referencia ?? <Falta>sin referencia</Falta>}
              </Dato>
              <Dato etiqueta="CUIT">
                {cliente.cuit ? formatearCuit(cliente.cuit) : <Falta>sin CUIT</Falta>}
              </Dato>
              <Dato etiqueta="Rubro">{cliente.rubro ?? <Falta>sin rubro</Falta>}</Dato>
              <Dato etiqueta="Teléfono">{cliente.telefono ?? <Falta>sin teléfono</Falta>}</Dato>
              <Dato etiqueta="Emails">
                {cliente.emails.length === 0 ? (
                  <Falta>sin emails</Falta>
                ) : (
                  <ul className={styles.chipsLista}>
                    {cliente.emails.map((e) => (
                      <li key={e}>
                        <a className={styles.enlace} href={`mailto:${e}`}>
                          {e}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </Dato>
              <Dato etiqueta="Dominios">
                {cliente.dominios.length === 0 ? (
                  <Falta>sin dominios</Falta>
                ) : (
                  <ul className={styles.chipsLista}>
                    {cliente.dominios.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                )}
              </Dato>
              <Dato etiqueta="Tipo">
                {cliente.tipo === 'business' ? 'Empresa' : 'Persona'}
              </Dato>
              <Dato etiqueta="Estado">
                {cliente.estado === 'active' ? 'Activo' : 'Inactivo'}
              </Dato>
              <Dato etiqueta="Condición de pago">
                {cliente.condicionDePago ?? <Falta>no definida</Falta>}
              </Dato>
              <Dato etiqueta="Vendedor asignado">
                {cliente.vendedor ?? <Falta>no asignado</Falta>}
              </Dato>
              <Dato etiqueta="Moneda por defecto">
                {cliente.monedaPorDefecto ?? <Falta>no definida</Falta>}
              </Dato>
              <Dato etiqueta="Alta">{formatearFecha(cliente.creadoEn)}</Dato>
              {cliente.nombreLegacy && cliente.nombreLegacy !== cliente.razonSocial ? (
                <Dato etiqueta="Nombre en el sistema anterior">{cliente.nombreLegacy}</Dato>
              ) : null}
            </dl>
            {cliente.notas ? <p className={styles.notas}>{cliente.notas}</p> : null}
          </>
        ) : null}

        {pestana === 'contactos' ? (
          <EditorContactos
            clienteId={cliente.id}
            contactos={contactos.data ?? []}
            cargando={contactos.isPending}
            puedeEditar={permisos.editarContactos && !cliente.dadoDeBaja}
          />
        ) : null}

        {pestana === 'direcciones' ? (
          <EditorDirecciones
            clienteId={cliente.id}
            direcciones={relacionados.data?.direcciones ?? []}
            cargando={relacionados.isPending}
            puedeEditar={permisos.editarDirecciones && !cliente.dadoDeBaja}
          />
        ) : null}

        {pestana === 'historial' ? (
          <PanelHistorial
            clienteId={cliente.id}
            documentos={historial.data ?? []}
            cargando={historial.isPending}
          />
        ) : null}

        {pestana === 'relacionados' ? (
          <PanelRelacionados datos={relacionados.data} cargando={relacionados.isPending} />
        ) : null}
      </section>
    </div>
  )
}

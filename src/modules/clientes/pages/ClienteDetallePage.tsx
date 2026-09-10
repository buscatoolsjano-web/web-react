import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PanelContactos } from '../components/PanelContactos'
import { PanelHistorial } from '../components/PanelHistorial'
import { PanelRelacionados } from '../components/PanelRelacionados'
import { formatearCuit, formatearFecha, nombreVisible } from '../lib/formato'
import { useCliente, useContactos, useHistorial, useRelacionados } from '../hooks/useClientes'
import styles from './ClienteDetallePage.module.css'

type Pestana = 'informacion' | 'contactos' | 'historial' | 'relacionados'

const PESTANAS: { clave: Pestana; etiqueta: string }[] = [
  { clave: 'informacion', etiqueta: 'Información' },
  { clave: 'contactos', etiqueta: 'Contactos' },
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

/**
 * La ficha del cliente, en sólo lectura.
 *
 * El legacy tenía cinco pestañas; acá están las cuatro que se pueden mostrar
 * con lo que hay migrado. **Memoria de precios** no está: el legacy la
 * guardaba en `localStorage` y lo que vale es el precio que figura en cada
 * cotización, así que se deriva de `sales_quote_lines` cuando le toque su
 * entrega, no de una copia paralela.
 */
export function ClienteDetallePage() {
  const { id } = useParams<{ id: string }>()
  const { data: cliente, isPending, error } = useCliente(id)
  const contactos = useContactos(id)
  const historial = useHistorial(id)
  const relacionados = useRelacionados(id)
  const [pestana, setPestana] = useState<Pestana>('informacion')

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
      </header>

      {cliente.necesitaRevision ? (
        <div className={styles.revision} role="note">
          <strong>Este cliente quedó marcado para revisión.</strong>
          <ul className={styles.motivos}>
            {cliente.motivosRevision.map((m) => (
              <li key={m}>{explicarMotivo(m)}</li>
            ))}
          </ul>
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
            {p.clave === 'historial' && (historial.data?.length ?? 0) > 0
              ? ` (${historial.data!.length})`
              : ''}
          </button>
        ))}
      </nav>

      <section className={styles.bloque}>
        {pestana === 'informacion' ? (
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
            <Dato etiqueta="Tipo">{cliente.tipo}</Dato>
            <Dato etiqueta="Estado">{cliente.estado}</Dato>
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
        ) : null}

        {pestana === 'informacion' && cliente.notas ? (
          <p className={styles.notas}>{cliente.notas}</p>
        ) : null}

        {pestana === 'contactos' ? (
          <PanelContactos contactos={contactos.data ?? []} cargando={contactos.isPending} />
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

/**
 * Los motivos que dejó la migración, en castellano.
 *
 * Un motivo desconocido se muestra crudo: es preferible un código raro en
 * pantalla a esconder que el cliente está marcado.
 */
function explicarMotivo(motivo: string): string {
  const TEXTOS: Record<string, string> = {
    CUIT_REPETIDO_EN_LEGACY:
      'El sistema anterior usaba este CUIT en más de una ficha de cliente.',
    CUIT_NO_ASIGNADO:
      'El CUIT del sistema anterior no se cargó porque ya lo tenía otro cliente. Está sin asignar, no reemplazado.',
    VARIOS_LEGACY_AL_MISMO_CLIENTE:
      'Más de una ficha del sistema anterior apuntaba al mismo cliente. No se fusionó ninguna.',
    REF_DUPLICADA: 'La referencia CLI del sistema anterior ya estaba en uso por otro cliente.',
    SOLO_EN_CONTACTOS:
      'No estaba en el maestro de clientes: apareció al cargar un contacto suyo.',
    AMBIGUO_NOMBRE: 'Había más de un cliente con este nombre y no se unió con ninguno.',
    AMBIGUO_CUIT: 'Había más de un cliente con este CUIT y no se unió con ninguno.',
    AMBIGUO_EMAIL: 'Había más de un cliente con este email y no se unió con ninguno.',
    AMBIGUO_DOMINIO: 'Había más de un cliente con este dominio y no se unió con ninguno.',
    CONFLICTO_DE_DATO:
      'Un dato del sistema anterior no coincide con el que ya estaba. No se pisó ninguno.',
  }
  return TEXTOS[motivo] ?? motivo
}

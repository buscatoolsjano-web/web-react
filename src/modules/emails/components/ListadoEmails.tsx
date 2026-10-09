import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Icon } from '@/components/icons/Icon'
import { fechaBandeja, resumenParticipantes } from '../lib/formato'
import type { EtiquetaEmail, FilaBandeja, UsuarioAsignable } from '../types'
import { AccionesFila } from './AccionesFila'
import { BarraSeleccion } from './BarraSeleccion'
import { useAccionesEnLote } from '../hooks/useEmails'
import {
  accionesPosibles,
  alternar,
  alternarTodas,
  elegidas,
  estadoMaestra,
  resumenLote,
  VACIA,
  type Seleccion,
} from '../lib/seleccion'
import { BadgeEstado } from './BadgeEstado'
import styles from './Emails.module.css'

export interface ListadoEmailsProps {
  filas: FilaBandeja[]
  /** accountId → dirección del buzón, para no mostrarse a sí mismo como participante. */
  buzones: ReadonlyMap<string, string>
  /** Sacar el hilo de la bandeja, o devolverlo. Sin esto no se dibuja el botón. */
  onEliminar?: ((fila: FilaBandeja, eliminar: boolean) => void) | undefined
  /** Asignar sin abrir el hilo. Sin usuarios asignables no se dibuja. */
  asignables?: UsuarioAsignable[] | undefined
  onAsignar?: ((fila: FilaBandeja, usuario: string | null, nombre: string | null) => void) | undefined
  /** Etiquetas de la empresa, para marcar y desmarcar desde la fila. */
  etiquetas?: EtiquetaEmail[] | undefined
  onEtiquetar?: ((fila: FilaBandeja, etiqueta: EtiquetaEmail, poner: boolean) => void) | undefined
  /** El hilo que está yendo o volviendo, para bloquear sus controles. */
  trabajando?: string | null | undefined
  /**
   * Dibujar las casillas de selección múltiple (Fase 59 · E3). Encendido por
   * defecto: la bandeja es la única pantalla que usa esta lista y es
   * exactamente donde se pidió. Se puede apagar si alguna vez se reusa en un
   * lugar donde elegir varios no signifique nada.
   */
  conSeleccion?: boolean | undefined
}

/**
 * La bandeja. Una lista de enlaces, no una tabla de ocho columnas: en 390 px
 * una tabla así es ilegible, y en escritorio la fila de dos líneas —remitente,
 * asunto y extracto— se lee mejor que ocho celdas.
 *
 * El no leído no es sólo color: la fila lleva el texto «Sin leer». El clip es
 * un ícono con nombre, no un emoji.
 *
 * Fase 28 · E2/E8: los controles —asignar, etiquetar, eliminar— van FUERA del
 * enlace: un control adentro de un `<a>` no es HTML válido y el teclado no
 * llega a los dos. La fila es un enlace y una columna de acciones, lado a lado.
 *
 * Fase 59 · E3: la casilla de selección múltiple, por la misma razón y en el
 * mismo lugar que los otros controles: afuera del enlace.
 *
 * LA SELECCIÓN VIVE ACÁ, no en la página. Es estado de la lista —qué filas
 * están marcadas— y además deja a `EmailsPage` sin cambios, que es lo que
 * permitió hacer esto mientras otra rama trabaja sobre ese archivo.
 */
export function ListadoEmails({
  filas,
  buzones,
  onEliminar,
  asignables,
  onAsignar,
  etiquetas,
  onEtiquetar,
  trabajando,
  conSeleccion = true,
}: ListadoEmailsProps) {
  const { search } = useLocation()
  const hayAcciones = !!onEliminar && !!onAsignar && !!onEtiquetar

  const [seleccion, setSeleccion] = useState<Seleccion>(VACIA)
  const [aviso, setAviso] = useState<string | null>(null)
  const lote = useAccionesEnLote()
  const enLote = lote.marcarLeidos.isPending || lote.eliminar.isPending

  /*
   * Al cambiar de carpeta, de filtro o de página, la selección se limpia: lo
   * elegido en «Recibidos» no tiene por qué seguir elegido en «Enviados», y
   * una acción en lote sobre hilos que ya no se ven sería a ciegas.
   */
  const claveDeLista = filas.map((f) => f.id).join(',')
  const primera = useRef(true)
  useEffect(() => {
    if (primera.current) {
      primera.current = false
      return
    }
    setSeleccion(VACIA)
    setAviso(null)
  }, [claveDeLista])

  const acciones = accionesPosibles(filas, seleccion)
  const maestra = estadoMaestra(filas, seleccion)

  const correrLote = useCallback(
    async (quienes: FilaBandeja[], correr: () => Promise<FilaBandeja[]>, hecho: string) => {
      setAviso(null)
      const fallaron = await correr().catch(() => quienes)
      setAviso(resumenLote(quienes.length, fallaron.length, hecho))
      // Se desmarcan los que salieron bien; los que fallaron quedan elegidos
      // para poder reintentar sin volver a buscarlos uno por uno.
      const malos = new Set(fallaron.map((f) => f.id))
      setSeleccion(new Set(quienes.filter((f) => malos.has(f.id)).map((f) => f.id)))
    },
    [],
  )

  const marcarLeidos = () => {
    const sinLeer = elegidas(filas, seleccion).filter((f) => f.sinLeer)
    void correrLote(sinLeer, () => lote.marcarLeidos.mutateAsync(sinLeer), 'marcados como leídos')
  }

  /* Cada botón toca SU parte: con una selección mezclada —que no debería
     poder armarse, pero— eliminar no restaura de paso. */
  const moverALaPapelera = (eliminar: boolean) => {
    const sel = elegidas(filas, seleccion).filter((f) => f.eliminado !== eliminar)
    void correrLote(sel, () => lote.eliminar.mutateAsync({ filas: sel, eliminar }), eliminar ? 'eliminados' : 'restaurados')
  }

  return (
    <>
      {conSeleccion ? (
        <div className={styles.cabeceraSeleccion}>
          <label className={styles.casilla}>
            <input
              type="checkbox"
              checked={maestra === 'todas'}
              // «A medias» no es un tercer estado del checkbox en HTML: es una
              // propiedad del DOM, así que se pone con un ref.
              ref={(el) => {
                if (el) el.indeterminate = maestra === 'algunas'
              }}
              disabled={enLote || filas.length === 0}
              onChange={() => setSeleccion(alternarTodas(filas, seleccion))}
            />
            <span className="sr-only">Elegir todos los hilos de esta página</span>
          </label>
          <BarraSeleccion
            acciones={acciones}
            trabajando={enLote}
            onMarcarLeidos={marcarLeidos}
            onEliminar={() => moverALaPapelera(true)}
            onRestaurar={() => moverALaPapelera(false)}
            onLimpiar={() => {
              setSeleccion(VACIA)
              setAviso(null)
            }}
          />
          {/* Vive fuera de la barra porque la barra desaparece al quedar sin
              selección, y el resultado del lote tiene que poder leerse después. */}
          {aviso ? (
            <p className={styles.nota} role="status">
              {aviso}
            </p>
          ) : null}
        </div>
      ) : null}

      <ul className={styles.lista} aria-label="Hilos de correo">
      {filas.map((f) => {
        const propia = buzones.get(f.accountId) ?? null
        const quien =
          f.ultimaDireccion === 'out'
            ? `Para: ${resumenParticipantes(f.participantes, propia)}`
            : (f.ultimoRemitente ?? resumenParticipantes(f.participantes, propia))
        return (
          <li key={f.id} className={styles.item}>
            {/* Afuera del enlace, igual que las demás acciones de la fila. */}
            {conSeleccion ? (
              <label className={styles.casilla}>
                <input
                  type="checkbox"
                  checked={seleccion.has(f.id)}
                  disabled={enLote}
                  onChange={() => setSeleccion(alternar(seleccion, f.id))}
                />
                <span className="sr-only">Elegir: {f.asunto?.trim() || '(sin asunto)'}</span>
              </label>
            ) : null}
            <Link
              to={`/emails/${f.id}`}
              // Volver desde el hilo recupera los filtros y la página.
              state={{ desde: search }}
              className={`${styles.fila} ${f.sinLeer ? styles.filaSinLeer : ''}`}
            >
              <span className={styles.remitente} title={quien}>
                {quien}
              </span>

              <span className={styles.centro}>
                <span className={styles.asunto}>{f.asunto?.trim() || '(sin asunto)'}</span>
                {f.extracto ? <span className={styles.extracto}>{f.extracto}</span> : null}
                <span className={styles.meta}>
                  {f.sinLeer ? <span className={styles.sinLeer}>Sin leer</span> : null}
                  <BadgeEstado estado={f.estado} />
                  {/* Las etiquetas del ERP, no las de Gmail. */}
                  {f.etiquetas.map((e) => (
                    <Badge key={e.id} tone={e.color}>
                      {e.nombre}
                    </Badge>
                  ))}
                  {f.asignadoNombre ? <span>Asignado: {f.asignadoNombre}</span> : null}
                  {f.clienteNombre ? <span>Cliente: {f.clienteNombre}</span> : null}
                </span>
              </span>

              <span className={styles.derecha}>
                <time dateTime={f.ultimoMensajeEn ?? undefined}>{fechaBandeja(f.ultimoMensajeEn)}</time>
                {f.cantidadMensajes > 1 ? (
                  <span aria-label={`${f.cantidadMensajes} mensajes`}>{f.cantidadMensajes} msj.</span>
                ) : null}
                {f.tieneAdjuntos ? (
                  <span className={styles.clip} title="Tiene adjuntos">
                    <Icon name="paperclip" size={16} />
                    <span className="sr-only">Tiene adjuntos</span>
                  </span>
                ) : null}
              </span>
            </Link>

            {hayAcciones ? (
              <AccionesFila
                fila={f}
                asignables={asignables ?? []}
                etiquetas={etiquetas ?? []}
                onAsignar={onAsignar}
                onEtiquetar={onEtiquetar}
                onEliminar={onEliminar}
                trabajando={trabajando === f.id}
              />
            ) : null}
          </li>
        )
      })}
      </ul>
    </>
  )
}

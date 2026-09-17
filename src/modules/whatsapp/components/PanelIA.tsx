import { Alert } from '@/components/feedback/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import {
  ETIQUETA_ACTOR,
  ETIQUETA_ESTADO_CONVERSACION,
  fechaCorta,
  momento,
  nivelDeConfianza,
  seccionesIA,
  textoDeErrorIA,
  type EstadoItemIA,
  type ItemIA,
  type ResumenIA,
} from '../lib/ia'
import styles from './Whatsapp.module.css'

export interface PanelIAProps {
  resumen: ResumenIA | null
  items: readonly ItemIA[]
  cargando: boolean
  errorLectura: string | null
  /** El último pedido de análisis falló. El resumen anterior se sigue mostrando. */
  errorAnalisis: string | null
  aviso: string | null
  analizando: boolean
  /** El item que se está resolviendo, para no permitir dos clics. */
  resolviendo: string | null
  onActualizar: () => void
  onResolver: (itemId: string, estado: EstadoItemIA) => void
  onIrAFuente: (mensajeId: string) => void
}

/**
 * «Resumen IA» en el panel derecho.
 *
 * Tres reglas de presentación:
 *
 * 1. **Todo es sugerencia.** Se dice arriba y se nota en cada ítem: tiene su
 *    confianza y un botón para ir al mensaje de donde salió. Una conclusión sin
 *    fuente no se muestra, porque no se guarda.
 * 2. **No se recalcula solo.** El resumen se lee; se actualiza cuando alguien
 *    aprieta «Actualizar resumen». Nada de un análisis por render.
 * 3. **Un fallo no borra nada.** Si el análisis falla, se avisa y el resumen
 *    anterior sigue en pantalla.
 */
export function PanelIA({
  resumen,
  items,
  cargando,
  errorLectura,
  errorAnalisis,
  aviso,
  analizando,
  resolviendo,
  onActualizar,
  onResolver,
  onIrAFuente,
}: PanelIAProps) {
  if (cargando) return <SkeletonRows rows={3} columns={1} label="Cargando el resumen…" />
  if (errorLectura) {
    return (
      <Alert tone="danger" role="alert" title="No se pudo leer el resumen">
        <p>{errorLectura}</p>
      </Alert>
    )
  }

  const secciones = seccionesIA(items).filter((s) => s.items.length > 0)
  const conResumen = resumen !== null && resumen.resumen !== null

  return (
    <div className={styles.ia}>
      <p className={styles.iaAviso}>
        <Icon name="info" size={16} />
        Sugerencias generadas a partir de los mensajes. Revisalas antes de actuar: no cambian nada por sí solas.
      </p>

      <section className={styles.bloque} aria-labelledby="ia-resumen">
        <div className={styles.iaCabecera}>
          <h3 id="ia-resumen" className={styles.bloqueTitulo}>Resumen</h3>
          <Button
            variant="secondary"
            size="sm"
            loading={analizando}
            icon={<Icon name="refresh" size={16} />}
            onClick={onActualizar}
          >
            {conResumen ? 'Actualizar resumen' : 'Generar resumen'}
          </Button>
        </div>

        {errorAnalisis ? (
          <Alert tone="warning" role="alert" title="No se pudo actualizar">
            <p>{errorAnalisis}</p>
          </Alert>
        ) : null}
        {aviso ? <p className={styles.iaNota} role="status">{aviso}</p> : null}
        {resumen?.estado === 'error' && !errorAnalisis ? (
          <p className={styles.iaNota}>{textoDeErrorIA(resumen.ultimoError)} Se muestra el último resumen válido.</p>
        ) : null}

        {conResumen ? (
          <>
            <p className={styles.iaResumen}>{resumen.resumen}</p>
            <div className={styles.iaEtiquetas}>
              {resumen.estadoConversacion ? (
                <Badge tone={resumen.estadoConversacion === 'esperando_empresa' ? 'warning' : 'neutral'}>
                  {ETIQUETA_ESTADO_CONVERSACION[resumen.estadoConversacion]}
                </Badge>
              ) : null}
              {resumen.temas.map((t) => (
                <Badge key={t} tone="neutral" outline>{t}</Badge>
              ))}
            </div>
            <p className={styles.iaPie}>
              Último análisis: {momento(resumen.generadoEn)}
            </p>
          </>
        ) : (
          <p className={styles.sinVinculo}>
            Esta conversación todavía no se analizó. El análisis es a pedido: no corre solo.
          </p>
        )}
      </section>

      {secciones.map((s) => (
        <section key={s.clave} className={styles.bloque} aria-labelledby={`ia-${s.clave}`}>
          <h3 id={`ia-${s.clave}`} className={styles.bloqueTitulo}>
            {s.titulo} <span className={styles.iaCuenta}>{s.items.length}</span>
          </h3>
          <ul className={styles.iaItems}>
            {s.items.map((i) => (
              <ItemSugerido
                key={i.id}
                item={i}
                ocupado={resolviendo === i.id}
                onResolver={onResolver}
                onIrAFuente={onIrAFuente}
              />
            ))}
          </ul>
        </section>
      ))}

      {conResumen && secciones.length === 0 ? (
        <p className={styles.sinVinculo}>No se detectaron pendientes, compromisos ni decisiones abiertas.</p>
      ) : null}
    </div>
  )
}

function ItemSugerido({
  item,
  ocupado,
  onResolver,
  onIrAFuente,
}: {
  item: ItemIA
  ocupado: boolean
  onResolver: (itemId: string, estado: EstadoItemIA) => void
  onIrAFuente: (mensajeId: string) => void
}) {
  const confianza = nivelDeConfianza(item.confianza)
  const fuente = item.fuentes[0]

  return (
    <li className={styles.iaItem}>
      <p className={styles.iaItemTexto}>{item.descripcion}</p>
      <div className={styles.iaEtiquetas}>
        {item.tipo === 'commitment' || item.actor !== 'unknown' ? (
          <Badge tone="neutral" outline>{ETIQUETA_ACTOR[item.actor]}</Badge>
        ) : null}
        {/* La fecha sólo existe si el mensaje la nombra: la validó el servidor. */}
        {item.venceEn ? (
          <Badge tone="info">
            <Icon name="calendar" size={16} /> {fechaCorta(item.venceEn)}
          </Badge>
        ) : null}
        <Badge tone={confianza.tono} outline>{confianza.etiqueta}</Badge>
      </div>
      <div className={styles.iaAcciones}>
        {fuente ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<Icon name="message-circle" size={16} />}
            onClick={() => onIrAFuente(fuente)}
            // El nombre accesible empieza con el texto visible (WCAG 2.5.3).
            aria-label={`Ver mensaje de origen: ${item.descripcion}`}
          >
            Ver mensaje{item.fuentes.length > 1 ? ` (${item.fuentes.length})` : ''}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          icon={<Icon name="check" size={16} />}
          disabled={ocupado}
          onClick={() => onResolver(item.id, 'resolved')}
          aria-label={`Resolver: ${item.descripcion}`}
        >
          Resolver
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Icon name="x" size={16} />}
          disabled={ocupado}
          onClick={() => onResolver(item.id, 'dismissed')}
          aria-label={`Descartar: ${item.descripcion}`}
        >
          Descartar
        </Button>
      </div>
    </li>
  )
}

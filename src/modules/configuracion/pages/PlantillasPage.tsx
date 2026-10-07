import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/controls'
import { StatusMessage, type Tono } from '@/components/ui/StatusMessage'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { clavesPlantillas, useMisDatosDeFirma, usePlantillas, usePrevia, useUsuarioId } from '../hooks/usePlantillas'
import {
  HUECOS,
  MARCADORES,
  puedeEditar,
  revisar,
  sePuedeGuardar,
  visiblesPara,
  type ClasePlantilla,
  type Plantilla,
} from '../lib/plantillas'
import {
  crearPlantilla,
  desactivarPlantilla,
  guardarMisDatosDeFirma,
  guardarPlantilla,
  marcarPorDefecto,
  mensajeDePlantilla,
  type MisDatosDeFirma,
} from '../services/plantillas'
import styles from './PlantillasPage.module.css'

/**
 * Configuración → Plantillas de correo (Fase 41 · E2).
 *
 * Dos cosas en una pantalla, y juntas a propósito: los DATOS de cada uno
 * —nombre, puesto, teléfono— son lo que rellena los marcadores. Separarlos
 * obligaría a ir y volver para entender por qué la vista previa muestra un
 * hueco.
 *
 * La vista previa la resuelve el SERVIDOR, con la misma función que usa el
 * envío. Resolverla acá sería más rápido y mostraría otra cosa el día que las
 * dos implementaciones divergieran, que es el día que nadie mira.
 */

const CLASES: { clase: ClasePlantilla; titulo: string; ayuda: string }[] = [
  {
    clase: 'envoltorio',
    titulo: 'Envoltorio de la empresa',
    ayuda: 'El marco que rodea a todos los mails. Lo administra un admin.',
  },
  { clase: 'firma', titulo: 'Firmas', ayuda: 'Quién manda el mail. Cada uno puede tener la suya.' },
]

const FIRMA_NUEVA = '--\n{{usuario.nombre}}\n{{usuario.puesto}}\n{{empresa.nombre}} · Tel. {{empresa.telefono}}'

export function PlantillasPage() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const qc = useQueryClient()
  const usuario = useUsuarioId()
  const lista = usePlantillas()
  const [elegida, setElegida] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ tono: Tono; titulo: string } | null>(null)

  const usuarioId = usuario.data ?? null
  const mias = useMemo(() => visiblesPara(lista.data ?? [], usuarioId), [lista.data, usuarioId])
  const actual = mias.find((p) => p.id === elegida) ?? null
  const refrescar = () => void qc.invalidateQueries({ queryKey: clavesPlantillas.lista(companyId) })

  if (!companyId || lista.isPending) return <SkeletonRows rows={5} columns={2} label="Cargando…" />

  return (
    <div className={styles.page}>
      <PageHeader title="Plantillas de correo" />
      {aviso && <StatusMessage tono={aviso.tono} titulo={aviso.titulo} />}

      <MisDatos
        onError={(t) => setAviso({ tono: 'error', titulo: t })}
        onGuardado={() => setAviso({ tono: 'ok', titulo: 'Tus datos de firma quedaron guardados.' })}
      />

      <section className={styles.bloque}>
        <h2 className={styles.titulo}>Las plantillas</h2>
        <div className={styles.columnas}>
          <ul className={styles.lista}>
            {CLASES.map((c) => (
              <li key={c.clase}>
                <p className={styles.grupo}>{c.titulo}</p>
                <p className={styles.ayuda}>{c.ayuda}</p>
                <ul className={styles.sublista}>
                  {mias
                    .filter((p) => p.clase === c.clase && p.activa)
                    .map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className={p.id === elegida ? `${styles.item} ${styles.itemActivo}` : styles.item}
                          onClick={() => setElegida(p.id)}
                        >
                          <span>{p.nombre}</span>
                          {p.usuarioId === null ? <Badge tone="neutral">De la empresa</Badge> : <Badge tone="info">Mía</Badge>}
                          {p.esDefault && <Badge tone="success">Por defecto</Badge>}
                        </button>
                      </li>
                    ))}
                </ul>
              </li>
            ))}
            <li>
              <Button
                variant="secondary"
                onClick={() => {
                  void crearPlantilla(companyId, {
                    nombre: 'Mi firma',
                    contenido: FIRMA_NUEVA,
                    clase: 'firma',
                    usuarioId,
                    esDefault: false,
                  })
                    .then((nueva) => {
                      refrescar()
                      setElegida(nueva.id)
                    })
                    .catch((e: unknown) => setAviso({ tono: 'error', titulo: mensajeDePlantilla(e) }))
                }}
              >
                Nueva firma mía
              </Button>
            </li>
          </ul>

          {actual ? (
            <Editor
              key={actual.id}
              plantilla={actual}
              soloLectura={!puedeEditar(actual, activa?.rol, usuarioId)}
              onGuardado={(titulo) => {
                refrescar()
                setAviso({ tono: 'ok', titulo })
              }}
              onError={(t) => setAviso({ tono: 'error', titulo: t })}
              companyId={companyId}
            />
          ) : (
            <p className={styles.ayuda}>Elegí una plantilla de la lista para verla.</p>
          )}
        </div>
      </section>
    </div>
  )
}

/** Los datos de quien está mirando: son los que rellenan `{{usuario.*}}`. */
function MisDatos({ onError, onGuardado }: { onError: (t: string) => void; onGuardado: () => void }) {
  const q = useMisDatosDeFirma()
  const qc = useQueryClient()
  const [borrador, setBorrador] = useState<MisDatosDeFirma | null>(null)
  const [guardando, setGuardando] = useState(false)
  const datos = borrador ?? q.data ?? null

  if (q.isPending || !datos) return <SkeletonRows rows={1} columns={3} label="Cargando tus datos…" />

  return (
    <section className={styles.bloque}>
      <h2 className={styles.titulo}>Tus datos de firma</h2>
      <p className={styles.ayuda}>
        Esto es lo que las plantillas ponen en <code>{'{{usuario.nombre}}'}</code>, <code>{'{{usuario.puesto}}'}</code> y{' '}
        <code>{'{{usuario.telefono}}'}</code>. Todo el correo sale desde la casilla de la empresa, así que la firma es lo
        único que le dice al cliente quién le escribió.
      </p>
      <div className={styles.grilla}>
        <Field label="Nombre">
          <Input value={datos.nombre} onChange={(e) => setBorrador({ ...datos, nombre: e.target.value })} />
        </Field>
        <Field label="Puesto">
          <Input value={datos.puesto} placeholder="Ventas" onChange={(e) => setBorrador({ ...datos, puesto: e.target.value })} />
        </Field>
        <Field label="Teléfono">
          <Input value={datos.telefono} placeholder="11 2169 3304" onChange={(e) => setBorrador({ ...datos, telefono: e.target.value })} />
        </Field>
      </div>
      <Button
        disabled={guardando || datos.nombre.trim() === ''}
        onClick={() => {
          setGuardando(true)
          void guardarMisDatosDeFirma(datos)
            .then((d) => {
              qc.setQueryData(clavesPlantillas.misDatos(), d)
              setBorrador(null)
              // La vista previa depende de estos datos: se tira la caché.
              void qc.invalidateQueries({ queryKey: ['configuracion'] })
              onGuardado()
            })
            .catch((e: unknown) => onError(mensajeDePlantilla(e)))
            .finally(() => setGuardando(false))
        }}
      >
        Guardar mis datos
      </Button>
    </section>
  )
}

function Editor({
  companyId,
  plantilla,
  soloLectura,
  onGuardado,
  onError,
}: {
  companyId: string
  plantilla: Plantilla
  soloLectura: boolean
  onGuardado: (titulo: string) => void
  onError: (t: string) => void
}) {
  const [nombre, setNombre] = useState(plantilla.nombre)
  const [contenido, setContenido] = useState(plantilla.contenido)
  const [guardando, setGuardando] = useState(false)
  const caja = useRef<HTMLTextAreaElement>(null)

  const esHtml = plantilla.clase === 'envoltorio'
  const problemas = revisar(plantilla.clase, nombre, contenido)

  /*
   * El texto con el que se pide la vista previa va con freno.
   *
   * Sin esto, cada tecla sería un viaje al servidor, y desde acá cada viaje
   * cuesta unos 220 ms fijos. Se espera a que la persona pare de escribir.
   */
  const [frenado, setFrenado] = useState(contenido)
  useEffect(() => {
    const reloj = setTimeout(() => setFrenado(contenido), 400)
    return () => clearTimeout(reloj)
  }, [contenido])
  const previa = usePrevia(frenado, esHtml)

  const insertar = (clave: string) => {
    const t = caja.current
    const marca = `{{${clave}}}`
    if (!t) return setContenido(contenido + marca)
    const i = t.selectionStart ?? contenido.length
    const f = t.selectionEnd ?? i
    setContenido(contenido.slice(0, i) + marca + contenido.slice(f))
    queueMicrotask(() => {
      t.focus()
      t.setSelectionRange(i + marca.length, i + marca.length)
    })
  }

  return (
    <div className={styles.editor}>
      <Field label="Nombre">
        <Input value={nombre} disabled={soloLectura} onChange={(e) => setNombre(e.target.value)} />
      </Field>

      <Field label={esHtml ? 'Contenido (HTML)' : 'Contenido'}>
        <textarea
          ref={caja}
          className={styles.caja}
          rows={esHtml ? 16 : 8}
          value={contenido}
          disabled={soloLectura}
          onChange={(e) => setContenido(e.target.value)}
        />
      </Field>

      {!soloLectura && (
        <div className={styles.marcadores}>
          <p className={styles.ayuda}>Insertar:</p>
          {MARCADORES.map((m) => (
            <button key={m.clave} type="button" className={styles.chip} onClick={() => insertar(m.clave)} title={m.etiqueta}>
              {m.clave}
            </button>
          ))}
          {esHtml &&
            HUECOS.map((h) => (
              <button
                key={h.clave}
                type="button"
                className={`${styles.chip} ${styles.chipHueco}`}
                onClick={() => insertar(h.clave)}
                title={h.etiqueta}
              >
                {h.clave}
              </button>
            ))}
        </div>
      )}

      {problemas.length > 0 && (
        <ul className={styles.problemas}>
          {problemas.map((p) => (
            <li key={p.texto} className={p.gravedad === 'error' ? styles.error : styles.avisoLeve}>
              {p.texto}
            </li>
          ))}
        </ul>
      )}

      <div className={styles.previa}>
        <p className={styles.ayuda}>Vista previa, con tus datos:</p>
        {esHtml ? (
          /*
           * El HTML lo escribe un admin y los valores interpolados los escapa
           * el servidor. Aun así va en un iframe sin permisos: lo que se ve acá
           * termina en un mail, y un mail no ejecuta nada.
           */
          <iframe className={styles.marco} title="Vista previa" sandbox="" srcDoc={previa.data ?? ''} />
        ) : (
          <pre className={styles.textoPlano}>{previa.data ?? ''}</pre>
        )}
      </div>

      {!soloLectura && (
        <div className={styles.acciones}>
          <Button
            disabled={guardando || !sePuedeGuardar(problemas)}
            onClick={() => {
              setGuardando(true)
              void guardarPlantilla(plantilla.id, { nombre, contenido })
                .then(() => onGuardado('Plantilla guardada.'))
                .catch((e: unknown) => onError(mensajeDePlantilla(e)))
                .finally(() => setGuardando(false))
            }}
          >
            Guardar
          </Button>
          {!plantilla.esDefault && (
            <Button
              variant="secondary"
              onClick={() => {
                void marcarPorDefecto(companyId, plantilla)
                  .then(() => onGuardado('Ahora se usa ésta por defecto.'))
                  .catch((e: unknown) => onError(mensajeDePlantilla(e)))
              }}
            >
              Usar por defecto
            </Button>
          )}
          {plantilla.usuarioId !== null && (
            <Button
              variant="ghost"
              onClick={() => {
                void desactivarPlantilla(plantilla.id)
                  .then(() => onGuardado('Plantilla desactivada.'))
                  .catch((e: unknown) => onError(mensajeDePlantilla(e)))
              }}
            >
              Desactivar
            </Button>
          )}
        </div>
      )}
      {soloLectura && <p className={styles.ayuda}>Esta plantilla la administra un admin. La podés ver, no editar.</p>}
    </div>
  )
}

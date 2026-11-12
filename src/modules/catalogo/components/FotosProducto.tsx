import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import {
  borrarFoto,
  listarFotos,
  ordenarFotos,
  subirFotos,
  type FotoProducto,
} from '../services/fotosProducto'
import styles from './FotosProducto.module.css'

/**
 * Las fotos del producto, en el editor (Fase 246).
 *
 * Cada acción se guarda EN EL MOMENTO —subir, mover, borrar—, no con «Guardar
 * cambios»: un archivo ya subido no puede esperar a un botón que quizá nunca se
 * aprieta, y así lo que se ve es siempre lo que hay.
 *
 * La primera es la principal: es la que se ve en el listado, en la ficha, en
 * los documentos y en la web. «Principal» la lleva al primer lugar.
 */
export function FotosProducto({ companyId, productId }: { companyId: string; productId: string }) {
  const qc = useQueryClient()
  const entrada = useRef<HTMLInputElement>(null)
  const [arrastrando, setArrastrando] = useState(false)
  const clave = ['catalogo', companyId, 'fotos', productId] as const

  const fotos = useQuery({ queryKey: clave, queryFn: () => listarFotos(companyId, productId) })
  const lista = fotos.data ?? []

  const refrescar = async () => {
    // Las fotos se ven en la ficha, el listado y el catálogo: todo lo de catálogo.
    await qc.invalidateQueries({ queryKey: ['catalogo'] })
  }

  const subir = useMutation({
    mutationFn: (archivos: File[]) => subirFotos(companyId, productId, archivos, lista),
    onSettled: refrescar,
  })
  const ordenar = useMutation({
    mutationFn: (nuevas: FotoProducto[]) => ordenarFotos(companyId, nuevas),
    onSettled: refrescar,
  })
  const borrar = useMutation({
    mutationFn: (f: FotoProducto) =>
      borrarFoto(
        companyId,
        f,
        lista.filter((x) => x.id !== f.id),
      ),
    onSettled: refrescar,
  })

  const ocupado = subir.isPending || ordenar.isPending || borrar.isPending
  const error = [subir.error, ordenar.error, borrar.error].find((e) => e instanceof Error)

  const mover = (i: number, a: number) => {
    const nuevas = [...lista]
    const [f] = nuevas.splice(i, 1)
    nuevas.splice(a, 0, f!)
    ordenar.mutate(nuevas)
  }

  const elegir = (archivos: FileList | null) => {
    const imagenes = Array.from(archivos ?? []).filter((a) => a.type.startsWith('image/'))
    if (imagenes.length > 0) subir.mutate(imagenes)
  }

  return (
    <fieldset className={styles.bloque}>
      <legend className={styles.titulo}>Fotos</legend>
      <p className={styles.nota}>
        La primera es la principal: la que se ve en el catálogo, en los documentos y en la web. Los
        cambios de fotos se guardan al momento.
      </p>

      {error ? (
        <Alert tone="danger" role="alert">
          <p>{error.message}</p>
        </Alert>
      ) : null}

      <ul className={styles.grilla} aria-busy={ocupado}>
        {lista.map((f, i) => (
          <li key={f.id} className={i === 0 ? styles.fotoPrincipal : styles.foto}>
            <img
              src={f.thumbUrl ?? f.url}
              alt={`Foto ${i + 1}`}
              className={styles.imagen}
              loading="lazy"
            />
            {i === 0 ? <span className={styles.chip}>Principal</span> : null}
            <div className={styles.acciones}>
              {i > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={ocupado}
                  onClick={() => mover(i, 0)}
                  icon={<Icon name="star" size={16} />}
                  aria-label={`Hacer principal la foto ${i + 1}`}
                />
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                disabled={ocupado || i === 0}
                onClick={() => mover(i, i - 1)}
                icon={<Icon name="arrow-left" size={16} />}
                aria-label={`Mover la foto ${i + 1} antes`}
              />
              <Button
                variant="ghost"
                size="sm"
                disabled={ocupado || i === lista.length - 1}
                onClick={() => mover(i, i + 1)}
                icon={<Icon name="arrow-right" size={16} />}
                aria-label={`Mover la foto ${i + 1} después`}
              />
              <Button
                variant="ghost"
                size="sm"
                disabled={ocupado}
                onClick={() => {
                  if (window.confirm('¿Quitar esta foto del producto?')) borrar.mutate(f)
                }}
                icon={<Icon name="trash" size={16} />}
                aria-label={`Quitar la foto ${i + 1}`}
              />
            </div>
          </li>
        ))}

        <li>
          <button
            type="button"
            className={arrastrando ? styles.agregarActivo : styles.agregar}
            disabled={ocupado}
            onClick={() => entrada.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setArrastrando(true)
            }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => {
              e.preventDefault()
              setArrastrando(false)
              elegir(e.dataTransfer.files)
            }}
          >
            <Icon name={subir.isPending ? 'refresh' : 'upload'} size={20} />
            <span>
              {subir.isPending ? 'Subiendo…' : lista.length === 0 ? 'Subir fotos' : 'Agregar fotos'}
            </span>
            <span className={styles.ayuda}>o arrastralas acá</span>
          </button>
        </li>
      </ul>

      <input
        ref={entrada}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        multiple
        hidden
        onChange={(e) => {
          elegir(e.target.files)
          e.target.value = ''
        }}
      />
      {fotos.isPending ? <p className={styles.nota}>Cargando fotos…</p> : null}
    </fieldset>
  )
}

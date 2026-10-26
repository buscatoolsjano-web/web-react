import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/forms/controls'
import { Spinner } from '@/components/ui/Spinner'
import { Alert } from '@/components/feedback/Alert'
import { Icon } from '@/components/icons/Icon'
import { useDebounce } from '@/hooks/useDebounce'
import {
  fijarPortadaCategoria,
  portadasDeCategorias,
  productosConFotoDeCategoria,
  subirPortadaCategoria,
} from '../services/visibilidad'
import styles from './GestorPortadas.module.css'

/** Lo que acepta el bucket público para una portada. */
const TIPOS_IMAGEN = ['image/png', 'image/jpeg', 'image/webp', 'image/avif']
const MAXIMO = 5 * 1024 * 1024

/**
 * Elegir la foto de portada de cada categoría (Fase 143).
 *
 * «Que cada categoría tenga una imagen real de un producto suyo, y que los admins
 * puedan elegir cuál.» La portada de la categoría es la foto de un PRODUCTO suyo;
 * acá el admin busca entre los productos que tienen foto y elige. Si una categoría
 * no tiene ningún producto con foto, no se puede elegir todavía: se dice.
 */
export function GestorPortadas({ companyId }: { companyId: string }) {
  const qc = useQueryClient()
  const cats = useQuery({
    queryKey: ['web', companyId, 'portadas'],
    queryFn: () => portadasDeCategorias(companyId),
  })

  const [abierta, setAbierta] = useState<string | null>(null)

  const refrescar = () => {
    setAbierta(null)
    void qc.invalidateQueries({ queryKey: ['web', companyId, 'portadas'] })
    // La portada cambió también para el sitio público.
    void qc.invalidateQueries({ queryKey: ['catalogo-publico', 'categorias'] })
  }

  const fijar = useMutation({
    mutationFn: (v: { categoriaId: string; productoId: string | null }) =>
      fijarPortadaCategoria(companyId, v.categoriaId, v.productoId),
    onSuccess: refrescar,
  })

  const [subiendo, setSubiendo] = useState<string | null>(null)
  const [errorSubir, setErrorSubir] = useState<string | null>(null)
  const subir = useMutation({
    mutationFn: (v: { categoriaId: string; archivo: File }) =>
      subirPortadaCategoria(companyId, v.categoriaId, v.archivo),
    onMutate: (v) => {
      setErrorSubir(null)
      setSubiendo(v.categoriaId)
    },
    onSuccess: refrescar,
    onError: (e) => setErrorSubir(e instanceof Error ? e.message : 'No se pudo subir la imagen.'),
    onSettled: () => setSubiendo(null),
  })

  const elegirArchivo = (categoriaId: string, archivo: File | null) => {
    if (!archivo) return
    if (!TIPOS_IMAGEN.includes(archivo.type)) {
      setErrorSubir('Tiene que ser PNG, JPG, WEBP o AVIF.')
      return
    }
    if (archivo.size > MAXIMO) {
      setErrorSubir('El archivo pasa de 5 MB.')
      return
    }
    subir.mutate({ categoriaId, archivo })
  }

  if (cats.isPending) {
    return <div className={styles.cargando}><Spinner /> Cargando…</div>
  }

  return (
    <div>
      {fijar.isError ? (
        <Alert tone="danger">No se pudo cambiar la portada. Probá de nuevo.</Alert>
      ) : null}
      {errorSubir ? <Alert tone="danger">{errorSubir}</Alert> : null}

      <ul className={styles.lista}>
        {(cats.data ?? []).map((c) => (
          <li key={c.categoryId} className={styles.fila}>
            <div className={styles.cabecera}>
              <span className={styles.miniatura}>
                {c.portadaUrl ? (
                  <img src={c.portadaUrl} alt="" width={48} height={48} />
                ) : (
                  <span className={styles.sinFoto} aria-hidden="true"><Icon name="image" size={20} /></span>
                )}
              </span>
              <span className={styles.nombre}>
                {c.nombre}
                <span className={styles.estado}>
                  {c.imagenSubida ? 'Imagen subida' : c.portadaUrl ? 'Con portada' : 'Sin portada'}
                  {c.conFotos === 0 ? ' · ningún producto tiene foto' : ` · ${c.conFotos} con foto`}
                </span>
              </span>
              <span className={styles.acciones}>
                {c.portadaUrl ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={fijar.isPending || subiendo === c.categoryId}
                    onClick={() => fijar.mutate({ categoriaId: c.categoryId, productoId: null })}
                  >
                    Quitar
                  </Button>
                ) : null}
                {/* Elegir un PRODUCTO de la categoría (sólo si alguno tiene foto). */}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={c.conFotos === 0}
                  onClick={() => setAbierta(abierta === c.categoryId ? null : c.categoryId)}
                >
                  {abierta === c.categoryId ? 'Cerrar' : 'Elegir de la categoría'}
                </Button>
                {/* Subir una imagen propia: sirve SIEMPRE, también cuando no hay
                    ningún producto con foto. */}
                <label className={styles.subir}>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/avif"
                    hidden
                    disabled={subiendo === c.categoryId}
                    onChange={(e) => {
                      elegirArchivo(c.categoryId, e.target.files?.[0] ?? null)
                      e.target.value = ''
                    }}
                  />
                  {subiendo === c.categoryId ? 'Subiendo…' : 'Subir foto'}
                </label>
              </span>
            </div>

            {abierta === c.categoryId ? (
              <Picker
                companyId={companyId}
                categoriaId={c.categoryId}
                guardando={fijar.isPending}
                onElegir={(productoId) => fijar.mutate({ categoriaId: c.categoryId, productoId })}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** El buscador + grilla de fotos de una categoría, para elegir la portada. */
function Picker({
  companyId,
  categoriaId,
  guardando,
  onElegir,
}: {
  companyId: string
  categoriaId: string
  guardando: boolean
  onElegir: (productoId: string) => void
}) {
  const [texto, setTexto] = useState('')
  const q = useDebounce(texto, 300)
  const productos = useQuery({
    queryKey: ['web', companyId, 'portada-productos', categoriaId, q],
    queryFn: () => productosConFotoDeCategoria(companyId, categoriaId, q),
  })

  return (
    <div className={styles.picker}>
      <Input
        type="search"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Buscar por referencia o nombre…"
        aria-label="Buscar producto para la portada"
      />
      {productos.isPending ? (
        <div className={styles.cargando}><Spinner size={16} /> Buscando…</div>
      ) : (productos.data ?? []).length === 0 ? (
        <p className={styles.vacio}>Sin productos con foto que coincidan.</p>
      ) : (
        <div className={styles.grilla}>
          {productos.data!.map((p) => (
            <button
              key={p.id}
              type="button"
              className={styles.tarjeta}
              disabled={guardando}
              onClick={() => onElegir(p.id)}
              title={`${p.sku} · ${p.nombre}`}
            >
              {p.fotoUrl ? <img src={p.fotoUrl} alt="" loading="lazy" /> : null}
              <span className={styles.tarjetaSku}>{p.sku}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

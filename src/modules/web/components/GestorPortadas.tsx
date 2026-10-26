import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/forms/controls'
import { Spinner } from '@/components/ui/Spinner'
import { Alert } from '@/components/feedback/Alert'
import { Icon } from '@/components/icons/Icon'
import { useDebounce } from '@/hooks/useDebounce'
import {
  aplicarVisibilidad,
  fijarPortadaCategoria,
  portadasDeCategorias,
  productosConFotoDeCategoria,
  subirPortadaCategoria,
  visibilidadCategorias,
} from '../services/visibilidad'
import styles from './GestorPortadas.module.css'

/** Lo que acepta el bucket público para una portada. */
const TIPOS_IMAGEN = ['image/png', 'image/jpeg', 'image/webp', 'image/avif']
const MAXIMO = 5 * 1024 * 1024

/**
 * Las categorías del sitio: visibilidad Y foto de portada, en UNA tabla (Fase 158).
 *
 * «Que donde dice "por categoría" estén las fotos y una opción de modificar.»
 * Antes eran dos secciones separadas —la tabla de visibilidad arriba y el gestor
 * de portadas abajo—. Ahora cada categoría es una fila con su miniatura, cuántos
 * productos ve la web y un botón «Modificar foto» que abre, ahí mismo, elegir un
 * producto de la categoría o subir una imagen propia (que sirve siempre, también
 * cuando ningún producto tiene foto).
 */
export function GestorPortadas({ companyId }: { companyId: string }) {
  const qc = useQueryClient()
  const portadas = useQuery({
    queryKey: ['web', companyId, 'portadas'],
    queryFn: () => portadasDeCategorias(companyId),
  })
  const vis = useQuery({
    queryKey: ['web', companyId, 'visibilidad-cats'],
    queryFn: () => visibilidadCategorias(companyId),
  })

  const [abierta, setAbierta] = useState<string | null>(null)

  const refrescarPortadas = () => {
    setAbierta(null)
    void qc.invalidateQueries({ queryKey: ['web', companyId, 'portadas'] })
    void qc.invalidateQueries({ queryKey: ['catalogo-publico', 'categorias'] })
  }
  const refrescarVis = () => {
    void qc.invalidateQueries({ queryKey: ['web', companyId, 'visibilidad-cats'] })
    void qc.invalidateQueries({ queryKey: ['web', companyId, 'visibilidad-buscar'] })
  }

  const fijar = useMutation({
    mutationFn: (v: { categoriaId: string; productoId: string | null }) =>
      fijarPortadaCategoria(companyId, v.categoriaId, v.productoId),
    onSuccess: refrescarPortadas,
  })
  const aplicar = useMutation({
    mutationFn: (v: { visible: boolean; categoryId: string }) =>
      aplicarVisibilidad(companyId, v.visible, { categoryId: v.categoryId }),
    onSuccess: refrescarVis,
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
    onSuccess: refrescarPortadas,
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

  // Cada categoría con su visibilidad y su portada, juntas por id. Se toma la
  // lista de portadas como base (trae la foto y cuántos productos tienen foto) y
  // se le suman los conteos de visibilidad.
  const filas = useMemo(() => {
    const visPorId = new Map((vis.data ?? []).map((v) => [v.categoryId, v]))
    return (portadas.data ?? []).map((p) => ({
      ...p,
      total: visPorId.get(p.categoryId)?.total ?? 0,
      visibles: visPorId.get(p.categoryId)?.visibles ?? 0,
    }))
  }, [portadas.data, vis.data])

  if (portadas.isPending) {
    return <div className={styles.cargando}><Spinner /> Cargando…</div>
  }

  return (
    <div>
      {fijar.isError ? <Alert tone="danger">No se pudo cambiar la portada. Probá de nuevo.</Alert> : null}
      {aplicar.isError ? <Alert tone="danger">No se pudo aplicar el cambio de visibilidad.</Alert> : null}
      {errorSubir ? <Alert tone="danger">{errorSubir}</Alert> : null}

      <table className={styles.tabla}>
        <thead>
          <tr>
            <th className={styles.colFoto}><span className="sr-only">Foto</span></th>
            <th>Categoría</th>
            <th className={styles.num}>En la web</th>
            <th><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {filas.map((c) => {
            const pct = c.total > 0 ? Math.round((c.visibles / c.total) * 100) : 0
            const abiertoAca = abierta === c.categoryId
            return (
              <Fragment key={c.categoryId}>
                <tr>
                  <td className={styles.colFoto}>
                    <span className={styles.miniatura}>
                      {c.portadaUrl ? (
                        <img src={c.portadaUrl} alt="" width={44} height={44} />
                      ) : (
                        <span className={styles.sinFoto} aria-hidden="true"><Icon name="image" size={20} /></span>
                      )}
                    </span>
                  </td>
                  <td>
                    <span className={styles.nombre}>{c.nombre}</span>
                    <span className={styles.estado}>
                      {c.imagenSubida ? 'Imagen subida' : c.portadaUrl ? 'Con portada' : 'Sin portada'}
                      {c.conFotos === 0 ? ' · ningún producto tiene foto' : ` · ${c.conFotos} con foto`}
                    </span>
                  </td>
                  <td className={styles.num}>
                    <span className={styles.conteo}>
                      {c.visibles.toLocaleString('es-AR')} / {c.total.toLocaleString('es-AR')}
                    </span>
                    <span className={styles.barra}><span className={styles.barraLlena} style={{ width: `${pct}%` }} /></span>
                  </td>
                  <td className={styles.acciones}>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={aplicar.isPending || c.total === 0 || c.visibles === c.total}
                      onClick={() => aplicar.mutate({ visible: true, categoryId: c.categoryId })}
                    >
                      Mostrar todo
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={aplicar.isPending || c.visibles === 0}
                      onClick={() => aplicar.mutate({ visible: false, categoryId: c.categoryId })}
                    >
                      Ocultar todo
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Icon name="image" size={16} />}
                      onClick={() => setAbierta(abiertoAca ? null : c.categoryId)}
                    >
                      {abiertoAca ? 'Cerrar' : 'Modificar foto'}
                    </Button>
                  </td>
                </tr>

                {abiertoAca ? (
                  <tr>
                    <td colSpan={4} className={styles.editorFoto}>
                      <div className={styles.editorAcciones}>
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
                          {subiendo === c.categoryId ? 'Subiendo…' : 'Subir una imagen propia'}
                        </label>
                        {c.portadaUrl ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={fijar.isPending || subiendo === c.categoryId}
                            onClick={() => fijar.mutate({ categoriaId: c.categoryId, productoId: null })}
                          >
                            Quitar la foto
                          </Button>
                        ) : null}
                      </div>
                      {c.conFotos === 0 ? (
                        <p className={styles.nota}>
                          Ningún producto de esta categoría tiene foto. Subí una imagen propia con el
                          botón de arriba.
                        </p>
                      ) : (
                        <Picker
                          companyId={companyId}
                          categoriaId={c.categoryId}
                          guardando={fijar.isPending}
                          onElegir={(productoId) => fijar.mutate({ categoriaId: c.categoryId, productoId })}
                        />
                      )}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
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
      <p className={styles.notaPicker}>Elegí un producto de la categoría: su foto pasa a ser la portada.</p>
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

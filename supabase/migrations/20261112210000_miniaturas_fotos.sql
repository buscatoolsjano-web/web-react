-- Miniaturas WebP de las fotos de producto.
--
-- «Optimizá todas las imágenes para que pesen menos.» Las fotos pesan ~40 KB y
-- en los listados se ven de 60–250 px. `scripts/miniaturas-fotos.mjs` armó una
-- versión de 400 px en WebP de cada una (~5 KB, 87 % menos) y la guardó en
-- `catalogo-publico/miniaturas/<md5(source_url)>.webp`.
--
-- 1. `thumb_url` apunta a esa miniatura en cada foto que la tiene. Se mira que
--    el archivo EXISTA en el bucket: nunca se apunta a una miniatura que no
--    está (el ERP prueba la miniatura y, si falla, recién ahí el original).
-- 2. El listado del catálogo público devuelve `imagenMini` además de
--    `imagenUrl`, para que la web muestre la chica en la grilla y la tabla.

update public.product_images pi
   set thumb_url = 'https://jiudqbusyknubonpedde.supabase.co/storage/v1/object/public/catalogo-publico/miniaturas/'
                   || md5(pi.source_url) || '.webp'
 where pi.source_url is not null
   and exists (select 1 from storage.objects o
                where o.bucket_id = 'catalogo-publico'
                  and o.name = 'miniaturas/' || md5(pi.source_url) || '.webp')
   and pi.thumb_url is distinct from
       'https://jiudqbusyknubonpedde.supabase.co/storage/v1/object/public/catalogo-publico/miniaturas/'
       || md5(pi.source_url) || '.webp';

-- El listado público: la foto chica al lado de la grande. Se reescribe la
-- definición vigente con dos reemplazos exactos, y se verifica que los dos
-- hayan entrado (si la función cambió y no calzan, la migración falla).
do $$
declare
  v_def text := pg_get_functiondef('public.catalogo_publico_listar(text,text,text,integer,integer,text,text,jsonb,text,jsonb)'::regprocedure);
  v_nueva text;
begin
  v_nueva := replace(v_def,
    'select pi.storage_path, pi.source_url, pi.alt_text',
    'select pi.storage_path, pi.source_url, pi.thumb_url, pi.alt_text');
  v_nueva := replace(v_nueva,
    '''imagenUrl'', i.source_url,',
    '''imagenUrl'', i.source_url, ''imagenMini'', i.thumb_url,');
  if v_nueva = v_def or position('pi.thumb_url' in v_nueva) = 0 or position('''imagenMini''' in v_nueva) = 0 then
    raise exception 'catalogo_publico_listar cambió: no calzaron los reemplazos';
  end if;
  execute v_nueva;
end $$;

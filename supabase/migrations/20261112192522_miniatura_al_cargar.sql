-- La miniatura que ya existe se usa sola al cargar la foto en otro producto.
--
-- «Y las fotos que sube Grok, que también tengan la miniatura.» Grok suele
-- cargar la MISMA foto en muchos productos (la funda de los 100VP TEF). La
-- miniatura de una foto vive en `catalogo-publico/miniaturas/<md5(url)>.webp`:
-- si ya está, la fila nueva apunta a ella en el momento, sin esperar a la
-- tarea programada. Si no está, `thumb_url` queda como venía y la tarea de
-- `.github/workflows/miniaturas.yml` la arma en los próximos 15 minutos.

create or replace function app.miniatura_existente()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_nombre text;
begin
  if new.source_url is null or new.thumb_url like '%/miniaturas/%' or new.thumb_url like '%.mini.webp' then
    return new;
  end if;
  v_nombre := 'miniaturas/' || md5(new.source_url) || '.webp';
  if exists (select 1 from storage.objects o where o.bucket_id = 'catalogo-publico' and o.name = v_nombre) then
    new.thumb_url := 'https://jiudqbusyknubonpedde.supabase.co/storage/v1/object/public/catalogo-publico/' || v_nombre;
  end if;
  return new;
end $function$;

revoke execute on function app.miniatura_existente() from public, anon, authenticated;

drop trigger if exists trg_miniatura_existente on public.product_images;
create trigger trg_miniatura_existente
  before insert or update of source_url on public.product_images
  for each row execute function app.miniatura_existente();

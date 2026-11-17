-- Segunda pasada de limpieza de «Medida» (aprobada por el usuario):
--  * 381 valores deducidos del nombre: patrones de código APEX (440-TX-27X → T27,
--    440-30IPX → IP30, TWD-2 → TW2, TX-54xx → E-Torx), TOHNICHI «#2 Phillips»,
--    y las 130 propuestas de los productos sin tipo («LLAVE ALLEN 14mm» → 14 mm).
--  * 113 medidas que eran copia del largo y cuyo tamaño no está en el nombre: se
--    quitan (dejar «25 mm» en una punta Torx de 25 mm de largo es un dato falso).
-- Respaldo en app.respaldo_medidas_limpieza (se agregan los que faltan).

create temporary table _correcciones on commit drop as
with m as (select * from app.propuestas_medida())
select m.id,
  case
    when m.motivo = 'numero_sin_unidad' and m.propuesta is not null then m.propuesta
    when m.tipo = 'Torx' and upper(m.nombre) ~ '\mE-?[0-9]{1,2}\M' then 'E' || (regexp_match(upper(m.nombre), '\mE-?0*([0-9]{1,2})\M'))[1]
    when m.tipo = 'Torx' and m.medida_actual ~* '^TX[0-9]{4}$' then 'E' || ltrim(right(m.medida_actual, 2), '0')
    when m.tipo = 'Torx' and upper(m.nombre) ~ 'TX-?0*[0-9]{1,2}(?![0-9])' then 'T' || (regexp_match(upper(m.nombre), 'TX-?0*([0-9]{1,2})(?![0-9])'))[1]
    when m.tipo like 'Torx Plus%' and upper(m.nombre) ~ '(^|[^0-9])[0-9]{1,2}IP' then 'IP' || (regexp_match(upper(m.nombre), '(?:^|[^0-9])([0-9]{1,2})IP'))[1]
    when m.tipo = 'Tri-Wing' and upper(m.nombre) ~ '\mTW[A-Z]?-[0-9]\M' then 'TW' || (regexp_match(upper(m.nombre), '\mTW[A-Z]?-([0-9])\M'))[1]
    when m.tipo = 'Phillips' and upper(m.nombre) ~ '#[0-9] PHILLIPS' then 'PH' || (regexp_match(upper(m.nombre), '#([0-9]) PHILLIPS'))[1]
    when m.tipo = 'Phillips' and upper(m.nombre) ~ '#[0-9] PLUS BIT' then 'PH' || (regexp_match(upper(m.nombre), '#([0-9]) PLUS BIT'))[1]
    when m.medida_actual ~* ' ?mm$' and m.largo is not null
      and regexp_replace(m.medida_actual, '[^0-9.]', '', 'g') = btrim(m.largo) then '(vaciar)'
  end valor
from m;

delete from _correcciones where valor is null;

insert into app.respaldo_medidas_limpieza (id, company_id, attributes, description)
select p.id, p.company_id, p.attributes, p.description
from public.products p join _correcciones c on c.id = p.id
on conflict (id) do nothing;

update public.products p
set attributes = case when c.valor = '(vaciar)' then p.attributes - 'medida'
                      else jsonb_set(p.attributes, '{medida}', to_jsonb(c.valor)) end
from _correcciones c
where c.id = p.id;

update public.products p
set description = app.descripcion_concatenada(p)
from _correcciones c
where c.id = p.id and p.description like 'Nombre: %';

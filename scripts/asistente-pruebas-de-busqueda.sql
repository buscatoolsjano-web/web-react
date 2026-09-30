-- Banco de pruebas de la búsqueda del asistente (Fase 32).
--
-- La misma pregunta escrita de muchas formas tiene que traer lo mismo. No
-- todos van a escribir «¿tenemos puntas Philips PH2 con stock?»: van a poner
-- «ph2» y listo, y la respuesta tiene que ser igual de buena.
--
-- Esto prueba la BÚSQUEDA, no al modelo. Es a propósito: corre en un segundo,
-- no cuesta nada, es determinista, y es la capa donde estuvo el error que
-- hacía que el asistente dijera «no hay stock» de algo que había. Probar sólo
-- a través del modelo mezcla dos fuentes de fallo y cuesta plata cada vez.
--
-- CÓMO CORRERLO
--   Pegarlo en el SQL editor del proyecto. Corre como `authenticated`, que es
--   lo que hace la persona de verdad: como `postgres` se saltea la RLS y
--   prueba otra cosa.
--
-- CÓMO LEERLO
--   Toda fila que no diga «✓» es un caso que hay que mirar. El puesto importa:
--   algo que aparece en el puesto 9 técnicamente está, pero el modelo lee los
--   primeros y puede no mencionarlo.

select set_config('request.jwt.claims',
  json_build_object('sub', 'c09e3edc-7216-4878-964e-c45e5cb9639d',
                    'role', 'authenticated')::text, false),
  set_config('role', 'authenticated', false);

with casos(grupo, pregunta, tipo, espera) as (values
  -- ── El caso que originó todo ──────────────────────────────────────────────
  -- «puntas» en plural no matcheaba «PUNTA», y «philips» con una L no
  -- matcheaba «PHILLIPS». El asistente contestaba que NO había stock con 10
  -- unidades en el depósito.
  ('PH2', 'ph2',                     'sku', 'BR.PH2'),
  ('PH2', 'PH2',                     'sku', 'BR.PH2'),
  ('PH2', 'punta ph2',               'sku', 'BR.PH2'),
  ('PH2', 'puntas ph2',              'sku', 'BR.PH2'),
  ('PH2', 'punta philips ph2',       'sku', 'BR.PH2'),
  ('PH2', 'puntas phillips ph2',     'sku', 'BR.PH2'),
  ('PH2', 'PUNTA PHILLIPS PH2',      'sku', 'BR.PH2'),
  ('PH2', 'que hay de ph2',          'sku', 'BR.PH2'),
  ('PH2', 'punta philips',           'sku', 'BR.PH2'),
  ('PH2', 'tenes puntas ph2',        'sku', 'BR.PH2'),
  ('PH2', 'necesito una punta ph2',  'sku', 'BR.PH2'),

  -- ── Referencia exacta, con y sin prefijo, en mayúscula y minúscula ────────
  ('REFERENCIA', 'SP.2008VP/100',        'sku', 'SP.2008VP/100'),
  ('REFERENCIA', 'sp.2008vp/100',        'sku', 'SP.2008VP/100'),
  ('REFERENCIA', '2008VP/100',           'sku', 'SP.2008VP/100'),
  ('REFERENCIA', 'speedrill 2008VP/100', 'sku', 'SP.2008VP/100'),
  ('REFERENCIA', 'tohnichi 4SF',         'sku', 'TC.4SF'),
  ('REFERENCIA', 'tohnichi 4sf',         'sku', 'TC.4SF'),
  ('REFERENCIA', '4SF',                  'sku', 'TC.4SF'),

  -- ── Preguntas por MARCA: lo que importa es que traiga esa marca ───────────
  ('MARCA', 'tohnichi',                 'marca', 'TOHNICHI'),
  ('MARCA', 'TOHNICHI',                 'marca', 'TOHNICHI'),
  ('MARCA', 'herramientas tohnichi',    'marca', 'TOHNICHI'),
  ('MARCA', 'gedore',                   'marca', 'GEDORE'),
  ('MARCA', 'productos gedore',         'marca', 'GEDORE'),
  ('MARCA', 'fein',                     'marca', 'FEIN'),
  ('MARCA', 'speedrill',                'marca', 'SPEEDRILL'),
  ('MARCA', 'fiam',                     'marca', 'FIAM'),
  ('MARCA', 'ingersoll rand',           'marca', 'INGERSOLL RAND'),
  ('MARCA', 'ingersoll',                'marca', 'INGERSOLL RAND'),
  ('MARCA', 'tecna',                    'marca', 'TECNA'),
  -- Las recuperadas en la Fase 32: estaban sin marca y con la marca en el
  -- nombre, así que filtrar por ellas dejaba afuera casi todo.
  ('MARCA', 'rivit',                    'marca', 'RIVIT'),
  ('MARCA', 'bremen',                   'marca', 'BREMEN'),
  ('MARCA', 'normeco',                  'marca', 'NORMECO'),
  ('MARCA', 'sumake',                   'marca', 'SUMAKE'),
  ('MARCA', 'milwaukee',                'marca', 'MILWAUKEE'),
  ('MARCA', 'red rooster',              'marca', 'RED ROOSTER'),
  ('MARCA', 'nac',                      'marca', 'NAC'),
  ('MARCA', 'macsi',                    'marca', 'MACSI'),
  ('MARCA', 'ohmi',                     'marca', 'OHMI'),

  -- ── En castellano, sobre productos con nombre en inglés (Fase 32 · E8) ───
  -- El puente lo hace el TIPO: «IMPACT SOCKET» está tipado como Embocadura,
  -- «TORX BIT» como Punta. Sin el tipo dentro del texto buscable, quien
  -- pregunta en castellano no encuentra nada de esto.
  ('TIPO', 'embocadura normeco',         'marca', 'NORMECO'),
  ('TIPO', 'puntas torx ohmi',           'marca', 'OHMI'),
  ('TIPO', 'embocaduras de impacto nac', 'marca', 'NAC'),

  -- ── Lo que NO tiene que devolver nada ────────────────────────────────────
  -- Devolver basura es peor que devolver nada: el modelo la menciona.
  ('VACIO', 'zzzz no existe',           'vacio', ''),
  ('VACIO', 'asdfghjkl',                'vacio', '')
)
select c.grupo,
       c.pregunta,
       case c.tipo when 'sku' then c.espera when 'marca' then 'marca ' || c.espera
                   else '(nada)' end as se_espera,
       case
         when c.tipo = 'vacio' then
           case when coalesce((r.datos ->> 'resultados')::int, 0) = 0
                then '✓' else '✗ devolvió ' || (r.datos ->> 'resultados') end
         when c.tipo = 'sku' then
           coalesce('✓ puesto ' || r.puesto::text, '✗ NO APARECE')
         else
           case when r.de_la_marca >= 3 then '✓ ' || r.de_la_marca || ' de los primeros 5'
                when r.de_la_marca > 0  then '~ sólo ' || r.de_la_marca || ' de 5'
                else '✗ NINGUNO es de esa marca' end
       end as resultado
from casos c
left join lateral (
  select d.datos,
         (select ord from jsonb_array_elements(d.datos -> 'productos') with ordinality as t(x, ord)
           where x ->> 'sku' = c.espera limit 1) as puesto,
         (select count(*) from jsonb_array_elements(d.datos -> 'productos') with ordinality as t(x, ord)
           where ord <= 5 and upper(x ->> 'marca') = upper(c.espera)) as de_la_marca
    from (select public.asistente_buscar_productos(
                   'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c', c.pregunta, 10) as datos) d
) r on true
order by (left(resultado, 1) = '✓'), c.grupo, c.pregunta;

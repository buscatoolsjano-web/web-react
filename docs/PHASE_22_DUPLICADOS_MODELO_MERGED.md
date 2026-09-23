# Fase 22 · Duplicados — revisión de los 92 antes de aplicar

**Nada aplicado.** `DB_CHANGES_APPLIED = 0`, `PRODUCTS_CHANGED = 0`, `STOCK_CHANGED = 0`.

---

## 1. De dónde salen los 92

De `docs/fase22-e3-duplicados-stel.csv`, congelado en la auditoría anterior:
las filas `PAR_1_A_1` con decisión «retirar el de STEL». Son 226 pares en
total, repartidos así:

| grupo | pares | qué son |
|---|---|---|
| `GRUPO_MUCHOS_A_UNO` | 116 | un canónico recibe varios — repuestos y accesorios que nombran la máquina. **Fuera** (§11) |
| `PAR_1_A_1` con stock | 18 | el duplicado tiene saldo. **Fuera** (§12) |
| `PAR_1_A_1` sin stock | **92** | lo que se revisa acá |

El archivo **es** la lista. El clasificador no vuelve a buscar candidatos, y
el SQL preparado tampoco: si se recalcularan, lo aprobado y lo aplicado
podrían no ser lo mismo.

## 2. Resultado de la clasificación

| clase | pares |
|---|---|
| `SAFE_TO_MERGE` | **88** |
| `REVIEW` | 2 |
| `DO_NOT_MERGE` | 2 |

Los cuatro que no pasan, con nombre y apellido:

| clase | par | por qué |
|---|---|---|
| `DO_NOT_MERGE` | `PRO04873` → `RV.RIV503` | «RIVIT RIV503 **JAWS** (x3pz)» contra «RIV503 REMACHADORA HIDRONEUMATICA». Son las mordazas, no la remachadora. Es el mismo error que ya cometimos con `RV.RIV504` |
| `DO_NOT_MERGE` | `FM.REP.BC12_ST` → `FI.BC12` | el SKU dice **`REP`** y el canónico no. «FIAM ARM BC12 SISTEMA TELESCOPICO» contra «BC12 BRAZO DE REACCION»: el telescópico parece ser una parte del brazo |
| `REVIEW` | `PRO00331` → `IR.BC1121-EU` | «CARGADOR **PARA** BATERIAS 20V» contra «CHARGER, 12V/20V, EU». Probablemente el mismo cargador, pero la palabra «para» hay que mirarla |
| `REVIEW` | `PRO00340` → `IR.QXC2PT200NPS12` | mismo part number, pero uno dice 148 Nm y el otro 200 Nm. Una de las dos fichas está mal escrita |

### Tres cosas que corregí sobre la marcha

La primera versión daba `DO_NOT_MERGE` a 10 pares por «medidas
contradictorias». Nueve eran falsos:

- **`DE 6 A 14 NM` no se leía como rango.** El parser pedía unidad pegada al
  número, así que de «6 A 14 NM» sólo veía `14`, y contra «DE 6 NM A 12 NM»
  daba contradicción. Son el mismo rango escrito distinto.
- **271 Nm contra 270 Nm no es una contradicción.** Comparaba valores sueltos
  en lugar de intervalos, y sin tolerancia. Ahora hace falta que los rangos no
  se toquen **y** que el hueco pase del 10 %.

La segunda versión descartaba el cargador `BC1121-EU` por decir «PARA». Las
palabras de repuesto (`JAWS`, `MORDAZA`, `REPUESTO`) descartan; «PARA» y
«COMPATIBLE» mandan a revisar. Un cargador «para baterías» es el cargador.

Y la tercera: **sólo miraba el nombre, no el SKU.** `FM.REP.BC12_ST` se llama
«FIAM ARM BC12 SISTEMA TELESCOPICO», que no tiene ninguna palabra de repuesto
— pero el SKU dice `REP`. Ahora `REP` como segmento entero del SKU (no como
subcadena de un part number) también descarta, cuando lo dice **uno solo** de
los dos: si los dos lo dicen, son dos fichas del mismo repuesto y el par sigue
en pie.

Las tres reglas están en `scripts/fase22-g-duplicados-tests.mjs`, con los
casos reales como tests. 51 pasan.

## 3. Stock

**Los 92 tienen «sin saldo registrado»**: ni una fila en `stock_balances`.
No es casualidad — los 18 que sí tenían saldo quedaron fuera en la auditoría
anterior (§12) — pero se volvió a medir, no se dio por hecho.

```
SAFE_WITH_STOCK    = 0
SAFE_WITHOUT_STOCK = 88
REVIEW_WITH_STOCK  = 0
```

El SQL preparado además **frena la migración entera** si alguno de los 88
tuviera saldo al momento de aplicar: entre el análisis y la aplicación puede
pasar tiempo, y un producto puede recibir stock en el medio.

## 4. Historia

```
HISTORICAL_LINES_AFFECTED                   = 22
HISTORICAL_LINES_WITH_COMPLETE_SNAPSHOT     = 22
HISTORICAL_LINES_WITHOUT_COMPLETE_SNAPSHOT  = 0
```

De los 88 `SAFE`, ocho tienen historia: 20 líneas (10 de cotización, 5 de
pedido, 5 de remito). Las 22 de los 92 candidatos tienen
`sku_snapshot` y `name_snapshot` completos, así que el documento sigue
mostrando lo que mostraba. **No se reescribe ninguna FK.**

## 5. El efecto que hay que mirar antes de apretar el botón

Los 88 duplicados son productos **sin marca**, y un producto sin marca no
tiene quién lo oculte: hoy están **visibles** en el Catálogo.

| | pares |
|---|---|
| el canónico es de marca activa → el producto sigue viéndose | **63** |
| el canónico es de marca **inactiva** (APEX) → el producto **desaparece** del Catálogo | **25** |

Los 25 son coherentes con haber desactivado APEX (§13): el canónico ya no se
ve, y no hay que compensarlo mostrando el duplicado. Pero es un número que
tiene que estar sobre la mesa, no una consecuencia que se descubre después.

Ficha de los canónicos de los 88: 42 con atributos, 40 con imagen, 28 con
hoja de catálogo.

## 6. `en_catalogo()` — una sola definición (§8)

Hoy la condición está escrita **dos veces**, dentro de `search_products` y de
`catalog_facets`, y ninguna de las dos mira el `status`:

```sql
NOT p_solo_catalogo OR p.brand_id IS NULL
  OR EXISTS (SELECT 1 FROM brands b WHERE b.id = p.brand_id AND b.is_active)
```

La propuesta la unifica y le agrega el estado:

```sql
p.deleted_at is null
  and p.status not in ('discontinued', 'merged')
  and (p.brand_id is null or exists (select 1 from brands b where b.id = p.brand_id and b.is_active))
```

El `null` de marca es la parte delicada: escrito como `b.is_active` a secas,
el LEFT JOIN da `null`, `null` no es `true`, y **5.482 productos sin marca**
desaparecerían del Catálogo sin que nadie lo pidiera. Hay un test para eso.

**Medido contra la base, hoy:** el Catálogo pasa de 17.996 a 17.969
productos. La diferencia son exactamente los **27 `discontinued`** (§9), que
hoy se ven y dejarían de verse. Con los 88 `merged` aplicados quedarían
17.881.

La usan las tres puertas: `search_products`, `catalog_facets` y
`productos_similares` — esta última además excluye las relaciones
`source_kind = 'duplicate'`, porque un duplicado no es una alternativa
comercial (§3).

## 7. Ventas (§10) — lo que NO cambia, y la propuesta

Ventas llama a `search_products` **sin** `p_solo_catalogo`, así que
`en_catalogo()` no la toca.

```
SALES_DISCONTINUED_BEHAVIOR = sin cambios: un discontinued se sigue
                              encontrando y cotizando, como hoy
SALES_MERGED_BEHAVIOR       = sin cambios TAMBIÉN, y esto hay que decirlo:
                              marcar merged NO impide crear líneas nuevas
                              sobre esos 88 productos
```

Lo segundo es un hueco, no un efecto del diseño. Buscar `PRO05299` en Ventas
después de aplicar seguiría devolviendo el producto retirado.

**Propuesta, para implementar aparte:** que `search_products` devuelva el
canónico cuando la búsqueda pega contra un `merged`, con una marca discreta
—«reemplaza a PRO05299»— en vez de esconder el SKU viejo. Esconderlo rompería
la búsqueda por el SKU que la gente tiene escrito en un remito de hace dos
años. **No implementado.**

## 8. Los archivos

| archivo | qué es |
|---|---|
| `docs/fase22-g-duplicados-candidatos.csv` | los 92, una fila cada uno, con las 28 columnas pedidas |
| `scripts/fase22-g-duplicados-candidatos.mjs` | el clasificador |
| `scripts/fase22-g-duplicados-tests.mjs` | 51 tests de las reglas de §5 y §8 |
| `scripts/fase22-g-generar-sql.mjs` | genera el SQL desde el análisis |
| `scripts/fase22-g-duplicados-PREPARADO.sql` | A–G. **No ejecutado** |
| `scripts/fase22-g-invariantes.mjs` | los invariantes de §16, ejecutables |

El SQL se genera, no se escribe a mano: la whitelist de 88 UUID sale del mismo
JSON que produjo el CSV. El generador además se niega a escribir el archivo si
hay un id repetido, un producto que es su propio canónico, o una **cadena**
—un duplicado que además es canónico de otro—, porque retirarlo dejaría al
tercero apuntando a un producto retirado.

## 9. Invariantes (§16) — línea de base, antes de aplicar

```
✓ discontinued no aparece en el catálogo            27 discontinued, 0 visibles
✓ active + marca activa SÍ aparece                  12.487 productos
✓ active + marca inactiva NO aparece                3.829 productos
✓ active sin marca SÍ aparece                       5.482 productos
✓ los documentos históricos conservan su snapshot   22 líneas, 0 incompletas
✓ search y facetas cuentan el MISMO universo        17.996 = 17.996
✓ la segunda corrida no duplicaría relaciones       0 pares repetidos
· merged no aparece en el catálogo                  PENDIENTE (no hay merged)
· merged no aparece en similares                    PENDIENTE
· la relación duplicate es direccional              PENDIENTE
· el canónico sigue activo                          PENDIENTE
```

Los cuatro `PENDIENTE` no son fallas: no hay todavía ningún producto `merged`
que mirar. Decir «PASA» ahí sería un verde vacío. Se vuelven a correr después
de aplicar y ahí tienen que dar `PASA`.

## 10. Lo que falta decidir

1. Aprobar los **88** `SAFE_TO_MERGE`, sabiendo que **25 desaparecen** del
   Catálogo (§5 de este documento).
2. Los **2 `REVIEW`** y los **2 `DO_NOT_MERGE`**: a mano, o se dejan como están.
3. Si se aplica §9 —los 27 `discontinued` fuera del Catálogo— en la misma
   migración o aparte.
4. La propuesta de Ventas de §7, que es funcionalidad nueva.

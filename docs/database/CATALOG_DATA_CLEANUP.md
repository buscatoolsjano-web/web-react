# Limpieza de datos del catálogo — informe para una fase futura

Generado el 2026-09-09 desde `productos-data.json` (21.772 productos).

**Nada de esto se corrige en la Fase 3.5.** El catálogo se migra tal como
está; este documento es el trabajo pendiente, ordenado por lo que
realmente molesta.

---

## Resumen

| # | Problema | Productos | Prioridad |
|---|---|---:|---|
| 1 | Categoría `otros` | **12.588** (57,8 %) | **Alta** |
| 2 | Sin ningún precio | **9.509** (43,7 %) | **Alta** |
| 3 | Sin marca | **5.456** (25,1 %) | Media |
| 4 | Sin imagen | 14.249 (65,4 %) | Media |
| 5 | `pu = 0` | 4.476 (20,6 %) | Media |
| 6 | Posibles duplicados por nombre | 61 grupos | Baja |
| 7 | `pu` anómalo | 9 | Baja |
| 8 | Stock negativo | 5 | Baja |
| 9 | Tipos de atributo mal declarados | 3 claves | Baja |

---

## 1. Categoría `otros` — 12.588 productos

Más de la mitad del catálogo está sin clasificar. Es el problema de fondo:
mientras siga así, el filtro por categoría sirve poco y los filtros
dinámicos por atributo no aplican a esos productos.

| Categoría | Productos |
|---|---:|
| **otros** | **12.588** |
| punta | 8.623 |
| balanceador | 376 |
| atornillador | 129 |
| accesorio | 43 |
| llave de impacto | 7 |
| remachadora | 4 |
| llave dinamométrica | 2 |

**Marcados con `needs_review = true`.**

Consulta:

```sql
SELECT p.sku, p.name, b.name AS marca
FROM products p
LEFT JOIN brands b ON b.id = p.brand_id
JOIN product_categories c ON c.id = p.category_id
WHERE c.slug = 'otros' AND p.company_id = '<buscatools>'
ORDER BY b.name NULLS LAST, p.name;
```

**Por dónde empezaría:** las 4 categorías con menos de 50 productos
(accesorio, llave de impacto, remachadora, llave dinamométrica) suman 56.
Es probable que muchos de los 12.588 pertenezcan ahí. Un repaso por marca
—SPEEDRILL tiene 4.928 productos— avanzaría rápido en bloque.

**No recategorizar automáticamente.** Sin una regla que el negocio valide,
mover miles de productos por heurística crea un problema peor.

---

## 2. Sin ningún precio — 9.509 productos

Ni `precio_venta` ni `pu > 0`. Hoy el cliente ve "—"; en el sistema nuevo
verá **"Consultar"**.

| Situación | Productos |
|---|---:|
| Sin ningún dato de precio | 5.033 |
| Con `pu = 0` | 4.476 |
| **Total sin precio utilizable** | **9.509** |

Los 4.476 con `pu = 0` son el caso interesante: alguien cargó un cero. Un
cero **no es un precio** y no se migra como tal.

```sql
SELECT p.sku, p.name
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM product_prices pp WHERE pp.product_id = p.id)
  AND p.company_id = '<buscatools>';
```

---

## 3. Sin marca — 5.456 productos

`brand_id IS NULL`. Se migran sin problema, pero no aparecen al filtrar por
marca.

```sql
SELECT sku, name FROM products
WHERE brand_id IS NULL AND company_id = '<buscatools>';
```

Vale revisar si el nombre contiene la marca en texto: muchos empiezan con
ella (`"APEX 16F-20R PUNTA"`), lo que permitiría recuperarla con revisión
humana.

---

## 4. Imágenes

| | |
|---|---:|
| Con al menos una imagen | 7.523 (34,6 %) |
| **Sin imagen** | **14.249 (65,4 %)** |
| URLs totales | 8.859 |
| **Archivos distintos** | **3.317** |
| URLs repetidas en varios productos | 1.596 |
| URLs inválidas | 0 |

Dominios: `www.buscatool.com` (5.315) y `apexbits.com.ar` (3.544).

Dos cosas que importan para la futura migración a Storage:

- **Son 3.317 archivos, no 8.859.** Un tercio del trabajo esperado.
- **Dos tercios del catálogo no tiene imagen.** Conseguirlas probablemente
  rinda más que migrar las que ya hay.

No se verificó si las URLs responden: eso requiere 3.317 peticiones a
dominios externos y va con la fase de Storage.

---

## 5. Posibles duplicados

**0 SKU duplicados.** Los 21.772 son únicos — mejor de lo esperado.

61 grupos de productos con **nombre idéntico y SKU distinto**. No son
necesariamente duplicados: pueden ser variantes legítimas que se
distinguen por medida o encastre y comparten nombre comercial.

```sql
SELECT lower(trim(name)) AS nombre, count(*), array_agg(sku)
FROM products WHERE company_id = '<buscatools>'
GROUP BY 1 HAVING count(*) > 1 ORDER BY 2 DESC;
```

---

## 6. Valores anómalos

### `pu` desproporcionado — 9 productos

Percentil 99 de `pu` = 21.922 USD. Nueve productos lo superan por más de
10×; el máximo es **8.190.355,76 USD**. Con el markup 3× darían precios de
venta de 24 millones de dólares.

**Excluidos de la migración de precios** y marcados `needs_review`.

### Stock negativo — 5 productos

| SKU | `sr` | `sv` |
|---|---:|---:|
| SP.VPTX15/50 | **−15** | 535 |
| SP.VPTX15/70 | −4 | −4 |
| SP.J2926B | −2 | −2 |
| SP.J3026B | −2 | −2 |
| SP.R100VP | −3 | −3 |

`on_hand` tiene `CHECK (>= 0)`. **El producto se migra; el saldo no.**
Forzarlo a cero sería inventar un dato.

`SP.VPTX15/50` es el más raro: stock real −15 pero virtual 535.

### `sv > sr` — 26 productos

Stock virtual mayor que el real. En el modelo nuevo
`virtual = on_hand − reserved`, así que virtual **nunca** puede superar al
real: es una inconsistencia del legacy que el modelo nuevo hace imposible
por construcción.

---

## 7. Tipos de atributo mal declarados

| Clave | `data_type` declarado | Tipo real | Filas |
|---|---|---|---:|
| `rpm` | `number` | **string** | 57 |
| `catalogo_pagina` | `text` | **number** | 48 |
| `sufijos` | `text` | **array** | 3.306 |

No bloquean: el trigger valida que la clave exista, no el tipo (limitación
documentada en la Etapa 1). Corregir `data_type` sin un validador que lo
use sería cosmético.

Si en el futuro se agrega validación de tipo, hay que arreglar esto
**antes** o el trigger rechazará filas válidas.

---

## 8. Campos del legacy sin destino

| Campo | Filas | Qué hacer |
|---|---:|---|
| `sim_sp`, `sim_tc`, `sim_cp`, `sim_ir` | 1.735 | Productos similares. Si el negocio los usa, hace falta una tabla `product_related`. Si no, se descartan |
| `costo` | 237 | Costo de compra → **Compras (Fase 5)** |
| `fob_eur` | 6 | Valor FOB → Compras |
| `_importOrigen` | 12.592 | Metadato. Único valor: `STEL Order API (products)` |
| `_apexPageCatalog`, `_apexFamilyTitle` | 3.807 | Metadatos del catálogo APEX. `_apexFamilyTitle` tiene 334 valores distintos y **podría servir para recategorizar** los productos APEX |
| `s` | 21.772 | Cadena de búsqueda precalculada. La reemplaza `search_vector` |

**`_apexFamilyTitle` merece atención.** 334 títulos de familia sobre 3.807
productos APEX, con nombres como `Bit Holders 1/4" Hex Drive`. Es
exactamente el tipo de dato que ayudaría a sacar productos de `otros` — con
revisión humana, no automáticamente.

---

## Orden sugerido

1. **`erp_wappfly_token`** — no es de catálogo, pero es lo más urgente que
   salió de todo este análisis. Ver
   [SHARED_ORIGIN_RISK.md](../security/SHARED_ORIGIN_RISK.md).
2. **Definir la política de precios.** 9.509 productos sin precio es lo que
   más limita el catálogo comercialmente.
3. **Recategorizar `otros`**, empezando por marca y usando
   `_apexFamilyTitle` para los 3.807 de APEX.
4. **Recuperar marcas** desde el texto del nombre.
5. Imágenes: conseguir las que faltan pesa más que migrar las que hay.
6. Los casos puntuales (9 + 5 + 26 productos) en cualquier momento.

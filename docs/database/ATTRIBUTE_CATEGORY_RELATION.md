# `applies_to_category_id` — evidencia y propuesta

Fecha: 2026-09-08 · Estado: **evidencia entregada, cambio NO ejecutado**

Tenías razón en frenar el UPDATE. El modelo actual **no soporta** que un
atributo aplique a varias categorías, y el problema es más grande que el
ejemplo que planteaste.

---

## 1. Qué dice el schema hoy

```
product_attribute_definitions
  applies_to_category_id uuid NULL
    REFERENCES product_categories(id)      -- FK simple, UNA sola categoría
  UNIQUE (company_id, key)
  CHECK (data_type IN ('text','number','boolean'))
```

Una FK escalar. Un atributo puede apuntar a **una** categoría o a ninguna.
No hay forma de expresar "esta clave sirve para tres categorías".

---

## 2. La jerarquía no puede resolverlo: es plana

Las 8 categorías de Buscatools:

| Categoría | slug | `parent_id` | Productos |
|---|---|---|---:|
| Otros | `otros` | **NULL** | 92 |
| Puntas y tubos | `punta` | **NULL** | 98 |
| Balanceadores | `balanceador` | **NULL** | 20 |
| Atornilladores | `atornillador` | **NULL** | 2 |
| Accesorios | `accesorio` | **NULL** | 1 |
| Llaves de impacto | `llave-de-impacto` | **NULL** | 1 |
| Remachadoras | `remachadora` | **NULL** | 1 |
| Llaves dinamométricas | `llave-dinamometrica` | **NULL** | 1 |

**Las 8 son raíz. No hay un solo `parent_id` poblado.** La herencia
padre/hijo existe en el modelo pero no hay árbol que recorrer, así que hoy
no resuelve nada.

### Nota sobre tu ejemplo

En el legacy, `CATEGORY_FILTERS` tiene dos entradas — `'puntas y tubos'` y
`'punta'`. En el modelo nuevo **esas dos colapsaron en una sola categoría**:
`name = 'Puntas y tubos'`, `slug = 'punta'`. Así que ese caso puntual ya no
existe.

Pero al ir a verificarlo apareció el problema de fondo, que es peor.

---

## 3. La evidencia real: 8 de los 11 atributos filtrables cruzan categorías

Contando sobre los 219 productos cargados, qué categorías usa cada clave:

| Atributo filtrable | Categorías | Cuáles |
|---|:---:|---|
| `encastre` | **5** | Puntas y tubos, Atornilladores, Llaves de impacto, Llaves dinamométricas, Remachadoras |
| `modelo` | **4** | Accesorios, Atornilladores, Balanceadores, Llaves dinamométricas |
| `medida` | **3** | Balanceadores, Llaves dinamométricas, Puntas y tubos |
| `rpm` | **3** | Atornilladores, Llaves de impacto, Remachadoras |
| `torq_max` | **3** | Accesorios, Atornilladores, Llaves de impacto |
| `torq_min` | **3** | Accesorios, Atornilladores, Llaves de impacto |
| `voltaje` | **3** | Atornilladores, Llaves de impacto, Remachadoras |
| `largo` | **2** | Llaves dinamométricas, Puntas y tubos |
| `alimentacion` | 1 | Atornilladores |
| `max_kg` | 1 | Balanceadores |
| `min_kg` | 1 | Balanceadores |

Sobre el total de claves en uso: **15 de 25 aparecen en más de una categoría.**

Esto no es ruido del dataset de prueba. Son los datos reales del legacy: un
encastre de 1/2" describe igual de bien una punta que una llave de impacto.
Es la realidad del negocio, no un error de carga.

---

## 4. Por qué ningún árbol puede arreglarlo

Aunque mañana armáramos la jerarquía, seguiría sin alcanzar. Mirá estos dos
conjuntos:

```
encastre → { Puntas y tubos, Atornilladores, Llaves de impacto,
             Llaves dinamométricas, Remachadoras }

medida   → { Puntas y tubos, Balanceadores, Llaves dinamométricas }
```

Se **superponen** (comparten Puntas y tubos y Llaves dinamométricas) pero
**ninguno contiene al otro**: `encastre` toca Atornilladores y `medida` no;
`medida` toca Balanceadores y `encastre` no.

En un árbol, cada atributo cuelga de un subárbol. Dos subárboles o son
disjuntos o uno contiene al otro — **nunca se superponen parcialmente**. Es
una propiedad de los árboles, no una limitación de este modelo en particular.

**Conclusión: la relación es N:N por naturaleza. Ninguna FK escalar ni
jerarquía la representa.**

---

## 5. Propuesta

Tal como pediste: una tabla N:N mínima, sin arrays dentro de JSONB.

```sql
CREATE TABLE product_attribute_categories (
  company_id              uuid NOT NULL REFERENCES companies(id),
  attribute_definition_id uuid NOT NULL
    REFERENCES product_attribute_definitions(id) ON DELETE CASCADE,
  category_id             uuid NOT NULL
    REFERENCES product_categories(id) ON DELETE CASCADE,
  created_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attribute_definition_id, category_id)
);

CREATE INDEX idx_pac_category  ON product_attribute_categories (category_id);
CREATE INDEX idx_pac_company   ON product_attribute_categories (company_id);

ALTER TABLE product_attribute_categories ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON product_attribute_categories FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_attribute_categories TO authenticated;
```

**La PK compuesta `(attribute_definition_id, category_id)` es la constraint
de unicidad**: impide duplicar el mismo par. No hace falta un `id` sintético
— nunca se referencia esta tabla desde otra.

`ON DELETE CASCADE` en ambos lados: si se borra un atributo o una categoría,
sus vínculos se van con ella. Nunca queda un vínculo huérfano.

### RLS

```sql
-- Leer: cualquier miembro de la empresa.
CREATE POLICY pac_select ON product_attribute_categories
  FOR SELECT TO authenticated
  USING (company_id = ANY (app.current_company_ids()));

-- Escribir: sólo admin, y las tres partes deben ser de la MISMA empresa.
CREATE POLICY pac_write ON product_attribute_categories
  FOR ALL TO authenticated
  USING      (app.is_admin(company_id))
  WITH CHECK (
    app.is_admin(company_id)
    AND EXISTS (SELECT 1 FROM product_attribute_definitions d
                 WHERE d.id = attribute_definition_id AND d.company_id = company_id)
    AND EXISTS (SELECT 1 FROM product_categories c
                 WHERE c.id = category_id            AND c.company_id = company_id)
  );
```

El `WITH CHECK` cierra el agujero que trae toda tabla puente en un sistema
multiempresa: **vincular un atributo de Buscatools con una categoría de
Torquetools**. Las dos subconsultas fuerzan que atributo, categoría y fila
pertenezcan a la misma empresa. Sin eso, un admin de dos empresas podría
cruzarlas por accidente.

Se resuelve así y no con FK compuestas porque las FK compuestas exigirían
agregar `UNIQUE (id, company_id)` a las dos tablas padre — tocar dos tablas
ya probadas para ganar lo mismo que gana una política.

### Qué pasa con `applies_to_category_id`

Se queda **como está, en NULL, sin usar**. No la borro en este paso: borrar
una columna es irreversible y no molesta a nadie. Propongo marcarla obsoleta
con un `COMMENT` y removerla en una limpieza posterior, cuando la N:N esté
en uso y probada.

### Datos iniciales

Los vínculos se derivan de los productos reales, no se inventan:

```sql
INSERT INTO product_attribute_categories (company_id, attribute_definition_id, category_id)
SELECT DISTINCT d.company_id, d.id, p.category_id
FROM products p
CROSS JOIN LATERAL jsonb_object_keys(p.attributes) AS k(key)
JOIN product_attribute_definitions d
  ON d.key = k.key AND d.company_id = p.company_id
WHERE d.is_filterable
ON CONFLICT DO NOTHING;
```

Esto produce los vínculos de la tabla de la sección 3 — exactamente las
combinaciones que existen en los datos. Cuando entren los 21.772 productos
habrá que volver a correrlo (es idempotente por el `ON CONFLICT`).

---

## 6. Impacto si NO se aprueba

El catálogo funciona igual, con una limitación: `DynamicAttributeFilters`
muestra **los 15 atributos filtrables** en vez de los 3–5 de la categoría
elegida. Más ruido en la UI, ningún riesgo de seguridad ni de datos.

Lo implemento detrás de un único servicio —
`getFilterableAttributes(companyId, categoryId)` — así que pasar de un
modelo al otro es cambiar esa función y nada más.

---

## 7. Qué necesito

| | |
|---|---|
| ¿Creo `product_attribute_categories` con la RLS de arriba? | pendiente de tu OK |
| ¿Cargo los vínculos derivados de los productos reales? | pendiente de tu OK |
| ¿Marco `applies_to_category_id` como obsoleta con COMMENT? | pendiente de tu OK |

**Nada de esto está ejecutado.**

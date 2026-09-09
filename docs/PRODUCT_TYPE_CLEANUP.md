# `product_type` — clasificación de valores

**Nada modificado.** Clasificación para que apruebes antes de tocar datos.

Fuente: `products.product_type` en la base, 21.772 productos de Buscatools.
Fecha: 2026-09-09. **41 valores distintos**, contando el vacío.

---

## Resumen

| clasificación | valores | productos | qué son |
|---|---:|---:|---|
| **VÁLIDO** | 35 | 9.076 | subtipos reales que filtran algo |
| **DEGENERADO** | 2 | 378 | un solo hijo con el nombre del padre |
| **BASURA** | 2 | 12.599 | `-` y vacío |
| **AMBIGUO** | 2 | 46 | `Gatillo` y el par `Atornillador Angular` |

---

## BASURA

| valor | categorías | productos | acción recomendada |
|---|---|---:|---|
| *(vacío / NULL)* | `otros` (12.588) · `punta` (3) | **12.591** | **No tocar el dato.** La faceta lo omite: ya lo hace `btrim(product_type) <> ''` |
| `-` | `accesorio` (8) | 8 | **Poner a NULL.** Es el mismo marcador de ausencia que en `encastre` y `rpm` |

El vacío no se corrige porque **no hay con qué**: los 12.588 de `otros` no
tienen subtipo en el legacy, ni atributos, ni serie. No es un dato perdido en
la migración; nunca existió. Ver
[`database/CATALOG_DATA_CLEANUP.md`](database/CATALOG_DATA_CLEANUP.md).

Los 3 de `punta` con subtipo vacío sí son casos sueltos que se pueden revisar
a mano, pero son 3 sobre 8.623.

---

## DEGENERADO

| valor | categoría | productos | por qué |
|---|---|---:|---|
| `Balanceador` | `balanceador` | 376 | único subtipo, y repite el nombre de la categoría |
| `Llave dinamométrica` | `llave-dinamometrica` | 2 | ídem |

Un solo hijo con el nombre del padre no divide nada: elegirlo devuelve
exactamente los mismos productos que ya estaban.

**Acción recomendada: ninguna sobre el dato.** La faceta los oculta sola, por
regla y sin nombrar categorías:

> se oculta la faceta de subcategoría si trae 0 valores, o si trae 1 solo y
> ese valor coincide (normalizado) con el nombre de la categoría.

Borrar el dato sería peor: `product_type` también se muestra en la ficha del
producto, donde «Balanceador» sí informa.

Lo mismo aplicaría a `llave-de-impacto → Gatillo` (7) y
`remachadora → Gatillo` (4): un solo subtipo, aunque el nombre no coincida
con el padre. La regla de «1 solo valor» los cubre igual.

---

## AMBIGUO

### `Gatillo` — 40 productos en 3 categorías

| categoría | productos |
|---|---:|
| `atornillador` | 29 |
| `llave-de-impacto` | 7 |
| `remachadora` | 4 |

Es el **único** valor que cruza categorías, y por él descartamos el árbol
jerárquico.

Pero el problema de fondo es otro: **`Gatillo` no es un tipo de producto,
es el accionamiento.** Dentro de `atornillador` convive con
`Atornillador Pistola` (38) y `Atornillador Recto Neumático` (36), que sí son
tipos. La lista mezcla dos criterios: forma del cuerpo y forma de disparo.

Un atornillador de pistola **también** tiene gatillo. Que 29 productos estén
marcados `Gatillo` y 38 `Atornillador Pistola` no significa que sean
disjuntos: significa que quien cargó los datos usó el campo para dos cosas.

**Acción recomendada: no tocar ahora.** Como faceta funciona: elegir
`Gatillo` devuelve los 40 y la faceta de categorías muestra las 3, que es la
verdad. Convertirlo en un atributo aparte (`accionamiento`) es un cambio de
modelo que necesita criterio comercial, no una limpieza.

### `Atornillador Angular` vs `Atornillador Angular Neumático`

| valor | productos |
|---|---:|
| `Atornillador Angular Neumático` | 20 |
| `Atornillador Angular` | 6 |

Solapamiento probable: el segundo parece el primero sin el calificador de
alimentación. Pero **no lo puedo afirmar**: los 6 podrían ser eléctricos.

Dato que ayuda: `alimentacion` tiene un único valor en todo el catálogo,
`NEUMATICA` (91 productos). Si los 6 lo tienen, son neumáticos y el
solapamiento es real. Si no lo tienen, no se puede deducir.

**Acción recomendada: decidís vos.** Si confirmás que son lo mismo:
`Atornillador Angular → Atornillador Angular Neumático` (6 productos).

---

## VÁLIDO

### `punta` — 21 subtipos, 8.620 productos

```
Embocadura (4279) · Extensión (802) · Allen (572) · Adaptador (568)
Torx (463) · Cardánico (284) · Phillips (250) · Plana (218)
Torq-Set (189) · Torx Plus (163) · Bi-hexagonal (153) · Holder Bit (151)
Cuadrado (124) · Pozidrive (121) · Hexagonal (105) · Nutsetter (90)
Tri-Wing (51) · Torx Plus (IP) (24) · Husillo (7)
Destornillador Manual (5) · Imán (1)
```

Es donde la faceta más rinde: 8.623 productos que hoy son un muro.

**Una observación que no es una acción.** Siete de esos subtipos no son
puntas en sentido estricto: `Adaptador` (568), `Extensión` (802),
`Holder Bit` (151), `Cardánico` (284), `Husillo` (7), `Imán` (1),
`Destornillador Manual` (5) — 1.818 productos, el 21 % de la categoría — son
portapuntas, extensiones o herramientas. Estarían mejor en `accesorio`.

**No propongo moverlos.** Es recategorización, no limpieza, y sin una regla
que valides mover 1.818 productos crea un problema peor. Queda anotado.

### `atornillador` — 3 subtipos válidos, 94 productos

`Atornillador Pistola` (38) · `Atornillador Recto Neumático` (36) ·
`Atornillador Angular Neumático` (20). Los otros dos están en AMBIGUO.

### `accesorio` — 11 subtipos válidos, 35 productos

```
Casquillo (8) · Cabezal angular (7) · Funda (5) · Batería (4)
Protector cabezal angular (3) · Cabezal recto (2) · Herramienta ajuste (1)
Soporte (1) · Cargador (1) · Adaptador programación (1)
Llave tuercas ranuradas (1) · Prolongador (1)
```

Coinciden con tu captura. **Diferencia de caja, no de dato**: la base guarda
`Cabezal angular` y la web anterior mostraba `Cabezal Angular`. La UI del
legacy capitalizaba para mostrar. Es presentación: se resuelve con CSS
(`text-transform: capitalize`) o formateando en la vista, sin tocar la base.

Nótese que `punta` usa Title Case (`Torq-Set`, `Holder Bit`) y `accesorio`
usa mayúscula sólo inicial. Inconsistencia de carga, cosmética.

---

## Propuesta de ejecución

**Bloque único — 8 productos, sin criterio comercial:**

```sql
update products set product_type = null
where company_id = <buscatools> and btrim(product_type) = '-';
```

Con respaldo previo en JSON fuera del repositorio, como en las limpiezas
anteriores.

**Sin tocar datos, en la faceta:**

- omitir subtipos vacíos (ya está en la RPC);
- ocultar la faceta si trae 0 valores o 1 solo que coincide con la categoría;
- capitalizar sólo para mostrar.

**Esperando tu decisión:**

1. ¿`Atornillador Angular` = `Atornillador Angular Neumático`? (6 productos)
2. ¿`Gatillo` pasa a ser un atributo `accionamiento` en vez de un subtipo? (40)
3. ¿Los 1.818 «no-puntas» se mueven a `accesorio`? (recategorización)
4. ¿Los 3 productos de `punta` sin subtipo se revisan a mano?

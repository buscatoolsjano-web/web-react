/**
 * La skill: cómo se usa el ERP (Fase 67 · E5). PURO.
 *
 * ── De dónde sale este texto ────────────────────────────────────────────────
 *
 * De `../asistente/agentes.ts`, que es donde vive el prompt afinado del
 * asistente de la web. Ahí son seis prompts —un común y cinco especialistas—
 * porque la web tiene cinco agentes y cada uno elige entre pocas herramientas.
 *
 * Acá hay UN servidor con trece herramientas, así que es un documento solo,
 * ordenado por tema. NO son los cinco prompts pegados uno atrás del otro: eso
 * repetiría cuatro veces las mismas reglas de estilo y dejaría al modelo
 * leyendo instrucciones que no le aplican, que es justo el problema que los
 * cinco agentes resuelven en la web.
 *
 * ── Por qué una skill y no el campo `instructions` ──────────────────────────
 *
 * Porque OpenAI lo dice: en `instructions` va lo transversal, con lo más
 * importante en los primeros 512 caracteres, y explícitamente NO hay que
 * repetir las descripciones de las herramientas ni intentar cambiar la
 * personalidad del modelo. Todo esto no entra ahí.
 *
 * Las skills se importan en el «Scan Tools» como un SNAPSHOT: cambiar este
 * archivo y desplegar no alcanza, hay que volver a escanear desde ChatGPT.
 * Está dicho en el paso a paso.
 *
 * ── Por qué no se decide la personalidad ────────────────────────────────────
 *
 * El prompt de la web dice «castellano rioplatense, con voseo» y «dos o tres
 * frases». Acá eso NO va, porque OpenAI pide no cambiar la personalidad del
 * modelo desde el servidor y porque ChatGPT ya habla como la persona le pidió.
 * Lo que sí va es todo lo que hace que la respuesta sea VERDADERA: no
 * inventar, insistir antes de decir que no hay, los números exactos, el
 * período y la moneda. Eso no es estilo.
 */

/** El nombre de la carpeta de la skill. Tiene que coincidir con `name`. */
export const SKILL_NOMBRE = 'erp-buscatools'

export const SKILL_DESCRIPCION =
  'Cómo consultar el ERP de BuscaTools: productos, clientes, cotizaciones, ' +
  'pedidos, costos de compra, stock, correo e informes. Incluye las reglas que ' +
  'evitan contestar de memoria o dar por inexistente algo que sí está.'

/** `skill://<servidor>/<skill>/SKILL.md` */
export const SKILL_URI = `skill://${SKILL_NOMBRE}/${SKILL_NOMBRE}/SKILL.md`

export const SKILL_MD = `---
name: ${SKILL_NOMBRE}
description: ${SKILL_DESCRIPCION}
---

# El ERP de BuscaTools

BuscaTools es una importadora argentina de herramientas industriales. Estas
herramientas leen su ERP, y quien pregunta trabaja ahí.

Todo lo que devuelven está filtrado por los permisos de la persona conectada:
la base aplica sus reglas de acceso igual que cuando entra por la web. Si algo
vuelve vacío puede ser que no exista o que no le corresponda, y no hay forma de
saber cuál de las dos: no afirmes ninguna.

## Antes de decir que no hay

**Una búsqueda vacía no es una respuesta: es un primer intento.** Casi siempre
significa que se buscó con demasiadas palabras juntas, no que el dato no exista.

Volvé a buscar al menos una vez con MENOS: el nombre suelto sin la razón
social, el modelo sin la marca, el término solo sin el tipo de documento.
\`Grupo Mirgor S.A. orden de compra\` no encuentra nada; \`mirgor\` encuentra
cincuenta.

Recién cuando una búsqueda ancha también vuelve vacía se puede decir «no hay».
Y entonces decilo derecho: «no hay», no «no tengo acceso».

Esto no es un detalle de estilo. Un «no hay correos de Mirgor» cuando entraron
tres órdenes de compra hoy es peor que no contestar: quien pregunta no tiene
cómo darse cuenta de que le erraste.

## Los datos se citan, no se recuerdan

- Nunca inventes. Si no lo trajo una herramienta, no lo sabés: decilo y ofrecé
  qué sí podés averiguar.
- Los números, los SKU y las referencias van **exactos** como los devolvió la
  herramienta. Nunca los redondees ni los completes de memoria.
- Los importes se escriben a la argentina: punto para los miles y coma para los
  decimales, con la moneda adelante. \`USD 10.811,48\`, no \`USD 10811.48\`. Es el
  mismo número, escrito como se lee allá.
- Nombrá los productos con el SKU y el nombre juntos: el SKU es lo que se usa
  para cotizar.
- Citá los documentos por su número (\`COT-…\`, \`PED-…\`), que es como los busca
  la persona después.

## Cuándo preguntar y cuándo asumir

Preguntar de más cansa. Si falta un dato con respuesta obvia —el año cuando
dicen un mes, el período cuando dicen «últimamente»— asumí lo razonable,
contestá, y decí en una línea qué asumiste.

Preguntá sólo cuando elegir mal tenga consecuencias: cuál de dos clientes
parecidos, o cuál de dos productos que no son intercambiables. Equivocarse de
cliente manda mercadería a otra empresa.

## Cuando una herramienta devuelve \`error\`

Es una instrucción para vos, no un texto para mostrar. Leela y hacé lo que
dice: si pide reintentar con otros parámetros, reintentá; si dice que la
herramienta está rota, no la llames de nuevo y avisá que eso no se puede
averiguar ahora.

## La empresa

Casi todos trabajan en una sola y no hay nada que hacer. \`quien_soy\` dice en
cuál estás. Si alguien pide datos de otra empresa a la que pertenece, mandá
\`empresa\` con el nombre en la herramienta que uses.

---

# Qué herramienta para qué

## Productos, precios de lista y stock

\`buscar_productos\`, \`ficha_producto\`, \`resumen_catalogo\`, \`stock_actual\`

Buscá **siempre** antes de afirmar que un producto existe o no existe: el
catálogo tiene decenas de miles y lo que no apareció puede estar con otro
nombre o con el modelo suelto.

- El precio que devuelven es el de **lista**. El precio de un cliente puntual
  es otra cosa: está en \`precios_del_cliente\`.
- El stock distingue en mano, reservado y **disponible**. Para vender importa
  el disponible.
- Para preguntas sobre el tamaño o la composición del catálogo usá
  \`resumen_catalogo\`, no una búsqueda.
- Si proponés un equivalente, decí en qué se parece y en qué no.

## Clientes y documentos de venta

\`buscar_cliente\`, \`historial_del_cliente\`, \`precios_del_cliente\`,
\`buscar_documentos\`, \`ver_documento\`

El circuito es: **cotización → pedido de venta → remito (entrega) → factura**.
Un pedido puede entregarse en partes.

- Si nombran un cliente, resolvelo primero con \`buscar_cliente\`. Si hay más de
  uno parecido, preguntá cuál.
- Para el precio de un producto a un cliente usá \`precios_del_cliente\`, que
  trae el precio real con su fecha. El de lista no es el que se le cobró.
- Para «los más grandes» o cualquier ranking por plata, usá
  \`buscar_documentos\` con \`orden=importe\` y la moneda. Ordenar a ojo la página
  que devolvió la herramienta es rankear una muestra, no el conjunto.

## Armar una cotización

\`preparar_cotizacion\`

Resuelve el cliente, busca cada producto, trae el precio que se le cobró a ese
cliente y calcula el total. El total es **sin IVA**.

- **Vos no la creás.** Mostrá el borrador —cliente, renglones, total— y decile
  que para crearla entre al ERP, al asistente de la web, donde le aparece el
  botón.
- Si alguna línea vuelve sin resolver, decí **cuál** y pedí el SKU o un nombre
  más preciso. Nunca elijas un producto parecido para completar: un renglón mal
  resuelto es mercadería equivocada enviada a un cliente.
- El precio que trae es el que se le cobró a ese cliente cuando existe, y el de
  lista cuando no. Si es de lista, aclaralo.

## Costos de compra

\`ultimo_costo\`, \`ver_documento\`

El circuito es: **pedido a proveedor → recepción → factura del proveedor**. Una
recepción puede ser parcial.

**Cuidado con una confusión frecuente:** el costo es lo que paga BuscaTools; el
precio es lo que cobra. Si preguntan «a cuánto está» sin aclarar, averiguá cuál
de los dos quieren antes de contestar. Confundirlos es mostrar el margen sin
querer.

Todavía **no se pueden listar** pedidos a proveedor por fecha o por estado. Se
puede abrir uno con \`ver_documento\` si dan el número. Si piden un listado, decí
eso en vez de contestar con lo que encuentres por otro lado.

## Correo

\`buscar_emails\`

- Decí siempre de quién, cuándo y el asunto. Un resumen sin el remitente no
  sirve para nada.
- Para «¿qué me falta responder?», mirá el estado y a quién está asignado.
- No inventes el contenido de un correo que no leíste: si sólo tenés el asunto,
  decí que tenés el asunto.

## Informes y rankings

\`ranking_comercial\`, \`buscar_documentos\`

- Decí **siempre** el período y la moneda. Un número sin período no significa
  nada, y acá se opera en más de una moneda: **nunca sumes monedas distintas.**
- La moneda por defecto es USD, que es en la que se opera. No preguntes cuál
  quieren: informá en USD y aclaralo.
- Cuando compares dos períodos, dá los dos números, no sólo la variación.
- Si el período que piden no tiene datos, decí eso. **No es lo mismo que cero.**
- Para un documento puntual o un cliente puntual, eso no es un informe: usá
  \`ver_documento\` o \`historial_del_cliente\`.
`

/**
 * Lo que va en `instructions` del `initialize`.
 *
 * Corto a propósito: OpenAI pide lo más importante en los primeros 512
 * caracteres y no repetir las descripciones de las herramientas. Así que acá
 * va sólo la regla que más daño evita —la de no dar por inexistente algo que
 * sí está— y el resto queda en la skill.
 */
export const INSTRUCCIONES =
  'Datos del ERP de BuscaTools (importadora argentina de herramientas). ' +
  'Una búsqueda vacía casi nunca significa que el dato no exista: significa que ' +
  'buscaste con demasiadas palabras juntas. Volvé a buscar con menos —el nombre ' +
  'suelto, el modelo sin la marca— antes de decir que no hay. ' +
  'Todo se lee con los permisos de la persona conectada, así que un resultado ' +
  'vacío puede ser que no exista o que no le corresponda: no afirmes cuál. ' +
  'Los importes van a la argentina (USD 10.811,48) y los SKU exactos. ' +
  'Si una herramienta devuelve la clave «error», es una instrucción para vos: ' +
  'leela y actuá, no se la muestres a la persona.'

/**
 * El manifiesto de `skills/list`, con los digest ya calculados.
 *
 * Recibe los digest en vez de calcularlos porque hashear es asincrónico y
 * necesita WebCrypto: eso vive en `index.ts`. Acá queda la FORMA, que es lo
 * que se puede probar y lo que OpenAI valida al importar —si el front matter
 * del archivo no coincide exactamente con la entrada del catálogo, el import
 * se rechaza—.
 */
export function entradaDeSkill(digestDelMd: string): Record<string, unknown> {
  return {
    uri: SKILL_URI,
    frontmatter: { name: SKILL_NOMBRE, description: SKILL_DESCRIPCION },
    resources: [{ uri: SKILL_URI, digest: digestDelMd }],
  }
}

/** Los recursos que `resources/read` tiene que saber servir. */
export const RECURSOS: Readonly<Record<string, string>> = { [SKILL_URI]: SKILL_MD }

# Auditoría tras abrir el catálogo al público

**Fecha:** 2026-10-21 · **Motivo:** la Fase 87 publicó el catálogo sin sesión.
**Estado:** lo que se podía cerrar desde la base está cerrado. Quedan dos
interruptores del panel de Supabase que tiene que tocar una persona.

---

## 1. Lo grave que había

### 1.1 Un anónimo podía anular remitos · **cerrado**

`anular_entrega` es `SECURITY DEFINER` —corre con los permisos del dueño, así
que la RLS no la frena— y su control de permiso decía:

```sql
if auth.uid() is not null
   and v_company <> all (app.current_writer_company_ids()) then
  raise exception 'Sin permiso sobre esa empresa';
end if;
```

El `auth.uid() is not null` estaba para dejar pasar a la clave de servicio,
que no tiene usuario. **Pero el rol anónimo tampoco lo tiene**, así que para
alguien que venía de Internet el control entero se salteaba. El control
fallaba ABIERTO.

Con un uuid de remito real, cualquiera podía anular la entrega, generar los
contramovimientos de stock y cambiar el estado de cumplimiento del pedido.

Confirmado sin sesión antes de arreglarlo: con un uuid inexistente la función
contestaba «La entrega no existe» en vez de «sin permiso», o sea que había
pasado el control y llegado a la búsqueda.

`registrar_borrado` tenía el mismo patrón, y además lee la fila entera con
`to_jsonb` y devuelve una de sus columnas: servía de mirilla.

**Arreglo.** `app.es_la_clave_de_servicio()` exime al servidor por lo que ES
—su rol— y no por lo que le falta. Cualquier otro, con usuario o sin él, pasa
por el control.

### 1.2 Cuarenta y cinco funciones privilegiadas abiertas · **cerrado**

Postgres concede `EXECUTE` a `PUBLIC` sobre toda función nueva del esquema
`public`, y Supabase mete a `anon` adentro de `PUBLIC`. Resultado: 45
funciones `SECURITY DEFINER` eran ejecutables sin sesión, entre ellas
`borrar_contacto`, `config_eliminar_miembro` y `listar_bandeja_email`.

**La mayoría se defendía sola** —probado sin sesión, contestan «no perteneces
a esta empresa»— pero depender de que cada función se acuerde de comprobar es
depender de cuarenta y cinco aciertos seguidos, y uno ya había fallado.

**Arreglo.** `anon` pierde `EXECUTE` sobre los esquemas `public` y `app`, y se
le devuelve sólo las cuatro del catálogo. Y se cambiaron los privilegios por
defecto, para que la próxima función que alguien cree **no** nazca abierta.

Antes: 45 · Ahora: **4**, que son las que el sitio público necesita.

### 1.3 Una tabla de respaldo sin protección · **cerrado**

`respaldo_fase43_medida_balanceador` quedó de una migración vieja sin RLS y
con los permisos por defecto. Era lo único que un desconocido podía leer de
verdad: 376 filas, comprobado sin sesión y también con un usuario registrado
sin empresa. Ahora tiene RLS sin política y los permisos quitados.

### 1.4 Setenta tablas con permiso concedido a `anon` · **cerrado**

La RLS las tapaba —un anónimo recibía una lista vacía, no datos— pero el
permiso sobraba. No es lo mismo: una dice «no existís acá» y la otra dice
«existe, se llama así, y está vacía para vos». Ahora todas contestan 401.

### 1.5 `postgres_fdw` instalado en el esquema público · **cerrado**

Quedó de la mudanza de Ohio a São Paulo. Dejaba cinco funciones ejecutables
por anónimos, entre ellas `postgres_fdw_disconnect_all()`. No quedaba ningún
servidor foráneo ni tabla foránea, así que se sacó la extensión.

---

## 2. Lo que ya estaba bien

No todo estaba mal, y conviene saber qué aguantó:

- **La RLS aguanta.** Un usuario registrado SIN empresa ve **cero filas** en
  `products`, `customers`, `sales_quotes`, `sales_orders`, `deliveries`,
  `companies`, `profiles`, `company_memberships`, `product_prices` y
  `stock_balances`. Verificado simulando el rol, no leyéndolo.
- **Las funciones de lectura se defienden**: `listar_bandeja_email`,
  `usuarios_para_chat`, `listar_chats`, `pendiente_por_persona` y
  `config_categorias_listar` rechazan al anónimo con su propio mensaje.
- **El almacenamiento está cerrado**: los cuatro buckets son privados y listar
  sin sesión devuelve vacío.
- **Las Edge Functions piden token**: las nueve contestan 401 o 403 sin él.
- **La vista `product_availability`**, aunque es `SECURITY DEFINER`, filtra por
  `app.current_company_ids()`: un intruso ve cero filas.
- **El catálogo público no filtra nada de más**: ni precio, ni costo, ni
  stock, ni un dato de ningún cliente. No están escondidos — no se nombran en
  la respuesta, que es la única forma de que no se escapen cuando alguien
  agregue una columna.

---

## 3. Lo que falta, y lo tiene que hacer una persona

Son dos interruptores del panel de Supabase. No se pueden cambiar por SQL.

### 3.1 El registro público está ABIERTO · **pendiente**

`/auth/v1/settings` devuelve `disable_signup: false`. Cualquiera puede crear
una cuenta con su correo y quedarse con un token válido de `authenticated`.

Hoy eso **no le da acceso a ningún dato** —ver 2— pero le da una llave para
seguir probando las 146 funciones que ese rol puede ejecutar. Y este es un ERP
interno: nadie se registra solo, los usuarios los crea un administrador.

> **Qué hacer:** Authentication → Sign In / Providers → Email → apagar «Allow
> new users to sign up».

### 3.2 Contraseñas filtradas · **pendiente**

Supabase puede rechazar contraseñas que aparecen en filtraciones conocidas,
contrastándolas con HaveIBeenPwned. Está apagado.

> **Qué hacer:** Authentication → Policies → encender «Leaked password
> protection».

---

## 4. Lo que queda abierto a propósito

- **Las cuatro funciones del catálogo público.** Es la puerta, y es angosta a
  propósito: devuelven columnas elegidas a mano, tienen tope de página y no
  tocan ninguna tabla directamente.
- **`cotizar-publico`**, que escribe sin sesión. Lo que lo sostiene no es un
  permiso sino lo que hace antes de escribir: valida, recorta, mira una trampa
  para robots y cuenta cuántos pedidos vinieron de la misma conexión. La tabla
  no tiene política de inserción para nadie.
- **La clave anónima en el bundle.** Es pública por diseño: identifica al
  proyecto, no autoriza nada. Lo que autoriza es la RLS.

---

## 5. Lo que sigue sin resolverse de antes

`SHARED_ORIGIN_RISK.md` sigue abierto, y **la landing lo agrava**: ahora hay
páginas públicas en el mismo origen que guarda el token de sesión del ERP. Un
XSS en el sitio público sería un robo de sesión.

Hoy el riesgo está acotado porque React escapa todo por defecto y el proyecto
no usa `dangerouslySetInnerHTML` en ninguna parte —verificado—, y el único
lugar donde se inyecta texto de la base en el HTML son los datos estructurados
del buscador, que usan `textContent` justamente por esto.

Lo que falta ahí es una Content-Security-Policy, y se vuelve más urgente
cuando se haga el prerenderizado: ahí el HTML lo vamos a escribir nosotros con
texto que viene de la base, y escapar mal una comilla deja de ser un detalle.

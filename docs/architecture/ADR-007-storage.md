# ADR-007 — Archivos y Supabase Storage

**Estado:** Aceptada · **Fecha:** 2026-09-08 · **Aplica desde:** Fase 3

## Contexto

En el legacy los archivos se resuelven de tres maneras distintas:

- adjuntos de email codificados en **base64 dentro de la fila** de
  Postgres;
- imágenes de producto como **URLs externas** a `buscatool.com`
  (WordPress) — 8.859 URLs para 7.523 productos;
- adjuntos varios guardados en `localStorage` bajo `erp_attachments`.

Guardar base64 en la base infla las filas, arruina el rendimiento de las
queries que ni siquiera piden el archivo, y hace inviable el versionado.

## Decisión

### 1. Los archivos van a Supabase Storage

Imágenes, PDFs, videos, audios, adjuntos de WhatsApp y documentación de
mantenimiento.

### 2. Postgres guarda sólo la referencia

```sql
bucket      text not null
path        text not null
mime_type   text
size_bytes  bigint
uploaded_by uuid references profiles(id)
company_id  uuid not null
-- + la FK a la entidad dueña (producto, ficha, mensaje…)
```

### 3. Prohibido base64 en columnas

Sin excepciones.

### 4. Buckets con RLS

El aislamiento por empresa y por rol aplica también a los archivos: un
distribuidor no puede leer el PDF de otro por adivinar la URL.

### 5. Imágenes externas: migración diferida

Las 8.859 URLs de `buscatool.com` **no se migran en Fase 3**. Se guarda la
URL tal cual y se agrega una columna para la ruta en Storage. Migrarlas es
un trabajo aparte, con su propio criterio de calidad, y no debe bloquear el
módulo de Catálogo.

## Consecuencias

- Las filas quedan chicas y las queries rápidas.
- Se puede servir con CDN y transformaciones de imagen.
- Costo: subir un archivo pasa a ser dos pasos (Storage + fila). Se
  encapsula en el service, no en los componentes.

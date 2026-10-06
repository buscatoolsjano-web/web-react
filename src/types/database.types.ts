/**
 * Tipos generados desde el schema de Supabase (proyecto jiudqbusyknubonpedde,
 * São Paulo / sa-east-1). Es la base que usa la app: el secreto de GitHub
 * `VITE_SUPABASE_URL` apunta ahí —verificado en el bundle que sirve
 * app.buscatools.com— y `.env.local` también. El proyecto uaxcfufvapzulqvynanp
 * (Ohio) quedó atrás y NO sirve como fuente: le faltan 3 tablas y 26
 * funciones que São Paulo sí tiene (Fases 30, 39 y 40).
 *
 * NO editar a mano. Se regenera con:
 *   npx supabase gen types typescript --project-id jiudqbusyknubonpedde
 *
 * PERO ESA ORDEN SOLA NO ALCANZA, y conviene saber por qué antes de correrla.
 * Medido sobre este esquema: la salida cruda de la CLI
 *
 *   · pierde `| null` en 277 campos de `Functions` (111 en Args, 166 en
 *     Returns) y en NINGUNO de `Tables`. No es un bug del generador: Postgres
 *     no guarda la nulabilidad de las columnas de un `returns table(...)` ni
 *     de los parámetros `out`, así que el generador asume no-nulo. Las tablas
 *     sí la tienen en el catálogo y salen bien.
 *   · pierde `maintenance_assets.estado_servicio`, que es una columna
 *     calculada que PostgREST expone y que el código filtra con `.eq()`.
 *
 * Las dos cosas se reinyectan encima de la salida generada. Por eso el
 * objetivo que declaraba la versión anterior de este header —«cuando se pueda
 * regenerar con la CLI, el resultado tiene que ser idéntico»— es inalcanzable:
 * la CLI no puede producir este archivo, y aceptarla tal cual haría que 166
 * campos de retorno dejaran de pedir chequeo de null.
 *
 * El orden de los miembros es el del generador (alfabético dentro de cada
 * sección), no el temático que tenía el archivo escrito a mano. Los
 * comentarios se conservaron anclados al miembro que precedían, así que alguno
 * que describía a un grupo quedó sobre el primero de ese grupo.
 */
/* eslint-disable @typescript-eslint/no-redundant-type-constituents --
 * Este esquema no tiene enums ni tipos compuestos, asi que dentro de los
 * helpers `Enums<>` y `CompositeTypes<>` que emite el generador
 * `keyof DefaultSchema["Enums"]` resuelve a `never` y la union queda con un
 * constituyente redundante. Es salida del generador, no codigo nuestro, y
 * vuelve a aparecer en cada regeneracion: se silencia la regla en vez de
 * editar el footer a mano cada vez. Nada del codigo usa esos dos helpers.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      attachments: {
        Row: {
          bytes: number | null
          company_id: string
          created_at: string
          entity_id: string
          entity_type: string
          file_name: string | null
          id: string
          kind: string | null
          mime_type: string | null
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          bytes?: number | null
          company_id: string
          created_at?: string
          entity_id: string
          entity_type: string
          file_name?: string | null
          id?: string
          kind?: string | null
          mime_type?: string | null
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          bytes?: number | null
          company_id?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          file_name?: string | null
          id?: string
          kind?: string | null
          mime_type?: string | null
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          logo_path: string | null
          name: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          logo_path?: string | null
          name: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          logo_path?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "brands_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_audit: {
        Row: {
          action: string
          actor_id: string | null
          changed_fields: string[]
          company_id: string
          created_at: string
          entity_id: string
          entity_name: string
          entity_type: string
          id: number
        }
        Insert: {
          action: string
          actor_id?: string | null
          changed_fields?: string[]
          company_id: string
          created_at?: string
          entity_id: string
          entity_name: string
          entity_type: string
          id?: never
        }
        Update: {
          action?: string
          actor_id?: string | null
          changed_fields?: string[]
          company_id?: string
          created_at?: string
          entity_id?: string
          entity_name?: string
          entity_type?: string
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "catalog_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversaciones: {
        Row: {
          company_id: string
          creada_por: string | null
          created_at: string
          id: string
          ultimo_mensaje: string | null
          ultimo_mensaje_en: string | null
        }
        Insert: {
          company_id: string
          creada_por?: string | null
          created_at?: string
          id?: string
          ultimo_mensaje?: string | null
          ultimo_mensaje_en?: string | null
        }
        Update: {
          company_id?: string
          creada_por?: string | null
          created_at?: string
          id?: string
          ultimo_mensaje?: string | null
          ultimo_mensaje_en?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversaciones_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_conversaciones_creada_por_fkey"
            columns: ["creada_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_mensajes: {
        Row: {
          autor_id: string
          company_id: string
          conversacion_id: string
          created_at: string
          id: string
          texto: string
        }
        Insert: {
          autor_id: string
          company_id: string
          conversacion_id: string
          created_at?: string
          id?: string
          texto: string
        }
        Update: {
          autor_id?: string
          company_id?: string
          conversacion_id?: string
          created_at?: string
          id?: string
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_mensajes_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_mensajes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_mensajes_conversacion_id_fkey"
            columns: ["conversacion_id"]
            isOneToOne: false
            referencedRelation: "chat_conversaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_participantes: {
        Row: {
          company_id: string
          conversacion_id: string
          created_at: string
          leido_hasta: string | null
          user_id: string
        }
        Insert: {
          company_id: string
          conversacion_id: string
          created_at?: string
          leido_hasta?: string | null
          user_id: string
        }
        Update: {
          company_id?: string
          conversacion_id?: string
          created_at?: string
          leido_hasta?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_participantes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_participantes_conversacion_id_fkey"
            columns: ["conversacion_id"]
            isOneToOne: false
            referencedRelation: "chat_conversaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_participantes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          brand_color: string | null
          created_at: string
          default_currency: string
          email: string | null
          id: string
          is_active: boolean
          legal_name: string | null
          logo_path: string | null
          name: string
          phone: string | null
          slug: string
          tax_id: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          brand_color?: string | null
          created_at?: string
          default_currency?: string
          email?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string | null
          logo_path?: string | null
          name: string
          phone?: string | null
          slug: string
          tax_id?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          brand_color?: string | null
          created_at?: string
          default_currency?: string
          email?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string | null
          logo_path?: string | null
          name?: string
          phone?: string | null
          slug?: string
          tax_id?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_default_currency_fkey"
            columns: ["default_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      company_audit: {
        Row: {
          action: string
          actor_id: string | null
          changed_fields: string[]
          company_id: string
          created_at: string
          id: number
        }
        Insert: {
          action: string
          actor_id?: string | null
          changed_fields: string[]
          company_id: string
          created_at?: string
          id?: never
        }
        Update: {
          action?: string
          actor_id?: string | null
          changed_fields?: string[]
          company_id?: string
          created_at?: string
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "company_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_memberships: {
        Row: {
          allowed_sections: string[] | null
          company_id: string
          created_at: string
          customer_id: string | null
          id: string
          role: string
          status: string
          supplier_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          allowed_sections?: string[] | null
          company_id: string
          created_at?: string
          customer_id?: string | null
          id?: string
          role: string
          status?: string
          supplier_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          allowed_sections?: string[] | null
          company_id?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          role?: string
          status?: string
          supplier_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_memberships_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_memberships_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          decimals: number
          name: string
          symbol: string
        }
        Insert: {
          code: string
          decimals?: number
          name: string
          symbol: string
        }
        Update: {
          code?: string
          decimals?: number
          name?: string
          symbol?: string
        }
        Relationships: []
      }
      customer_addresses: {
        Row: {
          active: boolean
          city: string | null
          company_id: string
          country_code: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          is_default: boolean
          kind: string
          notes: string | null
          postal_code: string | null
          state: string | null
          street: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          city?: string | null
          company_id: string
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          is_default?: boolean
          kind: string
          notes?: string | null
          postal_code?: string | null
          state?: string | null
          street?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          city?: string | null
          company_id?: string
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          is_default?: boolean
          kind?: string
          notes?: string | null
          postal_code?: string | null
          state?: string | null
          street?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_contacts: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          created_by: string | null
          customer_id: string
          email: string | null
          fax: string | null
          full_name: string
          id: string
          is_default: boolean
          notes: string | null
          phone: string | null
          role: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          email?: string | null
          fax?: string | null
          full_name: string
          id?: string
          is_default?: boolean
          notes?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          email?: string | null
          fax?: string | null
          full_name?: string
          id?: string
          is_default?: boolean
          notes?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_contacts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_contacts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_legacy_tax_ids: {
        Row: {
          created_at: string
          customer_id: string
          legacy_ref: string
          legacy_tax_id_raw: string
          source: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          legacy_ref: string
          legacy_tax_id_raw: string
          source?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          legacy_ref?: string
          legacy_tax_id_raw?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_legacy_tax_ids_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_oc_aliases: {
        Row: {
          clave: string
          company_id: string
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          last_used_at: string
          texto_original: string | null
          times_used: number
          tipo: string
          updated_at: string
        }
        Insert: {
          clave: string
          company_id: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          last_used_at?: string
          texto_original?: string | null
          times_used?: number
          tipo: string
          updated_at?: string
        }
        Update: {
          clave?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          last_used_at?: string
          texto_original?: string | null
          times_used?: number
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_oc_aliases_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_oc_aliases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_po_candidates: {
        Row: {
          candidate: string
          company_id: string
          confidence: string
          created_at: string
          customer_id: string | null
          doc_count: number
          id: string
          po_id: string | null
          raw_text: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_field: string
          source_ref: string
          source_type: string
          status: string
        }
        Insert: {
          candidate: string
          company_id: string
          confidence: string
          created_at?: string
          customer_id?: string | null
          doc_count?: number
          id?: string
          po_id?: string | null
          raw_text: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_field: string
          source_ref: string
          source_type: string
          status?: string
        }
        Update: {
          candidate?: string
          company_id?: string
          confidence?: string
          created_at?: string
          customer_id?: string | null
          doc_count?: number
          id?: string
          po_id?: string | null
          raw_text?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_field?: string
          source_ref?: string
          source_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_po_candidates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_po_candidates_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_po_candidates_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "customer_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_po_candidates_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_product_aliases: {
        Row: {
          company_id: string
          confidence: number | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          customer_code: string | null
          customer_description: string | null
          customer_id: string
          id: string
          last_used_at: string | null
          normalized_key: string
          product_id: string
          source: string | null
          status: string
          times_used: number
          updated_at: string
        }
        Insert: {
          company_id: string
          confidence?: number | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_code?: string | null
          customer_description?: string | null
          customer_id: string
          id?: string
          last_used_at?: string | null
          normalized_key: string
          product_id: string
          source?: string | null
          status?: string
          times_used?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          confidence?: number | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_code?: string | null
          customer_description?: string | null
          customer_id?: string
          id?: string
          last_used_at?: string | null
          normalized_key?: string
          product_id?: string
          source?: string | null
          status?: string
          times_used?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_product_aliases_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_product_aliases_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_product_aliases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_product_aliases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_product_aliases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_purchase_order_lines: {
        Row: {
          company_id: string
          created_at: string
          customer_description: string | null
          customer_product_code: string | null
          discount_pct: number | null
          id: string
          line_no: number
          match_confidence: number | null
          match_method: string | null
          match_status: string
          matched_at: string | null
          matched_by: string | null
          po_id: string
          product_id: string | null
          quantity: number | null
          quote_line_id: string | null
          unit_price: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          customer_description?: string | null
          customer_product_code?: string | null
          discount_pct?: number | null
          id?: string
          line_no: number
          match_confidence?: number | null
          match_method?: string | null
          match_status?: string
          matched_at?: string | null
          matched_by?: string | null
          po_id: string
          product_id?: string | null
          quantity?: number | null
          quote_line_id?: string | null
          unit_price?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          customer_description?: string | null
          customer_product_code?: string | null
          discount_pct?: number | null
          id?: string
          line_no?: number
          match_confidence?: number | null
          match_method?: string | null
          match_status?: string
          matched_at?: string | null
          matched_by?: string | null
          po_id?: string
          product_id?: string | null
          quantity?: number | null
          quote_line_id?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_purchase_order_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_order_lines_matched_by_fkey"
            columns: ["matched_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_order_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "customer_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_order_lines_quote_line_id_fkey"
            columns: ["quote_line_id"]
            isOneToOne: false
            referencedRelation: "sales_quote_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_purchase_orders: {
        Row: {
          company_id: string
          contact_id: string | null
          cost_center: string | null
          created_at: string
          created_by: string | null
          currency_code: string | null
          customer_id: string
          exchange_rate: number | null
          id: string
          match_status: string
          needs_review: boolean
          notes: string | null
          payment_terms: string | null
          po_date: string | null
          po_number: string
          quote_id: string | null
          raw_text: string | null
          received_at: string | null
          received_by: string | null
          review_reason: string | null
          shipping_address_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          contact_id?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id: string
          exchange_rate?: number | null
          id?: string
          match_status?: string
          needs_review?: boolean
          notes?: string | null
          payment_terms?: string | null
          po_date?: string | null
          po_number: string
          quote_id?: string | null
          raw_text?: string | null
          received_at?: string | null
          received_by?: string | null
          review_reason?: string | null
          shipping_address_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          contact_id?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id?: string
          exchange_rate?: number | null
          id?: string
          match_status?: string
          needs_review?: boolean
          notes?: string | null
          payment_terms?: string | null
          po_date?: string | null
          po_number?: string
          quote_id?: string | null
          raw_text?: string | null
          received_at?: string | null
          received_by?: string | null
          review_reason?: string | null
          shipping_address_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_purchase_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_orders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "customer_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_orders_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "customer_purchase_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_orders_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "sales_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_orders_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_orders_shipping_address_id_fkey"
            columns: ["shipping_address_id"]
            isOneToOne: false
            referencedRelation: "customer_addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_orders_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          credit_limit: number | null
          customer_type: string
          default_currency: string | null
          default_price_list_id: string | null
          deleted_at: string | null
          discount_pct: number
          email_domains: string[]
          emails: string[] | null
          id: string
          imported_at: string | null
          industry: string | null
          legacy_name: string | null
          legacy_ref: string | null
          legacy_source: string | null
          legal_name: string
          needs_review: boolean
          notes: string | null
          payment_terms: string | null
          phone: string | null
          review_reason: string | null
          salesperson_id: string | null
          search_text: string | null
          status: string
          tax_id: string | null
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          credit_limit?: number | null
          customer_type?: string
          default_currency?: string | null
          default_price_list_id?: string | null
          deleted_at?: string | null
          discount_pct?: number
          email_domains?: string[]
          emails?: string[] | null
          id?: string
          imported_at?: string | null
          industry?: string | null
          legacy_name?: string | null
          legacy_ref?: string | null
          legacy_source?: string | null
          legal_name: string
          needs_review?: boolean
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          review_reason?: string | null
          salesperson_id?: string | null
          search_text?: string | null
          status?: string
          tax_id?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          credit_limit?: number | null
          customer_type?: string
          default_currency?: string | null
          default_price_list_id?: string | null
          deleted_at?: string | null
          discount_pct?: number
          email_domains?: string[]
          emails?: string[] | null
          id?: string
          imported_at?: string | null
          industry?: string | null
          legacy_name?: string | null
          legacy_ref?: string | null
          legacy_source?: string | null
          legal_name?: string
          needs_review?: boolean
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          review_reason?: string | null
          salesperson_id?: string | null
          search_text?: string | null
          status?: string
          tax_id?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_default_currency_fkey"
            columns: ["default_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "customers_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_customers_price_list"
            columns: ["default_price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          carrier: string | null
          company_id: string
          contact_id: string | null
          created_at: string
          created_by: string | null
          currency_code: string | null
          customer_id: string
          delivery_address_snapshot: Json | null
          delivery_date: string
          exchange_rate: number | null
          external_id: string | null
          external_source: string | null
          id: string
          imported_at: string | null
          legacy_source: string | null
          needs_review: boolean
          notes: string | null
          number: string
          number_outlier: boolean
          order_id: string | null
          original_number: string | null
          review_reason: string | null
          series_code: string | null
          shipping_address_id: string | null
          source_quote_id: string | null
          status: string
          subtotal: number | null
          suspected_normalized_number: string | null
          tax_amount: number | null
          title: string | null
          total: number | null
          tracking: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          carrier?: string | null
          company_id: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id: string
          delivery_address_snapshot?: Json | null
          delivery_date: string
          exchange_rate?: number | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          imported_at?: string | null
          legacy_source?: string | null
          needs_review?: boolean
          notes?: string | null
          number: string
          number_outlier?: boolean
          order_id?: string | null
          original_number?: string | null
          review_reason?: string | null
          series_code?: string | null
          shipping_address_id?: string | null
          source_quote_id?: string | null
          status?: string
          subtotal?: number | null
          suspected_normalized_number?: string | null
          tax_amount?: number | null
          title?: string | null
          total?: number | null
          tracking?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          carrier?: string | null
          company_id?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id?: string
          delivery_address_snapshot?: Json | null
          delivery_date?: string
          exchange_rate?: number | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          imported_at?: string | null
          legacy_source?: string | null
          needs_review?: boolean
          notes?: string | null
          number?: string
          number_outlier?: boolean
          order_id?: string | null
          original_number?: string | null
          review_reason?: string | null
          series_code?: string | null
          shipping_address_id?: string | null
          source_quote_id?: string | null
          status?: string
          subtotal?: number | null
          suspected_normalized_number?: string | null
          tax_amount?: number | null
          title?: string | null
          total?: number | null
          tracking?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "customer_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "deliveries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_shipping_address_id_fkey"
            columns: ["shipping_address_id"]
            isOneToOne: false
            referencedRelation: "customer_addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_source_quote_id_fkey"
            columns: ["source_quote_id"]
            isOneToOne: false
            referencedRelation: "sales_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_lines: {
        Row: {
          company_id: string
          created_at: string
          delivery_id: string
          description_snapshot: string | null
          discount_pct: number | null
          id: string
          line_no: number | null
          name_snapshot: string | null
          notes: string | null
          order_line_id: string | null
          product_id: string | null
          quantity: number
          sku_snapshot: string | null
          tax_rate_snapshot: number | null
          tax_treatment: string | null
          unit_price: number | null
          warehouse_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          delivery_id: string
          description_snapshot?: string | null
          discount_pct?: number | null
          id?: string
          line_no?: number | null
          name_snapshot?: string | null
          notes?: string | null
          order_line_id?: string | null
          product_id?: string | null
          quantity: number
          sku_snapshot?: string | null
          tax_rate_snapshot?: number | null
          tax_treatment?: string | null
          unit_price?: number | null
          warehouse_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          delivery_id?: string
          description_snapshot?: string | null
          discount_pct?: number | null
          id?: string
          line_no?: number | null
          name_snapshot?: string | null
          notes?: string | null
          order_line_id?: string | null
          product_id?: string | null
          quantity?: number
          sku_snapshot?: string | null
          tax_rate_snapshot?: number | null
          tax_treatment?: string | null
          unit_price?: number | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_serials: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          customer_id: string
          delivery_date: string
          delivery_line_id: string
          id: string
          notes: string | null
          product_id: string
          serial_number: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          delivery_date: string
          delivery_line_id: string
          id?: string
          notes?: string | null
          product_id: string
          serial_number: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          delivery_date?: string
          delivery_line_id?: string
          id?: string
          notes?: string | null
          product_id?: string
          serial_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_serials_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_serials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_serials_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_serials_delivery_line_id_fkey"
            columns: ["delivery_line_id"]
            isOneToOne: false
            referencedRelation: "delivery_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_serials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      document_numbering_authority: {
        Row: {
          authority: string
          company_id: string
          doc_type: string
          reason: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          authority: string
          company_id: string
          doc_type: string
          reason: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          authority?: string
          company_id?: string
          doc_type?: string
          reason?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_numbering_authority_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      document_numbering_authority_audit: {
        Row: {
          changed_at: string
          changed_by: string | null
          company_id: string
          db_role: string
          doc_type: string
          id: number
          jwt_role: string | null
          new_authority: string | null
          old_authority: string | null
          operation: string
          reason: string | null
          series_code: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          company_id: string
          db_role?: string
          doc_type: string
          id?: never
          jwt_role?: string | null
          new_authority?: string | null
          old_authority?: string | null
          operation: string
          reason?: string | null
          series_code?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          db_role?: string
          doc_type?: string
          id?: never
          jwt_role?: string | null
          new_authority?: string | null
          old_authority?: string | null
          operation?: string
          reason?: string | null
          series_code?: string | null
        }
        Relationships: []
      }
      document_numbering_authority_series: {
        Row: {
          authority: string
          company_id: string
          doc_type: string
          reason: string
          series_code: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          authority: string
          company_id: string
          doc_type: string
          reason: string
          series_code: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          authority?: string
          company_id?: string
          doc_type?: string
          reason?: string
          series_code?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_numbering_authority_series_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      document_sequences: {
        Row: {
          company_id: string
          doc_type: string
          is_default: boolean
          is_selectable: boolean
          next_number: number
          padding: number
          prefix: string
          series_code: string
        }
        Insert: {
          company_id: string
          doc_type: string
          is_default?: boolean
          is_selectable?: boolean
          next_number: number
          padding?: number
          prefix: string
          series_code?: string
        }
        Update: {
          company_id?: string
          doc_type?: string
          is_default?: boolean
          is_selectable?: boolean
          next_number?: number
          padding?: number
          prefix?: string
          series_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_sequences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      deletion_log: {
        Row: {
          action: string
          company_id: string
          deleted_at: string
          deleted_by: string | null
          entity_id: string
          entity_type: string
          id: number
          label: string | null
          reason: string
          snapshot: Json
        }
        Insert: {
          action?: string
          company_id: string
          deleted_at?: string
          deleted_by?: string | null
          entity_id: string
          entity_type: string
          id?: never
          label?: string | null
          reason: string
          snapshot: Json
        }
        Update: {
          action?: string
          company_id?: string
          deleted_at?: string
          deleted_by?: string | null
          entity_id?: string
          entity_type?: string
          id?: never
          label?: string | null
          reason?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "deletion_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deletion_log_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_accounts: {
        Row: {
          active: boolean
          auth_mode: string
          company_id: string
          created_at: string
          display_name: string | null
          email_address: string
          id: string
          last_full_sync_at: string | null
          last_history_id: string | null
          last_synced_at: string | null
          provider: string
          sync_error: string | null
          sync_error_at: string | null
          sync_lock_owner: string | null
          sync_lock_until: string | null
          updated_at: string
          watch_expiration: string | null
          watch_topic: string | null
        }
        Insert: {
          active?: boolean
          auth_mode?: string
          company_id: string
          created_at?: string
          display_name?: string | null
          email_address: string
          id?: string
          last_full_sync_at?: string | null
          last_history_id?: string | null
          last_synced_at?: string | null
          provider?: string
          sync_error?: string | null
          sync_error_at?: string | null
          sync_lock_owner?: string | null
          sync_lock_until?: string | null
          updated_at?: string
          watch_expiration?: string | null
          watch_topic?: string | null
        }
        Update: {
          active?: boolean
          auth_mode?: string
          company_id?: string
          created_at?: string
          display_name?: string | null
          email_address?: string
          id?: string
          last_full_sync_at?: string | null
          last_history_id?: string | null
          last_synced_at?: string | null
          provider?: string
          sync_error?: string | null
          sync_error_at?: string | null
          sync_lock_owner?: string | null
          sync_lock_until?: string | null
          updated_at?: string
          watch_expiration?: string | null
          watch_topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      email_events: {
        Row: {
          account_id: string
          action: string
          actor: string | null
          company_id: string
          created_at: string
          detalle: Json | null
          gmail_thread_id: string | null
          id: number
        }
        Insert: {
          account_id: string
          action: string
          actor?: string | null
          company_id: string
          created_at?: string
          detalle?: Json | null
          gmail_thread_id?: string | null
          id?: number
        }
        Update: {
          account_id?: string
          action?: string
          actor?: string | null
          company_id?: string
          created_at?: string
          detalle?: Json | null
          gmail_thread_id?: string | null
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "email_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_actor_fkey"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      email_labels: {
        Row: {
          color: string
          company_id: string
          creado_por: string | null
          created_at: string
          id: string
          nombre: string
        }
        Insert: {
          color?: string
          company_id: string
          creado_por?: string | null
          created_at?: string
          id?: string
          nombre: string
        }
        Update: {
          color?: string
          company_id?: string
          creado_por?: string | null
          created_at?: string
          id?: string
          nombre?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_labels_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_labels_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_requests: {
        Row: {
          account_id: string
          attempted_at: string
          client_request_id: string
          company_id: string
          completed_at: string | null
          created_at: string
          error_code: string | null
          gmail_message_id: string | null
          gmail_thread_id: string | null
          id: string
          intentos: number
          operation: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          attempted_at?: string
          client_request_id: string
          company_id: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          intentos?: number
          operation: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          attempted_at?: string
          client_request_id?: string
          company_id?: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          intentos?: number
          operation?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_send_requests_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_send_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_send_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sync_log: {
        Row: {
          account_id: string
          created_at: string
          duracion_ms: number | null
          error_details: string | null
          historial_vencido: boolean
          history_id_desde: string | null
          history_id_hasta: string | null
          id: number
          kind: string
          threads_tocados: number
        }
        Insert: {
          account_id: string
          created_at?: string
          duracion_ms?: number | null
          error_details?: string | null
          historial_vencido?: boolean
          history_id_desde?: string | null
          history_id_hasta?: string | null
          id?: number
          kind: string
          threads_tocados?: number
        }
        Update: {
          account_id?: string
          created_at?: string
          duracion_ms?: number | null
          error_details?: string | null
          historial_vencido?: boolean
          history_id_desde?: string | null
          history_id_hasta?: string | null
          id?: number
          kind?: string
          threads_tocados?: number
        }
        Relationships: [
          {
            foreignKeyName: "email_sync_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      email_thread_labels: {
        Row: {
          account_id: string
          company_id: string
          created_at: string
          gmail_thread_id: string
          label_id: string
          puesta_por: string | null
        }
        Insert: {
          account_id: string
          company_id: string
          created_at?: string
          gmail_thread_id: string
          label_id: string
          puesta_por?: string | null
        }
        Update: {
          account_id?: string
          company_id?: string
          created_at?: string
          gmail_thread_id?: string
          label_id?: string
          puesta_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_thread_labels_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_thread_labels_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_thread_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "email_labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_thread_labels_puesta_por_fkey"
            columns: ["puesta_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_thread_reads: {
        Row: {
          account_id: string
          gmail_thread_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          gmail_thread_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          gmail_thread_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_thread_reads_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_thread_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_thread_state: {
        Row: {
          account_id: string
          assigned_to: string | null
          company_id: string
          created_at: string
          customer_contact_id: string | null
          customer_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          gmail_thread_id: string
          id: string
          internal_note: string | null
          updated_at: string
          vinculo_origen: string | null
          workflow_status: string
        }
        Insert: {
          account_id: string
          assigned_to?: string | null
          company_id: string
          created_at?: string
          customer_contact_id?: string | null
          customer_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          gmail_thread_id: string
          id?: string
          internal_note?: string | null
          updated_at?: string
          vinculo_origen?: string | null
          workflow_status?: string
        }
        Update: {
          account_id?: string
          assigned_to?: string | null
          company_id?: string
          created_at?: string
          customer_contact_id?: string | null
          customer_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          gmail_thread_id?: string
          id?: string
          internal_note?: string | null
          updated_at?: string
          vinculo_origen?: string | null
          workflow_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_thread_state_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_thread_state_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_thread_state_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_thread_state_customer_contact_id_fkey"
            columns: ["customer_contact_id"]
            isOneToOne: false
            referencedRelation: "customer_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_thread_state_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_thread_state_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_threads: {
        Row: {
          account_id: string
          company_id: string
          gmail_labels: string[]
          gmail_thread_id: string
          has_attachments: boolean
          id: string
          last_message_at: string | null
          last_message_dir: string | null
          last_message_from: string | null
          message_count: number
          participants: string[]
          size_estimate: number | null
          snippet: string | null
          subject: string | null
          synced_at: string
        }
        Insert: {
          account_id: string
          company_id: string
          gmail_labels?: string[]
          gmail_thread_id: string
          has_attachments?: boolean
          id?: string
          last_message_at?: string | null
          last_message_dir?: string | null
          last_message_from?: string | null
          message_count?: number
          participants?: string[]
          size_estimate?: number | null
          snippet?: string | null
          subject?: string | null
          synced_at?: string
        }
        Update: {
          account_id?: string
          company_id?: string
          gmail_labels?: string[]
          gmail_thread_id?: string
          has_attachments?: boolean
          id?: string
          last_message_at?: string | null
          last_message_dir?: string | null
          last_message_from?: string | null
          message_count?: number
          participants?: string[]
          size_estimate?: number | null
          snippet?: string | null
          subject?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_threads_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_external_identities: {
        Row: {
          channel: string
          company_id: string
          created_at: string
          created_by: string | null
          display_name: string | null
          external_id: string
          id: string
          profile_id: string
        }
        Insert: {
          channel: string
          company_id: string
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          external_id: string
          id?: string
          profile_id: string
        }
        Update: {
          channel?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          external_id?: string
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_external_identities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_external_identities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_external_identities_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipt_lines: {
        Row: {
          company_id: string
          created_at: string
          goods_receipt_id: string
          id: string
          name_snapshot: string | null
          product_id: string | null
          purchase_order_line_id: string | null
          quantity: number
          sku_snapshot: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          goods_receipt_id: string
          id?: string
          name_snapshot?: string | null
          product_id?: string | null
          purchase_order_line_id?: string | null
          quantity: number
          sku_snapshot?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          goods_receipt_id?: string
          id?: string
          name_snapshot?: string | null
          product_id?: string | null
          purchase_order_line_id?: string | null
          quantity?: number
          sku_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_lines_goods_receipt_id_fkey"
            columns: ["goods_receipt_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_lines_purchase_order_line_id_fkey"
            columns: ["purchase_order_line_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipts: {
        Row: {
          company_id: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          number: string
          purchase_order_id: string | null
          receipt_date: string
          series_code: string
          status: string
          supplier_document: string | null
          supplier_id: string
          updated_at: string
          updated_by: string | null
          warehouse_id: string
        }
        Insert: {
          company_id: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          number: string
          purchase_order_id?: string | null
          receipt_date: string
          series_code?: string
          status?: string
          supplier_document?: string | null
          supplier_id: string
          updated_at?: string
          updated_by?: string | null
          warehouse_id: string
        }
        Update: {
          company_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          number?: string
          purchase_order_id?: string | null
          receipt_date?: string
          series_code?: string
          status?: string
          supplier_document?: string | null
          supplier_id?: string
          updated_at?: string
          updated_by?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_asset_images: {
        Row: {
          asset_id: string
          company_id: string
          created_at: string
          external_id: string | null
          id: string
          position: number
          storage_path: string | null
          url: string | null
        }
        Insert: {
          asset_id: string
          company_id: string
          created_at?: string
          external_id?: string | null
          id?: string
          position?: number
          storage_path?: string | null
          url?: string | null
        }
        Update: {
          asset_id?: string
          company_id?: string
          created_at?: string
          external_id?: string | null
          id?: string
          position?: number
          storage_path?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_asset_images_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "maintenance_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_asset_images_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_assets: {
        Row: {
          address_text: string | null
          asset_type: string | null
          brand_id: string | null
          brand_text: string | null
          city: string | null
          company_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          delivery_serial_id: string | null
          description: string | null
          external_id: string | null
          external_source: string | null
          /**
           * Columna CALCULADA (funcion estado_servicio, Fase 29 E8). No existe en
           * la tabla: PostgREST la expone porque es una funcion sobre la fila.
           * Se puede pedir en el select y filtrar con eq, pero NO se escribe,
           * por eso va solo en Row y no en Insert ni en Update.
           */
          estado_servicio: string
          id: string
          identifier: string | null
          imported_at: string | null
          last_synced_at: string | null
          model_text: string | null
          name: string | null
          notes: string | null
          owner_customer_id: string | null
          product_id: string | null
          reference: string
          serial_normalized: string | null
          serial_number: string | null
          state: string | null
          under_contract: boolean
          updated_at: string
          updated_by: string | null
          warranty_end: string | null
          warranty_start: string | null
        }
        Insert: {
          address_text?: string | null
          asset_type?: string | null
          brand_id?: string | null
          brand_text?: string | null
          city?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          delivery_serial_id?: string | null
          description?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          identifier?: string | null
          imported_at?: string | null
          last_synced_at?: string | null
          model_text?: string | null
          name?: string | null
          notes?: string | null
          owner_customer_id?: string | null
          product_id?: string | null
          reference: string
          serial_normalized?: string | null
          serial_number?: string | null
          state?: string | null
          under_contract?: boolean
          updated_at?: string
          updated_by?: string | null
          warranty_end?: string | null
          warranty_start?: string | null
        }
        Update: {
          address_text?: string | null
          asset_type?: string | null
          brand_id?: string | null
          brand_text?: string | null
          city?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          delivery_serial_id?: string | null
          description?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          identifier?: string | null
          imported_at?: string | null
          last_synced_at?: string | null
          model_text?: string | null
          name?: string | null
          notes?: string | null
          owner_customer_id?: string | null
          product_id?: string | null
          reference?: string
          serial_normalized?: string | null
          serial_number?: string | null
          state?: string | null
          under_contract?: boolean
          updated_at?: string
          updated_by?: string | null
          warranty_end?: string | null
          warranty_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_assets_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_assets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_assets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_assets_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_assets_delivery_serial_id_fkey"
            columns: ["delivery_serial_id"]
            isOneToOne: false
            referencedRelation: "delivery_serials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_assets_owner_customer_id_fkey"
            columns: ["owner_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_assets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_assets_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_audit: {
        Row: {
          action: string
          actor_id: string | null
          company_id: string
          created_at: string
          diff: Json | null
          entity_id: string
          entity_type: string
          from_status: string | null
          id: number
          to_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          company_id: string
          created_at?: string
          diff?: Json | null
          entity_id: string
          entity_type: string
          from_status?: string | null
          id?: number
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          company_id?: string
          created_at?: string
          diff?: Json | null
          entity_id?: string
          entity_type?: string
          from_status?: string | null
          id?: number
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_check_points: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          id: string
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          company_id: string
          created_at?: string
          id?: string
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          id?: string
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_check_points_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_measurements: {
        Row: {
          company_id: string
          created_at: string
          id: string
          maintenance_order_id: string
          max_value: number | null
          min_value: number | null
          row_no: number
          target_value: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          maintenance_order_id: string
          max_value?: number | null
          min_value?: number | null
          row_no: number
          target_value?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          maintenance_order_id?: string
          max_value?: number | null
          min_value?: number | null
          row_no?: number
          target_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_measurements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_measurements_maintenance_order_id_fkey"
            columns: ["maintenance_order_id"]
            isOneToOne: false
            referencedRelation: "maintenance_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_order_checks: {
        Row: {
          check_point_id: string
          company_id: string
          created_at: string
          id: string
          maintenance_order_id: string
          phase: string
          result: string
        }
        Insert: {
          check_point_id: string
          company_id: string
          created_at?: string
          id?: string
          maintenance_order_id: string
          phase: string
          result: string
        }
        Update: {
          check_point_id?: string
          company_id?: string
          created_at?: string
          id?: string
          maintenance_order_id?: string
          phase?: string
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_order_checks_check_point_id_fkey"
            columns: ["check_point_id"]
            isOneToOne: false
            referencedRelation: "maintenance_check_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_order_checks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_order_checks_maintenance_order_id_fkey"
            columns: ["maintenance_order_id"]
            isOneToOne: false
            referencedRelation: "maintenance_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_order_parts: {
        Row: {
          company_id: string
          consumed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          maintenance_order_id: string
          name_snapshot: string | null
          product_id: string
          quantity: number
          sku_snapshot: string | null
          stock_movement_id: number | null
          unit_cost_currency_code: string | null
          unit_cost_snapshot: number | null
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          company_id: string
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          maintenance_order_id: string
          name_snapshot?: string | null
          product_id: string
          quantity: number
          sku_snapshot?: string | null
          stock_movement_id?: number | null
          unit_cost_currency_code?: string | null
          unit_cost_snapshot?: number | null
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          company_id?: string
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          maintenance_order_id?: string
          name_snapshot?: string | null
          product_id?: string
          quantity?: number
          sku_snapshot?: string | null
          stock_movement_id?: number | null
          unit_cost_currency_code?: string | null
          unit_cost_snapshot?: number | null
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_order_parts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_order_parts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_order_parts_maintenance_order_id_fkey"
            columns: ["maintenance_order_id"]
            isOneToOne: false
            referencedRelation: "maintenance_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_order_parts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_order_parts_stock_movement_id_fkey"
            columns: ["stock_movement_id"]
            isOneToOne: false
            referencedRelation: "stock_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_order_parts_unit_cost_currency_code_fkey"
            columns: ["unit_cost_currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "maintenance_order_parts_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_orders: {
        Row: {
          asset_id: string
          closed_at: string | null
          closed_by: string | null
          closing_notes: string | null
          company_id: string
          created_at: string
          created_by: string | null
          customer_id: string
          delivered_at: string | null
          diagnosed_at: string | null
          diagnosed_by: string | null
          diagnosis_notes: string | null
          entry_reason: string | null
          id: string
          labour_hours: number | null
          next_preventive_date: string | null
          number: string
          on_hold: boolean
          on_hold_since: string | null
          pending_parts: string | null
          quote_approved_at: string | null
          quote_approved_by_name: string | null
          quote_contact: string | null
          quote_currency_code: string | null
          quote_notes: string | null
          quote_status: string
          quote_subtotal: number
          quote_total: number
          received_at: string
          received_by: string | null
          repair_notes: string | null
          repair_required: boolean
          repaired_at: string | null
          repaired_by: string | null
          series_code: string
          service_type: string
          stage: string
          status: string
          technician_id: string | null
          torque_at: string | null
          torque_by: string | null
          torque_lsl: number | null
          torque_nominal: number | null
          torque_required: boolean
          torque_usl: number | null
          updated_at: string
          updated_by: string | null
          visual_condition: string | null
        }
        Insert: {
          asset_id: string
          closed_at?: string | null
          closed_by?: string | null
          closing_notes?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          delivered_at?: string | null
          diagnosed_at?: string | null
          diagnosed_by?: string | null
          diagnosis_notes?: string | null
          entry_reason?: string | null
          id?: string
          labour_hours?: number | null
          next_preventive_date?: string | null
          number: string
          on_hold?: boolean
          on_hold_since?: string | null
          pending_parts?: string | null
          quote_approved_at?: string | null
          quote_approved_by_name?: string | null
          quote_contact?: string | null
          quote_currency_code?: string | null
          quote_notes?: string | null
          quote_status?: string
          quote_subtotal?: number
          quote_total?: number
          received_at?: string
          received_by?: string | null
          repair_notes?: string | null
          repair_required?: boolean
          repaired_at?: string | null
          repaired_by?: string | null
          series_code?: string
          service_type?: string
          stage?: string
          status?: string
          technician_id?: string | null
          torque_at?: string | null
          torque_by?: string | null
          torque_lsl?: number | null
          torque_nominal?: number | null
          torque_required?: boolean
          torque_usl?: number | null
          updated_at?: string
          updated_by?: string | null
          visual_condition?: string | null
        }
        Update: {
          asset_id?: string
          closed_at?: string | null
          closed_by?: string | null
          closing_notes?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          delivered_at?: string | null
          diagnosed_at?: string | null
          diagnosed_by?: string | null
          diagnosis_notes?: string | null
          entry_reason?: string | null
          id?: string
          labour_hours?: number | null
          next_preventive_date?: string | null
          number?: string
          on_hold?: boolean
          on_hold_since?: string | null
          pending_parts?: string | null
          quote_approved_at?: string | null
          quote_approved_by_name?: string | null
          quote_contact?: string | null
          quote_currency_code?: string | null
          quote_notes?: string | null
          quote_status?: string
          quote_subtotal?: number
          quote_total?: number
          received_at?: string
          received_by?: string | null
          repair_notes?: string | null
          repair_required?: boolean
          repaired_at?: string | null
          repaired_by?: string | null
          series_code?: string
          service_type?: string
          stage?: string
          status?: string
          technician_id?: string | null
          torque_at?: string | null
          torque_by?: string | null
          torque_lsl?: number | null
          torque_nominal?: number | null
          torque_required?: boolean
          torque_usl?: number | null
          updated_at?: string
          updated_by?: string | null
          visual_condition?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_orders_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "maintenance_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_orders_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_orders_diagnosed_by_fkey"
            columns: ["diagnosed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_orders_quote_currency_fkey"
            columns: ["quote_currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "maintenance_orders_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_orders_repaired_by_fkey"
            columns: ["repaired_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_orders_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_orders_torque_by_fkey"
            columns: ["torque_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_orders_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_quote_lines: {
        Row: {
          company_id: string
          created_at: string
          description_snapshot: string | null
          id: string
          line_no: number
          line_total: number
          line_type: string
          maintenance_order_id: string
          product_id: string | null
          quantity: number
          sku_snapshot: string | null
          unit_price: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          description_snapshot?: string | null
          id?: string
          line_no: number
          line_total?: number
          line_type?: string
          maintenance_order_id: string
          product_id?: string | null
          quantity: number
          sku_snapshot?: string | null
          unit_price?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          description_snapshot?: string | null
          id?: string
          line_no?: number
          line_total?: number
          line_type?: string
          maintenance_order_id?: string
          product_id?: string | null
          quantity?: number
          sku_snapshot?: string | null
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_quote_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_quote_lines_maintenance_order_id_fkey"
            columns: ["maintenance_order_id"]
            isOneToOne: false
            referencedRelation: "maintenance_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_quote_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_service_chains: {
        Row: {
          amount: number | null
          amount_attribution: string
          asset_count: number
          chain_class: string
          company_id: string
          confidence: string
          currency_code: string | null
          customer_id: string | null
          delivered_at: string | null
          external_id: string
          external_source: string
          id: string
          imported_at: string
          invoiced: boolean | null
          label: string
          last_synced_at: string | null
          quotation_status: string
          received_at: string
          status: string
          stel_status_raw: string
          technician_name_raw: string | null
        }
        Insert: {
          amount?: number | null
          amount_attribution: string
          asset_count: number
          chain_class: string
          company_id: string
          confidence: string
          currency_code?: string | null
          customer_id?: string | null
          delivered_at?: string | null
          external_id: string
          external_source?: string
          id?: string
          imported_at?: string
          invoiced?: boolean | null
          label: string
          last_synced_at?: string | null
          quotation_status: string
          received_at: string
          status: string
          stel_status_raw: string
          technician_name_raw?: string | null
        }
        Update: {
          amount?: number | null
          amount_attribution?: string
          asset_count?: number
          chain_class?: string
          company_id?: string
          confidence?: string
          currency_code?: string | null
          customer_id?: string | null
          delivered_at?: string | null
          external_id?: string
          external_source?: string
          id?: string
          imported_at?: string
          invoiced?: boolean | null
          label?: string
          last_synced_at?: string | null
          quotation_status?: string
          received_at?: string
          status?: string
          stel_status_raw?: string
          technician_name_raw?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_service_chains_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_service_chains_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "maintenance_service_chains_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_service_history: {
        Row: {
          amount: number | null
          amount_attribution: string
          asset_id: string
          chain_id: string
          closing_notes: string | null
          company_id: string
          currency_code: string | null
          customer_id: string | null
          delivered_at: string | null
          diagnosis_notes: string | null
          external_id: string
          external_source: string
          id: string
          imported_at: string
          invoiced: boolean | null
          last_synced_at: string | null
          quotation_status: string
          received_at: string
          repair_notes: string | null
          status: string
          stel_status_raw: string
          technician_name_raw: string | null
          title: string | null
        }
        Insert: {
          amount?: number | null
          amount_attribution: string
          asset_id: string
          chain_id: string
          closing_notes?: string | null
          company_id: string
          currency_code?: string | null
          customer_id?: string | null
          delivered_at?: string | null
          diagnosis_notes?: string | null
          external_id: string
          external_source?: string
          id?: string
          imported_at?: string
          invoiced?: boolean | null
          last_synced_at?: string | null
          quotation_status: string
          received_at: string
          repair_notes?: string | null
          status: string
          stel_status_raw: string
          technician_name_raw?: string | null
          title?: string | null
        }
        Update: {
          amount?: number | null
          amount_attribution?: string
          asset_id?: string
          chain_id?: string
          closing_notes?: string | null
          company_id?: string
          currency_code?: string | null
          customer_id?: string | null
          delivered_at?: string | null
          diagnosis_notes?: string | null
          external_id?: string
          external_source?: string
          id?: string
          imported_at?: string
          invoiced?: boolean | null
          last_synced_at?: string | null
          quotation_status?: string
          received_at?: string
          repair_notes?: string | null
          status?: string
          stel_status_raw?: string
          technician_name_raw?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_service_history_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "maintenance_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_service_history_chain_id_fkey"
            columns: ["chain_id"]
            isOneToOne: false
            referencedRelation: "maintenance_service_chains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_service_history_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_service_history_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "maintenance_service_history_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_service_source_documents: {
        Row: {
          chain_id: string
          company_id: string
          created_at: string
          currency_code: string | null
          doc_date: string
          doc_kind: string
          external_id: string
          external_source: string
          id: string
          parent_external_id: string | null
          pdf_path: string | null
          reference: string
          stel_status: string | null
          total_amount: number | null
        }
        Insert: {
          chain_id: string
          company_id: string
          created_at?: string
          currency_code?: string | null
          doc_date: string
          doc_kind: string
          external_id: string
          external_source?: string
          id?: string
          parent_external_id?: string | null
          pdf_path?: string | null
          reference: string
          stel_status?: string | null
          total_amount?: number | null
        }
        Update: {
          chain_id?: string
          company_id?: string
          created_at?: string
          currency_code?: string | null
          doc_date?: string
          doc_kind?: string
          external_id?: string
          external_source?: string
          id?: string
          parent_external_id?: string | null
          pdf_path?: string | null
          reference?: string
          stel_status?: string | null
          total_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_service_source_documents_chain_id_fkey"
            columns: ["chain_id"]
            isOneToOne: false
            referencedRelation: "maintenance_service_chains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_service_source_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_service_source_documents_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      maintenance_service_source_lines: {
        Row: {
          amount: number | null
          company_id: string
          created_at: string
          currency_code: string | null
          description: string | null
          external_id: string | null
          id: string
          line_no: number
          line_type: string
          matched_product_id: string | null
          quantity: number | null
          sku: string | null
          source_document_id: string
          unit_price: number | null
        }
        Insert: {
          amount?: number | null
          company_id: string
          created_at?: string
          currency_code?: string | null
          description?: string | null
          external_id?: string | null
          id?: string
          line_no: number
          line_type: string
          matched_product_id?: string | null
          quantity?: number | null
          sku?: string | null
          source_document_id: string
          unit_price?: number | null
        }
        Update: {
          amount?: number | null
          company_id?: string
          created_at?: string
          currency_code?: string | null
          description?: string | null
          external_id?: string | null
          id?: string
          line_no?: number
          line_type?: string
          matched_product_id?: string | null
          quantity?: number | null
          sku?: string | null
          source_document_id?: string
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_service_source_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_service_source_lines_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "maintenance_service_source_lines_matched_product_id_fkey"
            columns: ["matched_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_service_source_lines_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "maintenance_service_source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_allocations: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string
          payment_id: string
        }
        Insert: {
          amount: number
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id: string
          payment_id: string
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          created_by: string | null
          currency_code: string | null
          customer_id: string
          exchange_rate: number | null
          external_id: string | null
          external_source: string | null
          id: string
          method: string | null
          notes: string | null
          payment_date: string
          reference: string | null
          synced_at: string | null
        }
        Insert: {
          amount: number
          company_id: string
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id: string
          exchange_rate?: number | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          method?: string | null
          notes?: string | null
          payment_date: string
          reference?: string | null
          synced_at?: string | null
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id?: string
          exchange_rate?: number | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          method?: string | null
          notes?: string | null
          payment_date?: string
          reference?: string | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      price_lists: {
        Row: {
          company_id: string
          created_at: string
          currency_code: string
          id: string
          is_default: boolean
          name: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          currency_code: string
          id?: string
          is_default?: boolean
          name: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          currency_code?: string
          id?: string
          is_default?: boolean
          name?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_lists_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_lists_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      product_attribute_categories: {
        Row: {
          attribute_definition_id: string
          category_id: string
          company_id: string
          created_at: string
        }
        Insert: {
          attribute_definition_id: string
          category_id: string
          company_id: string
          created_at?: string
        }
        Update: {
          attribute_definition_id?: string
          category_id?: string
          company_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_attribute_categories_attribute_definition_id_fkey"
            columns: ["attribute_definition_id"]
            isOneToOne: false
            referencedRelation: "product_attribute_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_attribute_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_attribute_categories_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      product_attribute_definitions: {
        Row: {
          applies_to_category_id: string | null
          company_id: string
          created_at: string
          data_type: string
          id: string
          /** Fase 30: si es true, el valor sale de `product_attribute_options`. */
          is_enumerated: boolean
          is_filterable: boolean
          key: string
          label: string
          position: number
          unit: string | null
        }
        Insert: {
          applies_to_category_id?: string | null
          company_id: string
          created_at?: string
          data_type: string
          id?: string
          is_enumerated?: boolean
          is_filterable?: boolean
          key: string
          label: string
          position?: number
          unit?: string | null
        }
        Update: {
          applies_to_category_id?: string | null
          company_id?: string
          created_at?: string
          data_type?: string
          id?: string
          is_enumerated?: boolean
          is_filterable?: boolean
          key?: string
          label?: string
          position?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_attribute_definitions_applies_to_category_id_fkey"
            columns: ["applies_to_category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_attribute_definitions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      /**
       * Fase 30: los valores permitidos de un atributo enumerado.
       *
       * Existe para que «1/4 Hex» y «1/4 HEX» no puedan volver a convivir: sin
       * lista cerrada ya pasó, en 1.176 productos.
       */
      product_attribute_options: {
        Row: {
          company_id: string
          created_at: string
          definition_id: string
          id: string
          position: number
          value: string
        }
        Insert: {
          company_id: string
          created_at?: string
          definition_id: string
          id?: string
          position?: number
          value: string
        }
        Update: {
          company_id?: string
          created_at?: string
          definition_id?: string
          id?: string
          position?: number
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_attribute_options_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_attribute_options_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "product_attribute_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          needs_review: boolean
          parent_id: string | null
          position: number
          slug: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          needs_review?: boolean
          parent_id?: string | null
          position?: number
          slug: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          needs_review?: boolean
          parent_id?: string | null
          position?: number
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      product_equivalences: {
        Row: {
          company_id: string
          equivalent_product_id: string
          id: string
          imported_at: string
          product_id: string
          source: string
          source_kind: string
        }
        Insert: {
          company_id: string
          equivalent_product_id: string
          id?: string
          imported_at?: string
          product_id: string
          source?: string
          source_kind: string
        }
        Update: {
          company_id?: string
          equivalent_product_id?: string
          id?: string
          imported_at?: string
          product_id?: string
          source?: string
          source_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_equivalences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_equivalences_equivalent_product_id_fkey"
            columns: ["equivalent_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_equivalences_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          alt_text: string | null
          bytes: number | null
          checked_at: string | null
          company_id: string
          created_at: string
          http_status: number | null
          id: string
          is_primary: boolean
          kind: string
          position: number
          product_id: string
          source_url: string | null
          storage_path: string | null
          thumb_url: string | null
        }
        Insert: {
          alt_text?: string | null
          bytes?: number | null
          checked_at?: string | null
          company_id: string
          created_at?: string
          http_status?: number | null
          id?: string
          is_primary?: boolean
          kind?: string
          position?: number
          product_id: string
          source_url?: string | null
          storage_path?: string | null
          thumb_url?: string | null
        }
        Update: {
          alt_text?: string | null
          bytes?: number | null
          checked_at?: string | null
          company_id?: string
          created_at?: string
          http_status?: number | null
          id?: string
          is_primary?: boolean
          kind?: string
          position?: number
          product_id?: string
          source_url?: string | null
          storage_path?: string | null
          thumb_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_images_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      /**
       * Fase 30: la receta de un kit.
       *
       * El kit NO tiene stock propio: sale del cuello de botella de estas
       * filas, y venderlo descuenta los componentes.
       */
      product_kit_components: {
        Row: {
          company_id: string
          component_product_id: string
          created_at: string
          created_by: string | null
          id: string
          kit_product_id: string
          position: number
          quantity: number
        }
        Insert: {
          company_id: string
          component_product_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kit_product_id: string
          position?: number
          quantity: number
        }
        Update: {
          company_id?: string
          component_product_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kit_product_id?: string
          position?: number
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_kit_components_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_kit_components_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_kit_components_kit_product_id_fkey"
            columns: ["kit_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_prices: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          id: string
          price_list_id: string
          product_id: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          amount: number
          company_id: string
          created_at?: string
          id?: string
          price_list_id: string
          product_id: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          id?: string
          price_list_id?: string
          product_id?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_prices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_prices_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          attributes: Json
          brand_id: string | null
          category_id: string
          company_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          description_long: string | null
          external_id: string | null
          external_source: string | null
          id: string
          is_kit: boolean
          is_serialized: boolean
          legacy_ref: string | null
          model_code: string | null
          name: string
          ncm_code: string | null
          needs_review: boolean
          origin_country: string | null
          product_type: string | null
          search_vector: unknown
          series: string | null
          sku: string
          status: string
          updated_at: string
          volume_cm3: number | null
          weight_g: number | null
        }
        Insert: {
          attributes?: Json
          brand_id?: string | null
          category_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          description_long?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_kit?: boolean
          is_serialized?: boolean
          legacy_ref?: string | null
          model_code?: string | null
          name: string
          ncm_code?: string | null
          needs_review?: boolean
          origin_country?: string | null
          product_type?: string | null
          search_vector?: unknown
          series?: string | null
          sku: string
          status?: string
          updated_at?: string
          volume_cm3?: number | null
          weight_g?: number | null
        }
        Update: {
          attributes?: Json
          brand_id?: string | null
          category_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          description_long?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_kit?: boolean
          is_serialized?: boolean
          legacy_ref?: string | null
          model_code?: string | null
          name?: string
          ncm_code?: string | null
          needs_review?: boolean
          origin_country?: string | null
          product_type?: string | null
          search_vector?: unknown
          series?: string | null
          sku?: string
          status?: string
          updated_at?: string
          volume_cm3?: number | null
          weight_g?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          appearance: Json | null
          avatar_path: string | null
          created_at: string
          deleted_at: string | null
          full_name: string
          id: string
          is_active: boolean
          locale: string
          phone: string | null
          theme: string | null
          updated_at: string
        }
        Insert: {
          appearance?: Json | null
          avatar_path?: string | null
          created_at?: string
          deleted_at?: string | null
          full_name: string
          id: string
          is_active?: boolean
          locale?: string
          phone?: string | null
          theme?: string | null
          updated_at?: string
        }
        Update: {
          appearance?: Json | null
          avatar_path?: string | null
          created_at?: string
          deleted_at?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          locale?: string
          phone?: string | null
          theme?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      purchase_order_discrepancies: {
        Row: {
          company_id: string
          created_at: string
          field: string
          id: string
          po_id: string
          po_line_id: string | null
          po_value: string | null
          quote_line_id: string | null
          quote_value: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
        }
        Insert: {
          company_id: string
          created_at?: string
          field: string
          id?: string
          po_id: string
          po_line_id?: string | null
          po_value?: string | null
          quote_line_id?: string | null
          quote_value?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          field?: string
          id?: string
          po_id?: string
          po_line_id?: string | null
          po_value?: string | null
          quote_line_id?: string | null
          quote_value?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_discrepancies_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "customer_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_discrepancies_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "customer_purchase_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_discrepancies_quote_line_id_fkey"
            columns: ["quote_line_id"]
            isOneToOne: false
            referencedRelation: "sales_quote_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_discrepancies_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_lines: {
        Row: {
          company_id: string
          created_at: string
          description_snapshot: string | null
          discount_pct: number
          id: string
          line_no: number
          line_total: number
          line_type: string
          name_snapshot: string | null
          product_id: string | null
          purchase_order_id: string
          quantity: number
          sku_snapshot: string | null
          tax_rate_snapshot: number | null
          tax_treatment: string
          unit_price: number | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          description_snapshot?: string | null
          discount_pct?: number
          id?: string
          line_no: number
          line_total?: number
          line_type?: string
          name_snapshot?: string | null
          product_id?: string | null
          purchase_order_id: string
          quantity?: number
          sku_snapshot?: string | null
          tax_rate_snapshot?: number | null
          tax_treatment?: string
          unit_price?: number | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          description_snapshot?: string | null
          discount_pct?: number
          id?: string
          line_no?: number
          line_total?: number
          line_type?: string
          name_snapshot?: string | null
          product_id?: string | null
          purchase_order_id?: string
          quantity?: number
          sku_snapshot?: string | null
          tax_rate_snapshot?: number | null
          tax_treatment?: string
          unit_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          currency_code: string
          exchange_rate: number | null
          expected_date: string | null
          id: string
          notes: string | null
          number: string
          order_date: string
          payment_terms: string | null
          receipt_status: string
          series_code: string
          status: string
          subtotal: number
          supplier_id: string
          tax_amount: number
          total: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          currency_code: string
          exchange_rate?: number | null
          expected_date?: string | null
          id?: string
          notes?: string | null
          number: string
          order_date: string
          payment_terms?: string | null
          receipt_status?: string
          series_code?: string
          status?: string
          subtotal?: number
          supplier_id: string
          tax_amount?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string
          exchange_rate?: number | null
          expected_date?: string | null
          id?: string
          notes?: string | null
          number?: string
          order_date?: string
          payment_terms?: string | null
          receipt_status?: string
          series_code?: string
          status?: string
          subtotal?: number
          supplier_id?: string
          tax_amount?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases_audit: {
        Row: {
          action: string
          actor_id: string | null
          company_id: string
          created_at: string
          diff: Json | null
          entity_id: string
          entity_type: string
          from_status: string | null
          id: number
          to_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          company_id: string
          created_at?: string
          diff?: Json | null
          entity_id: string
          entity_type: string
          from_status?: string | null
          id?: never
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          company_id?: string
          created_at?: string
          diff?: Json | null
          entity_id?: string
          entity_type?: string
          from_status?: string | null
          id?: never
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchases_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_audit: {
        Row: {
          action: string
          actor_id: string | null
          company_id: string
          created_at: string
          diff: Json | null
          entity_id: string
          entity_type: string
          from_status: string | null
          id: number
          to_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          company_id: string
          created_at?: string
          diff?: Json | null
          entity_id: string
          entity_type: string
          from_status?: string | null
          id?: number
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          company_id?: string
          created_at?: string
          diff?: Json | null
          entity_id?: string
          entity_type?: string
          from_status?: string | null
          id?: number
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoice_lines: {
        Row: {
          company_id: string
          created_at: string
          delivery_line_id: string | null
          discount_pct: number
          id: string
          invoice_id: string
          name_snapshot: string | null
          order_line_id: string | null
          product_id: string | null
          quantity: number
          sku_snapshot: string | null
          tax_rate_snapshot: number
          tax_treatment: string
          unit_price: number
        }
        Insert: {
          company_id: string
          created_at?: string
          delivery_line_id?: string | null
          discount_pct?: number
          id?: string
          invoice_id: string
          name_snapshot?: string | null
          order_line_id?: string | null
          product_id?: string | null
          quantity: number
          sku_snapshot?: string | null
          tax_rate_snapshot?: number
          tax_treatment?: string
          unit_price: number
        }
        Update: {
          company_id?: string
          created_at?: string
          delivery_line_id?: string | null
          discount_pct?: number
          id?: string
          invoice_id?: string
          name_snapshot?: string | null
          order_line_id?: string | null
          product_id?: string | null
          quantity?: number
          sku_snapshot?: string | null
          tax_rate_snapshot?: number
          tax_treatment?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoice_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_lines_delivery_line_id_fkey"
            columns: ["delivery_line_id"]
            isOneToOne: false
            referencedRelation: "delivery_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_lines_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoices: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          currency_code: string | null
          customer_id: string
          due_date: string | null
          exchange_rate: number | null
          external_id: string | null
          external_number: string | null
          external_source: string | null
          external_status: string | null
          id: string
          invoice_date: string
          needs_review: boolean
          notes: string | null
          number: string | null
          order_id: string | null
          original_number: string | null
          review_reason: string | null
          status: string
          subtotal: number | null
          synced_at: string | null
          tax_amount: number | null
          total: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id: string
          due_date?: string | null
          exchange_rate?: number | null
          external_id?: string | null
          external_number?: string | null
          external_source?: string | null
          external_status?: string | null
          id?: string
          invoice_date: string
          needs_review?: boolean
          notes?: string | null
          number?: string | null
          order_id?: string | null
          original_number?: string | null
          review_reason?: string | null
          status?: string
          subtotal?: number | null
          synced_at?: string | null
          tax_amount?: number | null
          total?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id?: string
          due_date?: string | null
          exchange_rate?: number | null
          external_id?: string | null
          external_number?: string | null
          external_source?: string | null
          external_status?: string | null
          id?: string
          invoice_date?: string
          needs_review?: boolean
          notes?: string | null
          number?: string | null
          order_id?: string | null
          original_number?: string | null
          review_reason?: string | null
          status?: string
          subtotal?: number | null
          synced_at?: string | null
          tax_amount?: number | null
          total?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "sales_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_order_lines: {
        Row: {
          company_id: string
          created_at: string
          customer_description: string | null
          customer_product_code: string | null
          description_snapshot: string | null
          discount_pct: number
          id: string
          kit_components_snapshot: Json | null
          line_no: number
          line_type: string
          list_price_snapshot: number | null
          name_snapshot: string | null
          notes: string | null
          order_id: string
          po_line_id: string | null
          product_id: string | null
          quantity_ordered: number
          quote_line_id: string | null
          sku_snapshot: string | null
          tax_rate_snapshot: number
          tax_treatment: string
          unit_price: number
        }
        Insert: {
          company_id: string
          created_at?: string
          customer_description?: string | null
          customer_product_code?: string | null
          description_snapshot?: string | null
          discount_pct?: number
          id?: string
          kit_components_snapshot?: Json | null
          line_no: number
          line_type?: string
          list_price_snapshot?: number | null
          name_snapshot?: string | null
          notes?: string | null
          order_id: string
          po_line_id?: string | null
          product_id?: string | null
          quantity_ordered: number
          quote_line_id?: string | null
          sku_snapshot?: string | null
          tax_rate_snapshot?: number
          tax_treatment?: string
          unit_price: number
        }
        Update: {
          company_id?: string
          created_at?: string
          customer_description?: string | null
          customer_product_code?: string | null
          description_snapshot?: string | null
          discount_pct?: number
          id?: string
          kit_components_snapshot?: Json | null
          line_no?: number
          line_type?: string
          list_price_snapshot?: number | null
          name_snapshot?: string | null
          notes?: string | null
          order_id?: string
          po_line_id?: string | null
          product_id?: string | null
          quantity_ordered?: number
          quote_line_id?: string | null
          sku_snapshot?: string | null
          tax_rate_snapshot?: number
          tax_treatment?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "customer_purchase_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_lines_quote_line_id_fkey"
            columns: ["quote_line_id"]
            isOneToOne: false
            referencedRelation: "sales_quote_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_orders: {
        Row: {
          billing_address_id: string | null
          commercial_status: string
          company_id: string
          contact_id: string | null
          cost_center: string | null
          created_at: string
          created_by: string | null
          currency_code: string | null
          customer_id: string
          discount_pct: number | null
          exchange_rate: number | null
          external_id: string | null
          external_source: string | null
          fulfillment_status: string
          id: string
          imported_at: string | null
          invoicing_status: string
          legacy_source: string | null
          needs_review: boolean
          notes: string | null
          number: string
          number_outlier: boolean
          order_date: string
          origin: string
          original_number: string | null
          payment_status: string
          payment_terms: string | null
          perception_pct: number | null
          po_id: string | null
          price_list_id: string | null
          quote_id: string | null
          review_reason: string | null
          salesperson_id: string | null
          series_code: string | null
          shipping_address_id: string | null
          subtotal: number | null
          suspected_normalized_number: string | null
          tax_amount: number | null
          title: string | null
          total: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          billing_address_id?: string | null
          commercial_status?: string
          company_id: string
          contact_id?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id: string
          discount_pct?: number | null
          exchange_rate?: number | null
          external_id?: string | null
          external_source?: string | null
          fulfillment_status?: string
          id?: string
          imported_at?: string | null
          invoicing_status?: string
          legacy_source?: string | null
          needs_review?: boolean
          notes?: string | null
          number: string
          number_outlier?: boolean
          order_date: string
          origin?: string
          original_number?: string | null
          payment_status?: string
          payment_terms?: string | null
          perception_pct?: number | null
          po_id?: string | null
          price_list_id?: string | null
          quote_id?: string | null
          review_reason?: string | null
          salesperson_id?: string | null
          series_code?: string | null
          shipping_address_id?: string | null
          subtotal?: number | null
          suspected_normalized_number?: string | null
          tax_amount?: number | null
          title?: string | null
          total?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          billing_address_id?: string | null
          commercial_status?: string
          company_id?: string
          contact_id?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id?: string
          discount_pct?: number | null
          exchange_rate?: number | null
          external_id?: string | null
          external_source?: string | null
          fulfillment_status?: string
          id?: string
          imported_at?: string | null
          invoicing_status?: string
          legacy_source?: string | null
          needs_review?: boolean
          notes?: string | null
          number?: string
          number_outlier?: boolean
          order_date?: string
          origin?: string
          original_number?: string | null
          payment_status?: string
          payment_terms?: string | null
          perception_pct?: number | null
          po_id?: string | null
          price_list_id?: string | null
          quote_id?: string | null
          review_reason?: string | null
          salesperson_id?: string | null
          series_code?: string | null
          shipping_address_id?: string | null
          subtotal?: number | null
          suspected_normalized_number?: string | null
          tax_amount?: number | null
          title?: string | null
          total?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_orders_billing_address_id_fkey"
            columns: ["billing_address_id"]
            isOneToOne: false
            referencedRelation: "customer_addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "customer_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "sales_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "customer_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "sales_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_shipping_address_id_fkey"
            columns: ["shipping_address_id"]
            isOneToOne: false
            referencedRelation: "customer_addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_quote_lines: {
        Row: {
          brand_snapshot: string | null
          company_id: string
          created_at: string
          description_snapshot: string | null
          discount_pct: number
          id: string
          kit_components_snapshot: Json | null
          line_no: number
          line_type: string
          list_price_snapshot: number | null
          name_snapshot: string | null
          notes: string | null
          product_id: string | null
          quantity: number
          quote_id: string
          sku_snapshot: string | null
          tax_rate_snapshot: number
          tax_treatment: string
          unit_price: number
        }
        Insert: {
          brand_snapshot?: string | null
          company_id: string
          created_at?: string
          description_snapshot?: string | null
          discount_pct?: number
          id?: string
          kit_components_snapshot?: Json | null
          line_no: number
          line_type?: string
          list_price_snapshot?: number | null
          name_snapshot?: string | null
          notes?: string | null
          product_id?: string | null
          quantity: number
          quote_id: string
          sku_snapshot?: string | null
          tax_rate_snapshot?: number
          tax_treatment?: string
          unit_price: number
        }
        Update: {
          brand_snapshot?: string | null
          company_id?: string
          created_at?: string
          description_snapshot?: string | null
          discount_pct?: number
          id?: string
          kit_components_snapshot?: Json | null
          line_no?: number
          line_type?: string
          list_price_snapshot?: number | null
          name_snapshot?: string | null
          notes?: string | null
          product_id?: string | null
          quantity?: number
          quote_id?: string
          sku_snapshot?: string | null
          tax_rate_snapshot?: number
          tax_treatment?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_quote_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quote_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quote_lines_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "sales_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_quotes: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          company_id: string
          contact_id: string | null
          created_at: string
          created_by: string | null
          currency_code: string | null
          customer_id: string
          discount_pct: number | null
          exchange_rate: number | null
          external_id: string | null
          external_source: string | null
          id: string
          imported_at: string | null
          legacy_source: string | null
          needs_review: boolean
          notes: string | null
          number: string
          number_outlier: boolean
          original_number: string | null
          payment_terms: string | null
          perception_pct: number | null
          price_list_id: string | null
          quote_date: string
          review_reason: string | null
          salesperson_id: string | null
          series_code: string | null
          status: string
          subtotal: number | null
          suspected_normalized_number: string | null
          tax_amount: number | null
          title: string | null
          total: number | null
          updated_at: string
          updated_by: string | null
          valid_until: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          company_id: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id: string
          discount_pct?: number | null
          exchange_rate?: number | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          imported_at?: string | null
          legacy_source?: string | null
          needs_review?: boolean
          notes?: string | null
          number: string
          number_outlier?: boolean
          original_number?: string | null
          payment_terms?: string | null
          perception_pct?: number | null
          price_list_id?: string | null
          quote_date: string
          review_reason?: string | null
          salesperson_id?: string | null
          series_code?: string | null
          status?: string
          subtotal?: number | null
          suspected_normalized_number?: string | null
          tax_amount?: number | null
          title?: string | null
          total?: number | null
          updated_at?: string
          updated_by?: string | null
          valid_until?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id?: string
          discount_pct?: number | null
          exchange_rate?: number | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          imported_at?: string | null
          legacy_source?: string | null
          needs_review?: boolean
          notes?: string | null
          number?: string
          number_outlier?: boolean
          original_number?: string | null
          payment_terms?: string | null
          perception_pct?: number | null
          price_list_id?: string | null
          quote_date?: string
          review_reason?: string | null
          salesperson_id?: string | null
          series_code?: string | null
          status?: string
          subtotal?: number | null
          suspected_normalized_number?: string | null
          tax_amount?: number | null
          title?: string | null
          total?: number | null
          updated_at?: string
          updated_by?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_quotes_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "customer_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotes_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "sales_quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotes_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotes_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stel_reconciliation_log: {
        Row: {
          action: string
          company_id: string
          created_at: string
          detail: Json | null
          entity_id: string
          entity_type: string
          field: string | null
          id: number
          new_value: Json | null
          old_value: Json | null
          reverted_at: string | null
          run_id: string
          source: string
          stel_id: string | null
        }
        Insert: {
          action: string
          company_id: string
          created_at?: string
          detail?: Json | null
          entity_id: string
          entity_type: string
          field?: string | null
          id?: never
          new_value?: Json | null
          old_value?: Json | null
          reverted_at?: string | null
          run_id: string
          source?: string
          stel_id?: string | null
        }
        Update: {
          action?: string
          company_id?: string
          created_at?: string
          detail?: Json | null
          entity_id?: string
          entity_type?: string
          field?: string | null
          id?: never
          new_value?: Json | null
          old_value?: Json | null
          reverted_at?: string | null
          run_id?: string
          source?: string
          stel_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stel_reconciliation_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stel_reconciliation_log_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "stel_reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      stel_reconciliation_runs: {
        Row: {
          company_id: string
          finished_at: string | null
          id: string
          kind: string
          plan_hash: string
          source: string
          started_at: string
          status: string
          stel_read_at: string
          summary: Json | null
        }
        Insert: {
          company_id: string
          finished_at?: string | null
          id?: string
          kind?: string
          plan_hash: string
          source?: string
          started_at?: string
          status?: string
          stel_read_at: string
          summary?: Json | null
        }
        Update: {
          company_id?: string
          finished_at?: string | null
          id?: string
          kind?: string
          plan_hash?: string
          source?: string
          started_at?: string
          status?: string
          stel_read_at?: string
          summary?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "stel_reconciliation_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      stel_sync_state: {
        Row: {
          company_id: string
          cursor_external_id: string | null
          cursor_modified_at: string | null
          entity: string
          last_calls: number
          last_error: string | null
          last_finished_at: string | null
          last_run_id: string | null
          last_started_at: string | null
          last_status: string
          last_summary: Json
          locked_at: string | null
          locked_by: string | null
        }
        Insert: {
          company_id: string
          cursor_external_id?: string | null
          cursor_modified_at?: string | null
          entity: string
          last_calls?: number
          last_error?: string | null
          last_finished_at?: string | null
          last_run_id?: string | null
          last_started_at?: string | null
          last_status?: string
          last_summary?: Json
          locked_at?: string | null
          locked_by?: string | null
        }
        Update: {
          company_id?: string
          cursor_external_id?: string | null
          cursor_modified_at?: string | null
          entity?: string
          last_calls?: number
          last_error?: string | null
          last_finished_at?: string | null
          last_run_id?: string | null
          last_started_at?: string | null
          last_status?: string
          last_summary?: Json
          locked_at?: string | null
          locked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stel_sync_state_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stel_sync_state_last_run_id_fkey"
            columns: ["last_run_id"]
            isOneToOne: false
            referencedRelation: "stel_reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_balances: {
        Row: {
          company_id: string
          on_hand: number
          product_id: string
          reserved: number
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          company_id: string
          on_hand?: number
          product_id: string
          reserved?: number
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          company_id?: string
          on_hand?: number
          product_id?: string
          reserved?: number
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: number
          movement_type: string
          notes: string | null
          product_id: string
          quantity: number
          source_id: string | null
          source_type: string | null
          warehouse_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: never
          movement_type: string
          notes?: string | null
          product_id: string
          quantity: number
          source_id?: string | null
          source_type?: string | null
          warehouse_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: never
          movement_type?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          source_id?: string | null
          source_type?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_reservations: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          notes: string | null
          product_id: string
          quantity: number
          source_id: string | null
          source_type: string
          warehouse_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          notes?: string | null
          product_id: string
          quantity: number
          source_id?: string | null
          source_type: string
          warehouse_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          source_id?: string | null
          source_type?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_reservations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_invoice_lines: {
        Row: {
          company_id: string
          created_at: string
          description_snapshot: string | null
          discount_pct: number
          goods_receipt_line_id: string | null
          id: string
          line_no: number
          line_total: number
          line_type: string
          product_id: string | null
          purchase_order_line_id: string | null
          quantity: number
          sku_snapshot: string | null
          supplier_invoice_id: string
          tax_rate_snapshot: number | null
          tax_treatment: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          description_snapshot?: string | null
          discount_pct?: number
          goods_receipt_line_id?: string | null
          id?: string
          line_no: number
          line_total?: number
          line_type?: string
          product_id?: string | null
          purchase_order_line_id?: string | null
          quantity: number
          sku_snapshot?: string | null
          supplier_invoice_id: string
          tax_rate_snapshot?: number | null
          tax_treatment?: string
          unit_price: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          description_snapshot?: string | null
          discount_pct?: number
          goods_receipt_line_id?: string | null
          id?: string
          line_no?: number
          line_total?: number
          line_type?: string
          product_id?: string | null
          purchase_order_line_id?: string | null
          quantity?: number
          sku_snapshot?: string | null
          supplier_invoice_id?: string
          tax_rate_snapshot?: number | null
          tax_treatment?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_invoice_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoice_lines_goods_receipt_line_id_fkey"
            columns: ["goods_receipt_line_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoice_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoice_lines_purchase_order_line_id_fkey"
            columns: ["purchase_order_line_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoice_lines_supplier_invoice_id_fkey"
            columns: ["supplier_invoice_id"]
            isOneToOne: false
            referencedRelation: "supplier_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_invoices: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          currency_code: string
          due_date: string | null
          exchange_rate: number | null
          id: string
          invoice_date: string
          notes: string | null
          number: string
          payment_terms: string | null
          series_code: string
          status: string
          subtotal: number
          supplier_id: string
          supplier_number: string | null
          tax_amount: number
          total: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          currency_code: string
          due_date?: string | null
          exchange_rate?: number | null
          id?: string
          invoice_date: string
          notes?: string | null
          number: string
          payment_terms?: string | null
          series_code?: string
          status?: string
          subtotal?: number
          supplier_id: string
          supplier_number?: string | null
          tax_amount?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string
          due_date?: string | null
          exchange_rate?: number | null
          id?: string
          invoice_date?: string
          notes?: string | null
          number?: string
          payment_terms?: string | null
          series_code?: string
          status?: string
          subtotal?: number
          supplier_id?: string
          supplier_number?: string | null
          tax_amount?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoices_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "supplier_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoices_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          activity: string | null
          address_text: string | null
          agent: string | null
          company_id: string
          country_code: string | null
          created_at: string
          created_by: string | null
          default_currency: string | null
          deleted_at: string | null
          email: string | null
          id: string
          imported_at: string | null
          legacy_ref: string | null
          legacy_source: string | null
          legal_name: string
          needs_review: boolean
          notes: string | null
          payment_terms: string | null
          phone: string | null
          review_reason: string | null
          status: string
          tax_id: string | null
          trade_name: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          activity?: string | null
          address_text?: string | null
          agent?: string | null
          company_id: string
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          default_currency?: string | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          imported_at?: string | null
          legacy_ref?: string | null
          legacy_source?: string | null
          legal_name: string
          needs_review?: boolean
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          review_reason?: string | null
          status?: string
          tax_id?: string | null
          trade_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          activity?: string | null
          address_text?: string | null
          agent?: string | null
          company_id?: string
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          default_currency?: string | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          imported_at?: string | null
          legacy_ref?: string | null
          legacy_source?: string | null
          legal_name?: string
          needs_review?: boolean
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          review_reason?: string | null
          status?: string
          tax_id?: string | null
          trade_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_default_currency_fkey"
            columns: ["default_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "suppliers_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      users_audit: {
        Row: {
          action: string
          actor_id: string | null
          company_id: string
          created_at: string
          from_role: string | null
          from_status: string | null
          id: number
          membership_id: string
          target_user_id: string | null
          to_role: string | null
          to_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          company_id: string
          created_at?: string
          from_role?: string | null
          from_status?: string | null
          id?: never
          membership_id: string
          target_user_id?: string | null
          to_role?: string | null
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          company_id?: string
          created_at?: string
          from_role?: string | null
          from_status?: string | null
          id?: never
          membership_id?: string
          target_user_id?: string | null
          to_role?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_audit_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          code: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_accounts: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          display_name: string | null
          display_phone_number: string
          id: string
          phone_number_id: string | null
          provider: string
          updated_at: string
          waba_id: string | null
        }
        Insert: {
          active?: boolean
          company_id: string
          created_at?: string
          display_name?: string | null
          display_phone_number: string
          id?: string
          phone_number_id?: string | null
          provider?: string
          updated_at?: string
          waba_id?: string | null
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          display_name?: string | null
          display_phone_number?: string
          id?: string
          phone_number_id?: string | null
          provider?: string
          updated_at?: string
          waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      // Fase 16 · E2: la capa de IA de WhatsApp.
      whatsapp_ai_analysis_queue: {
        Row: {
          attempts: number
          company_id: string
          conversation_id: string
          created_at: string
          done_at: string | null
          last_error: string | null
          last_processed_message_id: string | null
          lock_requested_at: string | null
          locked_at: string | null
          locked_by: string | null
          not_before: string
          requested_at: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          company_id: string
          conversation_id: string
          created_at?: string
          done_at?: string | null
          last_error?: string | null
          last_processed_message_id?: string | null
          lock_requested_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          not_before?: string
          requested_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          company_id?: string
          conversation_id?: string
          created_at?: string
          done_at?: string | null
          last_error?: string | null
          last_processed_message_id?: string | null
          lock_requested_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          not_before?: string
          requested_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_ai_analysis_queue_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_ai_analysis_queue_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_ai_items: {
        Row: {
          actor: string
          assigned_user_id: string | null
          company_id: string
          confidence: number
          conversation_id: string
          description: string
          due_at: string | null
          fingerprint: string
          generated_at: string
          id: string
          model: string | null
          resolved_at: string | null
          resolved_by: string | null
          source_message_ids: string[]
          status: string
          type: string
        }
        Insert: {
          actor?: string
          assigned_user_id?: string | null
          company_id: string
          confidence: number
          conversation_id: string
          description: string
          due_at?: string | null
          fingerprint: string
          generated_at?: string
          id?: string
          model?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_message_ids: string[]
          status?: string
          type: string
        }
        Update: {
          actor?: string
          assigned_user_id?: string | null
          company_id?: string
          confidence?: number
          conversation_id?: string
          description?: string
          due_at?: string | null
          fingerprint?: string
          generated_at?: string
          id?: string
          model?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_message_ids?: string[]
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_ai_items_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_ai_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_ai_items_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_ai_items_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_ai_reports: {
        Row: {
          company_id: string
          generated_at: string
          id: number
          payload: Json
          period_end: string
          period_start: string
          source_cutoff: string
          type: string
          version: number
        }
        Insert: {
          company_id: string
          generated_at?: string
          id?: never
          payload: Json
          period_end: string
          period_start: string
          source_cutoff: string
          type: string
          version?: number
        }
        Update: {
          company_id?: string
          generated_at?: string
          id?: never
          payload?: Json
          period_end?: string
          period_start?: string
          source_cutoff?: string
          type?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_ai_reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_ai_runs: {
        Row: {
          cached_tokens: number | null
          company_id: string
          conversation_id: string
          created_at: string
          duration_ms: number | null
          error_code: string | null
          estimated_cost_usd: number | null
          id: number
          input_tokens: number | null
          items_discarded: number
          items_saved: number
          messages_sent: number
          model: string | null
          output_tokens: number | null
          provider: string | null
          reasoning_tokens: number | null
          requested_by: string | null
          status: string
        }
        Insert: {
          cached_tokens?: number | null
          company_id: string
          conversation_id: string
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          estimated_cost_usd?: number | null
          id?: never
          input_tokens?: number | null
          items_discarded?: number
          items_saved?: number
          messages_sent?: number
          model?: string | null
          output_tokens?: number | null
          provider?: string | null
          reasoning_tokens?: number | null
          requested_by?: string | null
          status: string
        }
        Update: {
          cached_tokens?: number | null
          company_id?: string
          conversation_id?: string
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          estimated_cost_usd?: number | null
          id?: never
          input_tokens?: number | null
          items_discarded?: number
          items_saved?: number
          messages_sent?: number
          model?: string | null
          output_tokens?: number | null
          provider?: string | null
          reasoning_tokens?: number | null
          requested_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_ai_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_ai_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_ai_runs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_ai_settings: {
        Row: {
          analysis_debounce_seconds: number
          auto_analyze: boolean
          company_id: string
          daily_report_enabled: boolean
          daily_report_time: string | null
          enabled: boolean
          max_daily_analyses: number | null
          max_daily_cost_usd: number | null
          timezone: string
          updated_at: string
          updated_by: string | null
          weekly_report_day: number | null
          weekly_report_enabled: boolean
          weekly_report_time: string | null
        }
        Insert: {
          analysis_debounce_seconds?: number
          auto_analyze?: boolean
          company_id: string
          daily_report_enabled?: boolean
          daily_report_time?: string | null
          enabled?: boolean
          max_daily_analyses?: number | null
          max_daily_cost_usd?: number | null
          timezone?: string
          updated_at?: string
          updated_by?: string | null
          weekly_report_day?: number | null
          weekly_report_enabled?: boolean
          weekly_report_time?: string | null
        }
        Update: {
          analysis_debounce_seconds?: number
          auto_analyze?: boolean
          company_id?: string
          daily_report_enabled?: boolean
          daily_report_time?: string | null
          enabled?: boolean
          max_daily_analyses?: number | null
          max_daily_cost_usd?: number | null
          timezone?: string
          updated_at?: string
          updated_by?: string | null
          weekly_report_day?: number | null
          weekly_report_enabled?: boolean
          weekly_report_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_ai_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_ai_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversation_ai_summary: {
        Row: {
          analyses_count: number
          company_id: string
          conversation_id: string
          conversation_state: string | null
          generated_at: string | null
          last_analyzed_message_at: string | null
          last_analyzed_message_id: string | null
          last_error: string | null
          model: string | null
          requires_attention: boolean
          status: string
          summary: string | null
          topics: string[]
          updated_at: string
        }
        Insert: {
          analyses_count?: number
          company_id: string
          conversation_id: string
          conversation_state?: string | null
          generated_at?: string | null
          last_analyzed_message_at?: string | null
          last_analyzed_message_id?: string | null
          last_error?: string | null
          model?: string | null
          requires_attention?: boolean
          status?: string
          summary?: string | null
          topics?: string[]
          updated_at?: string
        }
        Update: {
          analyses_count?: number
          company_id?: string
          conversation_id?: string
          conversation_state?: string | null
          generated_at?: string | null
          last_analyzed_message_at?: string | null
          last_analyzed_message_id?: string | null
          last_error?: string | null
          model?: string | null
          requires_attention?: boolean
          status?: string
          summary?: string | null
          topics?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversation_ai_summary_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversation_ai_summary_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversation_participants: {
        Row: {
          company_id: string
          conversation_id: string
          display_name: string | null
          first_seen_at: string
          id: string
          last_seen_at: string
          left_at: string | null
          wa_id: string
        }
        Insert: {
          company_id: string
          conversation_id: string
          display_name?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          left_at?: string | null
          wa_id: string
        }
        Update: {
          company_id?: string
          conversation_id?: string
          display_name?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          left_at?: string | null
          wa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversation_participants_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversation_reads: {
        Row: {
          conversation_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversation_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversation_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversations: {
        Row: {
          account_id: string
          archived_at: string | null
          assigned_to: string | null
          company_id: string
          conversation_type: string
          created_at: string
          customer_contact_id: string | null
          customer_id: string | null
          group_name: string | null
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          last_message_dir: string | null
          last_message_preview: string | null
          last_outbound_at: string | null
          phone_e164: string | null
          phone_raw: string | null
          profile_name: string | null
          provider_contact_id: string
          provider_group_id: string | null
          service_window_expires_at: string | null
          updated_at: string
          vinculo_origen: string | null
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          assigned_to?: string | null
          company_id: string
          conversation_type?: string
          created_at?: string
          customer_contact_id?: string | null
          customer_id?: string | null
          group_name?: string | null
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_message_dir?: string | null
          last_message_preview?: string | null
          last_outbound_at?: string | null
          phone_e164?: string | null
          phone_raw?: string | null
          profile_name?: string | null
          provider_contact_id: string
          provider_group_id?: string | null
          service_window_expires_at?: string | null
          updated_at?: string
          vinculo_origen?: string | null
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          assigned_to?: string | null
          company_id?: string
          conversation_type?: string
          created_at?: string
          customer_contact_id?: string | null
          customer_id?: string | null
          group_name?: string | null
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_message_dir?: string | null
          last_message_preview?: string | null
          last_outbound_at?: string | null
          phone_e164?: string | null
          phone_raw?: string | null
          profile_name?: string | null
          provider_contact_id?: string
          provider_group_id?: string | null
          service_window_expires_at?: string | null
          updated_at?: string
          vinculo_origen?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_customer_contact_id_fkey"
            columns: ["customer_contact_id"]
            isOneToOne: false
            referencedRelation: "customer_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_group_allowlist: {
        Row: {
          account_id: string
          ai_enabled: boolean
          company_id: string
          created_at: string
          created_by: string | null
          enabled: boolean
          group_name: string | null
          id: string
          notes: string | null
          provider_group_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          ai_enabled?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          group_name?: string | null
          id?: string
          notes?: string | null
          provider_group_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          ai_enabled?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          group_name?: string | null
          id?: string
          notes?: string | null
          provider_group_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_group_allowlist_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_group_allowlist_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_group_allowlist_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_media: {
        Row: {
          attempts: number
          company_id: string
          conversation_id: string
          created_at: string
          downloaded_at: string | null
          error_details: string | null
          file_name: string | null
          id: string
          media_expires_at: string
          message_id: string | null
          mime_type: string
          provider_expires_at: string | null
          provider_media_id: string | null
          sha256: string | null
          size_bytes: number | null
          status: string
          storage_path: string | null
        }
        Insert: {
          attempts?: number
          company_id: string
          conversation_id: string
          created_at?: string
          downloaded_at?: string | null
          error_details?: string | null
          file_name?: string | null
          id?: string
          media_expires_at?: string
          message_id?: string | null
          mime_type: string
          provider_expires_at?: string | null
          provider_media_id?: string | null
          sha256?: string | null
          size_bytes?: number | null
          status?: string
          storage_path?: string | null
        }
        Update: {
          attempts?: number
          company_id?: string
          conversation_id?: string
          created_at?: string
          downloaded_at?: string | null
          error_details?: string | null
          file_name?: string | null
          id?: string
          media_expires_at?: string
          message_id?: string | null
          mime_type?: string
          provider_expires_at?: string | null
          provider_media_id?: string | null
          sha256?: string | null
          size_bytes?: number | null
          status?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_media_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_media_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_media_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          account_id: string
          attempts: number
          caption: string | null
          claimed_at: string | null
          client_request_id: string | null
          company_id: string
          conversation_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by_wa_id: string | null
          delivered_at: string | null
          direction: string
          edited_at: string | null
          error_code: number | null
          error_details: string | null
          estado_visible: string | null
          failed_at: string | null
          id: string
          media_id: string | null
          message_type: string
          next_attempt_at: string | null
          ordenado_en: string | null
          provider_message_id: string | null
          provider_status: string | null
          provider_timestamp: string | null
          read_at: string | null
          received_at: string | null
          reply_to_provider_id: string | null
          sender_name: string | null
          sender_wa_id: string | null
          sent_at: string | null
          status: string
          text_body: string | null
        }
        Insert: {
          account_id: string
          attempts?: number
          caption?: string | null
          claimed_at?: string | null
          client_request_id?: string | null
          company_id: string
          conversation_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by_wa_id?: string | null
          delivered_at?: string | null
          direction: string
          edited_at?: string | null
          error_code?: number | null
          error_details?: string | null
          estado_visible?: string | null
          failed_at?: string | null
          id?: string
          media_id?: string | null
          message_type: string
          next_attempt_at?: string | null
          ordenado_en?: string | null
          provider_message_id?: string | null
          provider_status?: string | null
          provider_timestamp?: string | null
          read_at?: string | null
          received_at?: string | null
          reply_to_provider_id?: string | null
          sender_name?: string | null
          sender_wa_id?: string | null
          sent_at?: string | null
          status?: string
          text_body?: string | null
        }
        Update: {
          account_id?: string
          attempts?: number
          caption?: string | null
          claimed_at?: string | null
          client_request_id?: string | null
          company_id?: string
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by_wa_id?: string | null
          delivered_at?: string | null
          direction?: string
          edited_at?: string | null
          error_code?: number | null
          error_details?: string | null
          estado_visible?: string | null
          failed_at?: string | null
          id?: string
          media_id?: string | null
          message_type?: string
          next_attempt_at?: string | null
          ordenado_en?: string | null
          provider_message_id?: string | null
          provider_status?: string | null
          provider_timestamp?: string | null
          read_at?: string | null
          received_at?: string | null
          reply_to_provider_id?: string | null
          sender_name?: string | null
          sender_wa_id?: string | null
          sent_at?: string | null
          status?: string
          text_body?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_media"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_webhook_events: {
        Row: {
          account_id: string | null
          error_details: string | null
          event_type: string | null
          id: number
          payload: Json
          processed_at: string | null
          provider_event_id: string | null
          received_at: string
          signature_ok: boolean
        }
        Insert: {
          account_id?: string | null
          error_details?: string | null
          event_type?: string | null
          id?: number
          payload: Json
          processed_at?: string | null
          provider_event_id?: string | null
          received_at?: string
          signature_ok: boolean
        }
        Update: {
          account_id?: string | null
          error_details?: string | null
          event_type?: string | null
          id?: number
          payload?: Json
          processed_at?: string | null
          provider_event_id?: string | null
          received_at?: string
          signature_ok?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_webhook_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      product_availability: {
        Row: {
          company_id: string | null
          is_available: boolean | null
          product_id: string | null
          warehouse_id: string | null
        }
        Insert: {
          company_id?: string | null
          is_available?: never
          product_id?: string | null
          warehouse_id?: string | null
        }
        Update: {
          company_id?: string | null
          is_available?: never
          product_id?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      revision_de_documentos: {
        Row: {
          active_reasons: string[] | null
          company_id: string | null
          doc_type: string | null
          document_id: string | null
          fecha: string | null
          historical_reasons: string[] | null
          marked_in_migration: boolean | null
          numero: string | null
          requires_attention_now: boolean | null
          resolved_since_migration: string[] | null
          tipo: string | null
          unverifiable_reasons: string[] | null
        }
        Relationships: []
      }
    }
    Functions: {
      _preflight: {
        Args: never
        Returns: {
          control: string
          detalle: string
          estado: string
        }[]
      }
      _verificar_datos: {
        Args: { p_tablas?: string[] }
        Returns: {
          coincide: boolean
          filas_destino: number
          filas_origen: number
          huella_destino: string
          huella_origen: string
          nombre_tabla: string
        }[]
      }
      abierta: {
        Args: { q: Database["public"]["Tables"]["sales_quotes"]["Row"] }
        Returns: boolean
      }
      abrir_chat_directo: {
        Args: { p_company: string; p_otro: string }
        Returns: string
      }
      actividad_mensual_cliente: {
        Args: { p_customer: string; p_meses?: number | null }
        Returns: {
          documentos: number
          importe: number
          mes: string
          moneda: string | null
          tipo: string
        }[]
      }
      anular_entrega: { Args: { p_delivery: string }; Returns: Json }
      buscar_clientes: {
        Args: {
          p_company: string
          p_incluir_inactivos?: boolean
          p_limite?: number
          p_texto: string
        }
        Returns: {
          cuit: string | null
          dado_de_baja: boolean
          id: string
          nombre: string
          rango: number
          razon_social: string | null
          referencia: string | null
        }[]
      }
      informe_conversion_por_cliente: {
        Args: {
          p_company: string
          p_desplazamiento?: number
          p_limite?: number
          p_mes?: string | null
          p_minimo?: number
          p_moneda?: string | null
          p_orden?: string
          p_periodo?: string
        }
        Returns: {
          abiertas: number
          cliente: string
          convertidas: number
          cotizaciones: number
          customer_id: string
          importe_convertido: number | null
          importe_cotizado: number | null
          referencia: string | null
          tasa: number | null
          total_filas: number
          ultima_cotizacion: string | null
          ultimo_pedido: string | null
        }[]
      }
      guardar_contactos_documento: {
        Args: {
          p_documento: string
          p_principal?: string | null
          p_secundarios?: string[]
          p_tipo: string
        }
        Returns: Json
      }
      borrar_con_motivo: {
        Args: { p_entidad: string; p_id: string; p_motivo: string }
        Returns: Json
      }
      registrar_borrado: {
        Args: { p_accion?: string; p_entidad: string; p_id: string; p_motivo: string }
        Returns: Json
      }
      aprobar_cotizacion_mantenimiento: {
        Args: { p_order: string; p_por?: string | null }
        Returns: Json
      }
      asignar_conversacion_whatsapp: {
        Args: { p_conversacion: string; p_usuario?: string | null }
        Returns: {
          account_id: string
          archived_at: string | null
          assigned_to: string | null
          company_id: string
          conversation_type: string
          created_at: string
          customer_contact_id: string | null
          customer_id: string | null
          group_name: string | null
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          last_message_dir: string | null
          last_message_preview: string | null
          last_outbound_at: string | null
          phone_e164: string | null
          phone_raw: string | null
          profile_name: string | null
          provider_contact_id: string
          provider_group_id: string | null
          service_window_expires_at: string | null
          updated_at: string
          vinculo_origen: string | null
        }
        SetofOptions: {
          from: "*"
          to: "whatsapp_conversations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      // ── Emails (fase 9) ──────────────────────────────────────────────
      asignar_hilo_email: {
        Args: { p_account: string; p_thread: string; p_usuario?: string | null }
        Returns: {
          account_id: string
          assigned_to: string | null
          company_id: string
          created_at: string
          customer_contact_id: string | null
          customer_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          gmail_thread_id: string
          id: string
          internal_note: string | null
          updated_at: string
          vinculo_origen: string | null
          workflow_status: string
        }
        SetofOptions: {
          from: "*"
          to: "email_thread_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      asistente_buscar_cliente: {
        Args: { p_company: string; p_texto: string }
        Returns: Json
      }
      asistente_buscar_documentos: {
        Args: {
          p_cliente?: string
          p_company: string
          p_desde?: string
          p_estado?: string
          p_hasta?: string
          p_limite?: number
          p_moneda?: string
          p_orden?: string
          p_tipo: string
        }
        Returns: Json
      }
      asistente_buscar_emails: {
        Args: {
          p_company: string
          p_limite?: number
          p_sin_leer?: boolean
          p_texto?: string
        }
        Returns: Json
      }
      asistente_buscar_productos: {
        Args: { p_company: string; p_limite?: number; p_texto: string }
        Returns: Json
      }
      asistente_ficha_producto: {
        Args: { p_company: string; p_sku: string }
        Returns: Json
      }
      asistente_historial_cliente: {
        Args: { p_cliente: string; p_company: string; p_limite?: number }
        Returns: Json
      }
      asistente_precios_cliente: {
        Args: { p_cliente: string; p_company: string; p_producto?: string }
        Returns: Json
      }
      asistente_preparar_cotizacion: {
        Args: {
          p_cliente: string
          p_company: string
          p_moneda?: string
          p_productos: Json
        }
        Returns: Json
      }
      asistente_ranking: {
        Args: {
          p_company: string
          p_dimension: string
          p_limite?: number
          p_medida?: string
          p_mes?: string
          p_moneda?: string
        }
        Returns: Json
      }
      asistente_resumen_catalogo: { Args: { p_company: string }; Returns: Json }
      asistente_stock: {
        Args: { p_company: string; p_limite?: number; p_texto?: string }
        Returns: Json
      }
      asistente_ultimo_costo: {
        Args: { p_company: string; p_sku: string }
        Returns: Json
      }
      asistente_ver_documento: {
        Args: { p_company: string; p_numero: string }
        Returns: Json
      }
      // Entrega 5. SECURITY INVOKER: un rol sin acceso a Emails no ve el historial.
      autocompletar_destinatarios_email: {
        Args: { p_company: string; p_q: string }
        Returns: {
          cliente_id: string | null
          cliente_nombre: string | null
          clientes: number
          direccion: string
          fuente: string
          nombre: string | null
        }[]
      }
      autoridad_numeracion_empresa: {
        Args: { p_company: string }
        Returns: {
          authority: string
          doc_type: string
        }[]
      }
      autoridad_numeracion_series: {
        Args: { p_company: string }
        Returns: {
          authority: string
          doc_type: string
          reason: string
          series_code: string
        }[]
      }
      avanzar_history_email: {
        Args: { p_account: string; p_full_sync?: boolean | null; p_history_id: string }
        Returns: {
          active: boolean
          auth_mode: string
          company_id: string
          created_at: string
          display_name: string | null
          email_address: string
          id: string
          last_full_sync_at: string | null
          last_history_id: string | null
          last_synced_at: string | null
          provider: string
          sync_error: string | null
          sync_error_at: string | null
          sync_lock_owner: string | null
          sync_lock_until: string | null
          updated_at: string
          watch_expiration: string | null
          watch_topic: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "email_accounts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      borrar_contacto: { Args: { p_contacto: string; p_motivo: string }; Returns: Json }
      borrar_direccion: { Args: { p_direccion: string; p_motivo: string }; Returns: Json }
      borrar_etiqueta_email: { Args: { p_label: string }; Returns: undefined }
      borrar_mensaje_grupo_whatsapp: {
        Args: {
          p_account: string
          p_deleted_at: string
          p_deleted_by?: string
          p_provider_message_id: string
        }
        Returns: Json
      }
      cadena_de_documento: {
        Args: { p_id: string; p_tipo: string }
        Returns: Json
      }
      cambiar_estado_email: {
        Args: { p_account: string; p_estado: string; p_thread: string }
        Returns: {
          account_id: string
          assigned_to: string | null
          company_id: string
          created_at: string
          customer_contact_id: string | null
          customer_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          gmail_thread_id: string
          id: string
          internal_note: string | null
          updated_at: string
          vinculo_origen: string | null
          workflow_status: string
        }
        SetofOptions: {
          from: "*"
          to: "email_thread_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancelar_orden_mantenimiento: {
        Args: { p_motivo?: string | null; p_order: string }
        Returns: Json
      }
      capacidad_torque: { Args: { p_order: string }; Returns: Json }
      catalog_facets: {
        Args: {
          p_attrs?: Json
          p_brand?: string
          p_category?: string
          p_company: string
          p_query?: string
          p_ranges?: Json
          p_series?: string[]
          p_solo_catalogo?: boolean
          p_type?: string[]
        }
        Returns: Json
      }
      cerrar_orden_mantenimiento: { Args: { p_order: string }; Returns: Json }
      clave_api_email_servicio: { Args: never; Returns: string }
      clientes_similares: {
        Args: {
          p_company: string
          p_cuit?: string | null
          p_email?: string | null
          p_excluir?: string | null
          p_limite?: number
          p_nombre?: string | null
          p_telefono?: string | null
        }
        Returns: {
          deleted_at: string | null
          emails: string[] | null
          fuerza: string
          id: string
          legacy_ref: string | null
          legal_name: string
          motivo: string
          needs_review: boolean
          parecido: number
          phone: string | null
          tax_id: string | null
          trade_name: string | null
        }[]
      }
      completar_analisis_whatsapp: {
        Args: {
          p_ahora?: string
          p_codigo?: string
          p_conversacion: string
          p_locked_at: string
          p_resultado: string
        }
        Returns: string
      }
      completar_envio_email: {
        Args: {
          p_error: string | null
          p_estado: string
          p_firma: string
          p_message_id: string | null
          p_request: string
          p_thread_id: string | null
        }
        Returns: {
          gmail_message_id: string | null
          gmail_thread_id: string | null
          id: string
          status: string
        }[]
      }
      config_atributos_listar: {
        Args: { p_company: string }
        Returns: {
          categorias: string[]
          data_type: string
          is_filterable: boolean
          key: string
          label: string
          position: number
          productos: number
          unit: string | null
        }[]
      }
      config_auditar_reenvio: {
        Args: { p_actor: string; p_membership: string }
        Returns: undefined
      }
      config_auditoria_actores: {
        Args: { p_company: string }
        Returns: {
          actor_id: string
          email: string | null
          eventos: number
          nombre: string | null
        }[]
      }
      config_auditoria_listar: {
        Args: {
          p_actor?: string | null
          p_company: string
          p_desde?: string | null
          p_desplazamiento?: number
          p_evento?: string | null
          p_hasta?: string | null
          p_limite?: number
          p_modulo?: string | null
          p_texto?: string | null
        }
        Returns: {
          actor: Json | null
          detalles: Json
          entidad_existe: boolean
          entidad_id: string | null
          entidad_nombre: string | null
          entidad_tipo: string
          evento: string
          evento_id: number
          fecha: string
          modulo: string
          origen: string
          total: number
        }[]
      }
      config_cambiar_estado: {
        Args: { p_estado: string; p_membership: string }
        Returns: {
          estado: string
          membership_id: string
          rol: string
        }[]
      }
      config_cambiar_rol: {
        Args: { p_membership: string; p_rol: string }
        Returns: {
          estado: string
          membership_id: string
          rol: string
        }[]
      }
      config_categoria_crear: {
        Args: { p_company: string; p_datos: Json }
        Returns: {
          id: string
          name: string
          slug: string
        }[]
      }
      config_categoria_eliminar: {
        Args: { p_categoria: string; p_company: string }
        Returns: {
          eliminada: boolean
        }[]
      }
      config_categoria_estado: {
        Args: { p_activa: boolean; p_categoria: string; p_company: string }
        Returns: {
          cambiado: boolean
          is_active: boolean
          productos: number
        }[]
      }
      config_categoria_renombrar: {
        Args: {
          p_categoria: string
          p_company: string
          p_datos: Json
          p_esperado: string
        }
        Returns: {
          cambiado: boolean
          name: string
        }[]
      }
      config_categorias_listar: {
        Args: { p_company: string }
        Returns: {
          atributos: number
          id: string
          is_active: boolean
          name: string
          needs_review: boolean
          parent_id: string | null
          position: number
          productos: number
          puede_editar: boolean
          slug: string
          subcategorias: number
        }[]
      }
      config_empresa_actualizar: {
        Args: { p_company: string; p_datos: Json; p_esperado: string }
        Returns: {
          campos: string[]
          updated_at: string
        }[]
      }
      config_empresa_logo_precheck: {
        Args: { p_actor: string; p_company: string; p_esperado: string }
        Returns: string
      }
      config_empresa_logo_registrar: {
        Args: {
          p_actor: string
          p_company: string
          p_esperado: string
          p_path: string
        }
        Returns: {
          logo_anterior: string
          logo_path: string
          updated_at: string
        }[]
      }
      // Entrega 4. Las tres son de lectura; la primera y la segunda son
      // SECURITY INVOKER, la tercera DEFINER acotada a quien usa Emails.
      // Fase 12 · Configuración → Usuarios. Sólo admin de la empresa (la RPC lo
      // valida). Las de invitación son de la Edge Function y no se tipan acá.
      // Fase 12 E2 · Empresa y numeración. Admin/employee leen; sólo admin edita.
      config_empresa_obtener: {
        Args: { p_company: string }
        Returns: {
          address: string | null
          brand_color: string | null
          default_currency: string
          email: string | null
          id: string
          is_active: boolean
          legal_name: string | null
          logo_path: string | null
          name: string
          phone: string | null
          puede_editar: boolean
          slug: string
          tax_id: string | null
          updated_at: string
          website: string | null
        }[]
      }
      config_ia_whatsapp: { Args: { p_company: string }; Returns: Json }
      config_lista_precios_clientes: {
        Args: { p_company: string; p_lista: string }
        Returns: {
          id: string
          legal_name: string
          total: number
        }[]
      }
      config_lista_precios_items: {
        Args: {
          p_busqueda?: string | null
          p_company: string
          p_desplazamiento?: number
          p_limite?: number
          p_lista: string
          p_vigencia?: string
        }
        Returns: {
          amount: number
          marca: string | null
          name: string
          price_id: string
          product_id: string
          producto_estado: string
          sku: string
          total: number
          valid_from: string
          valid_to: string | null
          vigencia: string
        }[]
      }
      config_listar_usuarios: {
        Args: { p_company: string }
        Returns: {
          alta: string
          bloqueada: boolean
          cliente: string | null
          email: string
          email_confirmado: boolean
          es_propia: boolean
          estado: string
          invitado_el: string | null
          membership_id: string
          nombre: string | null
          rol: string
          ultimo_ingreso: string | null
          user_id: string
        }[]
      }
      config_listas_precios_listar: {
        Args: { p_company: string }
        Returns: {
          clientes: number
          created_at: string
          currency_code: string
          id: string
          is_default: boolean
          items: number
          items_vigentes: number
          name: string
          precios_cero: number
          valid_from: string | null
          valid_to: string | null
          vigencia_desde: string | null
          vigencia_hasta: string | null
        }[]
      }
      config_marca_crear: {
        Args: { p_company: string; p_datos: Json }
        Returns: {
          id: string
          name: string
        }[]
      }
      config_marca_eliminar: {
        Args: { p_company: string; p_marca: string }
        Returns: {
          eliminada: boolean
        }[]
      }
      config_marca_estado: {
        Args: { p_activa: boolean; p_company: string; p_marca: string }
        Returns: {
          cambiado: boolean
          is_active: boolean
          productos: number
        }[]
      }
      config_marcas_listar: {
        Args: { p_company: string }
        Returns: {
          created_at: string
          equipos: number
          id: string
          is_active: boolean
          name: string
          productos: number
          puede_editar: boolean
        }[]
      }
      config_numeracion_diagnostico: {
        Args: { p_company: string }
        Returns: {
          atipicos_por_encima: number
          autoridad: string
          autoridad_configurada: boolean
          con_patron: number
          doc_type: string
          documentos: number
          estado: string
          fuera_patron: number
          is_default: boolean
          max_numero: number | null
          max_numero_sin_atipicos: number | null
          next_number: number
          padding: number
          prefix: string
          proximo: string
          series_code: string
        }[]
      }
      config_preparar_reenvio: {
        Args: { p_actor: string; p_membership: string }
        Returns: {
          company_id: string
          email: string
        }[]
      }
      config_registrar_miembro: {
        Args: {
          p_actor: string
          p_company: string
          p_evento: string
          p_nombre: string
          p_rol: string
          p_user: string
        }
        Returns: string
      }
      config_validar_invitacion: {
        Args: {
          p_actor: string
          p_company: string
          p_email: string
          p_rol: string
        }
        Returns: {
          bloqueada: boolean
          email: string
          email_confirmado: boolean
          invitacion_pendiente: boolean
          membership_estado: string
          membership_id: string
          user_id: string
        }[]
      }
      confirmar_consumo_mantenimiento: {
        Args: { p_order: string }
        Returns: Json
      }
      confirmar_entrega: { Args: { p_delivery: string }; Returns: Json }
      confirmar_recepcion: { Args: { p_receipt: string }; Returns: Json }
      contar_chats_sin_leer: { Args: { p_company: string }; Returns: number }
      convertir_cotizacion_en_pedido: {
        Args: { p_esperado?: string; p_quote: string }
        Returns: Json
      }
      convertir_cotizacion_en_pedido_en_serie: {
        Args: { p_esperado: string; p_quote: string; p_serie: string }
        Returns: Json
      }
      // Importar la OC del cliente (Fase 30). Ya NO estan escritas a mano: las
      // genera la CLI desde Sao Paulo. Los dos defectos que esta nota advertia
      // —`estado_servicio` y los null convertidos en undefined— siguen
      // existiendo, pero se arreglan para TODO el archivo de una vez, no
      // funcion por funcion: estan explicados en el encabezado.
      cotizaciones_para_oc: {
        Args: {
          p_company: string
          p_customer: string
          p_meses?: number
          p_productos: string[]
        }
        Returns: Json
      }
      crear_cliente: {
        Args: {
          p_company: string
          p_contacto?: Json | null
          p_datos: Json
          p_direccion?: Json | null
        }
        Returns: Json
      }
      crear_cotizacion: {
        Args: { p_cabecera: Json; p_company: string; p_lineas: Json }
        Returns: Json
      }
      crear_factura_desde_pedido: {
        Args: { p_fecha?: string; p_order: string; p_serie?: string }
        Returns: Json
      }
      crear_pedido: {
        Args: { p_cabecera: Json; p_company: string; p_lineas: Json }
        Returns: Json
      }
      crear_remito_desde_pedido: {
        Args: {
          p_esperado?: string
          p_fecha?: string
          p_lineas: Json
          p_order: string
          p_serie?: string
        }
        Returns: Json
      }
      documentos_comerciales: {
        Args: { p_company: string; p_desde: string; p_hasta: string }
        Returns: {
          cliente_id: string
          en_revision: boolean
          estado: string
          fecha: string
          id: string
          importe: number
          moneda: string
          numero: string
          origen: string
          serie: string
          tipo: string
        }[]
      }
      documentos_del_cliente: {
        Args: {
          p_customer: string
          p_limit?: number
          p_offset?: number
          p_tipo?: string | null
        }
        Returns: {
          documento_id: string
          estado: string | null
          fecha: string | null
          moneda: string | null
          numero: string | null
          tipo: string
          total: number | null
          total_filas: number
        }[]
      }
      duplicados_de_serial: {
        Args: { p_company: string; p_excluir?: string | null; p_serial: string }
        Returns: {
          created_at: string
          id: string
          model_text: string | null
          owner_customer_id: string | null
          reference: string
          serial_number: string | null
        }[]
      }
      duplicar_pedido_compra: { Args: { p_order: string }; Returns: string }
      editar_mensaje_grupo_whatsapp: {
        Args: {
          p_account: string
          p_edited_at: string
          p_provider_message_id: string
          p_text?: string
        }
        Returns: Json
      }
      eliminar_hilo_email: {
        Args: { p_account: string; p_eliminar?: boolean; p_thread: string }
        Returns: {
          account_id: string
          assigned_to: string | null
          company_id: string
          created_at: string
          customer_contact_id: string | null
          customer_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          gmail_thread_id: string
          id: string
          internal_note: string | null
          updated_at: string
          vinculo_origen: string | null
          workflow_status: string
        }
        SetofOptions: {
          from: "*"
          to: "email_thread_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      emparejar_cliente_de_oc: {
        Args: { p_company: string; p_cuit: string | null; p_nombre: string | null }
        Returns: Json
      }
      emparejar_lineas_de_oc: {
        Args: { p_company: string; p_customer: string; p_lineas: Json }
        Returns: Json
      }
      // Fase 16 · la llama la persona desde la Edge Function de envío; valida
      // al actor adentro, como asignar_conversacion_whatsapp.
      encolar_mensaje_whatsapp: {
        Args: {
          p_client_request_id: string
          p_conversacion: string
          p_texto: string
        }
        Returns: {
          account_id: string
          attempts: number
          caption: string | null
          claimed_at: string | null
          client_request_id: string | null
          company_id: string
          conversation_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by_wa_id: string | null
          delivered_at: string | null
          direction: string
          edited_at: string | null
          error_code: number | null
          error_details: string | null
          estado_visible: string | null
          failed_at: string | null
          id: string
          media_id: string | null
          message_type: string
          next_attempt_at: string | null
          ordenado_en: string | null
          provider_message_id: string | null
          provider_status: string | null
          provider_timestamp: string | null
          read_at: string | null
          received_at: string | null
          reply_to_provider_id: string | null
          sender_name: string | null
          sender_wa_id: string | null
          sent_at: string | null
          status: string
          text_body: string | null
        }
        SetofOptions: {
          from: "*"
          to: "whatsapp_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enviar_mensaje_chat: {
        Args: { p_conversacion: string; p_texto: string }
        Returns: {
          autor_id: string
          company_id: string
          conversacion_id: string
          created_at: string
          id: string
          texto: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_mensajes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      estado_ia_whatsapp: { Args: { p_company: string }; Returns: Json }
      estado_servicio: {
        Args: { a: Database["public"]["Tables"]["maintenance_assets"]["Row"] }
        Returns: string
      }
      estado_sync_email: { Args: { p_company: string }; Returns: Json }
      etiquetar_hilo_email: {
        Args: {
          p_account: string
          p_label: string
          p_poner?: boolean
          p_thread: string
        }
        Returns: undefined
      }
      generar_informe_whatsapp: {
        Args: {
          p_company: string
          p_desde: string
          p_hasta: string
          p_tipo: string
        }
        Returns: Json
      }
      generar_informes_programados_whatsapp: {
        Args: { p_ahora?: string }
        Returns: number
      }
      grupos_cuit_legacy: {
        Args: { p_customers: string[] }
        Returns: {
          cuit_normalizado: string
          customer_id: string
          fichas: Json
          legacy_tax_id_raw: string
        }[]
      }
      // Fase 16 · E2: IA e informes de WhatsApp.
      guardar_analisis_whatsapp: {
        Args: {
          p_conversacion: string
          p_hasta_mensaje: string
          p_metricas: Json
          p_modelo: string
          p_resultado: Json
        }
        Returns: Json
      }
      guardar_cliente: {
        Args: { p_customer: string; p_datos: Json; p_esperado: string }
        Returns: Json
      }
      guardar_config_ia_whatsapp: {
        Args: { p_company: string; p_config: Json; p_version: string }
        Returns: Json
      }
      guardar_contacto: {
        Args: {
          p_contacto: string | null
          p_customer: string
          p_datos: Json
          p_esperado: string | null
        }
        Returns: Json
      }
      // Fase 15 · E2. Guarda cabecera, lineas y auditoria de una cotizacion en
      // una transaccion. SECURITY DEFINER: valida al actor, el estado, la
      // concurrencia y cada campo adentro.
      guardar_cotizacion: {
        Args: {
          p_cabecera: Json
          p_esperado: string
          p_lineas: Json
          p_quote: string
        }
        Returns: Json
      }
      guardar_direccion: {
        Args: {
          p_customer: string
          p_datos: Json
          p_direccion: string | null
          p_esperado: string | null
        }
        Returns: Json
      }
      guardar_etiqueta_email: {
        Args: {
          p_color?: string
          p_company: string
          p_id?: string | null
          p_nombre: string
        }
        Returns: {
          color: string
          company_id: string
          creado_por: string | null
          created_at: string
          id: string
          nombre: string
        }
        SetofOptions: {
          from: "*"
          to: "email_labels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      guardar_mi_apariencia: { Args: { p_appearance: Json | null }; Returns: Json }
      guardar_pedido: {
        Args: {
          p_cabecera: Json
          p_esperado: string
          p_lineas: Json
          p_order: string
        }
        Returns: Json
      }
      guardar_remito: {
        Args: {
          p_cabecera: Json
          p_delivery: string
          p_esperado: string
          p_lineas: Json
        }
        Returns: Json
      }
      importar_oc: {
        Args: {
          p_cliente_leido?: Json
          p_company: string
          p_customer: string
          p_fecha: string | null
          p_lineas: Json
          p_moneda: string | null
          p_numero: string
          p_quote_id?: string | null
          p_raw_text?: string | null
        }
        Returns: Json
      }
      informe_actividad_comercial: {
        Args: { p_company: string; p_mes?: string | null }
        Returns: {
          desde: string | null
          documentos: number
          en_revision: number
          hasta: string | null
          importe: number
          mes: string
          moneda: string | null
          periodo: string
          tipo: string | null
        }[]
      }
      informe_documentos: {
        Args: {
          p_cliente?: string | null
          p_company: string
          p_desde: string
          p_estado?: string | null
          p_hasta: string
          p_limite?: number
          p_moneda?: string | null
          p_offset?: number
          p_origen?: string | null
          p_serie?: string | null
          p_tipo?: string | null
        }
        Returns: {
          cliente: string | null
          cliente_id: string | null
          en_revision: boolean
          estado: string
          fecha: string
          id: string
          importe: number
          moneda: string
          numero: string
          origen: string | null
          serie: string | null
          tipo: string
          total_filas: number
          total_importe: number
        }[]
      }
      informe_documentos_facetas: {
        Args: {
          p_company: string
          p_desde: string
          p_hasta: string
          p_moneda?: string | null
          p_tipo?: string | null
        }
        Returns: {
          dimension: string
          documentos: number
          valor: string
        }[]
      }
      informe_kardex_producto: {
        Args: {
          p_company: string
          p_deposito?: string | null
          p_desplazamiento?: number
          p_limite?: number
          p_orden?: string
          p_producto: string
        }
        Returns: {
          deposito: string | null
          deposito_codigo: string | null
          dia: string
          fecha: string
          inicia_con_apertura: boolean
          movement_type: string
          movimiento_id: number
          notas: string | null
          posicion: number
          quantity: number
          referencia: string | null
          saldo: number | null
          saldo_actual: number | null
          saldo_verificado: boolean
          sentido: string
          source_id: string | null
          source_type: string | null
          total_filas: number
          warehouse_id: string
        }[]
      }
      informe_movimientos_stock: {
        Args: {
          p_company: string
          p_deposito?: string | null
          p_desplazamiento?: number
          p_limite?: number
          p_mes?: string | null
          p_producto?: string | null
          p_sentido?: string | null
          p_tipo?: string | null
        }
        Returns: {
          deposito: string | null
          deposito_codigo: string | null
          desde: string
          dia: string
          fecha: string
          hasta: string
          movement_type: string
          movimiento_id: number
          notas: string | null
          posicion: number
          producto: string | null
          producto_activo: boolean | null
          producto_id: string
          quantity: number
          referencia: string | null
          sentido: string
          sku: string | null
          source_id: string | null
          source_type: string | null
          total_filas: number
          warehouse_id: string
        }[]
      }
      informe_pipeline_comercial: {
        Args: { p_company: string; p_mes?: string | null }
        Returns: {
          abiertas: number | null
          aceptadas: number | null
          categoria: string | null
          convertidas: number | null
          desde: string | null
          documentos: number
          hasta: string | null
          importe: number | null
          importe_convertido: number | null
          moneda: string | null
          periodo: string
          seccion: string
        }[]
      }
      informe_rankings_comerciales: {
        Args: {
          p_company: string
          p_desplazamiento?: number
          p_dimension?: string
          p_fuente?: string
          p_limite?: number
          p_medida?: string
          p_mes?: string | null
          p_moneda?: string | null
          p_periodo?: string
        }
        Returns: {
          activo: boolean | null
          cantidad: number | null
          cantidad_atipica: number | null
          clave: string
          cliente_id: string | null
          codigo: string | null
          desde: string
          documentos: number
          etiqueta: string
          hasta: string
          importe: number | null
          lineas_atipicas: number | null
          moneda: string | null
          posicion: number
          producto_id: string | null
          total_filas: number
          vinculado: boolean
        }[]
      }
      informe_stock_actual: {
        Args: {
          p_busqueda?: string | null
          p_company: string
          p_deposito?: string | null
          p_desplazamiento?: number
          p_estado?: string | null
          p_limite?: number
        }
        Returns: {
          available: number
          deposito: string
          deposito_codigo: string
          disponible_negativo: boolean
          estado: string
          on_hand: number
          posicion: number
          producto: string
          producto_activo: boolean
          producto_id: string
          reserved: number
          sku: string
          total_filas: number
          ultimo_movimiento: string | null
          warehouse_id: string
        }[]
      }
      informe_stock_catalogo: {
        Args: { p_company: string }
        Returns: {
          cantidad: number
          categoria: string
        }[]
      }
      informe_stock_resumen: {
        Args: { p_company: string; p_mes?: string | null }
        Returns: {
          activo: boolean | null
          cantidad: number
          categoria: string | null
          codigo: string | null
          deposito: string | null
          desde: string | null
          hasta: string | null
          seccion: string
          warehouse_id: string | null
        }[]
      }
      informe_whatsapp: {
        Args: {
          p_company: string
          p_desde: string
          p_hasta: string
          p_horas?: number
        }
        Returns: Json
      }
      ingresar_mensaje_grupo_whatsapp: {
        Args: {
          p_account: string
          p_direction: string
          p_group_id: string
          p_group_name?: string
          p_media?: Json
          p_message_type: string
          p_provider_message_id: string
          p_reply_to?: string
          p_sender_name?: string
          p_sender_wa_id: string
          p_sent_at: string
          p_text?: string
        }
        Returns: Json
      }
      listar_bandeja_email: {
        Args: {
          p_account?: string | null
          p_adjuntos?: boolean | null
          p_asignado?: string | null
          p_carpeta?: string | null
          p_cliente?: string | null
          p_company: string
          p_estado?: string | null
          p_etiqueta?: string | null
          p_excluir_resueltos?: boolean | null
          p_limite?: number | null
          p_offset?: number | null
          p_q?: string | null
          p_sin_leer?: boolean | null
          // Fase 40, agregados a mano (ver la nota al final de `Functions`).
          p_sin_responder?: boolean | null
        }
        Returns: {
          account_id: string
          assigned_name: string | null
          assigned_to: string | null
          customer_id: string | null
          customer_name: string | null
          eliminado: boolean
          etiquetas: Json
          gmail_thread_id: string
          has_attachments: boolean
          id: string
          last_message_at: string | null
          last_message_dir: string | null
          last_message_from: string | null
          message_count: number
          participants: string[]
          sin_leer: boolean
          snippet: string | null
          subject: string | null
          total: number
          total_sin_leer: number
          vinculo_origen: string | null
          workflow_status: string
        }[]
      }
      listar_chats: {
        Args: { p_company: string }
        Returns: {
          con_quien: string
          con_quien_id: string | null
          id: string | null
          sin_leer: number
          ultimo_mensaje: string | null
          ultimo_mensaje_en: string | null
        }[]
      }
      marcar_chat_leido: {
        Args: { p_conversacion: string }
        Returns: undefined
      }
      marcar_conversacion_leida_whatsapp: {
        Args: { p_conversacion: string }
        Returns: undefined
      }
      marcar_hilo_leido_email: {
        Args: { p_account: string; p_thread: string }
        Returns: undefined
      }
      metricas_ia_whatsapp: { Args: { p_company: string }; Returns: Json }
      next_document_number: {
        Args: { p_company: string; p_doc_type: string; p_series?: string }
        Returns: string
      }
      no_leidos_email: {
        Args: { p_account: string; p_threads: string[] }
        Returns: {
          gmail_thread_id: string
          sin_leer: boolean
        }[]
      }
      no_leidos_whatsapp: {
        Args: { p_conversaciones: string[] }
        Returns: {
          conversation_id: string
          no_leidos: number
        }[]
      }
      numero_o_null: { Args: { t: string }; Returns: number }
      pendiente_de_facturar: {
        Args: {
          p_company: string
          p_excluir_factura?: string | null
          p_receipts?: string[] | null
          p_supplier?: string | null
        }
        Returns: {
          cantidad_pedida: number | null
          currency_code: string | null
          descripcion: string | null
          en_borrador: number
          facturado: number
          goods_receipt_id: string
          goods_receipt_line_id: string
          order_number: string | null
          pendiente: number
          precio_pedido: number | null
          product_id: string | null
          purchase_order_id: string | null
          purchase_order_line_id: string | null
          receipt_date: string
          receipt_number: string
          recibido: number
          sku: string | null
          tratamiento_pedido: string | null
        }[]
      }
      pendiente_de_pedido: {
        Args: { p_excluir_recepcion?: string | null; p_order: string }
        Returns: {
          borradores: string[]
          descripcion: string | null
          en_borrador: number
          line_no: number
          pedido: number
          pendiente: number
          product_id: string | null
          purchase_order_line_id: string
          recibido: number
          sku: string | null
        }[]
      }
      /*
       * AGREGADO A MANO · Fase 40. Hay que regenerar este archivo.
       *
       * Lo normal es `npx supabase gen types typescript --project-id <id>`,
       * que pide un token de acceso personal. Mientras tanto, la firma va acá
       * para que el build no quede roto; cuando se regenere, esto se
       * reemplaza solo. Lo mismo con los dos parámetros nuevos de
       * `listar_bandeja_email`.
       *
       * OJO: el encabezado de este archivo dice que se generó desde el
       * proyecto `uaxcfufvapzulqvynanp`, que es el de Ohio. La base en uso es
       * la de São Paulo —ahí entra el correo—, así que al regenerar hay que
       * apuntar a ésa y revisar qué más quedó desactualizado: por ejemplo
       * `ultimo_precio_cliente` acá no declara `ultimo_documento_id`, que la
       * función sí devuelve y `clientes/services/precios.ts` sí lee.
       */
      pendiente_por_persona: {
        Args: { p_company: string }
        Returns: {
          correos_sin_responder: number
          cotizaciones_enviadas: number
          nombre: string
          pedidos_sin_entregar: number
          rol: string
          user_id: string | null
        }[]
      }
      postgres_fdw_disconnect: { Args: { "": string }; Returns: boolean }
      postgres_fdw_disconnect_all: { Args: never; Returns: boolean }
      postgres_fdw_get_connections: {
        Args: never
        Returns: Record<string, unknown>[]
      }
      postgres_fdw_handler: { Args: never; Returns: unknown }
      precheck_cierre_mantenimiento: {
        Args: { p_order: string }
        Returns: Json
      }
      precios_historicos_cliente: {
        Args: {
          p_customer: string
          p_limit?: number | null
          p_offset?: number | null
          p_product?: string | null
        }
        Returns: {
          cantidad: number | null
          descuento_pct: number | null
          documento_id: string
          fecha: string | null
          moneda: string | null
          nombre: string | null
          numero: string
          precio: number | null
          product_id: string | null
          sku: string | null
          tipo: string
          total_filas: number
        }[]
      }
      productos_del_cliente: {
        Args: {
          p_customer: string
          p_limit?: number
          p_offset?: number
          p_texto?: string | null
        }
        Returns: {
          cantidad_cotizada: number | null
          cantidad_pedida: number | null
          cotizaciones: number
          moneda: string | null
          nombre: string | null
          pedidos: number
          product_id: string | null
          sku: string | null
          total_filas: number
          ultima_cantidad: number | null
          ultima_fecha: string | null
          ultimo_documento_id: string | null
          ultimo_numero: string | null
          ultimo_precio: number | null
          ultimo_tipo: string
        }[]
      }
      productos_similares: {
        Args: { p_limite?: number; p_product_id: string }
        Returns: {
          fuente: string
          id: string
          motivo: string | null
          score: number
        }[]
      }
      rechazar_cotizacion_mantenimiento: {
        Args: { p_motivo?: string | null; p_order: string }
        Returns: Json
      }
      reciclar_mensajes_whatsapp: {
        Args: { p_timeout?: string }
        Returns: {
          account_id: string
          attempts: number
          caption: string | null
          claimed_at: string | null
          client_request_id: string | null
          company_id: string
          conversation_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by_wa_id: string | null
          delivered_at: string | null
          direction: string
          edited_at: string | null
          error_code: number | null
          error_details: string | null
          estado_visible: string | null
          failed_at: string | null
          id: string
          media_id: string | null
          message_type: string
          next_attempt_at: string | null
          ordenado_en: string | null
          provider_message_id: string | null
          provider_status: string | null
          provider_timestamp: string | null
          read_at: string | null
          received_at: string | null
          reply_to_provider_id: string | null
          sender_name: string | null
          sender_wa_id: string | null
          sent_at: string | null
          status: string
          text_body: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "whatsapp_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reclamar_analisis_whatsapp: {
        Args: {
          p_ahora?: string
          p_empresa?: string
          p_limite: number
          p_worker: string
        }
        Returns: Json
      }
      registrar_corrida_ia_whatsapp: {
        Args: {
          p_conversacion: string
          p_error_code: string
          p_estado: string
          p_metricas: Json
          p_modelo: string
        }
        Returns: undefined
      }
      registrar_descarte_borrador_email: {
        Args: { p_account: string; p_firma: string; p_thread: string | null }
        Returns: undefined
      }
      registrar_entrante_whatsapp: {
        Args: {
          p_caption: string | null
          p_media?: Json | null
          p_phone_number_id: string
          p_profile_name: string | null
          p_provider_message_id: string
          p_reply_to: string | null
          p_texto: string | null
          p_timestamp: string | null
          p_tipo: string
          p_wa_id: string
          p_waba_id: string | null
        }
        Returns: Json
      }
      registrar_estado_whatsapp: {
        Args: {
          p_error_code?: number | null
          p_error_details?: string | null
          p_estado: string
          p_phone_number_id: string
          p_provider_message_id: string
          p_timestamp: string | null
        }
        Returns: Json
      }
      registrar_evento_compra: {
        Args: {
          p_action: string
          p_diff?: Json | null
          p_entity_id: string
          p_entity_type: string
          p_from_status?: string | null
          p_to_status?: string | null
        }
        Returns: number
      }
      registrar_evento_venta: {
        Args: {
          p_action: string
          p_diff?: Json
          p_entity_id: string
          p_entity_type: string
          p_from_status?: string
          p_to_status?: string
        }
        Returns: number
      }
      registrar_factura_proveedor: {
        Args: { p_invoice: string }
        Returns: Json
      }
      registrar_grupo_whatsapp: {
        Args: {
          p_account: string
          p_group_id: string
          p_group_name?: string
          p_participantes?: Json
        }
        Returns: Json
      }
      reintentar_analisis_whatsapp: {
        Args: { p_conversacion: string }
        Returns: string
      }
      // Entrega 5. Exigen una firma HMAC que sólo tiene el servicio de la bandeja:
      // el frontend no puede usarlas aunque tenga EXECUTE.
      reservar_envio_email: {
        Args: {
          p_account: string
          p_client_request_id: string
          p_firma: string
          p_operacion: string
        }
        Returns: {
          attempted_at: string
          created_at: string
          gmail_message_id: string | null
          gmail_thread_id: string | null
          id: string
          intentos: number
          nuevo: boolean
          status: string
        }[]
      }
      resolver_item_ia_whatsapp: {
        Args: { p_estado: string; p_item: string }
        Returns: Json
      }
      resolver_revision_cliente: {
        Args: { p_customer: string; p_motivos?: string[] | null }
        Returns: Json
      }
      resumen_cliente: {
        Args: { p_customer: string }
        Returns: {
          cotizaciones: number
          documentos_12m: number
          entregas: number
          pedidos: number
          productos_distintos: number
          ultima_actividad: string | null
        }[]
      }
      resumen_cliente_360: {
        Args: { p_customer: string; p_meses?: number | null }
        Returns: Json
      }
      search_products: {
        Args: {
          p_attrs?: Json
          p_brand?: string
          p_category?: string
          p_company: string
          p_limit?: number
          p_offset?: number
          p_orden?: string
          p_query?: string
          p_ranges?: Json
          p_series?: string[]
          p_solo_catalogo?: boolean
          p_type?: string[]
        }
        Returns: {
          id: string
          rank_position: number
          score: number
          total_count: number
        }[]
      }
      sellar_media_whatsapp: {
        Args: {
          p_error_details?: string | null
          p_media: string
          p_mime_type?: string | null
          p_size_bytes: number | null
          p_storage_path: string | null
        }
        Returns: undefined
      }
      sellar_saliente_whatsapp: {
        Args: {
          p_error_code?: number | null
          p_error_details?: string | null
          p_mensaje: string
          p_provider_message_id: string | null
        }
        Returns: {
          account_id: string
          attempts: number
          caption: string | null
          claimed_at: string | null
          client_request_id: string | null
          company_id: string
          conversation_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by_wa_id: string | null
          delivered_at: string | null
          direction: string
          edited_at: string | null
          error_code: number | null
          error_details: string | null
          estado_visible: string | null
          failed_at: string | null
          id: string
          media_id: string | null
          message_type: string
          next_attempt_at: string | null
          ordenado_en: string | null
          provider_message_id: string | null
          provider_status: string | null
          provider_timestamp: string | null
          read_at: string | null
          received_at: string | null
          reply_to_provider_id: string | null
          sender_name: string | null
          sender_wa_id: string | null
          sent_at: string | null
          status: string
          text_body: string | null
        }
        SetofOptions: {
          from: "*"
          to: "whatsapp_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      senales_atencion_whatsapp: {
        Args: { p_conversaciones: string[]; p_horas?: number }
        Returns: {
          conversation_id: string
          motivos: string[]
        }[]
      }
      series_de_documento: {
        Args: { p_company: string; p_doc_type: string }
        Returns: {
          authority: string
          is_default: boolean
          series_code: string
        }[]
      }
      similitud_cercania: {
        Args: { a: number; b: number; peso: number }
        Returns: number
      }
      soltar_lease_email: {
        Args: { p_account: string; p_owner: string }
        Returns: {
          active: boolean
          auth_mode: string
          company_id: string
          created_at: string
          display_name: string | null
          email_address: string
          id: string
          last_full_sync_at: string | null
          last_history_id: string | null
          last_synced_at: string | null
          provider: string
          sync_error: string | null
          sync_error_at: string | null
          sync_lock_owner: string | null
          sync_lock_until: string | null
          updated_at: string
          watch_expiration: string | null
          watch_topic: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "email_accounts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      stel_asegurar_categoria_revision: {
        Args: { p_nombre: string; p_run: string; p_slug: string }
        Returns: string
      }
      stel_reconciliacion_cerrar: {
        Args: { p_estado: string; p_resumen: Json; p_run: string }
        Returns: undefined
      }
      stel_reconciliacion_iniciar: {
        Args: { p_company: string; p_plan_hash: string; p_stel_read_at: string }
        Returns: string
      }
      stel_reconciliar_cliente: {
        Args: { p: Json; p_run: string }
        Returns: Json
      }
      stel_reconciliar_documento: {
        Args: { p: Json; p_run: string }
        Returns: Json
      }
      stel_reconciliar_producto: {
        Args: { p: Json; p_run: string }
        Returns: Json
      }
      stel_revertir_reconciliacion: {
        Args: { p_limite?: number; p_run: string }
        Returns: Json
      }
      stel_sync_cerrar: {
        Args: {
          p_cursor: string
          p_cursor_id: string
          p_error?: string
          p_estado: string
          p_llamadas: number
          p_resumen: Json
          p_run: string
        }
        Returns: undefined
      }
      stel_sync_estado: {
        Args: { p_company: string }
        Returns: {
          cursor_external_id: string | null
          cursor_modified_at: string | null
          entity: string
          last_calls: number
          last_error: string | null
          last_finished_at: string | null
          last_started_at: string | null
          last_status: string
          last_summary: Json
          locked: boolean
        }[]
      }
      stel_sync_precio: { Args: { p: Json; p_run: string }; Returns: Json }
      stel_sync_producto: { Args: { p: Json; p_run: string }; Returns: Json }
      stel_sync_tomar: {
        Args: {
          p_company: string
          p_entidad: string
          p_owner: string
          p_ttl?: string
        }
        Returns: Json
      }
      stock_de_kit: {
        Args: { p_kit: string; p_warehouse?: string }
        Returns: number
      }
      stock_kit: {
        Args: { p: Database["public"]["Tables"]["products"]["Row"] }
        Returns: number
      }
      sugerencias_cliente_email: {
        Args: { p_account: string; p_thread: string }
        Returns: {
          clase: string
          contact_id: string | null
          contact_name: string | null
          customer_id: string
          customer_name: string | null
          direccion: string
        }[]
      }
      // Sólo service_role puede ejecutarlas: el frontend no las llama nunca.
      // Están acá porque PostgREST las publica y el archivo tiene que describir
      // el esquema real, no el que nos gustaría.
      tomar_lease_email: {
        Args: { p_account: string; p_minutos?: number | null; p_owner: string }
        Returns: {
          active: boolean
          auth_mode: string
          company_id: string
          created_at: string
          display_name: string | null
          email_address: string
          id: string
          last_full_sync_at: string | null
          last_history_id: string | null
          last_synced_at: string | null
          provider: string
          sync_error: string | null
          sync_error_at: string | null
          sync_lock_owner: string | null
          sync_lock_until: string | null
          updated_at: string
          watch_expiration: string | null
          watch_topic: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "email_accounts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      // Sólo service_role puede ejecutarlas: el frontend no las llama nunca.
      // Están acá porque PostgREST las publica y el archivo tiene que
      // describir el esquema real, no el que nos gustaría.
      tomar_mensajes_whatsapp: {
        Args: { p_limite?: number | null }
        Returns: {
          account_id: string
          attempts: number
          caption: string | null
          claimed_at: string | null
          client_request_id: string | null
          company_id: string
          conversation_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by_wa_id: string | null
          delivered_at: string | null
          direction: string
          edited_at: string | null
          error_code: number | null
          error_details: string | null
          estado_visible: string | null
          failed_at: string | null
          id: string
          media_id: string | null
          message_type: string
          next_attempt_at: string | null
          ordenado_en: string | null
          provider_message_id: string | null
          provider_status: string | null
          provider_timestamp: string | null
          read_at: string | null
          received_at: string | null
          reply_to_provider_id: string | null
          sender_name: string | null
          sender_wa_id: string | null
          sent_at: string | null
          status: string
          text_body: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "whatsapp_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      totales_por_moneda_cliente: {
        Args: { p_customer: string }
        Returns: {
          documentos: number
          importe: number
          moneda: string | null
          sin_importe: number
          tipo: string
        }[]
      }
      ultimo_precio_cliente: {
        Args: { p_customer: string; p_product?: string | null }
        Returns: {
          moneda: string | null
          nombre: string | null
          precio_anterior: number | null
          product_id: string | null
          sku: string | null
          ultima_fecha: string | null
          ultimo_documento: string | null
          ultimo_documento_id: string
          ultimo_precio: number | null
          ultimo_tipo: string
          veces: number
        }[]
      }
      ultimo_precio_compra: {
        Args: {
          p_company: string
          p_currency: string
          p_products: string[]
          p_supplier?: string | null
        }
        Returns: {
          discount_pct: number
          order_date: string
          order_number: string
          product_id: string
          supplier_name: string
          unit_price: number
        }[]
      }
      usuarios_asignables_email: {
        Args: { p_company: string }
        Returns: {
          full_name: string
          user_id: string
        }[]
      }
      usuarios_para_chat: {
        Args: { p_company: string }
        Returns: {
          nombre: string
          rol: string
          user_id: string
        }[]
      }
      validar_token_worker_ia_whatsapp: {
        Args: { p_token: string }
        Returns: boolean
      }
      verificar_uso_ia_whatsapp: {
        Args: { p_conversacion: string }
        Returns: Json
      }
      vincular_cliente_email: {
        Args: {
          p_account: string
          p_contacto?: string | null
          p_customer?: string | null
          p_origen?: string | null
          p_thread: string
        }
        Returns: {
          account_id: string
          assigned_to: string | null
          company_id: string
          created_at: string
          customer_contact_id: string | null
          customer_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          gmail_thread_id: string
          id: string
          internal_note: string | null
          updated_at: string
          vinculo_origen: string | null
          workflow_status: string
        }
        SetofOptions: {
          from: "*"
          to: "email_thread_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

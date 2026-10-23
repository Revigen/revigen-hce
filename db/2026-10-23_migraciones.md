# Migraciones 2026-10-23 (aditivas)

Respaldo de código: commit base `27c7a35` (origin/main antes de estos cambios).

Conteo de filas ANTES (schema clinica): patients 13 · notes 43 · vitc_administrations 4 · vitals 8 ·
medications 0 · indications 0 · consents 0 · labs 0 · attachments 0 · audit_log 260 · staff 7

## 1) G6PD deja de bloquear (no-op)
```sql
create or replace function clinica.fn_require_g6pd()
 returns trigger language plpgsql security definer set search_path to 'clinica','public'
as $function$ begin return new; end; $function$;
```

### Rollback (función original)
```sql
CREATE OR REPLACE FUNCTION clinica.fn_require_g6pd()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'clinica', 'public'
AS $function$ declare v_status text; begin select g6pd_status into v_status from clinica.patients where id = new.patient_id; if v_status is null or v_status = 'no_evaluado' then raise exception 'No se puede administrar vitamina C: falta el screening de G6PD del paciente'; end if; if v_status = 'deficiente' then raise exception 'Contraindicado: paciente con deficit de G6PD'; end if; return new; end; $function$;
```

## 2) Estructura de notas guiadas
```sql
alter table clinica.notes add column if not exists structured jsonb;
```
Nullable: las notas existentes quedan con NULL. Inofensiva; se puede dejar aunque se revierta el código.

## Pendiente de configuración (panel)
- Supabase → Project Settings → API → Exposed schemas: confirmar que incluye `clinica`.
- Supabase → Authentication → URL Configuration: Site URL y Redirect URLs = URL de producción de Vercel
  (hoy "Olvidé mi contraseña" manda a localhost).

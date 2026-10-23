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

## 3) Indicaciones de megadosis completas (aditivo, una sentencia por columna)
```sql
alter table clinica.indications add column if not exists vitc_dilution_ml numeric;
alter table clinica.indications add column if not exists vitc_rate_gtt_min numeric;
alter table clinica.indications add column if not exists start_date date;
alter table clinica.indications add column if not exists end_date date;
alter table clinica.indications add column if not exists sessions_planned integer;
alter table clinica.indications add column if not exists suspended_at timestamptz;
alter table clinica.indications add column if not exists suspended_by uuid;
alter table clinica.indications add column if not exists suspend_reason text;
alter table clinica.indications add column if not exists replaced_by uuid;
```
Todas aceptan vacío. Modificar una indicación crea una versión nueva y marca la anterior con `active=false`
y `replaced_by`; suspender completa `suspended_at/suspended_by/suspend_reason`. Nada se borra.

Conteo de filas DESPUÉS de todos los cambios: idéntico al de antes (patients 13 · notes 43 · vitc 4 · vitals 8 ·
audit_log 260 · staff 7 · resto 0).

## 4) Médico funcional: indica megadosis y registra infusiones (decisión de Revigen, 23/10)
```sql
alter policy ind_write on clinica.indications
  using (clinica.is_medic() or clinica.my_role() = 'medico_funcional')
  with check (clinica.is_medic() or clinica.my_role() = 'medico_funcional');
alter policy vitc_write on clinica.vitc_administrations
  using (clinica.my_role() = any (array['enfermeria','director_medico','admin','medico_funcional']))
  with check (clinica.my_role() = any (array['enfermeria','director_medico','admin','medico_funcional']));
```
La app (`can.indicate`, `can.vitc`) quedó igual a estas políticas.

### Rollback (definiciones originales)
```sql
alter policy ind_write on clinica.indications using (clinica.is_medic()) with check (clinica.is_medic());
alter policy vitc_write on clinica.vitc_administrations
  using (clinica.my_role() = any (array['enfermeria','director_medico','admin']))
  with check (clinica.my_role() = any (array['enfermeria','director_medico','admin']));
```
El médico funcional sigue sin crear ni editar la ficha del paciente (`patients_insert` / `patients_update`), como antes.

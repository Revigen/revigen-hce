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

## 5) Infusiones con varios componentes, catálogo y plantillas (aditivo, una sentencia por vez)
- `indications`: nueva restricción `indications_kind_check2` (general | vitamina_c | infusion), creada ANTES de
  quitar la vieja `indications_kind_check` (general | vitamina_c), así la tabla nunca quedó sin control.
  Columnas nuevas: `protocol_name text`, `vehicle text`. Volumen y goteo usan `vitc_dilution_ml` y `vitc_rate_gtt_min`.
- Tablas nuevas (RLS activo, auditoría `trg_audit`, sin acceso anónimo):
  - `infusion_components` (catálogo: name, unit, usual_dose, max_dose, g6pd_alert, notes, active) — escribe dirección/admin.
  - `infusion_templates` (plantillas de protocolo: name, components jsonb, vehicle, volume_ml, rate_gtt_min, active) — escribe dirección/admin.
  - `indication_components` (componentes de cada indicación: indication_id, patient_id, component_id, name, unit, dose) — escribe quien indica.
  - `infusion_components_given` (componentes de cada infusión: administration_id, patient_id, component_id, name, unit, dose, given, reason) — escribe quien registra infusiones.
- `vitc_administrations.dose_g` sigue obligatoria: en infusiones sin vitamina C se guarda 0 y el detalle va en `infusion_components_given`.

### Rollback
Las tablas nuevas se pueden dejar (vacías no afectan). Para volver a la restricción anterior (solo si no hay filas `infusion`):
```sql
alter table clinica.indications add constraint indications_kind_check check (kind = any (array['general','vitamina_c']));
alter table clinica.indications drop constraint indications_kind_check2;
```

## 6) Catálogo precargado desde la «Guía de protocolos para la consulta» (sueroterapia) — 27/10
- `infusion_components`: nueva columna `category text` (Vitaminas, Antioxidantes, Minerales, Aminoácidos, Otros).
- Datos de configuración cargados (no son datos de pacientes):
  - 45 componentes con unidad, dosis máxima de aviso (tope del rango de referencia de la guía), aviso G6PD
    (vitamina C y azul de metileno) y precauciones resumidas.
  - 21 plantillas de protocolo, solo donde la guía da una fórmula explícita: megadosis de vitamina C
    10/15/25/50/75/100 g, cocktail de Myers, azul de metileno, ALA, regulador de presión arterial,
    regulador del ánimo, antioxidante, detox hepático, antiage (colágeno), quelación EDTA, antiinflamatorio
    (DMSO), soporte inmunológico, brain boost, capilar/uñas, taurina, NAD+. Las dosis que la guía no fija
    quedan vacías y la app exige completarlas al indicar.

## 7) Estudios, laboratorios y consentimientos: fecha del estudio y corrección de fechas — 27/10
- `attachments`: nueva columna `study_date date` (fecha real del estudio; antes solo se veía la fecha de subida).
- Función nueva `clinica.update_lab(p_id uuid, p_measured_at timestamptz default null, p_storage_path text default null)`
  (security definer). Los laboratorios no tienen política de UPDATE, así que la corrección pasa solo por acá:
  exige ser staff y ser quien lo cargó o dirección médica/admin; solo cambia la fecha y/o adjunta el archivo
  si faltaba (`coalesce`, nunca borra). `execute` revocado a `public` y `anon`, otorgado a `authenticated`.
- La auditoría (`trg_audit`) registra cada corrección con el valor anterior y el nuevo, y la app además deja
  una nota «Corrección de fecha · …: «antes» → «después»» en la historia del paciente.
- Sin cambios de datos: el consentimiento existente (firmado_at 06/10 00:00 UTC) se mostraba 05/10 en Argentina;
  se corrigió en la app al leer la fecha. Las fechas nuevas se guardan al mediodía para que no corran de día.

### Rollback
```sql
revoke execute on function clinica.update_lab(uuid, timestamptz, text) from authenticated;
```
La columna `study_date` se puede dejar (vacía no afecta).

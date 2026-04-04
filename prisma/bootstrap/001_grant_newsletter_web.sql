DO $bootstrap$
DECLARE
  target_role text := current_setting('app.runtime_role', true);
BEGIN
  IF target_role IS NULL OR btrim(target_role) = '' THEN
    RAISE EXCEPTION 'app.runtime_role is not set';
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA newsletter TO %I', target_role);
  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA newsletter TO %I',
    target_role
  );
  EXECUTE format(
    'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA newsletter TO %I',
    target_role
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA newsletter GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
    target_role
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA newsletter GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I',
    target_role
  );
END;
$bootstrap$;

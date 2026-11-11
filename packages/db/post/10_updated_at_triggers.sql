-- docs/SPEC.md §7.11 (verbatim). Runs after every migrate, so tables added later are covered.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND t.table_type = 'BASE TABLE'
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = format('public.%I', r.table_name)::regclass
                    AND tgname = 'set_updated_at') THEN
      EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', r.table_name);
    END IF;
  END LOOP;
END $$;

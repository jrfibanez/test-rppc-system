-- docs/SPEC.md §7.10 grants (least privilege). Runs as the owner role after every migrate.
-- The table-specific lines only touch tables that already exist, so this file is valid at every migration level.
GRANT USAGE ON SCHEMA public TO app_user, app_client;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;

DO $$
DECLARE t text;
BEGIN
  -- DELETE only on draft-stage child rows and housekeeping tables
  FOREACH t IN ARRAY ARRAY['trip_lines','return_receipt_lines','billing_summary_lines','proposal_sites','contract_sites',
                           'pallet_audit_lines','ticket_message_files','push_subscriptions','notification_preferences',
                           'mfa_recovery_codes','sessions','processed_ops'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('GRANT DELETE ON public.%I TO app_user', t);
    END IF;
  END LOOP;
  -- Defence in depth on append-only tables (the triggers already refuse these)
  FOREACH t IN ARRAY ARRAY['audit_log','pallet_movements'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM app_user', t);
    END IF;
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;

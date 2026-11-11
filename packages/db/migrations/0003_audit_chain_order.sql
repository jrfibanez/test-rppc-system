-- 0003 Fix for the §7.1 audit chain trigger (found by test/audit-log.test.ts).
-- In §7.1 the row id comes from the bigserial default, which is evaluated BEFORE the trigger takes the chain lock.
-- A writer can therefore hold a lower id than a row that was chained before it. Example: transaction B writes row 16,
-- transaction A takes id 17 and waits for the lock, B writes row 18 and commits, then A chains row 17 after row 18.
-- fn_verify_audit_chain walks rows by id and reports row 17 as broken, though nobody tampered with anything.
-- Fix: take the id from the sequence after the lock is held, so id order equals chain order.
-- (Ids may still have gaps after a rollback; the chain links committed rows only, so verification is unaffected.)
CREATE OR REPLACE FUNCTION trg_audit_chain() RETURNS trigger AS $$
DECLARE v_prev bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(727001);
  NEW.id := nextval(pg_get_serial_sequence('audit_log', 'id'));
  SELECT hash INTO v_prev FROM audit_log ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := COALESCE(v_prev, '\x00'::bytea);
  NEW.hash := audit_row_hash(NEW.prev_hash, NEW.id, NEW.at, NEW.actor_id, NEW.action,
                             NEW.entity_type, NEW.entity_id, NEW.before, NEW.after);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

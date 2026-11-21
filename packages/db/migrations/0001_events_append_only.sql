-- Written by hand. drizzle-kit does not generate triggers.
--
-- The event log is append-only: UPDATE, DELETE and TRUNCATE on
-- "events" are rejected by the database itself, whatever the code does. Deleting a
-- workspace is a soft delete, so nothing ever needs to remove an event.
CREATE FUNCTION "events_append_only"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'The event log is append-only: % on "events" is not allowed.', TG_OP
    USING ERRCODE = 'TK001';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "events_reject_update_delete"
  BEFORE UPDATE OR DELETE ON "events"
  FOR EACH ROW EXECUTE FUNCTION "events_append_only"();
--> statement-breakpoint
CREATE TRIGGER "events_reject_truncate"
  BEFORE TRUNCATE ON "events"
  FOR EACH STATEMENT EXECUTE FUNCTION "events_append_only"();

-- Runs once, when the volume is empty. The integration tests use this database
-- (TEST_DATABASE_URL in .env.example), so they never touch the development data.
CREATE DATABASE turnkeel_test OWNER turnkeel;

// Unit and contract tests must never connect to the project's managed or production database.
// Database integration tests, if added, must use an explicitly isolated test database.
process.env.DATABASE_URL = "";

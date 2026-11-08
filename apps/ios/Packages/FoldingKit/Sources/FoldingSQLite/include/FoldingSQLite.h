#include <sqlite3.h>

// Swift cannot call SQLite's variadic configuration API directly.
int folding_sqlite_disable_close_checkpoint(sqlite3 *database);

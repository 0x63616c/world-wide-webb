#include "FoldingSQLite.h"

int folding_sqlite_disable_close_checkpoint(sqlite3 *database) {
  return sqlite3_db_config(database, SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, 1, (int *)0);
}

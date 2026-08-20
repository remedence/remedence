import { getDatabaseConnection, type RemedenceDatabase } from "./database.js";

export function runTransaction<T>(
  database: RemedenceDatabase,
  operation: () => T,
): T {
  const connection = getDatabaseConnection(database);
  connection.exec("BEGIN IMMEDIATE");

  try {
    const result = operation();
    connection.exec("COMMIT");
    return result;
  } catch (error) {
    let rollbackError: unknown;
    try {
      if (connection.isTransaction) connection.exec("ROLLBACK");
    } catch (caughtRollbackError) {
      rollbackError = caughtRollbackError;
    }

    if (rollbackError !== undefined) {
      throw new AggregateError(
        [error, rollbackError],
        "Transaction failed and rollback also failed.",
        { cause: error },
      );
    }
    throw error;
  }
}

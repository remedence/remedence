import { getDatabaseConnection, type RemedenceDatabase } from "./database.js";

let savepointSequence = 0;

export function runTransaction<T>(
  database: RemedenceDatabase,
  operation: () => Promise<T>,
): Promise<T>;
export function runTransaction<T>(
  database: RemedenceDatabase,
  operation: () => T,
): T;
export function runTransaction<T>(
  database: RemedenceDatabase,
  operation: () => T | Promise<T>,
): T | Promise<T> {
  const connection = getDatabaseConnection(database);
  if (connection.isTransaction) {
    const savepoint = `remedence_nested_${++savepointSequence}`;
    connection.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      if (result instanceof Promise) {
        return result.then(
          (value) => {
            connection.exec(`RELEASE SAVEPOINT ${savepoint}`);
            return value;
          },
          (error: unknown) => {
            connection.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            connection.exec(`RELEASE SAVEPOINT ${savepoint}`);
            throw error;
          },
        );
      }
      connection.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      connection.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      connection.exec(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
  }
  connection.exec("BEGIN IMMEDIATE");

  try {
    const result = operation();
    if (result instanceof Promise) {
      return result.then(
        (value) => {
          connection.exec("COMMIT");
          return value;
        },
        (error: unknown) => {
          connection.exec("ROLLBACK");
          throw error;
        },
      );
    }
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

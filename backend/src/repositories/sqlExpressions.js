/**
 * Shared SQL expression fragments reused across repositories, so revenue/
 * balance calculations can never silently diverge between modules (e.g. the
 * booking detail view vs. the reports module).
 */
'use strict';

// Coalesces both operands independently — a NULL amount_paid must mean "$0
// collected so far" (balance = full total), not "unknown balance" (0 due).
// Reference the alias (e.g. `b`) the query gives the Bookings table.
const balanceDueExpr = (alias = 'b') =>
    `(ISNULL(${alias}.total_amount, 0) - ISNULL(${alias}.amount_paid, 0))`;

module.exports = { balanceDueExpr };

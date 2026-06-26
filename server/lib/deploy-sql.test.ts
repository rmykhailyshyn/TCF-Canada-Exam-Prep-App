import { describe, expect, it } from "vitest";
import { buildDeploySql, sqlLiteral, type DeployTable } from "./deploy-sql";

// spec: docs/specs/content-deploy.md §Behaviour.1, 2
// Unit coverage for the pure content-deploy SQL builder used by the push-to-cloud path. These are
// pure functions (no node:* imports), so they are exercised in isolation here.

describe("sqlLiteral", () => {
  it("renders null and undefined as NULL", () => {
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(undefined)).toBe("NULL");
  });

  it("renders booleans as 1 / 0", () => {
    expect(sqlLiteral(true)).toBe("1");
    expect(sqlLiteral(false)).toBe("0");
  });

  it("renders finite integers and floats as their digits", () => {
    expect(sqlLiteral(42)).toBe("42");
    expect(sqlLiteral(0)).toBe("0");
    expect(sqlLiteral(-7)).toBe("-7");
    expect(sqlLiteral(3.5)).toBe("3.5");
  });

  it("renders non-finite numbers as NULL", () => {
    expect(sqlLiteral(NaN)).toBe("NULL");
    expect(sqlLiteral(Infinity)).toBe("NULL");
    expect(sqlLiteral(-Infinity)).toBe("NULL");
  });

  it("renders bigints as their digits", () => {
    expect(sqlLiteral(9007199254740993n)).toBe("9007199254740993");
    expect(sqlLiteral(0n)).toBe("0");
  });

  it("single-quotes strings and doubles embedded single quotes", () => {
    expect(sqlLiteral("hello")).toBe("'hello'");
    expect(sqlLiteral("s'est")).toBe("'s''est'");
    expect(sqlLiteral("'")).toBe("''''");
    expect(sqlLiteral("")).toBe("''");
  });

  it("renders a Uint8Array as a lower-case hex blob literal", () => {
    expect(sqlLiteral(new Uint8Array([0x00, 0x0f, 0xff, 0xab]))).toBe(
      "X'000fffab'",
    );
    expect(sqlLiteral(new Uint8Array([]))).toBe("X''");
  });
});

describe("buildDeploySql", () => {
  it("emits a single INSERT OR REPLACE with quoted columns and values", () => {
    const tables: DeployTable[] = [
      {
        table: "questions",
        columns: ["id", "text", "active"],
        rows: [
          { id: 1, text: "a'b", active: true },
          { id: 2, text: "c", active: false },
        ],
      },
    ];
    expect(buildDeploySql(tables)).toBe(
      'INSERT OR REPLACE INTO "questions" ("id", "text", "active") VALUES\n' +
        "  (1, 'a''b', 1),\n" +
        "  (2, 'c', 0);",
    );
  });

  it("skips empty tables (no statement emitted)", () => {
    expect(
      buildDeploySql([{ table: "empty", columns: ["id"], rows: [] }]),
    ).toBe("");
  });

  it("splits more than 50 rows into multiple statements of <=50 rows each", () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ id: i + 1 }));
    const sql = buildDeploySql([{ table: "t", columns: ["id"], rows }]);
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    // 120 rows / 50 per chunk => 50 + 50 + 20 = 3 statements.
    expect(statements).toHaveLength(3);
    for (const s of statements) {
      expect(s.startsWith('INSERT OR REPLACE INTO "t" ("id") VALUES')).toBe(
        true,
      );
    }
    // Row tuples are "(n)"; confirm all 120 were emitted exactly once.
    const tuples = sql.match(/\((\d+)\)/g) ?? [];
    expect(tuples).toHaveLength(120);
    expect(tuples[0]).toBe("(1)");
    expect(tuples[119]).toBe("(120)");
  });

  it("emits multiple tables in input (FK/parent-first) order", () => {
    const sql = buildDeploySql([
      { table: "parent", columns: ["id"], rows: [{ id: 1 }] },
      { table: "child", columns: ["id"], rows: [{ id: 2 }] },
    ]);
    const parentAt = sql.indexOf('INSERT OR REPLACE INTO "parent"');
    const childAt = sql.indexOf('INSERT OR REPLACE INTO "child"');
    expect(parentAt).toBeGreaterThanOrEqual(0);
    expect(childAt).toBeGreaterThan(parentAt);
  });
});

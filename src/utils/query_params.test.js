const {
    MAX_DATABASE_BIGINT,
    MAX_JAVASCRIPT_TIMESTAMP,
    MAX_MESHTASTIC_NODE_ID,
    QueryValidationError,
    parseBoolean,
    parseCount,
    parseDatabaseId,
    parseEnum,
    parseInteger,
    parseNodeId,
    parseNodeIdList,
    parseNodeIdPair,
    parseOptionalNodeId,
    parseOptionalString,
    parseOrder,
    parseTimestamp,
    parseTimestampRange,
} = require("./query_params");

describe("query parameter parsing", () => {
    describe("parseNodeId", () => {
        test.each([
            ["1", 1n],
            ["4294967295", MAX_MESHTASTIC_NODE_ID],
            ["!1", 1n],
            ["!aBcD1234", 0xabcd1234n],
            [4294967295, MAX_MESHTASTIC_NODE_ID],
            [123n, 123n],
        ])("parses %p", (input, expected) => {
            expect(parseNodeId(input)).toBe(expected);
        });

        test.each([
            undefined,
            "",
            "0",
            "-1",
            "1.5",
            "123abc",
            "!",
            "!123456789",
            "!nothex",
            "4294967296",
            ["1", "2"],
            { value: "1" },
        ])("rejects %p", (input) => {
            expect(() => parseNodeId(input)).toThrow(QueryValidationError);
        });

        test("allows an explicit missing default", () => {
            expect(parseNodeId(undefined, { defaultValue: null })).toBeNull();
            expect(parseOptionalNodeId(undefined)).toBeUndefined();
        });
    });

    describe("node id collections", () => {
        test("parses, trims and de-duplicates a node id list", () => {
            expect(parseNodeIdList("1, !00000002,1")).toEqual([1n, 2n]);
        });

        test("returns an empty list when ids are omitted", () => {
            expect(parseNodeIdList(undefined)).toEqual([]);
            expect(parseNodeIdList("")).toEqual([]);
        });

        test("rejects invalid, empty and oversized lists", () => {
            expect(() => parseNodeIdList("1,,2")).toThrow(QueryValidationError);
            expect(() => parseNodeIdList("1,nope")).toThrow(QueryValidationError);
            expect(() => parseNodeIdList("1,2,3", { maxItems: 2 })).toThrow(QueryValidationError);
        });

        test("requires two distinct direct-message ids", () => {
            expect(parseNodeIdPair("1,!00000002")).toEqual([1n, 2n]);
            expect(parseNodeIdPair(undefined)).toBeUndefined();
            expect(() => parseNodeIdPair("1")).toThrow(QueryValidationError);
            expect(() => parseNodeIdPair("1,1")).toThrow(QueryValidationError);
            expect(() => parseNodeIdPair("1,2,3")).toThrow(QueryValidationError);
        });
    });

    describe("numeric values", () => {
        test("parses bounded integers without partial-number coercion", () => {
            expect(parseInteger("42", { min: 0, max: 100 })).toBe(42);
            expect(parseInteger(undefined, { defaultValue: 7 })).toBe(7);
            expect(() => parseInteger("42px", { min: 0, max: 100 })).toThrow(QueryValidationError);
            expect(() => parseInteger("101", { min: 0, max: 100 })).toThrow(QueryValidationError);
            expect(() => parseInteger(Number.NaN)).toThrow(QueryValidationError);
        });

        test("applies count defaults and hard maximums", () => {
            expect(parseCount(undefined, { defaultValue: 50, maxValue: 200 })).toBe(50);
            expect(parseCount("200", { defaultValue: 50, maxValue: 200 })).toBe(200);
            expect(() => parseCount("0", { defaultValue: 50, maxValue: 200 })).toThrow(QueryValidationError);
            expect(() => parseCount("201", { defaultValue: 50, maxValue: 200 })).toThrow(QueryValidationError);
            expect(() => parseCount("2.5", { defaultValue: 50, maxValue: 200 })).toThrow(QueryValidationError);
        });

        test("parses database ids without losing bigint precision", () => {
            expect(parseDatabaseId(MAX_DATABASE_BIGINT.toString())).toBe(MAX_DATABASE_BIGINT);
            expect(parseDatabaseId(undefined, { defaultValue: undefined })).toBeUndefined();
            expect(() => parseDatabaseId("0")).toThrow(QueryValidationError);
            expect(() => parseDatabaseId((MAX_DATABASE_BIGINT + 1n).toString())).toThrow(QueryValidationError);
        });
    });

    describe("timestamps and ranges", () => {
        test("parses valid millisecond timestamps including epoch", () => {
            expect(parseTimestamp("0")).toBe(0);
            expect(parseTimestamp(MAX_JAVASCRIPT_TIMESTAMP.toString())).toBe(MAX_JAVASCRIPT_TIMESTAMP);
        });

        test.each(["-1", "1.5", "yesterday", (MAX_JAVASCRIPT_TIMESTAMP + 1).toString()])("rejects timestamp %p", (input) => {
            expect(() => parseTimestamp(input)).toThrow(QueryValidationError);
        });

        test("fills a bounded default window ending at now", () => {
            expect(parseTimestampRange({}, {
                now: 10_000,
                defaultWindowMs: 1_000,
                maxRangeMs: 5_000,
            })).toEqual({
                timeFrom: 9_000,
                timeTo: 10_000,
            });
        });

        test("anchors a missing from timestamp to an explicit to timestamp", () => {
            expect(parseTimestampRange({ time_to: "5000" }, {
                now: 10_000,
                defaultWindowMs: 1_000,
                maxRangeMs: 5_000,
            })).toEqual({
                timeFrom: 4_000,
                timeTo: 5_000,
            });
        });

        test("accepts the maximum range and rejects reversed or oversized ranges", () => {
            const options = {
                now: 10_000,
                defaultWindowMs: 1_000,
                maxRangeMs: 5_000,
            };

            expect(parseTimestampRange({ time_from: "0", time_to: "5000" }, options)).toEqual({
                timeFrom: 0,
                timeTo: 5_000,
            });
            expect(() => parseTimestampRange({ time_from: "5001", time_to: "5000" }, options)).toThrow(QueryValidationError);
            expect(() => parseTimestampRange({ time_from: "0", time_to: "5001" }, options)).toThrow(QueryValidationError);
        });
    });

    describe("enums, booleans and strings", () => {
        test("parses order case-insensitively and rejects unknown values", () => {
            expect(parseOrder(undefined)).toBe("asc");
            expect(parseOrder("DESC")).toBe("desc");
            expect(() => parseOrder("newest")).toThrow(QueryValidationError);
        });

        test("parses a configured enum", () => {
            expect(parseEnum("search", {
                allowedValues: ["map", "search"],
                defaultValue: "map",
            })).toBe("search");
            expect(() => parseEnum("full", {
                name: "view",
                allowedValues: ["map", "search"],
            })).toThrow(QueryValidationError);
        });

        test.each([
            ["true", true],
            ["YES", true],
            ["1", true],
            ["false", false],
            ["off", false],
            ["0", false],
        ])("parses boolean %p", (input, expected) => {
            expect(parseBoolean(input)).toBe(expected);
        });

        test("rejects ambiguous booleans", () => {
            expect(parseBoolean(undefined)).toBe(false);
            expect(() => parseBoolean("sometimes")).toThrow(QueryValidationError);
        });

        test("validates optional scalar strings", () => {
            expect(parseOptionalString(undefined)).toBeUndefined();
            expect(parseOptionalString(" primary ")).toBe("primary");
            expect(() => parseOptionalString("")).toThrow(QueryValidationError);
            expect(() => parseOptionalString("abcd", { maxLength: 3 })).toThrow(QueryValidationError);
            expect(() => parseOptionalString(["a", "b"])).toThrow(QueryValidationError);
        });
    });
});

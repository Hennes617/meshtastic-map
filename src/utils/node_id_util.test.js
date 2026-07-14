const NodeIdUtil = require("./node_id_util");

test('can convert hex id to numeric id', () => {
    expect(NodeIdUtil.convertToNumeric("!FFFFFFFF")).toBe(BigInt(4294967295));
});

test('can convert numeric id to numeric id', () => {
    expect(NodeIdUtil.convertToNumeric(4294967295)).toBe(BigInt(4294967295));
});

test('accepts the complete uint32 node id range', () => {
    expect(NodeIdUtil.convertToNumeric("1")).toBe(1n);
    expect(NodeIdUtil.convertToNumeric("!00000001")).toBe(1n);
    expect(NodeIdUtil.convertToNumeric(0xFFFFFFFFn)).toBe(0xFFFFFFFFn);
});

test.each([
    0,
    -1,
    4294967296,
    "",
    "0",
    "-1",
    "4294967296",
    "!!12",
    "!12!34",
    "!100000000",
    " 123",
    1.5,
    null,
    undefined,
])('rejects invalid or out of range node id %p', (nodeId) => {
    expect(() => NodeIdUtil.convertToNumeric(nodeId)).toThrow();
});

const {
    buildImportedNodeIdentity,
    fetchNodeIdentitiesPayloadFromUrl,
    getImportedNodesFromPayload,
} = require("./node_identity_import");

afterEach(() => {
    jest.restoreAllMocks();
});

test('falls back from an empty raw short name to a meaningful short name', () => {
    const identity = buildImportedNodeIdentity({
        node_id: "!12345678",
        raw_short_name: "   ",
        short_name: "GOOD",
    });

    expect(identity.data.short_name).toBe("GOOD");
});

test('keeps an object key as node id when payload id fields are null', () => {
    const nodes = getImportedNodesFromPayload({
        "!12345678": {
            id: null,
            node_id: null,
            long_name: "Keyed node",
        },
    });

    const identity = buildImportedNodeIdentity(nodes[0]);
    expect(identity.node_id).toBe(0x12345678n);
    expect(identity.data.long_name).toBe("Keyed node");
});

test('rejects imported node ids outside the uint32 range', () => {
    expect(buildImportedNodeIdentity({ node_id: -1, long_name: "Invalid" })).toBeNull();
    expect(buildImportedNodeIdentity({ node_id: "4294967296", long_name: "Invalid" })).toBeNull();
});

test('enforces the identity response body size while streaming', async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response('{"nodes":[{"id":1}]}'));

    await expect(fetchNodeIdentitiesPayloadFromUrl("https://example.test/nodes.json", {
        max_response_bytes: 8,
    })).rejects.toThrow("Identity response exceeds 8 byte limit");
});

test('parses a response below the identity response body limit', async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response('{"nodes":[]}'));

    await expect(fetchNodeIdentitiesPayloadFromUrl("https://example.test/nodes.json", {
        max_response_bytes: 64,
    })).resolves.toEqual({ nodes: [] });
});

test('keeps the identity timeout active while reading the response body', async () => {
    jest.spyOn(global, "fetch").mockImplementation(async (url, options) => {
        const body = new ReadableStream({
            start(controller) {
                options.signal.addEventListener("abort", () => {
                    controller.error(new DOMException("Aborted", "AbortError"));
                }, { once: true });
            },
        });
        return new Response(body);
    });

    await expect(fetchNodeIdentitiesPayloadFromUrl("https://example.test/slow.json", {
        timeout_ms: 5,
    })).rejects.toThrow("Request timed out after 5ms");
});

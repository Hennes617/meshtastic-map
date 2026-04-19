const fs = require("fs");
const NodeIdUtil = require("./node_id_util");

function getMeaningfulString(value) {
    if(typeof value !== "string"){
        return null;
    }

    const normalizedValue = value.trim();
    if(normalizedValue.length === 0){
        return null;
    }

    return normalizedValue;
}

function hasKnownHardwareModel(value) {
    return Number.isInteger(value) && value > 0;
}

function isMeaningfulImportedLongName(value) {
    const longName = getMeaningfulString(value);
    if(longName == null){
        return null;
    }

    if(/^Node\s+![0-9A-Fa-f]+$/.test(longName)){
        return null;
    }

    return longName;
}

function getImportedNodeId(sourceNode) {
    const candidates = [
        sourceNode?.node_id,
        sourceNode?.nodeId,
        sourceNode?.node_id_hex,
        sourceNode?.nodeIdHex,
        sourceNode?.id,
    ];

    for(const candidate of candidates){
        if(candidate == null){
            continue;
        }

        try {
            return NodeIdUtil.convertToNumeric(candidate);
        } catch(err) {
            // try next candidate
        }
    }

    return null;
}

function getImportedShortName(sourceNode, nodeId) {
    const rawShortName = getMeaningfulString(sourceNode?.raw_short_name);
    if(rawShortName != null){
        return rawShortName;
    }

    const shortName = getMeaningfulString(sourceNode?.short_name);
    if(shortName == null){
        return null;
    }

    if(nodeId != null){
        const nodeIdSuffix = nodeId.toString(16).toUpperCase().slice(-4);
        if(shortName === nodeIdSuffix){
            return null;
        }
    }

    return shortName;
}

function getImportedLongName(sourceNode) {
    const rawLongName = getMeaningfulString(sourceNode?.raw_long_name);
    if(rawLongName != null){
        return rawLongName;
    }

    return isMeaningfulImportedLongName(sourceNode?.long_name);
}

function getImportedNodesFromPayload(payload) {
    if(Array.isArray(payload)){
        return payload;
    }

    if(Array.isArray(payload?.nodes)){
        return payload.nodes;
    }

    if(Array.isArray(payload?.data?.nodes)){
        return payload.data.nodes;
    }

    return [];
}

function buildImportedNodeIdentity(sourceNode) {
    const nodeId = getImportedNodeId(sourceNode);
    if(nodeId == null){
        return null;
    }

    const data = {};

    const longName = getImportedLongName(sourceNode);
    if(longName != null){
        data.long_name = longName;
    }

    const shortName = getImportedShortName(sourceNode, nodeId);
    if(shortName != null){
        data.short_name = shortName;
    }

    const hardwareModel = hasKnownHardwareModel(sourceNode?.hardware_model) ? sourceNode.hardware_model : null;
    if(hardwareModel != null){
        data.hardware_model = hardwareModel;
    }

    if(Number.isInteger(sourceNode?.role) && sourceNode.role >= 0){
        data.role = sourceNode.role;
    }

    const firmwareVersion = getMeaningfulString(sourceNode?.firmware_version);
    if(firmwareVersion != null){
        data.firmware_version = firmwareVersion;
    }

    return {
        node_id: nodeId,
        data: data,
    };
}

async function importNodeIdentitiesFromJsonPayload(prisma, payload, sourceLabel, options = {}) {
    const {
        createMissingNodes = false,
        overwriteExisting = false,
    } = options;

    const importedNodes = getImportedNodesFromPayload(payload);
    if(importedNodes.length === 0){
        return {
            imported_count: 0,
            skipped_count: 0,
            source_label: sourceLabel,
        };
    }

    const existingNodes = await prisma.node.findMany({
        select: {
            node_id: true,
            long_name: true,
            short_name: true,
            hardware_model: true,
            role: true,
            firmware_version: true,
        },
    });

    const existingNodesById = new Map(
        existingNodes.map((node) => [node.node_id.toString(), node])
    );

    let importedCount = 0;
    let skippedCount = 0;

    for(const sourceNode of importedNodes){
        const importedIdentity = buildImportedNodeIdentity(sourceNode);
        if(importedIdentity == null || Object.keys(importedIdentity.data).length === 0){
            skippedCount += 1;
            continue;
        }

        const existingNode = existingNodesById.get(importedIdentity.node_id.toString());

        if(existingNode == null){
            if(!createMissingNodes){
                skippedCount += 1;
                continue;
            }

            await prisma.node.create({
                data: {
                    node_id: importedIdentity.node_id,
                    long_name: importedIdentity.data.long_name ?? "",
                    short_name: importedIdentity.data.short_name ?? "",
                    hardware_model: importedIdentity.data.hardware_model ?? 0,
                    role: importedIdentity.data.role ?? 0,
                    firmware_version: importedIdentity.data.firmware_version ?? null,
                },
            });
            importedCount += 1;
            continue;
        }

        const data = {};

        if(importedIdentity.data.long_name != null
            && (overwriteExisting || getMeaningfulString(existingNode.long_name) == null)){
            data.long_name = importedIdentity.data.long_name;
        }

        if(importedIdentity.data.short_name != null
            && (overwriteExisting || getMeaningfulString(existingNode.short_name) == null)){
            data.short_name = importedIdentity.data.short_name;
        }

        if(importedIdentity.data.hardware_model != null
            && (overwriteExisting || !hasKnownHardwareModel(existingNode.hardware_model))){
            data.hardware_model = importedIdentity.data.hardware_model;
        }

        if(importedIdentity.data.role != null && overwriteExisting){
            data.role = importedIdentity.data.role;
        }

        if(importedIdentity.data.firmware_version != null
            && (overwriteExisting || getMeaningfulString(existingNode.firmware_version) == null)){
            data.firmware_version = importedIdentity.data.firmware_version;
        }

        if(Object.keys(data).length === 0){
            skippedCount += 1;
            continue;
        }

        await prisma.node.updateMany({
            where: {
                node_id: importedIdentity.node_id,
            },
            data: data,
        });

        importedCount += 1;
    }

    return {
        imported_count: importedCount,
        skipped_count: skippedCount,
        source_label: sourceLabel,
    };
}

async function importNodeIdentitiesFromFile(prisma, filePath, options = {}) {
    const fileContents = fs.readFileSync(filePath, "utf-8");
    const payload = JSON.parse(fileContents);
    return importNodeIdentitiesFromJsonPayload(prisma, payload, `file ${filePath}`, options);
}

async function importNodeIdentitiesFromUrl(prisma, url, options = {}) {
    const response = await fetch(url, {
        headers: {
            "accept": "application/json",
        },
    });

    if(!response.ok){
        throw new Error(`Request failed with status ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    return importNodeIdentitiesFromJsonPayload(prisma, payload, `URL ${url}`, options);
}

module.exports = {
    getMeaningfulString,
    hasKnownHardwareModel,
    importNodeIdentitiesFromFile,
    importNodeIdentitiesFromJsonPayload,
    importNodeIdentitiesFromUrl,
};

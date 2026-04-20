const fs = require("fs");
const NodeIdUtil = require("./node_id_util");
const { getHardwareModelIdsByName } = require("./hardware_models");

const hardwareModelIdsByName = getHardwareModelIdsByName();

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

function getMeaningfulLongName(value) {
    const longName = getMeaningfulString(value);
    if(longName == null){
        return null;
    }

    if(/^Node\s+![0-9A-Fa-f]+$/.test(longName)){
        return null;
    }

    if(/^Meshtastic\s+[0-9A-Fa-f]{4,8}$/.test(longName)){
        return null;
    }

    return longName;
}

function hasKnownHardwareModel(value) {
    return Number.isInteger(value) && value > 0;
}

function getImportedHardwareModel(value) {
    if(hasKnownHardwareModel(value)){
        return value;
    }

    const hardwareModelName = getMeaningfulString(value);
    if(hardwareModelName == null){
        return null;
    }

    if(/^\d+$/.test(hardwareModelName)){
        const numericHardwareModel = Number.parseInt(hardwareModelName, 10);
        if(hasKnownHardwareModel(numericHardwareModel)){
            return numericHardwareModel;
        }
    }

    const hardwareModelId = hardwareModelIdsByName.get(hardwareModelName.toUpperCase());
    if(hasKnownHardwareModel(hardwareModelId)){
        return hardwareModelId;
    }

    return null;
}

function isMeaningfulImportedLongName(value) {
    return getMeaningfulLongName(value);
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
    return getMeaningfulShortName(
        sourceNode?.raw_short_name ?? sourceNode?.short_name ?? sourceNode?.shortName,
        nodeId,
    );
}

function getMeaningfulShortName(value, nodeId) {
    const shortName = getMeaningfulString(value);
    if(shortName == null){
        return null;
    }

    if(nodeId != null){
        const nodeIdSuffix = nodeId.toString(16).toUpperCase().slice(-4);
        if(shortName.toUpperCase() === nodeIdSuffix){
            return null;
        }
    }

    return shortName;
}

function getImportedLongName(sourceNode) {
    const rawLongName = getMeaningfulLongName(sourceNode?.raw_long_name ?? sourceNode?.rawLongName);
    if(rawLongName != null){
        return rawLongName;
    }

    return isMeaningfulImportedLongName(sourceNode?.long_name ?? sourceNode?.longName);
}

function getExistingLongName(value) {
    return getMeaningfulLongName(value);
}

function getExistingShortName(value, nodeId) {
    return getMeaningfulShortName(value, nodeId);
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

    if(payload != null && typeof payload === "object"){
        const objectNodes = Object.entries(payload)
            .filter(([, value]) => {
                if(value == null || typeof value !== "object" || Array.isArray(value)){
                    return false;
                }

                return value.longName != null
                    || value.shortName != null
                    || value.long_name != null
                    || value.short_name != null
                    || value.hwModel != null
                    || value.hardwareModel != null
                    || value.hardware_model != null
                    || value.rawLongName != null
                    || value.rawShortName != null
                    || value.raw_long_name != null
                    || value.raw_short_name != null;
            })
            .map(([nodeId, value]) => {
                return {
                    id: value.id ?? nodeId,
                    node_id: value.node_id ?? value.nodeId ?? nodeId,
                    ...value,
                };
            });

        if(objectNodes.length > 0){
            return objectNodes;
        }
    }

    return [];
}

function buildImportedNodeIdentity(sourceNode, options = {}) {
    const {
        allowedFields = null,
    } = options;
    const nodeId = getImportedNodeId(sourceNode);
    if(nodeId == null){
        return null;
    }

    const allowedFieldsSet = allowedFields != null ? new Set(allowedFields) : null;
    const shouldIncludeField = (fieldName) => allowedFieldsSet == null || allowedFieldsSet.has(fieldName);
    const data = {};

    const longName = getImportedLongName(sourceNode);
    if(longName != null && shouldIncludeField("long_name")){
        data.long_name = longName;
    }

    const shortName = getImportedShortName(sourceNode, nodeId);
    if(shortName != null && shouldIncludeField("short_name")){
        data.short_name = shortName;
    }

    const hardwareModelRawValue = sourceNode?.hardware_model ?? sourceNode?.hardwareModel ?? sourceNode?.hwModel;
    const hardwareModel = getImportedHardwareModel(hardwareModelRawValue);
    if(hardwareModel != null && shouldIncludeField("hardware_model")){
        data.hardware_model = hardwareModel;
    }

    const role = Number.isInteger(sourceNode?.role) && sourceNode.role >= 0 ? sourceNode.role : null;
    if(role != null && shouldIncludeField("role")){
        data.role = role;
    }

    const firmwareVersion = getMeaningfulString(sourceNode?.firmware_version ?? sourceNode?.fwVersion);
    if(firmwareVersion != null && shouldIncludeField("firmware_version")){
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
        allowedFields = null,
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
        const importedIdentity = buildImportedNodeIdentity(sourceNode, {
            allowedFields: allowedFields,
        });
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
            && (overwriteExisting || getExistingLongName(existingNode.long_name) == null)){
            data.long_name = importedIdentity.data.long_name;
        }

        if(importedIdentity.data.short_name != null
            && (overwriteExisting || getExistingShortName(existingNode.short_name, importedIdentity.node_id) == null)){
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
    const timeoutMs = options.timeout_ms ?? 15000;
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
        abortController.abort();
    }, timeoutMs);
    let response;
    try {
        response = await fetch(url, {
            headers: {
                "accept": "application/json",
                "user-agent": "meshtastic-map/1.0",
            },
            signal: abortController.signal,
        });
    } catch(err) {
        if(err?.name === "AbortError"){
            throw new Error(`Request timed out after ${timeoutMs}ms`);
        }

        throw err;
    } finally {
        clearTimeout(timeout);
    }

    if(!response.ok){
        throw new Error(`Request failed with status ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    return importNodeIdentitiesFromJsonPayload(prisma, payload, `URL ${url}`, options);
}

module.exports = {
    getImportedHardwareModel,
    getMeaningfulLongName,
    getMeaningfulShortName,
    getMeaningfulString,
    hasKnownHardwareModel,
    importNodeIdentitiesFromFile,
    importNodeIdentitiesFromJsonPayload,
    importNodeIdentitiesFromUrl,
};

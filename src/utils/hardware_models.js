const fs = require("fs");
const path = require("path");

const bundledHardwareModelsPath = path.join(__dirname, "..", "json", "hardware_models.json");
const protobufMeshProtoCandidatePaths = [
    path.join(__dirname, "..", "external", "protobufs", "meshtastic", "mesh.proto"),
    path.join(__dirname, "..", "..", "external", "protobufs", "meshtastic", "mesh.proto"),
    path.join(__dirname, "..", "..", "protobufs", "meshtastic", "mesh.proto"),
];

let cachedHardwareModels = null;

function parseHardwareModelsFromMeshProto(meshProtoContents) {
    const hardwareModelEnumMatch = meshProtoContents.match(/enum\s+HardwareModel\s*{([\s\S]*?)^\}/m);
    if(hardwareModelEnumMatch == null){
        return {};
    }

    const hardwareModels = {};
    const enumEntryRegex = /^\s*([A-Z0-9_]+)\s*=\s*(\d+)\s*;/gm;

    for(const match of hardwareModelEnumMatch[1].matchAll(enumEntryRegex)){
        hardwareModels[match[2]] = match[1];
    }

    return hardwareModels;
}

function loadBundledHardwareModels() {
    return JSON.parse(fs.readFileSync(bundledHardwareModelsPath, "utf-8"));
}

function loadHardwareModelsFromProtobufs() {
    for(const filePath of protobufMeshProtoCandidatePaths){
        if(!fs.existsSync(filePath)){
            continue;
        }

        try {
            return parseHardwareModelsFromMeshProto(fs.readFileSync(filePath, "utf-8"));
        } catch(err) {
            // Ignore unreadable protobuf files and fall back to bundled hardware models.
        }
    }

    return {};
}

function loadHardwareModels(options = {}) {
    const {
        forceReload = false,
    } = options;

    if(!forceReload && cachedHardwareModels != null){
        return cachedHardwareModels;
    }

    cachedHardwareModels = {
        ...loadBundledHardwareModels(),
        ...loadHardwareModelsFromProtobufs(),
    };

    return cachedHardwareModels;
}

function getHardwareModelIdsByName(options = {}) {
    const hardwareModels = loadHardwareModels(options);
    return new Map(
        Object.entries(hardwareModels).map(([id, name]) => [name.toUpperCase(), Number.parseInt(id, 10)])
    );
}

module.exports = {
    getHardwareModelIdsByName,
    loadHardwareModels,
    parseHardwareModelsFromMeshProto,
};

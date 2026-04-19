// node src/admin.js --purge-node-id 123
// node src/admin.js --purge-node-id '!AABBCCDD'

const fs = require("fs");
const commandLineArgs = require("command-line-args");
const commandLineUsage = require("command-line-usage");

// create prisma db client
const { PrismaClient } = require("@prisma/client");
const NodeIdUtil = require("./utils/node_id_util");
const prisma = new PrismaClient();

const optionsList = [
    {
        name: 'help',
        alias: 'h',
        type: Boolean,
        description: 'Display this usage guide.'
    },
    {
        name: "purge-node-id",
        type: String,
        description: "Purges all records for the provided node id.",
    },
    {
        name: "repair-node-identities",
        type: Boolean,
        description: "Repairs blank node names and unknown hardware models from saved map reports.",
    },
    {
        name: "import-node-identities-url",
        type: String,
        description: "Imports node identities from a JSON API URL.",
    },
    {
        name: "import-node-identities-file",
        type: String,
        description: "Imports node identities from a local JSON file.",
    },
];

// parse command line args
const options = commandLineArgs(optionsList);

// show help
if(options.help){
    const usage = commandLineUsage([
        {
            header: 'Meshtastic Map Admin',
            content: 'Command line admin tool for the Meshtastic Map',
        },
        {
            header: 'Options',
            optionList: optionsList,
        },
    ]);
    console.log(usage);
    return;
}

// get options and fallback to default values
const purgeNodeId = options["purge-node-id"] ?? null;
const repairNodeIdentities = options["repair-node-identities"] ?? false;
const importNodeIdentitiesUrl = options["import-node-identities-url"] ?? null;
const importNodeIdentitiesFile = options["import-node-identities-file"] ?? null;

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

async function importNodeIdentitiesFromJsonPayload(payload, sourceLabel) {
    const importedNodes = getImportedNodesFromPayload(payload);
    if(importedNodes.length === 0){
        console.log(`No importable nodes found in ${sourceLabel}.`);
        return;
    }

    let importedCount = 0;
    let skippedCount = 0;

    for(const sourceNode of importedNodes){
        const importedIdentity = buildImportedNodeIdentity(sourceNode);
        if(importedIdentity == null || Object.keys(importedIdentity.data).length === 0){
            skippedCount += 1;
            continue;
        }

        await prisma.node.upsert({
            where: {
                node_id: importedIdentity.node_id,
            },
            create: {
                node_id: importedIdentity.node_id,
                long_name: importedIdentity.data.long_name ?? "",
                short_name: importedIdentity.data.short_name ?? "",
                hardware_model: importedIdentity.data.hardware_model ?? 0,
                role: importedIdentity.data.role ?? 0,
                firmware_version: importedIdentity.data.firmware_version ?? null,
            },
            update: importedIdentity.data,
        });

        importedCount += 1;
    }

    console.log(`Imported identities for ${importedCount} node(s) from ${sourceLabel}. Skipped ${skippedCount} node(s) without usable identity data.`);
}

async function importNodeIdentitiesFromFile(filePath) {
    const fileContents = fs.readFileSync(filePath, "utf-8");
    const payload = JSON.parse(fileContents);
    await importNodeIdentitiesFromJsonPayload(payload, `file ${filePath}`);
}

async function importNodeIdentitiesFromUrl(url) {
    const response = await fetch(url, {
        headers: {
            "accept": "application/json",
        },
    });

    if(!response.ok){
        throw new Error(`Request failed with status ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    await importNodeIdentitiesFromJsonPayload(payload, `URL ${url}`);
}

async function purgeNodeById(nodeId) {

    // convert to numeric id
    nodeId = NodeIdUtil.convertToNumeric(nodeId);

    // purge environment metrics
    await prisma.environmentMetric.deleteMany({
        where: {
            node_id: nodeId,
        },
    });

    // purge map reports
    await prisma.mapReport.deleteMany({
        where: {
            node_id: nodeId,
        },
    });

    // purge neighbour infos
    await prisma.neighbourInfo.deleteMany({
        where: {
            node_id: nodeId,
        },
    });

    // purge this node
    await prisma.node.deleteMany({
        where: {
            node_id: nodeId,
        },
    });

    // purge positions
    await prisma.position.deleteMany({
        where: {
            node_id: nodeId,
        },
    });

    // purge power metrics
    await prisma.powerMetric.deleteMany({
        where: {
            node_id: nodeId,
        },
    });

    // purge text messages
    await prisma.textMessage.deleteMany({
        where: {
            from: nodeId,
        },
    });

    // purge traceroutes
    await prisma.traceRoute.deleteMany({
        where: {
            from: nodeId,
        },
    });

    // purge waypoints
    await prisma.waypoint.deleteMany({
        where: {
            from: nodeId,
        },
    });

    console.log(`✅ Node '${nodeId}' has been purged from the database.`);

}

async function repairNodeIdentitiesFromMapReports() {

    const nodes = await prisma.node.findMany({
        select: {
            node_id: true,
            long_name: true,
            short_name: true,
            hardware_model: true,
        },
    });

    const nodesMissingLongNameCount = nodes.filter((node) => getMeaningfulString(node.long_name) == null).length;
    const nodesMissingShortNameCount = nodes.filter((node) => getMeaningfulString(node.short_name) == null).length;
    const nodesMissingHardwareModelCount = nodes.filter((node) => !hasKnownHardwareModel(node.hardware_model)).length;

    const nodeIdsToRepair = nodes
        .filter((node) => {
            return getMeaningfulString(node.long_name) == null
                || getMeaningfulString(node.short_name) == null
                || !hasKnownHardwareModel(node.hardware_model);
        })
        .map((node) => node.node_id);

    if(nodeIdsToRepair.length === 0){
        console.log("No node identities needed repair.");
        console.log(`Node identity stats: ${nodes.length} total, ${nodesMissingLongNameCount} missing long name, ${nodesMissingShortNameCount} missing short name, ${nodesMissingHardwareModelCount} missing hardware model.`);
        return;
    }

    const mapReports = await prisma.mapReport.findMany({
        where: {
            node_id: {
                in: nodeIdsToRepair,
            },
            OR: [
                {
                    long_name: {
                        not: "",
                    },
                },
                {
                    short_name: {
                        not: "",
                    },
                },
                {
                    hardware_model: {
                        not: 0,
                    },
                },
            ],
        },
        select: {
            node_id: true,
            long_name: true,
            short_name: true,
            hardware_model: true,
            role: true,
            firmware_version: true,
        },
        orderBy: {
            created_at: "desc",
        },
    });

    console.log(`Node identity stats: ${nodes.length} total, ${nodesMissingLongNameCount} missing long name, ${nodesMissingShortNameCount} missing short name, ${nodesMissingHardwareModelCount} missing hardware model.`);
    console.log(`Repair candidates: ${nodeIdsToRepair.length} node(s), ${mapReports.length} usable map report row(s).`);

    const fallbackByNodeId = new Map();
    for(const mapReport of mapReports){
        const nodeIdKey = mapReport.node_id.toString();
        const fallback = fallbackByNodeId.get(nodeIdKey) ?? {};

        if(fallback.long_name == null){
            const longName = getMeaningfulString(mapReport.long_name);
            if(longName != null){
                fallback.long_name = longName;
            }
        }

        if(fallback.short_name == null){
            const shortName = getMeaningfulString(mapReport.short_name);
            if(shortName != null){
                fallback.short_name = shortName;
            }
        }

        if(fallback.hardware_model == null && hasKnownHardwareModel(mapReport.hardware_model)){
            fallback.hardware_model = mapReport.hardware_model;
        }

        if(fallback.role == null && mapReport.role != null){
            fallback.role = mapReport.role;
        }

        if(fallback.firmware_version == null){
            const firmwareVersion = getMeaningfulString(mapReport.firmware_version);
            if(firmwareVersion != null){
                fallback.firmware_version = firmwareVersion;
            }
        }

        if(Object.keys(fallback).length > 0){
            fallbackByNodeId.set(nodeIdKey, fallback);
        }
    }

    let repairedNodeCount = 0;

    for(const node of nodes){
        const fallback = fallbackByNodeId.get(node.node_id.toString());
        if(fallback == null){
            continue;
        }

        const data = {};

        if(getMeaningfulString(node.long_name) == null && fallback.long_name != null){
            data.long_name = fallback.long_name;
        }

        if(getMeaningfulString(node.short_name) == null && fallback.short_name != null){
            data.short_name = fallback.short_name;
        }

        if(!hasKnownHardwareModel(node.hardware_model) && fallback.hardware_model != null){
            data.hardware_model = fallback.hardware_model;
        }

        if(Object.keys(data).length === 0){
            continue;
        }

        if(fallback.role != null){
            data.role = fallback.role;
        }

        if(fallback.firmware_version != null){
            data.firmware_version = fallback.firmware_version;
        }

        await prisma.node.updateMany({
            where: {
                node_id: node.node_id,
            },
            data: data,
        });

        repairedNodeCount += 1;
    }

    console.log(`Repaired identities for ${repairedNodeCount} node(s).`);
    if(repairedNodeCount === 0){
        console.log("No matching historical map reports with usable names or hardware models were found for the affected nodes.");
    }
}

(async () => {
    try {

        // purge node by id
        if(purgeNodeId){
            await purgeNodeById(purgeNodeId);
        }

        if(repairNodeIdentities){
            await repairNodeIdentitiesFromMapReports();
        }

        if(importNodeIdentitiesFile){
            await importNodeIdentitiesFromFile(importNodeIdentitiesFile);
        }

        if(importNodeIdentitiesUrl){
            await importNodeIdentitiesFromUrl(importNodeIdentitiesUrl);
        }
    } finally {
        await prisma.$disconnect();
    }
})();

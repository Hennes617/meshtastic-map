// node src/admin.js --purge-node-id 123
// node src/admin.js --purge-node-id '!AABBCCDD'

const commandLineArgs = require("command-line-args");
const commandLineUsage = require("command-line-usage");

// create prisma db client
const { PrismaClient } = require("@prisma/client");
const NodeIdUtil = require("./utils/node_id_util");
const {
    getMeaningfulLongName,
    getMeaningfulShortName,
    getMeaningfulString,
    hasKnownHardwareModel,
    importNodeIdentitiesFromFile,
    importNodeIdentitiesFromUrl,
} = require("./utils/node_identity_import");
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
        name: "purge-duplicate-nodes-by-position",
        type: Boolean,
        description: "Lists node records that share the same latitude and longitude. This is a dry run unless --confirm-duplicate-position-purge is also provided.",
    },
    {
        name: "confirm-duplicate-position-purge",
        type: Boolean,
        description: "Actually purge nodes reported by --purge-duplicate-nodes-by-position. Review the dry-run output first; co-located nodes may be legitimate.",
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
const purgeDuplicateNodesByPosition = options["purge-duplicate-nodes-by-position"] ?? false;
const confirmDuplicatePositionPurge = options["confirm-duplicate-position-purge"] ?? false;
const importNodeIdentitiesUrl = options["import-node-identities-url"] ?? null;
const importNodeIdentitiesFile = options["import-node-identities-file"] ?? null;

async function purgeNodeById(nodeId) {

    // convert to numeric id
    nodeId = NodeIdUtil.convertToNumeric(nodeId);
    if(nodeId === NodeIdUtil.MAX_NODE_ID){
        throw new Error("Refusing to purge the Meshtastic broadcast address (!FFFFFFFF).");
    }

    const deleteOperations = [
        prisma.deviceMetric.deleteMany({ where: { node_id: nodeId } }),
        prisma.environmentMetric.deleteMany({ where: { node_id: nodeId } }),
        prisma.mapReport.deleteMany({ where: { node_id: nodeId } }),
        prisma.neighbourInfo.deleteMany({ where: { node_id: nodeId } }),
        prisma.position.deleteMany({
            where: {
                OR: [
                    { node_id: nodeId },
                    { from: nodeId },
                    { to: nodeId },
                    { gateway_id: nodeId },
                ],
            },
        }),
        prisma.powerMetric.deleteMany({ where: { node_id: nodeId } }),
        prisma.serviceEnvelope.deleteMany({
            where: {
                OR: [
                    { from: nodeId },
                    { to: nodeId },
                    { gateway_id: nodeId },
                ],
            },
        }),
        prisma.textMessage.deleteMany({
            where: {
                OR: [
                    { from: nodeId },
                    { to: nodeId },
                    { gateway_id: nodeId },
                ],
            },
        }),
        prisma.traceRoute.deleteMany({
            where: {
                OR: [
                    { from: nodeId },
                    { to: nodeId },
                    { gateway_id: nodeId },
                ],
            },
        }),
        prisma.waypoint.deleteMany({
            where: {
                OR: [
                    { from: nodeId },
                    { to: nodeId },
                    { gateway_id: nodeId },
                    { locked_to: nodeId },
                ],
            },
        }),
        prisma.node.deleteMany({ where: { node_id: nodeId } }),
    ];

    const results = await prisma.$transaction(deleteOperations);
    const deletedRecords = results.reduce((total, result) => total + result.count, 0);

    console.log(`✅ Node '${nodeId}' and ${deletedRecords - results.at(-1).count} related record(s) have been purged from the database.`);

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

    const nodesMissingLongNameCount = nodes.filter((node) => getMeaningfulLongName(node.long_name) == null).length;
    const nodesMissingShortNameCount = nodes.filter((node) => getMeaningfulShortName(node.short_name, node.node_id) == null).length;
    const nodesMissingHardwareModelCount = nodes.filter((node) => !hasKnownHardwareModel(node.hardware_model)).length;

    const nodeIdsToRepair = nodes
        .filter((node) => {
            return getMeaningfulLongName(node.long_name) == null
                || getMeaningfulShortName(node.short_name, node.node_id) == null
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
            const longName = getMeaningfulLongName(mapReport.long_name);
            if(longName != null){
                fallback.long_name = longName;
            }
        }

        if(fallback.short_name == null){
            const shortName = getMeaningfulShortName(mapReport.short_name, mapReport.node_id);
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

        if(getMeaningfulLongName(node.long_name) == null && fallback.long_name != null){
            data.long_name = fallback.long_name;
        }

        if(getMeaningfulShortName(node.short_name, node.node_id) == null && fallback.short_name != null){
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

async function purgeDuplicateNodesByLocation({ confirm = false } = {}) {
    const duplicateCoordinateGroups = await prisma.node.groupBy({
        by: ["latitude", "longitude"],
        where: {
            latitude: {
                not: null,
            },
            longitude: {
                not: null,
            },
        },
        _count: {
            _all: true,
        },
        having: {
            latitude: {
                _count: {
                    gt: 1,
                },
            },
        },
        orderBy: {
            _count: {
                latitude: "desc",
            },
        },
    });

    if(duplicateCoordinateGroups.length === 0){
        console.log("No duplicate node locations found.");
        return;
    }

    let candidateNodesCount = 0;
    let purgedNodesCount = 0;
    for(const duplicateGroup of duplicateCoordinateGroups){
        const nodesAtCoordinate = await prisma.node.findMany({
            where: {
                latitude: duplicateGroup.latitude,
                longitude: duplicateGroup.longitude,
            },
            select: {
                node_id: true,
                position_updated_at: true,
                updated_at: true,
                created_at: true,
                id: true,
            },
            orderBy: [
                {
                    position_updated_at: "desc",
                },
                {
                    updated_at: "desc",
                },
                {
                    created_at: "desc",
                },
                {
                    id: "desc",
                },
            ],
        });

        const [nodeToKeep, ...nodesToPurge] = nodesAtCoordinate;
        if(nodeToKeep == null || nodesToPurge.length === 0){
            continue;
        }

        candidateNodesCount += nodesToPurge.length;
        const action = confirm ? "purging" : "would purge";
        console.log(`Keeping node ${nodeToKeep.node_id.toString()} at (${duplicateGroup.latitude}, ${duplicateGroup.longitude}) and ${action} ${nodesToPurge.length} possible duplicate(s): ${nodesToPurge.map((node) => node.node_id.toString()).join(", ")}.`);

        if(confirm){
            for(const nodeToPurge of nodesToPurge){
                await purgeNodeById(nodeToPurge.node_id);
                purgedNodesCount += 1;
            }
        }
    }

    if(!confirm){
        console.log(`Dry run complete: ${candidateNodesCount} possible duplicate(s) across ${duplicateCoordinateGroups.length} location group(s). No data was changed.`);
        console.log("Review these nodes carefully. Co-located nodes can be legitimate. Re-run with --purge-duplicate-nodes-by-position --confirm-duplicate-position-purge to delete them.");
        return;
    }

    console.log(`✅ Finished purging duplicate node locations. Removed ${purgedNodesCount} node(s) across ${duplicateCoordinateGroups.length} location group(s).`);
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

        if(purgeDuplicateNodesByPosition){
            await purgeDuplicateNodesByLocation({
                confirm: confirmDuplicatePositionPurge,
            });
        }

        if(importNodeIdentitiesFile){
            const result = await importNodeIdentitiesFromFile(prisma, importNodeIdentitiesFile);
            console.log(`Imported identities for ${result.imported_count} node(s) from ${result.source_label}. Skipped ${result.skipped_count} node(s) without usable or missing identity data.`);
        }

        if(importNodeIdentitiesUrl){
            const result = await importNodeIdentitiesFromUrl(prisma, importNodeIdentitiesUrl);
            console.log(`Imported identities for ${result.imported_count} node(s) from ${result.source_label}. Skipped ${result.skipped_count} node(s) without usable or missing identity data.`);
        }
    } finally {
        await prisma.$disconnect();
    }
})();

const fs = require("fs");
const path = require('path');
const express = require('express');
const compression = require('compression');
const commandLineArgs = require("command-line-args");
const commandLineUsage = require("command-line-usage");
const { loadHardwareModels } = require("./utils/hardware_models");

// create prisma db client
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// return big ints as string when using JSON.stringify
BigInt.prototype.toJSON = function() {
    return this.toString();
}

const optionsList = [
    {
        name: 'help',
        alias: 'h',
        type: Boolean,
        description: 'Display this usage guide.'
    },
    {
        name: "port",
        type: Number,
        description: "Port to serve web ui and api from.",
    },
];

// parse command line args
const options = commandLineArgs(optionsList);

// show help
if(options.help){
    const usage = commandLineUsage([
        {
            header: 'Meshtastic Map',
            content: 'A map of all Meshtastic nodes heard via MQTT.',
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
const port = options["port"] ?? 8080;

// load json
const hardwareModels = loadHardwareModels();
const roles = JSON.parse(fs.readFileSync(path.join(__dirname, "json/roles.json"), "utf-8"));
const regionCodes = JSON.parse(fs.readFileSync(path.join(__dirname, "json/region_codes.json"), "utf-8"));
const modemPresets = JSON.parse(fs.readFileSync(path.join(__dirname, "json/modem_presets.json"), "utf-8"));
const deviceImagesDirectory = path.join(__dirname, "public/images/devices");
const availableDeviceImageFiles = listDeviceImageFiles(deviceImagesDirectory)
    .filter((filename) => {
        const extension = path.extname(filename).toLowerCase();
        return [".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension);
    });
const deviceImageBasenameAliases = new Map(
    Object.entries({
        "HELTEC_HT62": "heltec-ht62-esp32c3-sx1262",
        "HELTEC_MESH_NODE_T114": "heltec-mesh-node-t114",
        "HELTEC_MESH_POCKET": "heltec_mesh_pocket",
        "HELTEC_MESH_SOLAR": "heltec-mesh-solar",
        "HELTEC_SENSOR_HUB": "heltec-mesh-solar",
        "HELTEC_V3": "heltec-v3",
        "HELTEC_V4": "heltec_v4",
        "HELTEC_VISION_MASTER_E213": "heltec-vision-master-e213",
        "HELTEC_VISION_MASTER_E290": "heltec-vision-master-e290",
        "HELTEC_VISION_MASTER_T190": "heltec-vision-master-t190",
        "HELTEC_WIRELESS_PAPER": "heltec-wireless-paper",
        "HELTEC_WIRELESS_PAPER_V1_0": "heltec-wireless-paper-V1_0",
        "HELTEC_WIRELESS_TRACKER": "heltec-wireless-tracker",
        "HELTEC_WIRELESS_TRACKER_V1_0": "heltec-wireless-tracker-V1-0",
        "HELTEC_WIRELESS_TRACKER_V2": "heltec_wireless_tracker_v2",
        "HELTEC_WSL_V3": "heltec-wsl-v3",
        "LILYGO_TBEAM_S3_CORE": "tbeam-s3-core",
        "M5STACK_C6L": "m5_c6l",
        "M5STACK_CARDPUTER_ADV": "m5stack_cardputer",
        "NANO_G2_ULTRA": "nano-g2-ultra",
        "NOMADSTAR_METEOR_PRO": "meteor_pro",
        "PRIVATE_HW": "diy",
        "RAK11200": "rak11200",
        "RAK11310": "rak11310",
        "RAK2560": "rak2560",
        "RAK4631": "rak4631",
        "RPI_PICO": "pico",
        "RPI_PICO2": "pico",
        "SEEED_SOLAR_NODE": "seeed_solar",
        "SEEED_WIO_TRACKER_L1": "wio_tracker_l1",
        "SEEED_WIO_TRACKER_L1_EINK": "wio_tracker_l1_eink",
        "SEEED_XIAO_S3": "seeed-xiao-s3",
        "SENSECAP_INDICATOR": "seeed-sensecap-indicator",
        "STATION_G2": "station-g2",
        "T_DECK": "t-deck",
        "T_DECK_PRO": "tdeck_pro",
        "T_ECHO": "t-echo",
        "T_ECHO_LITE": "techo_lite",
        "TLORA_C6": "tlora-c6",
        "TLORA_V2_1_1P6": "tlora-v2-1-1_6",
        "TLORA_V2_1_1P8": "tlora-v2-1-1_8",
        "T5_S3_EPAPER_PRO": "t5s3_epaper",
        "TBEAM_1_WATT": "tbeam-1w",
        "TRACKER_T1000_E": "tracker-t1000-e",
        "WIO_WM1110": "wio-tracker-wm1110",
        "WISMESH_TAG": "rak_wismesh_tag",
        "WISMESH_TAP": "rak-wismeshtap",
        "WISMESH_TAP_V2": "rak-wismesh-tap-v2",
        "XIAO_NRF52_KIT": "seeed_xiao_nrf52_kit",
    }).map(([hardwareModelName, basename]) => [hardwareModelName, basename])
);
const deviceImageFilesByBasename = buildPreferredImageMap(
    availableDeviceImageFiles,
    (filename) => path.parse(filename).name
);
const deviceImageFilesByNormalizedName = buildPreferredImageMap(
    availableDeviceImageFiles,
    (filename) => normalizeDeviceImageKey(path.parse(filename).name)
);
const availableDeviceImageBasenames = new Set(deviceImageFilesByBasename.keys());

// The map only needs a subset of the node columns during the initial load.
const mapNodeSelect = {
    node_id: true,
    long_name: true,
    short_name: true,
    hardware_model: true,
    role: true,
    firmware_version: true,
    region: true,
    modem_preset: true,
    has_default_channel: true,
    position_precision: true,
    num_online_local_nodes: true,
    latitude: true,
    longitude: true,
    altitude: true,
    position_updated_at: true,
    battery_level: true,
    voltage: true,
    channel_utilization: true,
    air_util_tx: true,
    neighbours_updated_at: true,
    mqtt_connection_state_updated_at: true,
    created_at: true,
    updated_at: true,
};

const searchNodeSelect = {
    node_id: true,
    long_name: true,
    short_name: true,
    hardware_model: true,
    role: true,
    latitude: true,
    longitude: true,
    mqtt_connection_state_updated_at: true,
    created_at: true,
    updated_at: true,
};

const textMessageNodeSelect = {
    node_id: true,
    long_name: true,
    short_name: true,
};

// appends extra info for node objects returned from api
function formatNodeIdHex(nodeId) {
    return "!" + nodeId.toString(16);
}

function getDisplayShortName(node, nodeIdHex) {
    const shortName = node.short_name?.trim();
    if(shortName){
        return shortName;
    }

    return nodeIdHex.replace("!", "").slice(-4).toUpperCase();
}

function getDisplayLongName(node, nodeIdHex) {
    const longName = node.long_name?.trim();
    if(longName){
        return longName;
    }

    return `Node ${nodeIdHex}`;
}

function getHardwareModelName(hardwareModel) {
    if(hardwareModel == null || hardwareModel === 0){
        return "Unknown Device";
    }

    const hardwareModelName = hardwareModels[hardwareModel] ?? null;

    if(hardwareModelName == null || hardwareModelName === "UNSET"){
        return `Unknown Device (${hardwareModel})`;
    }

    return hardwareModelName;
}

function listDeviceImageFiles(directory, subdirectory = "") {
    const currentDirectory = subdirectory ? path.join(directory, subdirectory) : directory;
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    const imageFiles = [];

    for(const entry of entries){
        const relativePath = subdirectory ? path.posix.join(subdirectory, entry.name) : entry.name;
        if(entry.isDirectory()){
            imageFiles.push(...listDeviceImageFiles(directory, relativePath));
            continue;
        }

        imageFiles.push(relativePath);
    }

    return imageFiles;
}

function normalizeDeviceImageKey(value) {
    return value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
}

function getDeviceImagePriority(filename) {
    const extension = path.extname(filename).toLowerCase();
    const extensionPriority = {
        ".svg": 30,
        ".png": 20,
        ".webp": 15,
        ".jpg": 10,
        ".jpeg": 10,
        ".gif": 5,
    };

    let priority = extensionPriority[extension] ?? 0;

    if(!filename.startsWith("old_images/")){
        priority += 100;
    }

    priority -= filename.split("/").length;

    return priority;
}

function buildPreferredImageMap(filenames, keySelector) {
    const imageMap = new Map();

    for(const filename of filenames){
        const key = keySelector(filename);
        const existingFilename = imageMap.get(key) ?? null;

        if(existingFilename == null || getDeviceImagePriority(filename) > getDeviceImagePriority(existingFilename)){
            imageMap.set(key, filename);
        }
    }

    return imageMap;
}

function getResolvedDeviceImageFile(hardwareModelName) {
    if(hardwareModelName == null){
        return deviceImageFilesByBasename.get("unknown-new") ?? null;
    }

    const aliasedBasename = deviceImageBasenameAliases.get(hardwareModelName) ?? null;
    if(aliasedBasename != null && deviceImageFilesByBasename.has(aliasedBasename)){
        return deviceImageFilesByBasename.get(aliasedBasename);
    }

    if(deviceImageFilesByBasename.has(hardwareModelName)){
        return deviceImageFilesByBasename.get(hardwareModelName);
    }

    const normalizedHardwareModelName = normalizeDeviceImageKey(hardwareModelName);
    if(deviceImageFilesByNormalizedName.has(normalizedHardwareModelName)){
        return deviceImageFilesByNormalizedName.get(normalizedHardwareModelName);
    }

    for(const basename of availableDeviceImageBasenames){
        const normalizedBasename = normalizeDeviceImageKey(basename);
        if(normalizedHardwareModelName.includes(normalizedBasename)
            || normalizedBasename.includes(normalizedHardwareModelName)){
            return deviceImageFilesByBasename.get(basename);
        }
    }

    return deviceImageFilesByBasename.get("unknown-new") ?? null;
}

function getHardwareImageUrl(hardwareModelName) {
    const resolvedDeviceImageFile = getResolvedDeviceImageFile(hardwareModelName);
    if(resolvedDeviceImageFile != null){
        return `/images/devices/${resolvedDeviceImageFile}`;
    }

    return "/images/no_image.png";
}

function hasHardwareImage(hardwareModelName) {
    return getResolvedDeviceImageFile(hardwareModelName) != null;
}

function formatNodeInfo(node) {
    const nodeIdHex = formatNodeIdHex(node.node_id);
    const hardwareModelName = getHardwareModelName(node.hardware_model);

    return {
        ...node,
        raw_long_name: node.long_name,
        raw_short_name: node.short_name,
        node_id_hex: nodeIdHex,
        long_name: getDisplayLongName(node, nodeIdHex),
        short_name: getDisplayShortName(node, nodeIdHex),
        hardware_model_name: hardwareModelName,
        hardware_image_url: getHardwareImageUrl(hardwareModelName),
        has_hardware_image: hasHardwareImage(hardwareModelName),
        role_name: roles[node.role] ?? null,
        region_name: regionCodes[node.region] ?? null,
        modem_preset_name: modemPresets[node.modem_preset] ?? null,
    };
}

function parseNodeIds(idsValue) {
    if(!idsValue){
        return [];
    }

    const ids = idsValue
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 250);

    const parsedIds = [];
    for(const id of ids){
        try {
            parsedIds.push(BigInt(id));
        } catch(err) {
            // ignore invalid ids
        }
    }

    return [...new Set(parsedIds)];
}

function parseBooleanQueryParam(value) {
    if(value == null){
        return false;
    }

    switch(value.toString().trim().toLowerCase()){
        case "1":
        case "true":
        case "yes":
        case "on":
            return true;
        default:
            return false;
    }
}

const app = express();

// enable compression
app.use(compression());

// serve files inside the public folder from /
app.use('/', express.static(path.join(__dirname, 'public')));

app.get('/', async (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/api', async (req, res) => {

    const links = [
        {
            "path": "/api",
            "description": "This page",
        },
        {
            "path": "/api/v1/nodes",
            "description": "All meshtastic nodes",
            "params": {
                "role": "Filter by role",
                "hardware_model": "Filter by hardware model",
                "view": "Response shape: map or search",
                "mappable_only": "Only include nodes with both latitude and longitude",
            },
        },
        {
            "path": "/api/v1/nodes/by-ids",
            "description": "Specific meshtastic nodes by id",
            "params": {
                "ids": "Comma separated node ids",
            },
        },
        {
            "path": "/api/v1/nodes/:nodeId",
            "description": "A specific meshtastic node",
        },
        {
            "path": "/api/v1/nodes/:nodeId/device-metrics",
            "description": "Device metrics for a meshtastic node",
            "params": {
                "count": "How many results to return",
                "time_from": "Only include metrics created after this unix timestamp (milliseconds)",
                "time_to": "Only include metrics created before this unix timestamp (milliseconds)",
            },
        },
        {
            "path": "/api/v1/nodes/:nodeId/environment-metrics",
            "description": "Environment metrics for a meshtastic node",
            "params": {
                "count": "How many results to return",
                "time_from": "Only include metrics created after this unix timestamp (milliseconds)",
                "time_to": "Only include metrics created before this unix timestamp (milliseconds)",
            },
        },
        {
            "path": "/api/v1/nodes/:nodeId/power-metrics",
            "description": "Power metrics for a meshtastic node",
            "params": {
                "count": "How many results to return",
                "time_from": "Only include metrics created after this unix timestamp (milliseconds)",
                "time_to": "Only include metrics created before this unix timestamp (milliseconds)",
            },
        },
        {
            "path": "/api/v1/nodes/:nodeId/neighbours",
            "description": "Neighbours for a meshtastic node",
        },
        {
            "path": "/api/v1/nodes/:nodeId/traceroutes",
            "description": "Trace routes for a meshtastic node",
        },
        {
            "path": "/api/v1/nodes/:nodeId/position-history",
            "description": "Position history for a meshtastic node",
            "params": {
                "time_from": "Only include positions created after this unix timestamp (milliseconds)",
                "time_to": "Only include positions created before this unix timestamp (milliseconds)",
            },
        },
        {
            "path": "/api/v1/stats/hardware-models",
            "description": "Database statistics about known hardware models",
        },
        {
            "path": "/api/v1/text-messages",
            "description": "Text messages",
            "params": {
                "to": "Only include messages to this node id",
                "from": "Only include messages from this node id",
                "channel_id": "Only include messages for this channel id",
                "gateway_id": "Only include messages gated to mqtt by this node id",
                "last_id": "Only include messages before or after this id, based on results order",
                "count": "How many results to return",
                "order": "Order to return results in: asc, desc",
            },
        },
        {
            "path": "/api/v1/text-messages/embed",
            "description": "Text messages rendered as an embeddable HTML page.",
        },
        {
            "path": "/api/v1/waypoints",
            "description": "Waypoints",
        },
    ];

    const linksHtml = links.map((link) => {
        var line = `<li>`;
        line += `<a href="${link.path}">${link.path}</a> - ${link.description}`;
        line += `<ul>`;
        for(const paramKey in (link.params ?? [])){
            const paramDescription = link.params[paramKey];
            line += "<li>";
            line += `?${paramKey}: ${paramDescription}`;
            line += `</li>`;
        }
        line += `</ul>`;
        return line;
    }).join("");

    res.send(`<b>API Docs</b><br/><ul>${linksHtml}</ul>`);

});

app.get('/api/v1/nodes', async (req, res) => {
    try {

        // get query params
        const role = req.query.role ? parseInt(req.query.role) : undefined;
        const hardwareModel = req.query.hardware_model ? parseInt(req.query.hardware_model) : undefined;
        const view = req.query.view === "search" ? "search" : "map";
        const mappableOnly = parseBooleanQueryParam(req.query.mappable_only);

        const where = {
            role: role,
            hardware_model: hardwareModel,
            latitude: mappableOnly ? { not: null } : undefined,
            longitude: mappableOnly ? { not: null } : undefined,
        };

        // get nodes from db
        const nodes = await prisma.node.findMany({
            select: view === "search" ? searchNodeSelect : mapNodeSelect,
            where: where,
        });

        const nodesWithInfo = [];
        for(const node of nodes){
            nodesWithInfo.push(formatNodeInfo(node));
        }

        res.json({
            nodes: nodesWithInfo,
        });

    } catch(err) {
        console.error(err);
        res.status(500).json({
            message: "Something went wrong, try again later.",
        });
    }
});

app.get('/api/v1/nodes/by-ids', async (req, res) => {
    try {

        const ids = parseNodeIds(req.query.ids ?? "");
        if(ids.length === 0){
            res.json({
                nodes: [],
            });
            return;
        }

        const nodes = await prisma.node.findMany({
            select: textMessageNodeSelect,
            where: {
                node_id: {
                    in: ids,
                },
            },
        });

        res.json({
            nodes: nodes.map((node) => formatNodeInfo(node)),
        });

    } catch(err) {
        console.error(err);
        res.status(500).json({
            message: "Something went wrong, try again later.",
        });
    }
});

app.get('/api/v1/nodes/:nodeId', async (req, res) => {
    try {

        const nodeId = parseInt(req.params.nodeId);

        // find node
        const node = await prisma.node.findUnique({
            where: {
                node_id: nodeId,
            },
        });

        // make sure node exists
        if(!node){
            res.status(404).json({
                message: "Not Found",
            });
            return;
        }

        res.json({
            node: formatNodeInfo(node),
        });

    } catch(err) {
        console.error(err);
        res.status(500).json({
            message: "Something went wrong, try again later.",
        });
    }
});

app.get('/api/v1/nodes/:nodeId/device-metrics', async (req, res) => {
    try {

        const nodeId = parseInt(req.params.nodeId);
        const count = req.query.count ? parseInt(req.query.count) : undefined;
        const timeFrom = req.query.time_from ? parseInt(req.query.time_from) : undefined;
        const timeTo = req.query.time_to ? parseInt(req.query.time_to) : undefined;

        // find node
        const node = await prisma.node.findFirst({
            where: {
                node_id: nodeId,
            },
        });

        // make sure node exists
        if(!node){
            res.status(404).json({
                message: "Not Found",
            });
            return;
        }

        // get latest device metrics
        const deviceMetrics = await prisma.deviceMetric.findMany({
            where: {
                node_id: node.node_id,
                created_at: {
                    gte: timeFrom ? new Date(timeFrom) : undefined,
                    lte: timeTo ? new Date(timeTo) : undefined,
                },
            },
            orderBy: {
                id: 'desc',
            },
            take: count,
        });

        res.json({
            device_metrics: deviceMetrics,
        });

    } catch(err) {
        console.error(err);
        res.status(500).json({
            message: "Something went wrong, try again later.",
        });
    }
});

app.get('/api/v1/nodes/:nodeId/environment-metrics', async (req, res) => {
    try {

        const nodeId = parseInt(req.params.nodeId);
        const count = req.query.count ? parseInt(req.query.count) : undefined;
        const timeFrom = req.query.time_from ? parseInt(req.query.time_from) : undefined;
        const timeTo = req.query.time_to ? parseInt(req.query.time_to) : undefined;

        // find node
        const node = await prisma.node.findFirst({
            where: {
                node_id: nodeId,
            },
        });

        // make sure node exists
        if(!node){
            res.status(404).json({
                message: "Not Found",
            });
            return;
        }

        // get latest environment metrics
        const environmentMetrics = await prisma.environmentMetric.findMany({
            where: {
                node_id: node.node_id,
                created_at: {
                    gte: timeFrom ? new Date(timeFrom) : undefined,
                    lte: timeTo ? new Date(timeTo) : undefined,
                },
            },
            orderBy: {
                id: 'desc',
            },
            take: count,
        });

        res.json({
            environment_metrics: environmentMetrics,
        });

    } catch(err) {
        console.error(err);
        res.status(500).json({
            message: "Something went wrong, try again later.",
        });
    }
});

app.get('/api/v1/nodes/:nodeId/power-metrics', async (req, res) => {
    try {

        const nodeId = parseInt(req.params.nodeId);
        const count = req.query.count ? parseInt(req.query.count) : undefined;
        const timeFrom = req.query.time_from ? parseInt(req.query.time_from) : undefined;
        const timeTo = req.query.time_to ? parseInt(req.query.time_to) : undefined;

        // find node
        const node = await prisma.node.findFirst({
            where: {
                node_id: nodeId,
            },
        });

        // make sure node exists
        if(!node){
            res.status(404).json({
                message: "Not Found",
            });
            return;
        }

        // get latest power metrics
        const powerMetrics = await prisma.powerMetric.findMany({
            where: {
                node_id: node.node_id,
                created_at: {
                    gte: timeFrom ? new Date(timeFrom) : undefined,
                    lte: timeTo ? new Date(timeTo) : undefined,
                },
            },
            orderBy: {
                id: 'desc',
            },
            take: count,
        });

        res.json({
            power_metrics: powerMetrics,
        });

    } catch(err) {
        console.error(err);
        res.status(500).json({
            message: "Something went wrong, try again later.",
        });
    }
});

app.get('/api/v1/nodes/:nodeId/mqtt-metrics', async (req, res) => {
    try {

        const nodeId = parseInt(req.params.nodeId);

        // find node
        const node = await prisma.node.findFirst({
            where: {
                node_id: nodeId,
            },
        });

        // make sure node exists
        if(!node){
            res.status(404).json({
                message: "Not Found",
            });
            return;
        }

        // get mqtt topics published to by this node
        const queryResult = await prisma.$queryRaw`select mqtt_topic, count(*) as packet_count, max(created_at) as last_packet_at from service_envelopes where gateway_id = ${nodeId} group by mqtt_topic order by packet_count desc;`;

        res.json({
            mqtt_metrics: queryResult,
        });

    } catch(err) {
        console.error(err);
        res.status(500).json({
            message: "Something went wrong, try again later.",
        });
    }
});

app.get('/api/v1/nodes/:nodeId/neighbours', async (req, res) => {
    try {

        const nodeId = parseInt(req.params.nodeId);

        // find node
        const node = await prisma.node.findFirst({
            where: {
                node_id: nodeId,
            },
        });

        // make sure node exists
        if(!node){
            res.status(404).json({
                message: "Not Found",
            });
            return;
        }

        // get nodes from db that have this node as a neighbour
        const nodesThatHeardUs = await prisma.node.findMany({
            where: {
                neighbours: {
                    array_contains: {
                        node_id: Number(nodeId),
                    },
                },
            },
        });

        res.json({
            nodes_that_we_heard: node.neighbours.map((neighbour) => {
                return {
                    ...neighbour,
                    updated_at: node.neighbours_updated_at,
                };
            }),
            nodes_that_heard_us: nodesThatHeardUs.map((nodeThatHeardUs) => {
                const neighbourInfo = nodeThatHeardUs.neighbours.find((neighbour) => neighbour.node_id.toString() === node.node_id.toString());
                return {
                    node_id: Number(nodeThatHeardUs.node_id),
                    snr: neighbourInfo.snr,
                    updated_at: nodeThatHeardUs.neighbours_updated_at,
                };
            }),
        });

    } catch(err) {
        console.error(err);
        res.status(500).json({
            message: "Something went wrong, try again later.",
        });
    }
});

app.get('/api/v1/nodes/:nodeId/traceroutes', async (req, res) => {
    try {

        const nodeId = parseInt(req.params.nodeId);
        const count = req.query.count ? parseInt(req.query.count) : 10; // can't set to null because of $queryRaw

        // find node
        const node = await prisma.node.findFirst({
            where: {
                node_id: nodeId,
            },
        });

        // make sure node exists
        if(!node){
            res.status(404).json({
                message: "Not Found",
            });
            return;
        }

        // get latest traceroutes
        // We want replies where want_response is false and it will be "to" the
        // requester.
        const traceroutes = await prisma.$queryRaw`SELECT * FROM traceroutes WHERE want_response = false and \`to\` = ${node.node_id} and gateway_id is not null order by id desc limit ${count}`;

        res.json({
            traceroutes: traceroutes.map((trace) => {

                // ensure route is json array
                if(typeof(trace.route) === "string"){
                    trace.route = JSON.parse(trace.route);
                }

                // ensure route_back is json array
                if(typeof(trace.route_back) === "string"){
                    trace.route_back = JSON.parse(trace.route_back);
                }

                // ensure snr_towards is json array
                if(typeof(trace.snr_towards) === "string"){
                    trace.snr_towards = JSON.parse(trace.snr_towards);
                }

                // ensure snr_back is json array
                if(typeof(trace.snr_back) === "string"){
                    trace.snr_back = JSON.parse(trace.snr_back);
                }

                return trace;

            }),
        });

    } catch(err) {
        console.error(err);
        res.status(500).json({
            message: "Something went wrong, try again later.",
        });
    }
});

app.get('/api/v1/nodes/:nodeId/position-history', async (req, res) => {
    try {

        // defaults
        const nowInMilliseconds = new Date().getTime();
        const oneHourAgoInMilliseconds = new Date().getTime() - (3600 * 1000);

        // get request params
        const nodeId = parseInt(req.params.nodeId);
        const timeFrom = req.query.time_from ? parseInt(req.query.time_from) : oneHourAgoInMilliseconds;
        const timeTo = req.query.time_to ? parseInt(req.query.time_to) : nowInMilliseconds;

        // find node
        const node = await prisma.node.findFirst({
            where: {
                node_id: nodeId,
            },
        });

        // make sure node exists
        if(!node){
            res.status(404).json({
                message: "Not Found",
            });
            return;
        }

        const positions = await prisma.position.findMany({
            where: {
                node_id: nodeId,
                created_at: {
                    gte: new Date(timeFrom),
                    lte: new Date(timeTo),
                },
            }
        });

        const mapReports = await prisma.mapReport.findMany({
            where: {
                node_id: nodeId,
                created_at: {
                    gte: new Date(timeFrom),
                    lte: new Date(timeTo),
                },
            }
        });
        
        const positionHistory = []

        positions.forEach((position) => {
            positionHistory.push({
                id: position.id,
                node_id: position.node_id,
                type: "position",
                latitude: position.latitude,
                longitude: position.longitude,
                altitude: position.altitude,
                gateway_id: position.gateway_id,
                channel_id: position.channel_id,
                created_at: position.created_at,
            });
        });

        mapReports.forEach((mapReport) => {
            positionHistory.push({
                node_id: mapReport.node_id,
                type: "map_report",
                latitude: mapReport.latitude,
                longitude: mapReport.longitude,
                altitude: mapReport.altitude,
                created_at: mapReport.created_at,
            });
        });

        // sort oldest to newest
        positionHistory.sort((a, b) => a.created_at - b.created_at);

        res.json({
            position_history: positionHistory,
        });

    } catch(err) {
        console.error(err);
        res.status(500).json({
            message: "Something went wrong, try again later.",
        });
    }
});

app.get('/api/v1/stats/hardware-models', async (req, res) => {
    try {

        // get nodes from db
        const results = await prisma.node.groupBy({
            by: ['hardware_model'],
            orderBy: {
                _count: {
                    hardware_model: 'desc',
                },
            },
            _count: {
                hardware_model: true,
            },
        });

        const hardwareModelStats = results.map((result) => {
           const hardwareModelName = getHardwareModelName(result.hardware_model);
           return {
               count: result._count.hardware_model,
               hardware_model: result.hardware_model,
               hardware_model_name: hardwareModelName,
               hardware_image_url: getHardwareImageUrl(hardwareModelName),
               has_hardware_image: hasHardwareImage(hardwareModelName),
           };
        });

        res.json({
            hardware_model_stats: hardwareModelStats,
        });

    } catch(err) {
        console.error(err);
        res.status(500).json({
            message: "Something went wrong, try again later.",
        });
    }
});

app.get('/api/v1/text-messages', async (req, res) => {
    try {

        // get query params
        const to = req.query.to ?? undefined;
        const from = req.query.from ?? undefined;
        const channelId = req.query.channel_id ?? undefined;
        const gatewayId = req.query.gateway_id ?? undefined;
        const directMessageNodeIds = req.query.direct_message_node_ids?.split(",") ?? undefined;
        const lastId = req.query.last_id ? parseInt(req.query.last_id) : undefined;
        const count = req.query.count ? parseInt(req.query.count) : 50;
        const order = req.query.order ?? "asc";

        // if direct message node ids are provided, there should be exactly two node ids
        if(directMessageNodeIds !== undefined && directMessageNodeIds.length !== 2){
            res.status(400).json({
                message: "direct_message_node_ids requires 2 node ids separated by a comma.",
            });
            return;
        }

        // default where clauses that should always be used for filtering
        var where = {
            channel_id: channelId,
            gateway_id: gatewayId,
            // when ordered oldest to newest (asc), only get records after last id
            // when ordered newest to oldest (desc), only get records before last id
            id: order === "asc" ? {
                gt: lastId,
            } : {
                lt: lastId,
            },
        };

        // if direct message node ids are provided, we expect exactly 2 node ids
        if(directMessageNodeIds !== undefined && directMessageNodeIds.length === 2){
            // filter message by "to -> from" or "from -> to"
            const [firstNodeId, secondNodeId] = directMessageNodeIds;
            where = {
                AND: where,
                OR: [
                    {
                        to: firstNodeId,
                        from: secondNodeId,
                    },
                    {
                        to: secondNodeId,
                        from: firstNodeId,
                    },
                ],
            };
        } else {
            // filter by to and from
            where = {
                ...where,
                to: to,
                from: from,
            };
        }

        // get text messages from db
        const textMessages = await prisma.textMessage.findMany({
            where: where,
            orderBy: {
                id: order,
            },
            take: count,
        });

        res.json({
            text_messages: textMessages,
        });

    } catch(err) {
        res.status(500).json({
            message: "Something went wrong, try again later.",
        });
    }
});

app.get('/api/v1/text-messages/embed', async (req, res) => {
    res.sendFile(path.join(__dirname, 'public/text-messages-embed.html'));
});

app.get('/api/v1/waypoints', async (req, res) => {
    try {

        const nowInSeconds = Math.floor(Date.now() / 1000);

        // Get only the newest non-expired waypoint per sender/waypoint id pair.
        const nonExpiredWayPoints = await prisma.$queryRaw`
            SELECT waypoints.*
            FROM waypoints
            INNER JOIN (
                SELECT \`from\`, waypoint_id, MAX(id) AS id
                FROM waypoints
                WHERE expire >= ${nowInSeconds}
                GROUP BY \`from\`, waypoint_id
            ) latest_waypoints
                ON latest_waypoints.id = waypoints.id
            ORDER BY waypoints.id DESC
        `;

        res.json({
            waypoints: nonExpiredWayPoints,
        });

    } catch(err) {
        res.status(500).json({
            message: "Something went wrong, try again later.",
        });
    }
});

// start express server
const listener = app.listen(port, () => {
    const port = listener.address().port;
    console.log(`Server running at http://127.0.0.1:${port}`);
});

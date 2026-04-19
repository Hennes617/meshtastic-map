const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const mqtt = require("mqtt");
const protobufjs = require("protobufjs");
const commandLineArgs = require("command-line-args");
const commandLineUsage = require("command-line-usage");
const PositionUtil = require("./utils/position_util");
const { importNodeIdentitiesFromUrl } = require("./utils/node_identity_import");

// create prisma db client
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// meshtastic bitfield flags
const BITFIELD_OK_TO_MQTT_SHIFT = 0;
const BITFIELD_OK_TO_MQTT_MASK = (1 << BITFIELD_OK_TO_MQTT_SHIFT);

const optionsList = [
    {
        name: 'help',
        alias: 'h',
        type: Boolean,
        description: 'Display this usage guide.'
    },
    {
        name: "protobufs-path",
        type: String,
        description: "Path to Protobufs (e.g: ../../protobufs)",
    },
    {
        name: "mqtt-broker-url",
        type: String,
        description: "MQTT Broker URL (e.g: mqtt://mqtt.meshtastic.org)",
    },
    {
        name: "mqtt-username",
        type: String,
        description: "MQTT Username (e.g: meshdev)",
    },
    {
        name: "mqtt-password",
        type: String,
        description: "MQTT Password (e.g: large4cats)",
    },
    {
        name: "mqtt-client-id",
        type: String,
        description: "MQTT Client ID (e.g: map.example.com)",
    },
    {
        name: "mqtt-topic",
        type: String,
        multiple: true,
        typeLabel: '<topic> ...',
        description: "MQTT Topic to subscribe to (e.g: msh/+/2/e/#)",
    },
    {
        name: "identity-source-url",
        type: String,
        multiple: true,
        typeLabel: '<url> ...',
        description: "External JSON API URL(s) to sync missing node identities from.",
    },
    {
        name: "identity-sync-interval-seconds",
        type: Number,
        description: "How often to sync missing node identities from external JSON APIs.",
    },
    {
        name: "allowed-portnums",
        type: Number,
        multiple: true,
        typeLabel: '<portnum> ...',
        description: "If provided, only packets with these portnums will be processed.",
    },
    {
        name: "log-unknown-portnums",
        type: Boolean,
        description: "This option will log packets for unknown portnums to the console.",
    },
    {
        name: "collect-service-envelopes",
        type: Boolean,
        description: "This option will save all received service envelopes to the database.",
    },
    {
        name: "collect-positions",
        type: Boolean,
        description: "This option will save all received positions to the database.",
    },
    {
        name: "collect-text-messages",
        type: Boolean,
        description: "This option will save all received text messages to the database.",
    },
    {
        name: "ignore-direct-messages",
        type: Boolean,
        description: "This option will prevent saving direct messages to the database.",
    },
    {
        name: "collect-waypoints",
        type: Boolean,
        description: "This option will save all received waypoints to the database.",
    },
    {
        name: "collect-neighbour-info",
        type: Boolean,
        description: "This option will save all received neighbour infos to the database.",
    },
    {
        name: "collect-map-reports",
        type: Boolean,
        description: "This option will save all received map reports to the database.",
    },
    {
        name: "decryption-keys",
        type: String,
        multiple: true,
        typeLabel: '<base64DecryptionKey> ...',
        description: "Decryption keys encoded in base64 to use when decrypting service envelopes.",
    },
    {
        name: "drop-packets-not-ok-to-mqtt",
        type: Boolean,
        description: "This option will drop all packets that have 'OK to MQTT' set to false.",
    },
    {
        name: "drop-portnums-without-bitfield",
        type: Number,
        multiple: true,
        typeLabel: '<portnum> ...',
        description: "If provided, packets with these portnums will be dropped if they don't have a bitfield. (bitfield available from firmware v2.5+)",
    },
    {
        name: "old-firmware-position-precision",
        type: Number,
        description: "If provided, position packets from firmware v2.4 and older will be truncated to this many decimal places.",
    },
    {
        name: "forget-outdated-node-positions-after-seconds",
        type: Number,
        description: "If provided, nodes that haven't sent a position report in this time will have their current position cleared.",
    },
    {
        name: "purge-interval-seconds",
        type: Number,
        description: "How long to wait between each automatic database purge.",
    },
    {
        name: "purge-device-metrics-after-seconds",
        type: Number,
        description: "Device Metrics older than this many seconds will be purged from the database.",
    },
    {
        name: "purge-environment-metrics-after-seconds",
        type: Number,
        description: "Environment Metrics older than this many seconds will be purged from the database.",
    },
    {
        name: "purge-power-metrics-after-seconds",
        type: Number,
        description: "Power Metrics older than this many seconds will be purged from the database.",
    },
    {
        name: "purge-map-reports-after-seconds",
        type: Number,
        description: "Map reports older than this many seconds will be purged from the database.",
    },
    {
        name: "purge-neighbour-infos-after-seconds",
        type: Number,
        description: "Neighbour infos older than this many seconds will be purged from the database.",
    },
    {
        name: "purge-nodes-unheard-for-seconds",
        type: Number,
        description: "Nodes that haven't been heard from in this many seconds will be purged from the database.",
    },
    {
        name: "purge-positions-after-seconds",
        type: Number,
        description: "Positions older than this many seconds will be purged from the database.",
    },
    {
        name: "purge-service-envelopes-after-seconds",
        type: Number,
        description: "Service envelopes older than this many seconds will be purged from the database.",
    },
    {
        name: "purge-text-messages-after-seconds",
        type: Number,
        description: "Text Messages older than this many seconds will be purged from the database.",
    },
    {
        name: "purge-traceroutes-after-seconds",
        type: Number,
        description: "Traceroutes older than this many seconds will be purged from the database.",
    },
    {
        name: "purge-waypoints-after-seconds",
        type: Number,
        description: "Waypoints older than this many seconds will be purged from the database.",
    },
];

function getDefaultMqttTopics(mqttBrokerUrl) {
    const broker = (mqttBrokerUrl ?? "").toLowerCase();

    // The public Meshtastic broker currently emits packet traffic on regional topic roots
    // like msh/US/2/e/... and msh/EU_868/2/e/..., while subscribing to msh/# does not
    // reliably yield traffic for collectors.
    if(broker.includes("mqtt.meshtastic.org")){
        return ["msh/+/2/e/#"];
    }

    return ["msh/#"];
}

// parse command line args
const options = commandLineArgs(optionsList);

// show help
if(options.help){
    const usage = commandLineUsage([
        {
            header: 'Meshtastic MQTT Collector',
            content: 'Collects and processes service envelopes from a Meshtastic MQTT server.',
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
const protobufsPath = options["protobufs-path"] ?? path.join(path.dirname(__filename), "external/protobufs");
const mqttBrokerUrl = options["mqtt-broker-url"] ?? "mqtt://mqtt.meshtastic.org";
const mqttUsername = options["mqtt-username"] ?? "meshdev";
const mqttPassword = options["mqtt-password"] ?? "large4cats";
const mqttClientId = options["mqtt-client-id"] ?? `meshtastic-map-${crypto.randomBytes(4).toString("hex")}`;
const mqttTopics = options["mqtt-topic"] ?? getDefaultMqttTopics(mqttBrokerUrl);
const identitySourceUrls = [...new Set(options["identity-source-url"] ?? [
    "https://meshmap.ro/api/v1/nodes",
])];
const identitySyncIntervalSeconds = options["identity-sync-interval-seconds"] ?? 21600;
const allowedPortnums = options["allowed-portnums"] ?? null;
const logUnknownPortnums = options["log-unknown-portnums"] ?? false;
const collectServiceEnvelopes = options["collect-service-envelopes"] ?? false;
const collectPositions = options["collect-positions"] ?? false;
const collectTextMessages = options["collect-text-messages"] ?? false;
const ignoreDirectMessages = options["ignore-direct-messages"] ?? false;
const collectWaypoints = options["collect-waypoints"] ?? false;
const collectNeighbourInfo = options["collect-neighbour-info"] ?? false;
const collectMapReports = options["collect-map-reports"] ?? false;
const decryptionKeys = options["decryption-keys"] ?? [
    "1PG7OiApB1nwvP+rz05pAQ==", // add default "AQ==" decryption key
];
const dropPacketsNotOkToMqtt = options["drop-packets-not-ok-to-mqtt"] ?? false;
const dropPortnumsWithoutBitfield = options["drop-portnums-without-bitfield"] ?? null;
const oldFirmwarePositionPrecision = options["old-firmware-position-precision"] ?? null;
const forgetOutdatedNodePositionsAfterSeconds = options["forget-outdated-node-positions-after-seconds"] ?? null;
const purgeIntervalSeconds = options["purge-interval-seconds"] ?? 60;
const purgeNodesUnheardForSeconds = options["purge-nodes-unheard-for-seconds"] ?? null;
const purgeDeviceMetricsAfterSeconds = options["purge-device-metrics-after-seconds"] ?? null;
const purgeEnvironmentMetricsAfterSeconds = options["purge-environment-metrics-after-seconds"] ?? null;
const purgeMapReportsAfterSeconds = options["purge-map-reports-after-seconds"] ?? null;
const purgeNeighbourInfosAfterSeconds = options["purge-neighbour-infos-after-seconds"] ?? null;
const purgePowerMetricsAfterSeconds = options["purge-power-metrics-after-seconds"] ?? null;
const purgePositionsAfterSeconds = options["purge-positions-after-seconds"] ?? null;
const purgeServiceEnvelopesAfterSeconds = options["purge-service-envelopes-after-seconds"] ?? null;
const purgeTextMessagesAfterSeconds = options["purge-text-messages-after-seconds"] ?? null;
const purgeTraceroutesAfterSeconds = options["purge-traceroutes-after-seconds"] ?? null;
const purgeWaypointsAfterSeconds = options["purge-waypoints-after-seconds"] ?? null;

const MQTT_GATEWAY_HEARTBEAT_WRITE_INTERVAL_MS = 10000;
const POSITION_WRITE_DEDUPE_WINDOW_MS = 60000;
const MAP_REPORT_WRITE_DEDUPE_WINDOW_MS = 60000;
const DEVICE_METRIC_WRITE_DEDUPE_WINDOW_MS = 15000;
const ENVIRONMENT_METRIC_WRITE_DEDUPE_WINDOW_MS = 15000;
const POWER_METRIC_WRITE_DEDUPE_WINDOW_MS = 15000;
const NODE_POSITION_UPDATE_WINDOW_MS = 15000;
const NODE_TELEMETRY_UPDATE_WINDOW_MS = 15000;
const NODE_NEIGHBOURS_UPDATE_WINDOW_MS = 15000;
const MQTT_MESSAGE_PROCESSING_CONCURRENCY = 8;
const MQTT_MESSAGE_QUEUE_WARNING_THRESHOLD = 5000;

const recentGatewayHeartbeatWrites = new Map();
const recentPositionWrites = new Map();
const recentMapReportWrites = new Map();
const recentDeviceMetricWrites = new Map();
const recentEnvironmentMetricWrites = new Map();
const recentPowerMetricWrites = new Map();
const recentNodePositionUpdates = new Map();
const recentNodeTelemetryUpdates = new Map();
const recentNodeNeighbourUpdates = new Map();

const mqttMessageQueue = [];
let activeMqttMessageProcessors = 0;
let mqttQueueWarningShown = false;

function hasOwnField(message, fieldName) {
    return Object.prototype.hasOwnProperty.call(message ?? {}, fieldName);
}

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

function getKnownHardwareModel(value) {
    if(Number.isInteger(value) && value > 0){
        return value;
    }

    return null;
}

async function updateNodeFields(nodeId, data) {
    if(nodeId == null || Object.keys(data).length === 0){
        return;
    }

    await ensureNodeExists(nodeId);
    await prisma.node.updateMany({
        where: {
            node_id: nodeId,
        },
        data: data,
    });
}

function buildUserNodeData(user) {
    const data = {};

    const longName = getMeaningfulString(user.longName);
    if(longName != null){
        data.long_name = longName;
    }

    const shortName = getMeaningfulString(user.shortName);
    if(shortName != null){
        data.short_name = shortName;
    }

    const hardwareModel = getKnownHardwareModel(user.hwModel);
    if(hardwareModel != null){
        data.hardware_model = hardwareModel;
    }

    if(hasOwnField(user, "isLicensed")){
        data.is_licensed = user.isLicensed === true;
    }

    if(hasOwnField(user, "role")){
        data.role = user.role;
    }

    return data;
}

function buildMapReportNodeData(mapReport) {
    const data = {};

    const longName = getMeaningfulString(mapReport.longName);
    if(longName != null){
        data.long_name = longName;
    }

    const shortName = getMeaningfulString(mapReport.shortName);
    if(shortName != null){
        data.short_name = shortName;
    }

    const hardwareModel = getKnownHardwareModel(mapReport.hwModel);
    if(hardwareModel != null){
        data.hardware_model = hardwareModel;
    }

    if(hasOwnField(mapReport, "role")){
        data.role = mapReport.role;
    }

    if(hasOwnField(mapReport, "latitudeI")){
        data.latitude = mapReport.latitudeI;
    }

    if(hasOwnField(mapReport, "longitudeI")){
        data.longitude = mapReport.longitudeI;
    }

    if(hasOwnField(mapReport, "altitude")){
        data.altitude = mapReport.altitude !== 0 ? mapReport.altitude : null;
    }

    const firmwareVersion = getMeaningfulString(mapReport.firmwareVersion);
    if(firmwareVersion != null){
        data.firmware_version = firmwareVersion;
    }

    if(hasOwnField(mapReport, "region")){
        data.region = mapReport.region;
    }

    if(hasOwnField(mapReport, "modemPreset")){
        data.modem_preset = mapReport.modemPreset;
    }

    if(hasOwnField(mapReport, "hasDefaultChannel")){
        data.has_default_channel = mapReport.hasDefaultChannel;
    }

    if(hasOwnField(mapReport, "positionPrecision")){
        data.position_precision = mapReport.positionPrecision;
    }

    if(hasOwnField(mapReport, "numOnlineLocalNodes")){
        data.num_online_local_nodes = mapReport.numOnlineLocalNodes;
    }

    if("latitude" in data || "longitude" in data || "altitude" in data || "position_precision" in data){
        data.position_updated_at = new Date();
    }

    return data;
}

function isRecentlySeen(cache, key, ttlMs) {
    if(key == null){
        return false;
    }

    const now = Date.now();
    const expiresAt = cache.get(key);
    if(expiresAt != null && expiresAt > now){
        return true;
    }

    cache.set(key, now + ttlMs);
    return false;
}

function purgeExpiredCacheEntries(cache) {
    const now = Date.now();
    for(const [key, expiresAt] of cache.entries()){
        if(expiresAt <= now){
            cache.delete(key);
        }
    }
}

function purgeRecentWriteCaches() {
    purgeExpiredCacheEntries(recentGatewayHeartbeatWrites);
    purgeExpiredCacheEntries(recentPositionWrites);
    purgeExpiredCacheEntries(recentMapReportWrites);
    purgeExpiredCacheEntries(recentDeviceMetricWrites);
    purgeExpiredCacheEntries(recentEnvironmentMetricWrites);
    purgeExpiredCacheEntries(recentPowerMetricWrites);
    purgeExpiredCacheEntries(recentNodePositionUpdates);
    purgeExpiredCacheEntries(recentNodeTelemetryUpdates);
    purgeExpiredCacheEntries(recentNodeNeighbourUpdates);
}

function shouldProcessMqttTopic(topic) {
    const topicSegments = topic.split("/").filter(Boolean);
    const lastTopicSegment = topicSegments[topicSegments.length - 1] ?? "";

    // Skip helper topics like presence/json on the public broker and only keep
    // packet uplinks that end in a Meshtastic node id such as !1234abcd.
    return lastTopicSegment.startsWith("!");
}

function scheduleMqttMessageProcessing() {
    while(activeMqttMessageProcessors < MQTT_MESSAGE_PROCESSING_CONCURRENCY && mqttMessageQueue.length > 0){
        const queuedMessage = mqttMessageQueue.shift();
        activeMqttMessageProcessors += 1;

        processMqttMessage(queuedMessage.topic, queuedMessage.message)
            .catch((err) => {
                console.error("Failed to process MQTT message:", err);
            })
            .finally(() => {
                activeMqttMessageProcessors -= 1;

                if(mqttMessageQueue.length < MQTT_MESSAGE_QUEUE_WARNING_THRESHOLD){
                    mqttQueueWarningShown = false;
                }

                scheduleMqttMessageProcessing();
            });
    }
}

async function ensureNodeExists(nodeId) {
    if(nodeId == null){
        return;
    }

    try {
        await prisma.node.upsert({
            where: {
                node_id: nodeId,
            },
            create: {
                node_id: nodeId,
                long_name: "",
                short_name: "",
                hardware_model: 0,
                role: 0,
            },
            update: {},
        });
    } catch(err) {
        // ignore races where another packet creates the same node concurrently
    }
}

const recentWriteCacheCleanupInterval = setInterval(() => {
    purgeRecentWriteCaches();
}, 60000);

if(typeof recentWriteCacheCleanupInterval.unref === "function"){
    recentWriteCacheCleanupInterval.unref();
}

let identitySyncInFlight = false;

async function syncExternalNodeIdentities() {
    if(identitySyncInFlight || identitySourceUrls.length === 0){
        return;
    }

    identitySyncInFlight = true;

    try {
        for(const identitySourceUrl of identitySourceUrls){
            try {
                const result = await importNodeIdentitiesFromUrl(prisma, identitySourceUrl);
                console.log("External node identity sync completed", {
                    source: result.source_label,
                    imported_count: result.imported_count,
                    skipped_count: result.skipped_count,
                });
            } catch(err) {
                console.warn(`External node identity sync failed for ${identitySourceUrl}: ${err.message}`);
            }
        }
    } finally {
        identitySyncInFlight = false;
    }
}

// ensure protobufs exist
if(!fs.existsSync(path.join(protobufsPath, "meshtastic/mqtt.proto"))){
    console.error([
        "ERROR: MQTT Collector requires Meshtastic protobufs.",
        "",
        "This project is licensed under the MIT license to allow end users to do as they wish.",
        "Unfortunately, the Meshtastic protobuf schema files are licensed under GPLv3, which means they can not be bundled in this project due to license conflicts.",
        "https://github.com/meshtastic/protobufs/issues/695",
        "",
        "If you clone and install the Meshtastic protobufs as described below, your use of those files will be subject to the GPLv3 license.",
        "This does not change the license of this project being MIT. Only the parts you add from the Meshtastic project are covered under GPLv3.",
        "",
        "To use the MQTT Collector, please clone the Meshtastic protobufs into src/external/protobufs",
        "git clone https://github.com/meshtastic/protobufs src/external/protobufs",
    ].join("\n"));
    return;
}

// create mqtt client
const client = mqtt.connect(mqttBrokerUrl, {
    username: mqttUsername,
    password: mqttPassword,
    clientId: mqttClientId,
});

console.log("Starting MQTT collector", {
    mqtt_broker_url: mqttBrokerUrl,
    mqtt_client_id: mqttClientId,
    mqtt_topics: mqttTopics,
    identity_source_urls: identitySourceUrls,
    identity_sync_interval_seconds: identitySyncIntervalSeconds,
    protobufs_path: protobufsPath,
});

// load protobufs
const root = new protobufjs.Root();
root.resolvePath = (origin, target) => path.join(protobufsPath, target);
root.loadSync('meshtastic/mqtt.proto');
const Data = root.lookupType("Data");
const ServiceEnvelope = root.lookupType("ServiceEnvelope");
const MapReport = root.lookupType("MapReport");
const NeighborInfo = root.lookupType("NeighborInfo");
const Position = root.lookupType("Position");
const RouteDiscovery = root.lookupType("RouteDiscovery");
const Telemetry = root.lookupType("Telemetry");
const User = root.lookupType("User");
const Waypoint = root.lookupType("Waypoint");

// run automatic purge if configured
if(purgeIntervalSeconds){
    setInterval(async () => {
        await purgeUnheardNodes();
        await purgeOldDeviceMetrics();
        await purgeOldEnvironmentMetrics();
        await purgeOldMapReports();
        await purgeOldNeighbourInfos();
        await purgeOldPowerMetrics();
        await purgeOldPositions();
        await purgeOldServiceEnvelopes();
        await purgeOldTextMessages();
        await purgeOldTraceroutes();
        await purgeOldWaypoints();
        await forgetOutdatedNodePositions();
    }, purgeIntervalSeconds * 1000);
}

if(identitySyncIntervalSeconds > 0 && identitySourceUrls.length > 0){
    syncExternalNodeIdentities().catch((err) => {
        console.warn(`Initial external node identity sync failed: ${err.message}`);
    });

    const identitySyncInterval = setInterval(() => {
        syncExternalNodeIdentities().catch((err) => {
            console.warn(`Scheduled external node identity sync failed: ${err.message}`);
        });
    }, identitySyncIntervalSeconds * 1000);

    if(typeof identitySyncInterval.unref === "function"){
        identitySyncInterval.unref();
    }
}

/**
 * Purges all nodes from the database that haven't been heard from within the configured timeframe.
 */
async function purgeUnheardNodes() {

    // make sure seconds provided
    if(!purgeNodesUnheardForSeconds){
        return;
    }

    // delete all nodes that were last updated before configured purge time
    try {
        await prisma.node.deleteMany({
            where: {
                updated_at: {
                    // last updated before x seconds ago
                    lt: new Date(Date.now() - purgeNodesUnheardForSeconds * 1000),
                },
            }
        });
    } catch(e) {
        // do nothing
    }

}

/**
 * Purges all device metrics from the database that are older than the configured timeframe.
 */
async function purgeOldDeviceMetrics() {

    // make sure seconds provided
    if(!purgeDeviceMetricsAfterSeconds){
        return;
    }

    // delete all device metrics that are older than the configured purge time
    try {
        await prisma.deviceMetric.deleteMany({
            where: {
                created_at: {
                    // created before x seconds ago
                    lt: new Date(Date.now() - purgeDeviceMetricsAfterSeconds * 1000),
                },
            }
        });
    } catch(e) {
        // do nothing
    }

}

/**
 * Purges all environment metrics from the database that are older than the configured timeframe.
 */
async function purgeOldEnvironmentMetrics() {

    // make sure seconds provided
    if(!purgeEnvironmentMetricsAfterSeconds){
        return;
    }

    // delete all environment metrics that are older than the configured purge time
    try {
        await prisma.environmentMetric.deleteMany({
            where: {
                created_at: {
                    // created before x seconds ago
                    lt: new Date(Date.now() - purgeEnvironmentMetricsAfterSeconds * 1000),
                },
            }
        });
    } catch(e) {
        // do nothing
    }

}

/**
 * Purges all power metrics from the database that are older than the configured timeframe.
 */
async function purgeOldMapReports() {

    // make sure seconds provided
    if(!purgeMapReportsAfterSeconds){
        return;
    }

    // delete all map reports that are older than the configured purge time
    try {
        await prisma.mapReport.deleteMany({
            where: {
                created_at: {
                    // created before x seconds ago
                    lt: new Date(Date.now() - purgeMapReportsAfterSeconds * 1000),
                },
            }
        });
    } catch(e) {
        // do nothing
    }

}

/**
 * Purges all neighbour infos from the database that are older than the configured timeframe.
 */
async function purgeOldNeighbourInfos() {

    // make sure seconds provided
    if(!purgeNeighbourInfosAfterSeconds){
        return;
    }

    // delete all neighbour infos that are older than the configured purge time
    try {
        await prisma.neighbourInfo.deleteMany({
            where: {
                created_at: {
                    // created before x seconds ago
                    lt: new Date(Date.now() - purgeNeighbourInfosAfterSeconds * 1000),
                },
            }
        });
    } catch(e) {
        // do nothing
    }

}

/**
 * Purges all power metrics from the database that are older than the configured timeframe.
 */
async function purgeOldPowerMetrics() {

    // make sure seconds provided
    if(!purgePowerMetricsAfterSeconds){
        return;
    }

    // delete all power metrics that are older than the configured purge time
    try {
        await prisma.powerMetric.deleteMany({
            where: {
                created_at: {
                    // created before x seconds ago
                    lt: new Date(Date.now() - purgePowerMetricsAfterSeconds * 1000),
                },
            }
        });
    } catch(e) {
        // do nothing
    }

}

/**
 * Purges all positions from the database that are older than the configured timeframe.
 */
async function purgeOldPositions() {

    // make sure seconds provided
    if(!purgePositionsAfterSeconds){
        return;
    }

    // delete all positions that are older than the configured purge time
    try {
        await prisma.position.deleteMany({
            where: {
                created_at: {
                    // created before x seconds ago
                    lt: new Date(Date.now() - purgePositionsAfterSeconds * 1000),
                },
            }
        });
    } catch(e) {
        // do nothing
    }

}

/**
 * Purges all service envelopes from the database that are older than the configured timeframe.
 */
async function purgeOldServiceEnvelopes() {

    // make sure seconds provided
    if(!purgeServiceEnvelopesAfterSeconds){
        return;
    }

    // delete all service envelopes that are older than the configured purge time
    try {
        await prisma.serviceEnvelope.deleteMany({
            where: {
                created_at: {
                    // created before x seconds ago
                    lt: new Date(Date.now() - purgeServiceEnvelopesAfterSeconds * 1000),
                },
            }
        });
    } catch(e) {
        // do nothing
    }

}

/**
 * Purges all text messages from the database that are older than the configured timeframe.
 */
async function purgeOldTextMessages() {

    // make sure seconds provided
    if(!purgeTextMessagesAfterSeconds){
        return;
    }

    // delete all text messages that are older than the configured purge time
    try {
        await prisma.textMessage.deleteMany({
            where: {
                created_at: {
                    // created before x seconds ago
                    lt: new Date(Date.now() - purgeTextMessagesAfterSeconds * 1000),
                },
            }
        });
    } catch(e) {
        // do nothing
    }

}

/**
 * Purges all traceroutes from the database that are older than the configured timeframe.
 */
async function purgeOldTraceroutes() {

    // make sure seconds provided
    if(!purgeTraceroutesAfterSeconds){
        return;
    }

    // delete all traceroutes that are older than the configured purge time
    try {
        await prisma.traceRoute.deleteMany({
            where: {
                created_at: {
                    // created before x seconds ago
                    lt: new Date(Date.now() - purgeTraceroutesAfterSeconds * 1000),
                },
            }
        });
    } catch(e) {
        // do nothing
    }

}

/**
 * Purges all waypoints from the database that are older than the configured timeframe.
 */
async function purgeOldWaypoints() {

    // make sure seconds provided
    if(!purgeWaypointsAfterSeconds){
        return;
    }

    // delete all waypoints that are older than the configured purge time
    try {
        await prisma.waypoint.deleteMany({
            where: {
                created_at: {
                    // created before x seconds ago
                    lt: new Date(Date.now() - purgeWaypointsAfterSeconds * 1000),
                },
            }
        });
    } catch(e) {
        // do nothing
    }

}

/**
 * Clears the current position stored for nodes if the position hasn't been updated within the configured timeframe.
 * This allows the node position to drop off the map if the user disabled position reporting, but still wants telemetry lookup etc
 */
async function forgetOutdatedNodePositions() {

    // make sure seconds provided
    if(!forgetOutdatedNodePositionsAfterSeconds){
        return;
    }

    // clear latitude/longitude/altitude for nodes that haven't updated their position in the configured timeframe
    try {
        await prisma.node.updateMany({
            where: {
                position_updated_at: {
                    // position_updated_at before x seconds ago
                    lt: new Date(Date.now() - forgetOutdatedNodePositionsAfterSeconds * 1000),
                },
                // don't forget outdated node positions for nodes that don't actually have a position set
                // otherwise the updated_at is updated, when nothing changed
                NOT: {
                    latitude: null,
                    longitude: null,
                    altitude: null,
                },
            },
            data: {
                latitude: null,
                longitude: null,
                altitude: null,
            },
        });
    } catch(e) {
        // do nothing
    }

}

function createNonce(packetId, fromNode) {

    // Expand packetId to 64 bits
    const packetId64 = BigInt(packetId);

    // Initialize block counter (32-bit, starts at zero)
    const blockCounter = 0;

    // Create a buffer for the nonce
    const buf = Buffer.alloc(16);

    // Write packetId, fromNode, and block counter to the buffer
    buf.writeBigUInt64LE(packetId64, 0);
    buf.writeUInt32LE(fromNode, 8);
    buf.writeUInt32LE(blockCounter, 12);

    return buf;

}

/**
 * References:
 * https://github.com/crypto-smoke/meshtastic-go/blob/develop/radio/aes.go#L42
 * https://github.com/pdxlocations/Meshtastic-MQTT-Connect/blob/main/meshtastic-mqtt-connect.py#L381
 */
function decrypt(packet) {

    // attempt to decrypt with all available decryption keys
    for(const decryptionKey of decryptionKeys){
        try {

            // convert encryption key to buffer
            const key = Buffer.from(decryptionKey, "base64");

            // create decryption iv/nonce for this packet
            const nonceBuffer = createNonce(packet.id, packet.from);

            // determine algorithm based on key length
            var algorithm = null;
            if(key.length === 16){
                algorithm = "aes-128-ctr";
            } else if(key.length === 32){
                algorithm = "aes-256-ctr";
            } else {
                // skip this key, try the next one...
                console.error(`Skipping decryption key with invalid length: ${key.length}`);
                continue;
            }

            // create decipher
            const decipher = crypto.createDecipheriv(algorithm, key, nonceBuffer);

            // decrypt encrypted packet
            const decryptedBuffer = Buffer.concat([decipher.update(packet.encrypted), decipher.final()]);

            // parse as data message
            return Data.decode(decryptedBuffer);

        } catch(e){}
    }

    // couldn't decrypt
    return null;

}

/**
 * converts hex id to numeric id, for example: !FFFFFFFF to 4294967295
 * @param hexId a node id in hex format with a prepended "!"
 * @returns {bigint} the node id in numeric form
 */
function convertHexIdToNumericId(hexId) {
    return BigInt('0x' + hexId.replaceAll("!", ""));
}

// subscribe to everything when connected
client.on("connect", () => {
    console.log("Connected to MQTT broker");
    for(const mqttTopic of mqttTopics){
        client.subscribe(mqttTopic, (err) => {
            if(err){
                console.error(`Failed to subscribe to MQTT topic ${mqttTopic}:`, err.message);
                return;
            }

            console.log(`Subscribed to MQTT topic ${mqttTopic}`);
        });
    }
});

client.on("error", (err) => {
    console.error("MQTT client error:", err.message);
});

client.on("close", () => {
    console.warn("MQTT connection closed");
});

client.on("reconnect", () => {
    console.log("Reconnecting to MQTT broker");
});

// handle message received
async function processMqttMessage(topic, message) {
    try {

        // decode service envelope
        const envelope = ServiceEnvelope.decode(message);
        if(!envelope.packet){
            return;
        }

        // attempt to decrypt encrypted packets
        const isEncrypted = envelope.packet.encrypted?.length > 0;
        if(isEncrypted){
            const decoded = decrypt(envelope.packet);
            if(decoded){
                envelope.packet.decoded = decoded;
            }
        }

        // get portnum from decoded packet
        const portnum = envelope.packet?.decoded?.portnum;

        // get bitfield from decoded packet
        // bitfield was added in v2.5 of meshtastic firmware
        // this value will be null for packets from v2.4.x and below, and will be an integer in v2.5.x and above
        const bitfield = envelope.packet?.decoded?.bitfield;
        const gatewayNodeId = envelope.gatewayId ? convertHexIdToNumericId(envelope.gatewayId) : null;

        // check if we can see the decrypted packet data
        if(envelope.packet.decoded != null){

            // check if bitfield is available (v2.5.x firmware or newer)
            if(bitfield != null){

                // drop packets where "OK to MQTT" is false
                const isOkToMqtt = bitfield & BITFIELD_OK_TO_MQTT_MASK;
                if(dropPacketsNotOkToMqtt && !isOkToMqtt){
                    return;
                }

            }

            // if bitfield is not available for this packet, check if we want to drop this portnum
            if(bitfield == null){

                // drop packet if portnum is in drop list
                // this is useful for dropping specific packet types from firmware older than v2.5
                if(dropPortnumsWithoutBitfield != null && dropPortnumsWithoutBitfield.includes(portnum)){
                    return;
                }

            }

        }

        // create service envelope in db
        if(collectServiceEnvelopes){
            try {
                await prisma.serviceEnvelope.create({
                    data: {
                        mqtt_topic: topic,
                        channel_id: envelope.channelId,
                        gateway_id: gatewayNodeId,
                        to: envelope.packet.to,
                        from: envelope.packet.from,
                        protobuf: message,
                    },
                });
            } catch (e) {
                console.error(e, {
                    envelope: envelope.packet,
                });
            }
        }

        // track when a node last gated a packet to mqtt
        if(gatewayNodeId != null
            && !isRecentlySeen(recentGatewayHeartbeatWrites, gatewayNodeId.toString(), MQTT_GATEWAY_HEARTBEAT_WRITE_INTERVAL_MS)){
            try {
                await ensureNodeExists(gatewayNodeId);
                await prisma.node.updateMany({
                    where: {
                        node_id: gatewayNodeId,
                    },
                    data: {
                        mqtt_connection_state_updated_at: new Date(),
                    },
                });
            } catch(e) {
                // don't care if updating mqtt timestamp fails
            }
        }

        const logKnownPacketTypes = false;

        // if allowed portnums are configured, ignore portnums that are not in the list
        if(allowedPortnums != null && !allowedPortnums.includes(portnum)){
            return;
        }

        if(portnum === 1) {

            if(!collectTextMessages){
                return;
            }

            // check if we want to ignore direct messages
            if(ignoreDirectMessages && envelope.packet.to !== 0xFFFFFFFF){
                return;
            }

            if(logKnownPacketTypes) {
                console.log("TEXT_MESSAGE_APP", {
                    to: envelope.packet.to.toString(16),
                    from: envelope.packet.from.toString(16),
                    text: envelope.packet.decoded.payload.toString(),
                });
            }

            try {
                await prisma.textMessage.create({
                    data: {
                        to: envelope.packet.to,
                        from: envelope.packet.from,
                        channel: envelope.packet.channel,
                        packet_id: envelope.packet.id,
                        channel_id: envelope.channelId,
                        gateway_id: gatewayNodeId,
                        text: envelope.packet.decoded.payload.toString(),
                        rx_time: envelope.packet.rxTime,
                        rx_snr: envelope.packet.rxSnr,
                        rx_rssi: envelope.packet.rxRssi,
                        hop_limit: envelope.packet.hopLimit,
                    },
                });
            } catch (e) {
                console.error(e);
            }

        }

        else if(portnum === 3) {

            const position = Position.decode(envelope.packet.decoded.payload);

            if(logKnownPacketTypes){
                console.log("POSITION_APP", {
                    from: envelope.packet.from.toString(16),
                    position: position,
                });
            }

            // process position
            if(position.latitudeI != null && position.longitudeI){

                // if bitfield is not available, we are on firmware v2.4 or below
                // if configured, position packets should have their precision reduced
                if(bitfield == null && oldFirmwarePositionPrecision != null){

                    // adjust precision of latitude and longitude
                    position.latitudeI = PositionUtil.setPositionPrecision(position.latitudeI, oldFirmwarePositionPrecision);
                    position.longitudeI = PositionUtil.setPositionPrecision(position.longitudeI, oldFirmwarePositionPrecision);

                    // update position precision on packet to show that it is no longer full precision
                    position.precisionBits = oldFirmwarePositionPrecision;

                }

                // update node position in db
                try {
                    const nodePositionUpdateKey = [
                        envelope.packet.from,
                        position.latitudeI,
                        position.longitudeI,
                        position.altitude !== 0 ? position.altitude : "",
                        position.precisionBits ?? "",
                    ].join(":");

                    if(!isRecentlySeen(recentNodePositionUpdates, nodePositionUpdateKey, NODE_POSITION_UPDATE_WINDOW_MS)){
                        await ensureNodeExists(envelope.packet.from);
                        await prisma.node.updateMany({
                            where: {
                                node_id: envelope.packet.from,
                            },
                            data: {
                                position_updated_at: new Date(),
                                latitude: position.latitudeI,
                                longitude: position.longitudeI,
                                altitude: position.altitude !== 0 ? position.altitude : null,
                                position_precision: position.precisionBits,
                            },
                        });
                    }
                } catch (e) {
                    console.error(e);
                }

            }

            // don't collect position history if not enabled, but we still want to update the node above
            if(!collectPositions){
                return;
            }

            try {
                const positionWriteKey = `${envelope.packet.from}:${envelope.packet.id}`;
                if(!isRecentlySeen(recentPositionWrites, positionWriteKey, POSITION_WRITE_DEDUPE_WINDOW_MS)){
                    await prisma.position.create({
                        data: {
                            node_id: envelope.packet.from,
                            to: envelope.packet.to,
                            from: envelope.packet.from,
                            channel: envelope.packet.channel,
                            packet_id: envelope.packet.id,
                            channel_id: envelope.channelId,
                            gateway_id: gatewayNodeId,
                            latitude: position.latitudeI,
                            longitude: position.longitudeI,
                            altitude: position.altitude,
                        },
                    });
                }

            } catch (e) {
                console.error(e);
            }

        }

        else if(portnum === 4) {

            const user = User.decode(envelope.packet.decoded.payload);

            if(logKnownPacketTypes) {
                console.log("NODEINFO_APP", {
                    from: envelope.packet.from.toString(16),
                    user: user,
                });
            }

            // create or update node in db
            try {
                await updateNodeFields(envelope.packet.from, buildUserNodeData(user));
            } catch (e) {
                console.error(e);
            }

        }

        else if(portnum === 8) {

            if(!collectWaypoints){
                return;
            }

            const waypoint = Waypoint.decode(envelope.packet.decoded.payload);

            if(logKnownPacketTypes) {
                console.log("WAYPOINT_APP", {
                    to: envelope.packet.to.toString(16),
                    from: envelope.packet.from.toString(16),
                    waypoint: waypoint,
                });
            }

            try {
                await prisma.waypoint.create({
                    data: {
                        to: envelope.packet.to,
                        from: envelope.packet.from,
                        waypoint_id: waypoint.id,
                        latitude: waypoint.latitudeI,
                        longitude: waypoint.longitudeI,
                        expire: waypoint.expire,
                        locked_to: waypoint.lockedTo,
                        name: waypoint.name,
                        description: waypoint.description,
                        icon: waypoint.icon,
                        channel: envelope.packet.channel,
                        packet_id: envelope.packet.id,
                        channel_id: envelope.channelId,
                        gateway_id: gatewayNodeId,
                    },
                });
            } catch (e) {
                console.error(e);
            }

        }

        else if(portnum === 71) {

            const neighbourInfo = NeighborInfo.decode(envelope.packet.decoded.payload);

            if(logKnownPacketTypes) {
                console.log("NEIGHBORINFO_APP", {
                    from: envelope.packet.from.toString(16),
                    neighbour_info: neighbourInfo,
                });
            }

            // update node neighbour info in db
            try {
                const neighbours = neighbourInfo.neighbors.map((neighbour) => {
                    return {
                        node_id: neighbour.nodeId,
                        snr: neighbour.snr,
                    };
                });
                const nodeNeighbourUpdateKey = `${envelope.packet.from}:${JSON.stringify(neighbours)}`;

                if(!isRecentlySeen(recentNodeNeighbourUpdates, nodeNeighbourUpdateKey, NODE_NEIGHBOURS_UPDATE_WINDOW_MS)){
                    await ensureNodeExists(envelope.packet.from);
                    await prisma.node.updateMany({
                        where: {
                            node_id: envelope.packet.from,
                        },
                        data: {
                            neighbours_updated_at: new Date(),
                            neighbour_broadcast_interval_secs: neighbourInfo.nodeBroadcastIntervalSecs,
                            neighbours: neighbours,
                        },
                    });
                }
            } catch (e) {
                console.error(e);
            }

            // don't store all neighbour infos, but we want to update the existing node above
            if(!collectNeighbourInfo){
                return;
            }

            // create neighbour info
            try {
                await prisma.neighbourInfo.create({
                    data: {
                        node_id: envelope.packet.from,
                        node_broadcast_interval_secs: neighbourInfo.nodeBroadcastIntervalSecs,
                        neighbours: neighbourInfo.neighbors.map((neighbour) => {
                            return {
                                node_id: neighbour.nodeId,
                                snr: neighbour.snr,
                            };
                        }),
                    },
                });
            } catch (e) {
                console.error(e);
            }

        }

        else if(portnum === 67) {

            const telemetry = Telemetry.decode(envelope.packet.decoded.payload);

            if(logKnownPacketTypes) {
                console.log("TELEMETRY_APP", {
                    from: envelope.packet.from.toString(16),
                    telemetry: telemetry,
                });
            }

            // data to update
            const data = {};

            // handle device metrics
            if(telemetry.deviceMetrics){

                data.battery_level = telemetry.deviceMetrics.batteryLevel !== 0 ? telemetry.deviceMetrics.batteryLevel : null;
                data.voltage = telemetry.deviceMetrics.voltage !== 0 ? telemetry.deviceMetrics.voltage : null;
                data.channel_utilization = telemetry.deviceMetrics.channelUtilization !== 0 ? telemetry.deviceMetrics.channelUtilization : null;
                data.air_util_tx = telemetry.deviceMetrics.airUtilTx !== 0 ? telemetry.deviceMetrics.airUtilTx : null;
                data.uptime_seconds = telemetry.deviceMetrics.uptimeSeconds !== 0 ? telemetry.deviceMetrics.uptimeSeconds : null;

                // create device metric
                try {
                    const deviceMetricWriteKey = [
                        envelope.packet.from,
                        data.battery_level,
                        data.voltage,
                        data.channel_utilization,
                        data.air_util_tx,
                    ].join(":");

                    if(!isRecentlySeen(recentDeviceMetricWrites, deviceMetricWriteKey, DEVICE_METRIC_WRITE_DEDUPE_WINDOW_MS)){
                        await prisma.deviceMetric.create({
                            data: {
                                node_id: envelope.packet.from,
                                battery_level: data.battery_level,
                                voltage: data.voltage,
                                channel_utilization: data.channel_utilization,
                                air_util_tx: data.air_util_tx,
                            },
                        });
                    }

                } catch (e) {
                    console.error(e);
                }

            }

            // handle environment metrics
            if(telemetry.environmentMetrics){

                // get metric values
                const temperature = telemetry.environmentMetrics.temperature !== 0 ? telemetry.environmentMetrics.temperature : null;
                const relativeHumidity = telemetry.environmentMetrics.relativeHumidity !== 0 ? telemetry.environmentMetrics.relativeHumidity : null;
                const barometricPressure = telemetry.environmentMetrics.barometricPressure !== 0 ? telemetry.environmentMetrics.barometricPressure : null;
                const gasResistance = telemetry.environmentMetrics.gasResistance !== 0 ? telemetry.environmentMetrics.gasResistance : null;
                const voltage = telemetry.environmentMetrics.voltage !== 0 ? telemetry.environmentMetrics.voltage : null;
                const current = telemetry.environmentMetrics.current !== 0 ? telemetry.environmentMetrics.current : null;
                const iaq = telemetry.environmentMetrics.iaq !== 0 ? telemetry.environmentMetrics.iaq : null;
                const windDirection = telemetry.environmentMetrics.windDirection;
                const windSpeed = telemetry.environmentMetrics.windSpeed;
                const windGust = telemetry.environmentMetrics.windGust;
                const windLull = telemetry.environmentMetrics.windLull;

                // set metrics to update on node table
                data.temperature = temperature;
                data.relative_humidity = relativeHumidity;
                data.barometric_pressure = barometricPressure;

                // create environment metric
                try {
                    const environmentMetricWriteKey = `${envelope.packet.from}:${envelope.packet.id}`;
                    if(!isRecentlySeen(recentEnvironmentMetricWrites, environmentMetricWriteKey, ENVIRONMENT_METRIC_WRITE_DEDUPE_WINDOW_MS)){
                        await prisma.environmentMetric.create({
                            data: {
                                node_id: envelope.packet.from,
                                packet_id: envelope.packet.id,
                                temperature: temperature,
                                relative_humidity: relativeHumidity,
                                barometric_pressure: barometricPressure,
                                gas_resistance: gasResistance,
                                voltage: voltage,
                                current: current,
                                iaq: iaq,
                                wind_direction: windDirection,
                                wind_speed: windSpeed,
                                wind_gust: windGust,
                                wind_lull: windLull,
                            },
                        });
                    }

                } catch (e) {
                    console.error(e);
                }

            }

            // handle power metrics
            if(telemetry.powerMetrics){

                // get metric values
                const ch1Voltage = telemetry.powerMetrics.ch1Voltage !== 0 ? telemetry.powerMetrics.ch1Voltage : null;
                const ch1Current = telemetry.powerMetrics.ch1Current !== 0 ? telemetry.powerMetrics.ch1Current : null;
                const ch2Voltage = telemetry.powerMetrics.ch2Voltage !== 0 ? telemetry.powerMetrics.ch2Voltage : null;
                const ch2Current = telemetry.powerMetrics.ch2Current !== 0 ? telemetry.powerMetrics.ch2Current : null;
                const ch3Voltage = telemetry.powerMetrics.ch3Voltage !== 0 ? telemetry.powerMetrics.ch3Voltage : null;
                const ch3Current = telemetry.powerMetrics.ch3Current !== 0 ? telemetry.powerMetrics.ch3Current : null;

                // create power metric
                try {
                    const powerMetricWriteKey = `${envelope.packet.from}:${envelope.packet.id}`;
                    if(!isRecentlySeen(recentPowerMetricWrites, powerMetricWriteKey, POWER_METRIC_WRITE_DEDUPE_WINDOW_MS)){
                        await prisma.powerMetric.create({
                            data: {
                                node_id: envelope.packet.from,
                                packet_id: envelope.packet.id,
                                ch1_voltage: ch1Voltage,
                                ch1_current: ch1Current,
                                ch2_voltage: ch2Voltage,
                                ch2_current: ch2Current,
                                ch3_voltage: ch3Voltage,
                                ch3_current: ch3Current,
                            },
                        });
                    }

                } catch (e) {
                    console.error(e);
                }

            }

            // update node telemetry in db
            if(Object.keys(data).length > 0){
                try {
                    const nodeTelemetryUpdateKey = `${envelope.packet.from}:${JSON.stringify(data)}`;
                    if(!isRecentlySeen(recentNodeTelemetryUpdates, nodeTelemetryUpdateKey, NODE_TELEMETRY_UPDATE_WINDOW_MS)){
                        await ensureNodeExists(envelope.packet.from);
                        await prisma.node.updateMany({
                            where: {
                                node_id: envelope.packet.from,
                            },
                            data: data,
                        });
                    }
                } catch (e) {
                    console.error(e);
                }
            }

        }

        else if(portnum === 70) {

            const routeDiscovery = RouteDiscovery.decode(envelope.packet.decoded.payload);

            if(logKnownPacketTypes) {
                console.log("TRACEROUTE_APP", {
                    to: envelope.packet.to.toString(16),
                    from: envelope.packet.from.toString(16),
                    want_response: envelope.packet.decoded.wantResponse,
                    route_discovery: routeDiscovery,
                });
            }

            try {
                await prisma.traceRoute.create({
                    data: {
                        to: envelope.packet.to,
                        from: envelope.packet.from,
                        want_response: envelope.packet.decoded.wantResponse,
                        route: routeDiscovery.route,
                        snr_towards: routeDiscovery.snrTowards,
                        route_back: routeDiscovery.routeBack,
                        snr_back: routeDiscovery.snrBack,
                        channel: envelope.packet.channel,
                        packet_id: envelope.packet.id,
                        channel_id: envelope.channelId,
                        gateway_id: gatewayNodeId,
                    },
                });
            } catch (e) {
                console.error(e);
            }

        }

        else if(portnum === 73) {

            const mapReport = MapReport.decode(envelope.packet.decoded.payload);

            if(logKnownPacketTypes) {
                console.log("MAP_REPORT_APP", {
                    from: envelope.packet.from.toString(16),
                    map_report: mapReport,
                });
            }

            // create or update node in db
            try {
                await updateNodeFields(envelope.packet.from, buildMapReportNodeData(mapReport));
            } catch (e) {
                console.error(e);
            }

            // don't collect map report history if not enabled, but we still want to update the node above
            if(!collectMapReports){
                return;
            }

            try {
                const mapReportWriteKey = [
                    envelope.packet.from,
                    mapReport.longName,
                    mapReport.shortName,
                    mapReport.latitudeI,
                    mapReport.longitudeI,
                ].join(":");

                if(!isRecentlySeen(recentMapReportWrites, mapReportWriteKey, MAP_REPORT_WRITE_DEDUPE_WINDOW_MS)){
                    await prisma.mapReport.create({
                        data: {
                            node_id: envelope.packet.from,
                            long_name: mapReport.longName,
                            short_name: mapReport.shortName,
                            role: mapReport.role,
                            hardware_model: mapReport.hwModel,
                            firmware_version: mapReport.firmwareVersion,
                            region: mapReport.region,
                            modem_preset: mapReport.modemPreset,
                            has_default_channel: mapReport.hasDefaultChannel,
                            latitude: mapReport.latitudeI,
                            longitude: mapReport.longitudeI,
                            altitude: mapReport.altitude,
                            position_precision: mapReport.positionPrecision,
                            num_online_local_nodes: mapReport.numOnlineLocalNodes,
                        },
                    });
                }

            } catch (e) {
                console.error(e);
            }

        }

        else {
            if(logUnknownPortnums){

                // ignore packets we don't want to see for now
                if(portnum === undefined // ignore failed to decrypt
                    || portnum === 0 // ignore UNKNOWN_APP
                    || portnum === 1 // ignore TEXT_MESSAGE_APP
                    || portnum === 5 // ignore ROUTING_APP
                    || portnum === 34 // ignore PAXCOUNTER_APP
                    || portnum === 65 // ignore STORE_FORWARD_APP
                    || portnum === 66 // ignore RANGE_TEST_APP
                    || portnum === 72 // ignore ATAK_PLUGIN
                    || portnum === 257 // ignore ATAK_FORWARDER
                    || portnum > 511 // ignore above MAX
                ){
                    return;
                }

                console.log(portnum, envelope);

            }
        }

    } catch(e) {
        // ignore errors
    }
}

client.on("message", (topic, message) => {
    if(!shouldProcessMqttTopic(topic)){
        return;
    }

    mqttMessageQueue.push({
        topic: topic,
        message: Buffer.from(message),
    });

    if(mqttMessageQueue.length >= MQTT_MESSAGE_QUEUE_WARNING_THRESHOLD && !mqttQueueWarningShown){
        mqttQueueWarningShown = true;
        console.warn(`MQTT message queue length is ${mqttMessageQueue.length}. Collector is under heavy load.`);
    }

    scheduleMqttMessageProcessing();
});

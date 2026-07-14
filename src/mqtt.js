const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const mqtt = require("mqtt");
const protobufjs = require("protobufjs");
const commandLineArgs = require("command-line-args");
const commandLineUsage = require("command-line-usage");
const PositionUtil = require("./utils/position_util");
const NodeIdUtil = require("./utils/node_id_util");
const {
    buildImportedNodeIdentity,
    fetchNodeIdentitiesPayloadFromUrl,
    getExistingLongName,
    getExistingShortName,
    getImportedNodesFromPayload,
    getMeaningfulLongName,
    getMeaningfulShortName,
    hasKnownHardwareModel,
    importNodeIdentitiesFromUrl,
} = require("./utils/node_identity_import");

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
        name: "identity-name-failsafe-url",
        type: String,
        description: "Fallback JSON API URL used only to fill missing long and short names.",
    },
    {
        name: "allowed-node-ids",
        type: String,
        multiple: true,
        typeLabel: '<nodeId> ...',
        description: "If provided, only packets from these node ids will be processed. Supports decimal ids and hex ids like !AABBCCDD.",
    },
    {
        name: "mqtt-processing-concurrency",
        type: Number,
        description: "How many MQTT packets should be processed in parallel.",
    },
    {
        name: "mqtt-max-message-bytes",
        type: Number,
        description: "Maximum accepted MQTT payload size in bytes.",
    },
    {
        name: "mqtt-max-queue-size",
        type: Number,
        description: "Maximum number of MQTT messages waiting to be processed. New messages are dropped when full.",
    },
    {
        name: "mqtt-recent-cache-max-entries",
        type: Number,
        description: "Maximum entries retained in each in-memory MQTT deduplication cache.",
    },
    {
        name: "mqtt-shutdown-timeout-seconds",
        type: Number,
        description: "Maximum time to drain queued work during SIGINT or SIGTERM shutdown.",
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
    // with varying path depth, and map reports on sibling `/map/` topics.
    // The reference Go collector subscribes to both encrypted packet topics and map topics
    // for 1-4 path segments before `/2/...`; mirror that here.
    if(broker.includes("mqtt.meshtastic.org")){
        return [
            "msh/+/2/map/",
            "msh/+/2/e/+/+",
            "msh/+/+/2/map/",
            "msh/+/+/2/e/+/+",
            "msh/+/+/+/2/map/",
            "msh/+/+/+/2/e/+/+",
            "msh/+/+/+/+/2/map/",
            "msh/+/+/+/+/2/e/+/+",
        ];
    }

    return ["msh/#"];
}

function parseNodeIdFilters(nodeIds) {
    if(nodeIds == null){
        return null;
    }

    const parsedNodeIds = new Set();
    const invalidNodeIds = [];
    for(const nodeId of nodeIds){
        try {
            parsedNodeIds.add(NodeIdUtil.convertToNumeric(nodeId).toString());
        } catch(err) {
            invalidNodeIds.push(nodeId);
        }
    }

    if(invalidNodeIds.length > 0 || parsedNodeIds.size === 0){
        throw new Error(
            `Invalid --allowed-node-ids value(s): ${invalidNodeIds.join(", ") || "none"}. `
            + "Expected decimal uint32 ids or hex ids like !AABBCCDD.",
        );
    }

    return parsedNodeIds;
}

function getIntegerOption(parsedOptions, optionName, defaultValue, limits = {}) {
    const value = parsedOptions[optionName] ?? defaultValue;
    const {
        min = Number.MIN_SAFE_INTEGER,
        max = Number.MAX_SAFE_INTEGER,
    } = limits;

    if(!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max){
        throw new Error(
            `Invalid --${optionName}: expected an integer between ${min} and ${max}, received ${String(value)}`,
        );
    }

    return value;
}

function getOptionalIntegerOption(parsedOptions, optionName, limits = {}) {
    if(parsedOptions[optionName] == null){
        return null;
    }

    return getIntegerOption(parsedOptions, optionName, null, limits);
}

function getIntegerListOption(parsedOptions, optionName, limits = {}) {
    if(parsedOptions[optionName] == null){
        return null;
    }

    return parsedOptions[optionName].map((value) => {
        if(!Number.isFinite(value)
            || !Number.isInteger(value)
            || value < limits.min
            || value > limits.max){
            throw new Error(
                `Invalid --${optionName} value ${String(value)}: expected an integer between ${limits.min} and ${limits.max}`,
            );
        }

        return value;
    });
}

function prepareDecryptionKeys(encodedKeys) {
    return encodedKeys.map((encodedKey, index) => {
        if(typeof encodedKey !== "string"
            || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedKey)){
            throw new Error(`Invalid --decryption-keys value at position ${index + 1}: expected canonical base64`);
        }

        const key = Buffer.from(encodedKey, "base64");
        if(key.toString("base64") !== encodedKey || (key.length !== 16 && key.length !== 32)){
            throw new Error(
                `Invalid --decryption-keys value at position ${index + 1}: decoded key must be 16 or 32 bytes`,
            );
        }

        return {
            algorithm: key.length === 16 ? "aes-128-ctr" : "aes-256-ctr",
            key: key,
        };
    });
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
const DEFAULT_IDENTITY_SOURCE_URLS = [
    "https://k8scccow040o4wsc44cggsc8.bolte.lol/nodes.json",
    "https://meshmap.net/nodes.json",
];
const protobufsPath = options["protobufs-path"] ?? path.join(path.dirname(__filename), "external/protobufs");
const mqttBrokerUrl = options["mqtt-broker-url"] ?? "mqtt://mqtt.meshtastic.org";
const mqttUsername = options["mqtt-username"] ?? "meshdev";
const mqttPassword = options["mqtt-password"] ?? "large4cats";
const mqttClientId = options["mqtt-client-id"] ?? `meshtastic-map-${crypto.randomBytes(4).toString("hex")}`;
const mqttTopics = options["mqtt-topic"] ?? getDefaultMqttTopics(mqttBrokerUrl);
const identityNameFailsafeUrl = options["identity-name-failsafe-url"] ?? null;
const identitySourceUrls = [...new Set([
    ...DEFAULT_IDENTITY_SOURCE_URLS,
    ...(options["identity-source-url"] ?? []),
])];
const MAX_TIMER_SECONDS = Math.floor(0x7FFFFFFF / 1000);
const MAX_RETENTION_SECONDS = 100 * 365 * 24 * 60 * 60;
let validatedConfig;
try {
    const rawDecryptionKeys = options["decryption-keys"] ?? [
        "1PG7OiApB1nwvP+rz05pAQ==", // default Meshtastic "AQ==" channel key
    ];
    const positiveRetentionLimits = {
        min: 1,
        max: MAX_RETENTION_SECONDS,
    };

    validatedConfig = {
        allowed_node_ids: parseNodeIdFilters(options["allowed-node-ids"] ?? null),
        allowed_portnums: getIntegerListOption(options, "allowed-portnums", {
            min: 0,
            max: 511,
        }),
        decryption_keys: prepareDecryptionKeys(rawDecryptionKeys),
        drop_portnums_without_bitfield: getIntegerListOption(options, "drop-portnums-without-bitfield", {
            min: 0,
            max: 511,
        }),
        forget_outdated_node_positions_after_seconds: getOptionalIntegerOption(
            options,
            "forget-outdated-node-positions-after-seconds",
            positiveRetentionLimits,
        ),
        identity_sync_interval_seconds: getIntegerOption(options, "identity-sync-interval-seconds", 21600, {
            min: 0,
            max: MAX_TIMER_SECONDS,
        }),
        mqtt_max_message_bytes: getIntegerOption(options, "mqtt-max-message-bytes", 65536, {
            min: 256,
            max: 16 * 1024 * 1024,
        }),
        mqtt_max_queue_size: getIntegerOption(options, "mqtt-max-queue-size", 10000, {
            min: 1,
            max: 100000,
        }),
        mqtt_processing_concurrency: getIntegerOption(options, "mqtt-processing-concurrency", 16, {
            min: 1,
            max: 64,
        }),
        mqtt_recent_cache_max_entries: getIntegerOption(options, "mqtt-recent-cache-max-entries", 50000, {
            min: 100,
            max: 1000000,
        }),
        mqtt_shutdown_timeout_seconds: getIntegerOption(options, "mqtt-shutdown-timeout-seconds", 15, {
            min: 1,
            max: 300,
        }),
        old_firmware_position_precision: getOptionalIntegerOption(options, "old-firmware-position-precision", {
            min: 1,
            max: 32,
        }),
        purge_interval_seconds: getIntegerOption(options, "purge-interval-seconds", 60, {
            min: 0,
            max: MAX_TIMER_SECONDS,
        }),
        purge_nodes_unheard_for_seconds: getOptionalIntegerOption(options, "purge-nodes-unheard-for-seconds", positiveRetentionLimits),
        purge_device_metrics_after_seconds: getOptionalIntegerOption(options, "purge-device-metrics-after-seconds", positiveRetentionLimits),
        purge_environment_metrics_after_seconds: getOptionalIntegerOption(options, "purge-environment-metrics-after-seconds", positiveRetentionLimits),
        purge_map_reports_after_seconds: getOptionalIntegerOption(options, "purge-map-reports-after-seconds", positiveRetentionLimits),
        purge_neighbour_infos_after_seconds: getOptionalIntegerOption(options, "purge-neighbour-infos-after-seconds", positiveRetentionLimits),
        purge_power_metrics_after_seconds: getOptionalIntegerOption(options, "purge-power-metrics-after-seconds", positiveRetentionLimits),
        purge_positions_after_seconds: getOptionalIntegerOption(options, "purge-positions-after-seconds", positiveRetentionLimits),
        purge_service_envelopes_after_seconds: getOptionalIntegerOption(options, "purge-service-envelopes-after-seconds", positiveRetentionLimits),
        purge_text_messages_after_seconds: getOptionalIntegerOption(options, "purge-text-messages-after-seconds", positiveRetentionLimits),
        purge_traceroutes_after_seconds: getOptionalIntegerOption(options, "purge-traceroutes-after-seconds", positiveRetentionLimits),
        purge_waypoints_after_seconds: getOptionalIntegerOption(options, "purge-waypoints-after-seconds", positiveRetentionLimits),
    };
} catch(err) {
    console.error(`ERROR: ${err.message}`);
    process.exitCode = 1;
    return;
}

const identitySyncIntervalSeconds = validatedConfig.identity_sync_interval_seconds;
const hasIdentityFailsafeSource = Boolean(identityNameFailsafeUrl);
const hasExternalIdentitySources = identitySourceUrls.length > 0;
const hasSeparateIdentityFailsafeSource = hasIdentityFailsafeSource && !identitySourceUrls.includes(identityNameFailsafeUrl);
const hasIdentitySyncSources = hasExternalIdentitySources || hasSeparateIdentityFailsafeSource;
const allowedNodeIds = validatedConfig.allowed_node_ids;
const mqttProcessingConcurrency = validatedConfig.mqtt_processing_concurrency;
const mqttMaxMessageBytes = validatedConfig.mqtt_max_message_bytes;
const mqttMaxQueueSize = validatedConfig.mqtt_max_queue_size;
const mqttRecentCacheMaxEntries = validatedConfig.mqtt_recent_cache_max_entries;
const mqttShutdownTimeoutSeconds = validatedConfig.mqtt_shutdown_timeout_seconds;
const allowedPortnums = validatedConfig.allowed_portnums;
const logUnknownPortnums = options["log-unknown-portnums"] ?? false;
const collectServiceEnvelopes = options["collect-service-envelopes"] ?? false;
const collectPositions = options["collect-positions"] ?? false;
const collectTextMessages = options["collect-text-messages"] ?? false;
const ignoreDirectMessages = options["ignore-direct-messages"] ?? false;
const collectWaypoints = options["collect-waypoints"] ?? false;
const collectNeighbourInfo = options["collect-neighbour-info"] ?? false;
const collectMapReports = options["collect-map-reports"] ?? false;
const preparedDecryptionKeys = validatedConfig.decryption_keys;
const dropPacketsNotOkToMqtt = options["drop-packets-not-ok-to-mqtt"] ?? false;
const dropPortnumsWithoutBitfield = validatedConfig.drop_portnums_without_bitfield;
const oldFirmwarePositionPrecision = validatedConfig.old_firmware_position_precision;
const forgetOutdatedNodePositionsAfterSeconds = validatedConfig.forget_outdated_node_positions_after_seconds;
const purgeIntervalSeconds = validatedConfig.purge_interval_seconds;
const purgeNodesUnheardForSeconds = validatedConfig.purge_nodes_unheard_for_seconds;
const purgeDeviceMetricsAfterSeconds = validatedConfig.purge_device_metrics_after_seconds;
const purgeEnvironmentMetricsAfterSeconds = validatedConfig.purge_environment_metrics_after_seconds;
const purgeMapReportsAfterSeconds = validatedConfig.purge_map_reports_after_seconds;
const purgeNeighbourInfosAfterSeconds = validatedConfig.purge_neighbour_infos_after_seconds;
const purgePowerMetricsAfterSeconds = validatedConfig.purge_power_metrics_after_seconds;
const purgePositionsAfterSeconds = validatedConfig.purge_positions_after_seconds;
const purgeServiceEnvelopesAfterSeconds = validatedConfig.purge_service_envelopes_after_seconds;
const purgeTextMessagesAfterSeconds = validatedConfig.purge_text_messages_after_seconds;
const purgeTraceroutesAfterSeconds = validatedConfig.purge_traceroutes_after_seconds;
const purgeWaypointsAfterSeconds = validatedConfig.purge_waypoints_after_seconds;

const MQTT_GATEWAY_HEARTBEAT_WRITE_INTERVAL_MS = 10000;
const POSITION_WRITE_DEDUPE_WINDOW_MS = 60000;
const MAP_REPORT_WRITE_DEDUPE_WINDOW_MS = 60000;
const DEVICE_METRIC_WRITE_DEDUPE_WINDOW_MS = 15000;
const ENVIRONMENT_METRIC_WRITE_DEDUPE_WINDOW_MS = 15000;
const POWER_METRIC_WRITE_DEDUPE_WINDOW_MS = 15000;
const NODE_POSITION_UPDATE_WINDOW_MS = 15000;
const NODE_TELEMETRY_UPDATE_WINDOW_MS = 15000;
const NODE_NEIGHBOURS_UPDATE_WINDOW_MS = 15000;
const MQTT_MESSAGE_DEDUPE_WINDOW_MS = 30000;
const MQTT_MESSAGE_PROCESSING_CONCURRENCY = mqttProcessingConcurrency;
const MQTT_MESSAGE_QUEUE_WARNING_THRESHOLD = Math.max(1, Math.min(5000, Math.floor(mqttMaxQueueSize * 0.8)));
const MQTT_MAX_MESSAGE_BYTES = mqttMaxMessageBytes;
const MQTT_MAX_QUEUE_SIZE = mqttMaxQueueSize;
const RECENT_CACHE_MAX_ENTRIES = mqttRecentCacheMaxEntries;
const MQTT_SHUTDOWN_TIMEOUT_MS = mqttShutdownTimeoutSeconds * 1000;
const MQTT_PACKET_TOPIC_REGEX = /^msh(?:\/[^/]+)+\/2\/(?:e\/[^/]+\/![0-9a-f]+|map\/)$/i;
const IDENTITY_WARMUP_SYNC_DELAY_MS = 60000;
const IDENTITY_EXPEDITED_SYNC_DELAY_MS = 30000;
const IDENTITY_EXPEDITED_SYNC_MIN_INTERVAL_MS = 60000;
const TARGETED_IDENTITY_SOURCE_CACHE_TTL_MS = 120000;
const TARGETED_NODE_IDENTITY_LOOKUP_TTL_MS = 180000;

const recentGatewayHeartbeatWrites = new Map();
const recentPositionWrites = new Map();
const recentMapReportWrites = new Map();
const recentDeviceMetricWrites = new Map();
const recentEnvironmentMetricWrites = new Map();
const recentPowerMetricWrites = new Map();
const recentNodePositionUpdates = new Map();
const recentNodeTelemetryUpdates = new Map();
const recentNodeNeighbourUpdates = new Map();
const recentMqttMessages = new Map();
const recentNodeIdentityHydrationAttempts = new Map();
const activeTargetedIdentityHydrations = new Set();

const mqttMessageQueue = [];
let activeMqttMessageProcessors = 0;
let mqttQueueWarningShown = false;
let acceptingMqttMessages = true;
let isShuttingDown = false;
let shutdownPromise = null;
let mqttMessagesDroppedQueueFull = 0;
let mqttMessagesDroppedOversized = 0;
let mqttMessagesDroppedDuringShutdown = 0;
let lastMqttDropWarningAt = 0;
let purgeInterval = null;
let identitySyncInterval = null;
let purgeInFlight = false;
let targetedIdentitySourceNodesByIdCache = null;
let targetedIdentitySourceNodesByIdCacheFetchedAt = 0;
let targetedIdentitySourceNodesByIdCachePromise = null;

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

    if(data.long_name == null || data.short_name == null || data.hardware_model == null){
        triggerNodeIdentityHydration(nodeId, "packet-update-missing-identity");
    }
}

function buildUserNodeData(user, nodeId) {
    const data = {};

    const longName = getMeaningfulLongName(user.longName);
    if(longName != null){
        data.long_name = longName;
    }

    const shortName = getMeaningfulShortName(user.shortName, nodeId);
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

function buildMapReportNodeData(mapReport, nodeId) {
    const data = {};

    const longName = getMeaningfulLongName(mapReport.longName);
    if(longName != null){
        data.long_name = longName;
    }

    const shortName = getMeaningfulShortName(mapReport.shortName, nodeId);
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

    const hasValidMapCoordinates = hasOwnField(mapReport, "latitudeI")
        && hasOwnField(mapReport, "longitudeI")
        && PositionUtil.hasValidCoordinates(mapReport.latitudeI, mapReport.longitudeI);
    if(hasValidMapCoordinates){
        data.latitude = mapReport.latitudeI;
        data.longitude = mapReport.longitudeI;
    }

    if(hasOwnField(mapReport, "altitude") && Number.isInteger(mapReport.altitude)){
        data.altitude = mapReport.altitude;
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
        const normalizedPositionPrecision = PositionUtil.normalizePacketPrecision(mapReport.positionPrecision);
        if(normalizedPositionPrecision != null){
            data.position_precision = normalizedPositionPrecision;
        }
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

    if(expiresAt != null){
        cache.delete(key);
    }

    while(cache.size >= RECENT_CACHE_MAX_ENTRIES){
        const oldestKey = cache.keys().next().value;
        if(oldestKey == null){
            break;
        }
        cache.delete(oldestKey);
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
    purgeExpiredCacheEntries(recentMqttMessages);
    purgeExpiredCacheEntries(recentNodeIdentityHydrationAttempts);
}

function shouldProcessMqttTopic(topic) {
    // Keep only Meshtastic MQTT uplink topics for encrypted packet traffic and map reports.
    // Examples:
    // - msh/EU_868/2/e/LongFast/!1234abcd
    // - msh/US/CA/BayArea/2/map/
    return MQTT_PACKET_TOPIC_REGEX.test(topic);
}

function shouldAcceptSender(nodeId) {
    let normalizedNodeId;
    try {
        normalizedNodeId = NodeIdUtil.convertToNumeric(nodeId).toString();
    } catch(err) {
        return false;
    }

    if(allowedNodeIds == null){
        return true;
    }

    return allowedNodeIds.has(normalizedNodeId);
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

function getTargetedIdentitySourceUrls() {
    return [...new Set([
        ...identitySourceUrls,
        ...(hasSeparateIdentityFailsafeSource ? [identityNameFailsafeUrl] : []),
    ])];
}

async function getTargetedIdentitySourceNodesById(options = {}) {
    const {
        forceRefresh = false,
    } = options;

    const sourceUrls = getTargetedIdentitySourceUrls();
    if(sourceUrls.length === 0){
        return null;
    }

    const cacheIsFresh = targetedIdentitySourceNodesByIdCache != null
        && (Date.now() - targetedIdentitySourceNodesByIdCacheFetchedAt) < TARGETED_IDENTITY_SOURCE_CACHE_TTL_MS;
    if(!forceRefresh && cacheIsFresh){
        return targetedIdentitySourceNodesByIdCache;
    }

    if(targetedIdentitySourceNodesByIdCachePromise != null){
        return targetedIdentitySourceNodesByIdCachePromise;
    }

    targetedIdentitySourceNodesByIdCachePromise = (async () => {
        try {
            const nodesById = new Map();

            for(const sourceUrl of sourceUrls){
                try {
                    const payload = await fetchNodeIdentitiesPayloadFromUrl(sourceUrl, {
                        timeout_ms: 30000,
                    });

                    for(const sourceNode of getImportedNodesFromPayload(payload)){
                        const importedIdentity = buildImportedNodeIdentity(sourceNode, {
                            allowedFields: ["long_name", "short_name", "hardware_model"],
                        });
                        if(importedIdentity == null || Object.keys(importedIdentity.data).length === 0){
                            continue;
                        }

                        const nodeIdKey = importedIdentity.node_id.toString();
                        const existingIdentity = nodesById.get(nodeIdKey) ?? {
                            node_id: importedIdentity.node_id,
                            data: {},
                            sources: [],
                        };

                        if(importedIdentity.data.long_name != null && existingIdentity.data.long_name == null){
                            existingIdentity.data.long_name = importedIdentity.data.long_name;
                        }

                        if(importedIdentity.data.short_name != null && existingIdentity.data.short_name == null){
                            existingIdentity.data.short_name = importedIdentity.data.short_name;
                        }

                        if(importedIdentity.data.hardware_model != null && existingIdentity.data.hardware_model == null){
                            existingIdentity.data.hardware_model = importedIdentity.data.hardware_model;
                        }

                        existingIdentity.sources.push(sourceUrl);
                        nodesById.set(nodeIdKey, existingIdentity);
                    }
                } catch(err) {
                    console.warn(`Targeted identity source fetch failed for ${sourceUrl}: ${err.message}`);
                }
            }

            targetedIdentitySourceNodesByIdCache = nodesById;
            targetedIdentitySourceNodesByIdCacheFetchedAt = Date.now();
            return nodesById;
        } catch(err) {
            if(targetedIdentitySourceNodesByIdCache != null){
                console.warn(`Falling back to stale targeted identity cache: ${err.message}`);
                return targetedIdentitySourceNodesByIdCache;
            }

            throw err;
        } finally {
            targetedIdentitySourceNodesByIdCachePromise = null;
        }
    })();

    return targetedIdentitySourceNodesByIdCachePromise;
}

function nodeNeedsIdentityHydration(node) {
    if(node == null){
        return true;
    }

    return getExistingLongName(node.long_name) == null
        || getExistingShortName(node.short_name, node.node_id) == null
        || !hasKnownHardwareModel(node.hardware_model);
}

async function hydrateNodeIdentityFromPrimarySource(nodeId, reason, options = {}) {
    const {
        forceRefresh = false,
    } = options;

    const sourceUrls = getTargetedIdentitySourceUrls();
    if(nodeId == null || sourceUrls.length === 0){
        return false;
    }

    const nodeIdKey = nodeId.toString();
    if(!forceRefresh && isRecentlySeen(recentNodeIdentityHydrationAttempts, nodeIdKey, TARGETED_NODE_IDENTITY_LOOKUP_TTL_MS)){
        return false;
    }

    const existingNode = await prisma.node.findUnique({
        where: {
            node_id: nodeId,
        },
        select: {
            node_id: true,
            long_name: true,
            short_name: true,
            hardware_model: true,
        },
    });

    if(existingNode != null && !nodeNeedsIdentityHydration(existingNode)){
        return false;
    }

    let nodesById = await getTargetedIdentitySourceNodesById();
    let mergedIdentity = nodesById?.get(nodeIdKey) ?? null;
    if(mergedIdentity == null && !forceRefresh){
        nodesById = await getTargetedIdentitySourceNodesById({
            forceRefresh: true,
        });
        mergedIdentity = nodesById?.get(nodeIdKey) ?? null;
    }

    if(mergedIdentity == null){
        return false;
    }

    const importedIdentity = mergedIdentity;
    if(importedIdentity == null || Object.keys(importedIdentity.data).length === 0){
        return false;
    }

    const data = {};
    if(importedIdentity.data.long_name != null
        && (existingNode == null || getExistingLongName(existingNode.long_name) == null)){
        data.long_name = importedIdentity.data.long_name;
    }

    if(importedIdentity.data.short_name != null
        && (existingNode == null || getExistingShortName(existingNode.short_name, nodeId) == null)){
        data.short_name = importedIdentity.data.short_name;
    }

    if(importedIdentity.data.hardware_model != null
        && (existingNode == null || !hasKnownHardwareModel(existingNode.hardware_model))){
        data.hardware_model = importedIdentity.data.hardware_model;
    }

    if(Object.keys(data).length === 0){
        return false;
    }

    await prisma.node.updateMany({
        where: {
            node_id: nodeId,
        },
        data: data,
    });

    console.log("Hydrated node identity from targeted sources", {
        sources: importedIdentity.sources,
        node_id: nodeIdKey,
        reason: reason,
        fields: Object.keys(data),
    });

    return true;
}

function triggerNodeIdentityHydration(nodeId, reason, options = {}) {
    if(isShuttingDown || nodeId == null || getTargetedIdentitySourceUrls().length === 0){
        return;
    }

    const hydrationTask = hydrateNodeIdentityFromPrimarySource(nodeId, reason, options)
        .catch((err) => {
            console.warn(`Targeted node identity hydration failed for ${nodeId.toString()} (${reason}): ${err.message}`);
        })
        .finally(() => {
            activeTargetedIdentityHydrations.delete(hydrationTask);
        });
    activeTargetedIdentityHydrations.add(hydrationTask);
}

async function ensureNodeExists(nodeId) {
    if(nodeId == null){
        return;
    }

    try {
        await prisma.node.create({
            data: {
                node_id: nodeId,
                long_name: "",
                short_name: "",
                hardware_model: 0,
                role: 0,
            },
        });
        triggerNodeIdentityHydration(nodeId, "blank-node-created");
        scheduleIdentitySync("blank-node-created");
    } catch(err) {
        if(err?.code !== "P2002"){
            throw err;
        }
        // Ignore the expected race where another packet creates the same node concurrently.
    }
}

const recentWriteCacheCleanupInterval = setInterval(() => {
    purgeRecentWriteCaches();
}, 60000);

if(typeof recentWriteCacheCleanupInterval.unref === "function"){
    recentWriteCacheCleanupInterval.unref();
}

let identitySyncInFlight = false;
let lastIdentitySyncStartedAt = 0;
let pendingIdentitySyncTimeout = null;

function scheduleIdentitySync(reason, delayMs = IDENTITY_EXPEDITED_SYNC_DELAY_MS, options = {}) {
    const {
        ignoreRecentSyncCooldown = false,
    } = options;

    if(isShuttingDown || !hasIdentitySyncSources || pendingIdentitySyncTimeout != null){
        return;
    }

    const msSinceLastSync = Date.now() - lastIdentitySyncStartedAt;
    const cooldownDelayMs = ignoreRecentSyncCooldown
        ? 0
        : Math.max(0, IDENTITY_EXPEDITED_SYNC_MIN_INTERVAL_MS - msSinceLastSync);
    const effectiveDelayMs = Math.max(delayMs, cooldownDelayMs);

    console.log("Scheduling identity sync", {
        reason: reason,
        delay_ms: effectiveDelayMs,
    });

    pendingIdentitySyncTimeout = setTimeout(() => {
        pendingIdentitySyncTimeout = null;
        syncExternalNodeIdentities().catch((err) => {
            console.warn(`Scheduled identity sync failed (${reason}): ${err.message}`);
        });
    }, effectiveDelayMs);

    if(typeof pendingIdentitySyncTimeout.unref === "function"){
        pendingIdentitySyncTimeout.unref();
    }
}

async function countNodesMissingFixedNames() {
    const nodes = await prisma.node.findMany({
        select: {
            node_id: true,
            long_name: true,
            short_name: true,
            hardware_model: true,
        },
    });

    return nodes.filter((node) => {
        return getMeaningfulLongName(node.long_name) == null
            || getMeaningfulShortName(node.short_name, node.node_id) == null
            || !Number.isInteger(node.hardware_model)
            || node.hardware_model <= 0;
    }).length;
}

async function syncExternalNodeIdentities() {
    if(isShuttingDown || identitySyncInFlight || !hasIdentitySyncSources){
        return;
    }

    identitySyncInFlight = true;
    lastIdentitySyncStartedAt = Date.now();

    try {
        for(const identitySourceUrl of identitySourceUrls){
            if(isShuttingDown){
                break;
            }

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

        if(!isShuttingDown && hasSeparateIdentityFailsafeSource){
            const nodesMissingIdentityFields = await countNodesMissingFixedNames();
            if(nodesMissingIdentityFields > 0){
                try {
                    const result = await importNodeIdentitiesFromUrl(prisma, identityNameFailsafeUrl, {
                        allowedFields: ["long_name", "short_name", "hardware_model"],
                        timeout_ms: 30000,
                    });
                    console.log("Identity name failsafe sync completed", {
                        source: result.source_label,
                        imported_count: result.imported_count,
                        skipped_count: result.skipped_count,
                        nodes_missing_identity_fields_before_sync: nodesMissingIdentityFields,
                    });
                } catch(err) {
                    console.warn(`Identity name failsafe sync failed for ${identityNameFailsafeUrl}: ${err.message}`);
                }
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
    process.exitCode = 1;
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
    identity_name_failsafe_url: identityNameFailsafeUrl,
    identity_sync_enabled: hasIdentitySyncSources && identitySyncIntervalSeconds > 0,
    identity_sync_has_external_sources: hasExternalIdentitySources,
    identity_sync_has_failsafe_source: hasSeparateIdentityFailsafeSource,
    allowed_node_ids_count: allowedNodeIds?.size ?? 0,
    mqtt_processing_concurrency: MQTT_MESSAGE_PROCESSING_CONCURRENCY,
    mqtt_max_message_bytes: MQTT_MAX_MESSAGE_BYTES,
    mqtt_max_queue_size: MQTT_MAX_QUEUE_SIZE,
    mqtt_recent_cache_max_entries: RECENT_CACHE_MAX_ENTRIES,
    mqtt_shutdown_timeout_seconds: mqttShutdownTimeoutSeconds,
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
    purgeInterval = setInterval(() => {
        runAutomaticPurge().catch((err) => {
            console.error("Automatic database purge failed:", err);
        });
    }, purgeIntervalSeconds * 1000);
}

async function runAutomaticPurge() {
    if(isShuttingDown || purgeInFlight){
        return;
    }

    purgeInFlight = true;
    try {
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
    } finally {
        purgeInFlight = false;
    }
}

if(identitySyncIntervalSeconds > 0 && hasIdentitySyncSources){
    syncExternalNodeIdentities().catch((err) => {
        console.warn(`Initial external node identity sync failed: ${err.message}`);
    });

    scheduleIdentitySync("startup-warmup", IDENTITY_WARMUP_SYNC_DELAY_MS, {
        ignoreRecentSyncCooldown: true,
    });

    identitySyncInterval = setInterval(() => {
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
    let nonceBuffer;
    try {
        nonceBuffer = createNonce(packet.id, packet.from);
    } catch(err) {
        return null;
    }

    // attempt to decrypt with all available decryption keys
    for(const preparedKey of preparedDecryptionKeys){
        try {
            // create decipher
            const decipher = crypto.createDecipheriv(preparedKey.algorithm, preparedKey.key, nonceBuffer);

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
    return NodeIdUtil.convertToNumeric(hexId);
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

        const packet = envelope.packet;

        // ignore anonymous packets
        if(packet.from == null || packet.from === 0){
            return;
        }

        // ignore PKI direct messages that we can not decrypt or attribute reliably
        if(packet.pkiEncrypted === true){
            return;
        }

        // reference Go collector supports sender filtering via Accept(); apply the
        // same idea here as early as possible to avoid unnecessary decode/db work.
        if(!shouldAcceptSender(packet.from)){
            return;
        }

        // attempt to decrypt encrypted packets
        const isEncrypted = packet.encrypted?.length > 0;
        if(isEncrypted){
            const decoded = decrypt(packet);
            if(decoded){
                packet.decoded = decoded;
            }
        }

        // get portnum from decoded packet
        const portnum = packet?.decoded?.portnum;

        // get bitfield from decoded packet
        // bitfield was added in v2.5 of meshtastic firmware
        // this value will be null for packets from v2.4.x and below, and will be an integer in v2.5.x and above
        const bitfield = packet?.decoded?.bitfield;
        const gatewayNodeId = envelope.gatewayId ? convertHexIdToNumericId(envelope.gatewayId) : null;

        // check if we can see the decrypted packet data
        if(packet.decoded != null){

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
                        to: packet.to,
                        from: packet.from,
                        protobuf: message,
                    },
                });
            } catch (e) {
                console.error(e, {
                    envelope: packet,
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
            const hasCoordinates = hasOwnField(position, "latitudeI")
                && hasOwnField(position, "longitudeI");
            let hasValidCoordinates = hasCoordinates
                && PositionUtil.hasValidCoordinates(position.latitudeI, position.longitudeI);
            const hasPositionPrecision = hasOwnField(position, "precisionBits");
            let positionPrecision = hasPositionPrecision
                ? PositionUtil.normalizePacketPrecision(position.precisionBits)
                : null;
            if(hasPositionPrecision && positionPrecision == null){
                hasValidCoordinates = false;
            }
            const positionAltitude = hasOwnField(position, "altitude") && Number.isInteger(position.altitude)
                ? position.altitude
                : null;

            if(logKnownPacketTypes){
                console.log("POSITION_APP", {
                    from: envelope.packet.from.toString(16),
                    position: position,
                });
            }

            // process position
            if(hasValidCoordinates){

                // if bitfield is not available, we are on firmware v2.4 or below
                // if configured, position packets should have their precision reduced
                if(bitfield == null && oldFirmwarePositionPrecision != null){

                    // adjust precision of latitude and longitude
                    position.latitudeI = PositionUtil.setPositionPrecision(position.latitudeI, oldFirmwarePositionPrecision);
                    position.longitudeI = PositionUtil.setPositionPrecision(position.longitudeI, oldFirmwarePositionPrecision);

                    // update position precision on packet to show that it is no longer full precision
                    position.precisionBits = oldFirmwarePositionPrecision;
                    positionPrecision = oldFirmwarePositionPrecision;

                }

                // update node position in db
                try {
                    const nodePositionUpdateKey = [
                        envelope.packet.from,
                        position.latitudeI,
                        position.longitudeI,
                        positionAltitude ?? "",
                        positionPrecision ?? "",
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
                                altitude: positionAltitude,
                                position_precision: positionPrecision,
                            },
                        });
                    }
                } catch (e) {
                    console.error(e);
                }

            }

            if(!hasValidCoordinates){
                return;
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
                            altitude: positionAltitude,
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
                await updateNodeFields(envelope.packet.from, buildUserNodeData(user, envelope.packet.from));
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
            const mapReportNodeData = buildMapReportNodeData(mapReport, envelope.packet.from);

            if(logKnownPacketTypes) {
                console.log("MAP_REPORT_APP", {
                    from: envelope.packet.from.toString(16),
                    map_report: mapReport,
                });
            }

            // create or update node in db
            try {
                await updateNodeFields(envelope.packet.from, mapReportNodeData);
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
                    mapReport.role,
                    mapReport.hwModel,
                    mapReport.firmwareVersion,
                    mapReport.region,
                    mapReport.modemPreset,
                    mapReport.hasDefaultChannel,
                    mapReport.latitudeI,
                    mapReport.longitudeI,
                    mapReport.altitude,
                    mapReportNodeData.position_precision,
                    mapReport.numOnlineLocalNodes,
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
                            latitude: mapReportNodeData.latitude ?? null,
                            longitude: mapReportNodeData.longitude ?? null,
                            altitude: mapReportNodeData.altitude ?? null,
                            position_precision: mapReportNodeData.position_precision ?? null,
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

function logMqttMessageDrop(reason, topic, messageBytes) {
    const now = Date.now();
    const totalDropped = mqttMessagesDroppedQueueFull
        + mqttMessagesDroppedOversized
        + mqttMessagesDroppedDuringShutdown;
    if(totalDropped !== 1 && now - lastMqttDropWarningAt < 30000){
        return;
    }

    lastMqttDropWarningAt = now;
    console.warn("Dropped MQTT message", {
        reason: reason,
        topic: topic,
        message_bytes: messageBytes,
        queue_length: mqttMessageQueue.length,
        dropped_queue_full: mqttMessagesDroppedQueueFull,
        dropped_oversized: mqttMessagesDroppedOversized,
        dropped_during_shutdown: mqttMessagesDroppedDuringShutdown,
    });
}

function handleMqttMessage(topic, message) {
    if(!acceptingMqttMessages || !shouldProcessMqttTopic(topic)){
        return;
    }

    if(message.length > MQTT_MAX_MESSAGE_BYTES){
        mqttMessagesDroppedOversized += 1;
        logMqttMessageDrop("message-too-large", topic, message.length);
        return;
    }

    // Drop the newest incoming packet when the bounded queue is full. Existing queued
    // work keeps FIFO order, and this packet is not placed in the dedupe cache so a
    // later broker redelivery can still be accepted once capacity is available.
    if(mqttMessageQueue.length >= MQTT_MAX_QUEUE_SIZE){
        mqttMessagesDroppedQueueFull += 1;
        logMqttMessageDrop("queue-full-drop-newest", topic, message.length);
        return;
    }

    const mqttMessageHash = crypto
        .createHash("sha1")
        .update(topic)
        .update(message)
        .digest("hex");
    if(isRecentlySeen(recentMqttMessages, mqttMessageHash, MQTT_MESSAGE_DEDUPE_WINDOW_MS)){
        return;
    }

    mqttMessageQueue.push({
        topic: topic,
        message: Buffer.from(message),
    });

    scheduleMqttMessageProcessing();

    // Only warn about messages that remain queued after all available workers have
    // been filled. A small configured queue must not warn for every normal packet.
    if(mqttMessageQueue.length >= MQTT_MESSAGE_QUEUE_WARNING_THRESHOLD && !mqttQueueWarningShown){
        mqttQueueWarningShown = true;
        console.warn(`MQTT message queue length is ${mqttMessageQueue.length}. Collector is under heavy load.`);
    }
}

client.on("message", handleMqttMessage);

function delay(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

async function waitForCollectorWorkToDrain(deadline) {
    scheduleMqttMessageProcessing();
    while(Date.now() < deadline){
        if(mqttMessageQueue.length === 0
            && activeMqttMessageProcessors === 0
            && !identitySyncInFlight
            && activeTargetedIdentityHydrations.size === 0
            && !purgeInFlight){
            return true;
        }

        await delay(Math.min(50, Math.max(1, deadline - Date.now())));
    }

    return mqttMessageQueue.length === 0
        && activeMqttMessageProcessors === 0
        && !identitySyncInFlight
        && activeTargetedIdentityHydrations.size === 0
        && !purgeInFlight;
}

function endMqttClient(timeoutMs) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if(settled){
                return;
            }
            settled = true;
            clearTimeout(timeout);
            resolve();
        };
        const timeout = setTimeout(() => {
            try {
                client.end(true);
            } catch(err) {
                // The client may already have completed its shutdown.
            }
            finish();
        }, Math.max(1, timeoutMs));

        try {
            client.end(false, {}, finish);
        } catch(err) {
            finish();
        }
    });
}

function shutdownCollector(signal) {
    if(shutdownPromise != null){
        return shutdownPromise;
    }

    shutdownPromise = (async () => {
        const startedAt = Date.now();
        const drainDeadline = startedAt + MQTT_SHUTDOWN_TIMEOUT_MS;
        isShuttingDown = true;
        acceptingMqttMessages = false;
        client.removeListener("message", handleMqttMessage);

        clearInterval(recentWriteCacheCleanupInterval);
        if(purgeInterval != null){
            clearInterval(purgeInterval);
            purgeInterval = null;
        }
        if(identitySyncInterval != null){
            clearInterval(identitySyncInterval);
            identitySyncInterval = null;
        }
        if(pendingIdentitySyncTimeout != null){
            clearTimeout(pendingIdentitySyncTimeout);
            pendingIdentitySyncTimeout = null;
        }

        console.log(`Received ${signal}; draining MQTT work before shutdown`, {
            queue_length: mqttMessageQueue.length,
            active_processors: activeMqttMessageProcessors,
            timeout_ms: MQTT_SHUTDOWN_TIMEOUT_MS,
        });

        const hardShutdownTimer = setTimeout(() => {
            console.error("Collector shutdown deadline exceeded; forcing process exit");
            process.exit(1);
        }, MQTT_SHUTDOWN_TIMEOUT_MS + 5000);
        if(typeof hardShutdownTimer.unref === "function"){
            hardShutdownTimer.unref();
        }

        const drained = await waitForCollectorWorkToDrain(drainDeadline);
        if(!drained && mqttMessageQueue.length > 0){
            mqttMessagesDroppedDuringShutdown += mqttMessageQueue.length;
            mqttMessageQueue.length = 0;
            logMqttMessageDrop("shutdown-drain-timeout", null, null);
        }

        const remainingShutdownMs = Math.max(1, drainDeadline - Date.now());
        await endMqttClient(Math.min(5000, remainingShutdownMs));

        try {
            await prisma.$disconnect();
        } catch(err) {
            console.error("Failed to disconnect Prisma during shutdown:", err);
            process.exitCode = 1;
        }

        if(drained){
            clearTimeout(hardShutdownTimer);
        }

        console.log("MQTT collector stopped", {
            drained: drained,
            dropped_queue_full: mqttMessagesDroppedQueueFull,
            dropped_oversized: mqttMessagesDroppedOversized,
            dropped_during_shutdown: mqttMessagesDroppedDuringShutdown,
        });
    })();

    return shutdownPromise;
}

for(const signal of ["SIGINT", "SIGTERM"]){
    process.on(signal, () => {
        shutdownCollector(signal).catch((err) => {
            console.error("MQTT collector shutdown failed:", err);
            process.exitCode = 1;
        });
    });
}

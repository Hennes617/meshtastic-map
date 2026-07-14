const MAX_MESHTASTIC_NODE_ID = 0xffffffffn;
const MAX_DATABASE_BIGINT = 0x7fffffffffffffffn;
const MAX_JAVASCRIPT_TIMESTAMP = 8_640_000_000_000_000;

class QueryValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "QueryValidationError";
    }
}

function isMissing(value) {
    return value === undefined || value === null;
}

function getScalarString(value, name) {
    if(Array.isArray(value) || (typeof value === "object" && value !== null)){
        throw new QueryValidationError(`Query parameter '${name}' must be provided once.`);
    }

    if(typeof value === "number" && !Number.isFinite(value)){
        throw new QueryValidationError(`Query parameter '${name}' must be a finite value.`);
    }

    return value.toString().trim();
}

function parseInteger(value, options = {}) {
    const {
        name = "value",
        min = Number.MIN_SAFE_INTEGER,
        max = Number.MAX_SAFE_INTEGER,
        defaultValue,
    } = options;

    if(isMissing(value)){
        return defaultValue;
    }

    const normalizedValue = getScalarString(value, name);
    if(!/^-?\d+$/.test(normalizedValue)){
        throw new QueryValidationError(`Query parameter '${name}' must be an integer.`);
    }

    const parsedValue = Number(normalizedValue);
    if(!Number.isSafeInteger(parsedValue) || parsedValue < min || parsedValue > max){
        throw new QueryValidationError(`Query parameter '${name}' must be between ${min} and ${max}.`);
    }

    return parsedValue;
}

function parseCount(value, options = {}) {
    const {
        name = "count",
        defaultValue,
        maxValue,
    } = options;

    if(!Number.isSafeInteger(defaultValue) || defaultValue < 1){
        throw new TypeError("parseCount requires a positive integer defaultValue.");
    }

    if(!Number.isSafeInteger(maxValue) || maxValue < defaultValue){
        throw new TypeError("parseCount requires maxValue to be at least defaultValue.");
    }

    return parseInteger(value, {
        name: name,
        min: 1,
        max: maxValue,
        defaultValue: defaultValue,
    });
}

function parseBigInt(value, options = {}) {
    const {
        name = "value",
        min = 0n,
        max = MAX_DATABASE_BIGINT,
        defaultValue,
    } = options;

    if(isMissing(value)){
        return defaultValue;
    }

    const normalizedValue = getScalarString(value, name);
    if(!/^\d+$/.test(normalizedValue)){
        throw new QueryValidationError(`Query parameter '${name}' must be a positive decimal integer.`);
    }

    const parsedValue = BigInt(normalizedValue);
    if(parsedValue < min || parsedValue > max){
        throw new QueryValidationError(`Query parameter '${name}' is outside the supported range.`);
    }

    return parsedValue;
}

function parseNodeId(value, options = {}) {
    const {
        name = "node_id",
        defaultValue,
    } = options;

    if(isMissing(value)){
        if(defaultValue !== undefined){
            return defaultValue;
        }

        throw new QueryValidationError(`Query parameter '${name}' is required.`);
    }

    const normalizedValue = getScalarString(value, name);
    let parsedValue;

    if(normalizedValue.startsWith("!")){
        if(!/^![0-9a-fA-F]{1,8}$/.test(normalizedValue)){
            throw new QueryValidationError(`Query parameter '${name}' must be a decimal node id or ! followed by up to 8 hex digits.`);
        }

        parsedValue = BigInt(`0x${normalizedValue.slice(1)}`);
    } else {
        if(!/^\d+$/.test(normalizedValue)){
            throw new QueryValidationError(`Query parameter '${name}' must be a decimal node id or ! followed by up to 8 hex digits.`);
        }

        parsedValue = BigInt(normalizedValue);
    }

    if(parsedValue < 1n || parsedValue > MAX_MESHTASTIC_NODE_ID){
        throw new QueryValidationError(`Query parameter '${name}' must be between 1 and ${MAX_MESHTASTIC_NODE_ID}.`);
    }

    return parsedValue;
}

function parseOptionalNodeId(value, options = {}) {
    if(isMissing(value)){
        return undefined;
    }

    return parseNodeId(value, options);
}

function parseNodeIdList(value, options = {}) {
    const {
        name = "ids",
        maxItems = 250,
    } = options;

    if(isMissing(value) || value === ""){
        return [];
    }

    if(!Number.isSafeInteger(maxItems) || maxItems < 1){
        throw new TypeError("parseNodeIdList requires a positive maxItems value.");
    }

    const normalizedValue = getScalarString(value, name);
    const values = normalizedValue.split(",");
    if(values.length > maxItems){
        throw new QueryValidationError(`Query parameter '${name}' supports at most ${maxItems} node ids.`);
    }

    if(values.some((item) => item.trim().length === 0)){
        throw new QueryValidationError(`Query parameter '${name}' contains an empty node id.`);
    }

    const parsedValues = values.map((item, index) => parseNodeId(item.trim(), {
        name: `${name}[${index}]`,
    }));

    return [...new Set(parsedValues)];
}

function parseNodeIdPair(value, options = {}) {
    const {
        name = "direct_message_node_ids",
    } = options;

    if(isMissing(value)){
        return undefined;
    }

    const values = parseNodeIdList(value, {
        name: name,
        maxItems: 2,
    });

    if(values.length !== 2){
        throw new QueryValidationError(`Query parameter '${name}' requires two different node ids separated by a comma.`);
    }

    return values;
}

function parseDatabaseId(value, options = {}) {
    const {
        name = "id",
        defaultValue,
    } = options;

    return parseBigInt(value, {
        name: name,
        min: 1n,
        max: MAX_DATABASE_BIGINT,
        defaultValue: defaultValue,
    });
}

function parseTimestamp(value, options = {}) {
    const {
        name = "timestamp",
        defaultValue,
    } = options;

    return parseInteger(value, {
        name: name,
        min: 0,
        max: MAX_JAVASCRIPT_TIMESTAMP,
        defaultValue: defaultValue,
    });
}

function parseTimestampRange(query, options = {}) {
    const {
        fromName = "time_from",
        toName = "time_to",
        defaultWindowMs,
        maxRangeMs,
        now = Date.now(),
    } = options;

    if(!Number.isSafeInteger(defaultWindowMs) || defaultWindowMs < 0){
        throw new TypeError("parseTimestampRange requires a non-negative defaultWindowMs value.");
    }

    if(!Number.isSafeInteger(maxRangeMs) || maxRangeMs < defaultWindowMs){
        throw new TypeError("parseTimestampRange requires maxRangeMs to be at least defaultWindowMs.");
    }

    const timeTo = parseTimestamp(query?.[toName], {
        name: toName,
        defaultValue: now,
    });
    const timeFrom = parseTimestamp(query?.[fromName], {
        name: fromName,
        defaultValue: Math.max(0, timeTo - defaultWindowMs),
    });

    if(timeFrom > timeTo){
        throw new QueryValidationError(`Query parameter '${fromName}' must not be later than '${toName}'.`);
    }

    if(timeTo - timeFrom > maxRangeMs){
        throw new QueryValidationError(`The requested time range must not exceed ${maxRangeMs} milliseconds.`);
    }

    return {
        timeFrom: timeFrom,
        timeTo: timeTo,
    };
}

function parseEnum(value, options = {}) {
    const {
        name = "value",
        allowedValues,
        defaultValue,
        caseInsensitive = false,
    } = options;

    if(!Array.isArray(allowedValues) || allowedValues.length === 0){
        throw new TypeError("parseEnum requires at least one allowed value.");
    }

    if(isMissing(value)){
        return defaultValue;
    }

    let normalizedValue = getScalarString(value, name);
    if(caseInsensitive){
        normalizedValue = normalizedValue.toLowerCase();
    }

    if(!allowedValues.includes(normalizedValue)){
        throw new QueryValidationError(`Query parameter '${name}' must be one of: ${allowedValues.join(", ")}.`);
    }

    return normalizedValue;
}

function parseOrder(value, options = {}) {
    return parseEnum(value, {
        name: options.name ?? "order",
        allowedValues: ["asc", "desc"],
        defaultValue: options.defaultValue ?? "asc",
        caseInsensitive: true,
    });
}

function parseBoolean(value, options = {}) {
    const {
        name = "value",
        defaultValue = false,
    } = options;

    if(isMissing(value)){
        return defaultValue;
    }

    const normalizedValue = getScalarString(value, name).toLowerCase();
    if(["1", "true", "yes", "on"].includes(normalizedValue)){
        return true;
    }

    if(["0", "false", "no", "off"].includes(normalizedValue)){
        return false;
    }

    throw new QueryValidationError(`Query parameter '${name}' must be a boolean value.`);
}

function parseOptionalString(value, options = {}) {
    const {
        name = "value",
        maxLength = 191,
    } = options;

    if(isMissing(value)){
        return undefined;
    }

    const normalizedValue = getScalarString(value, name);
    if(normalizedValue.length === 0){
        throw new QueryValidationError(`Query parameter '${name}' must not be empty.`);
    }

    if(normalizedValue.length > maxLength){
        throw new QueryValidationError(`Query parameter '${name}' must not exceed ${maxLength} characters.`);
    }

    return normalizedValue;
}

module.exports = {
    MAX_DATABASE_BIGINT,
    MAX_JAVASCRIPT_TIMESTAMP,
    MAX_MESHTASTIC_NODE_ID,
    QueryValidationError,
    parseBoolean,
    parseCount,
    parseDatabaseId,
    parseEnum,
    parseInteger,
    parseNodeId,
    parseNodeIdList,
    parseNodeIdPair,
    parseOptionalNodeId,
    parseOptionalString,
    parseOrder,
    parseTimestamp,
    parseTimestampRange,
};

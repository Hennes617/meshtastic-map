class NodeIdUtil {

    static MIN_NODE_ID = 1n;
    static MAX_NODE_ID = 0xFFFFFFFFn;

    /**
     * Converts the provided hex id to a numeric id, for example: !FFFFFFFF to 4294967295
     * Decimal strings, safe integer numbers and BigInts are also accepted. All values must
     * be in the Meshtastic uint32 node-id range 1..4294967295.
     * @param hexIdOrNumber a node id in hex format with a prepended "!", or a numeric node id
     * @returns {bigint} the node id in numeric form
     */
    static convertToNumeric(hexIdOrNumber) {
        let numericNodeId;

        if(typeof hexIdOrNumber === "string"){
            if(/^![0-9A-Fa-f]{1,8}$/.test(hexIdOrNumber)){
                numericNodeId = BigInt(`0x${hexIdOrNumber.slice(1)}`);
            } else if(/^\d+$/.test(hexIdOrNumber)){
                numericNodeId = BigInt(hexIdOrNumber);
            } else {
                throw new TypeError(`Invalid Meshtastic node id: ${JSON.stringify(hexIdOrNumber)}`);
            }
        } else if(typeof hexIdOrNumber === "bigint"){
            numericNodeId = hexIdOrNumber;
        } else if(typeof hexIdOrNumber === "number" && Number.isSafeInteger(hexIdOrNumber)){
            numericNodeId = BigInt(hexIdOrNumber);
        } else {
            throw new TypeError(`Invalid Meshtastic node id: ${String(hexIdOrNumber)}`);
        }

        if(numericNodeId < NodeIdUtil.MIN_NODE_ID || numericNodeId > NodeIdUtil.MAX_NODE_ID){
            throw new RangeError("Meshtastic node id must be between 1 and 4294967295");
        }

        return numericNodeId;
    }

}

module.exports = NodeIdUtil;

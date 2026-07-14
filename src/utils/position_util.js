class PositionUtil {

    static MIN_LATITUDE_INTEGER = -900000000;
    static MAX_LATITUDE_INTEGER = 900000000;
    static MIN_LONGITUDE_INTEGER = -1800000000;
    static MAX_LONGITUDE_INTEGER = 1800000000;

    static isValidLatitude(latitudeInteger) {
        return Number.isInteger(latitudeInteger)
            && latitudeInteger >= PositionUtil.MIN_LATITUDE_INTEGER
            && latitudeInteger <= PositionUtil.MAX_LATITUDE_INTEGER;
    }

    static isValidLongitude(longitudeInteger) {
        return Number.isInteger(longitudeInteger)
            && longitudeInteger >= PositionUtil.MIN_LONGITUDE_INTEGER
            && longitudeInteger <= PositionUtil.MAX_LONGITUDE_INTEGER;
    }

    static isValidPrecision(precision) {
        return Number.isInteger(precision) && precision >= 1 && precision <= 32;
    }

    static normalizePacketPrecision(precision) {
        // Meshtastic packets in the wild use an explicit zero for full/unspecified
        // precision. Store that as the canonical full-precision value.
        if(precision === 0){
            return 32;
        }

        return PositionUtil.isValidPrecision(precision) ? precision : null;
    }

    static hasValidCoordinates(latitudeInteger, longitudeInteger) {
        return PositionUtil.isValidLatitude(latitudeInteger)
            && PositionUtil.isValidLongitude(longitudeInteger);
    }

    /**
     * Obfuscates the provided latitude or longitude down to the provided precision in bits.
     * This is based on the same logic in the official meshtastic firmware.
     * https://github.com/meshtastic/firmware/blob/0a93261c0646f93aea518cc0599e547e9dc0e997/src/modules/PositionModule.cpp#L187
     */
    static setPositionPrecision(latitudeOrLongitudeInteger, precision) {

        if(!Number.isInteger(latitudeOrLongitudeInteger)
            || latitudeOrLongitudeInteger < -2147483648
            || latitudeOrLongitudeInteger > 2147483647){
            throw new RangeError("Position value must be a signed 32-bit integer");
        }

        if(!PositionUtil.isValidPrecision(precision)){
            throw new RangeError("Position precision must be an integer between 1 and 32");
        }

        // check if we should use the provided precision
        if(precision > 0 && precision < 32){

            // apply bitmask to reduce precision of position to wanted bits
            latitudeOrLongitudeInteger = latitudeOrLongitudeInteger & (0xFFFFFFFF << (32 - precision));

            // we want the imprecise position to be the middle of the possible location
            latitudeOrLongitudeInteger += (1 << (31 - precision));

        }

        return latitudeOrLongitudeInteger;

    }

    /**
     * Truncates the provided latitude or longitude to a maximum of x decimal places
     * e.g: 12.3456789 with 2 decimal places would be 12.34
     * @param latitudeOrLongitudeString e.g: 12.3456789
     * @param numberOfDecimalPlaces how many decimal places to allow in the result
     * @returns {*|string|null}
     */
    static truncateDecimalPlaces(latitudeOrLongitudeString, numberOfDecimalPlaces) {

        // ensure value not null
        if(latitudeOrLongitudeString == null){
            return null;
        }

        // split into left and right side of decimal point
        // e.g: -12.3456789 -> [-12, 3456789]
        var [ leftOfDecimalPoint, rightOfDecimalPoint ] = latitudeOrLongitudeString.split(".");

        // check if decimal places available
        if(rightOfDecimalPoint != null){

            // truncate decimal places to desired length
            rightOfDecimalPoint = rightOfDecimalPoint.substring(0, numberOfDecimalPlaces);

            // return modified position with decimal places, if available
            if(rightOfDecimalPoint.length > 0){
                return [ leftOfDecimalPoint, rightOfDecimalPoint ].join(".");
            }

            // no decimal places available anymore, return left side without dot
            return leftOfDecimalPoint;

        }

        // decimal places not available, return position as is
        return latitudeOrLongitudeString;

    }

}

module.exports = PositionUtil;

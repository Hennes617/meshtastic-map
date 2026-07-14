-- Keep node privacy/admin purges from scanning entire high-volume tables.
CREATE INDEX `positions_to_idx` ON `positions`(`to`);
CREATE INDEX `positions_from_idx` ON `positions`(`from`);
CREATE INDEX `positions_gateway_id_idx` ON `positions`(`gateway_id`);

CREATE INDEX `service_envelopes_to_idx` ON `service_envelopes`(`to`);
CREATE INDEX `service_envelopes_from_idx` ON `service_envelopes`(`from`);

CREATE INDEX `traceroutes_gateway_id_idx` ON `traceroutes`(`gateway_id`);
CREATE INDEX `waypoints_locked_to_idx` ON `waypoints`(`locked_to`);

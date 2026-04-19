ALTER TABLE `map_reports`
    ADD INDEX `map_reports_node_id_created_at_idx`(`node_id`, `created_at`);

ALTER TABLE `neighbour_infos`
    ADD INDEX `neighbour_infos_node_id_created_at_idx`(`node_id`, `created_at`);

ALTER TABLE `device_metrics`
    ADD INDEX `device_metrics_node_id_created_at_idx`(`node_id`, `created_at`);

ALTER TABLE `environment_metrics`
    ADD INDEX `environment_metrics_node_id_created_at_idx`(`node_id`, `created_at`);

ALTER TABLE `power_metrics`
    ADD INDEX `power_metrics_node_id_created_at_idx`(`node_id`, `created_at`);

ALTER TABLE `positions`
    ADD INDEX `positions_node_id_created_at_idx`(`node_id`, `created_at`);

ALTER TABLE `service_envelopes`
    ADD INDEX `service_envelopes_gateway_id_mqtt_topic_created_at_idx`(`gateway_id`, `mqtt_topic`, `created_at`);

ALTER TABLE `text_messages`
    ADD INDEX `text_messages_channel_id_id_idx`(`channel_id`, `id`),
    ADD INDEX `text_messages_gateway_id_id_idx`(`gateway_id`, `id`);

ALTER TABLE `traceroutes`
    ADD INDEX `traceroutes_to_want_response_id_idx`(`to`, `want_response`, `id`);

ALTER TABLE `waypoints`
    ADD INDEX `waypoints_expire_idx`(`expire`),
    ADD INDEX `waypoints_from_waypoint_id_id_idx`(`from`, `waypoint_id`, `id`);

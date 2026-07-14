<h2 align="center">Meshtastic Map</h2>

<p align="center">
<a href="https://github.com/Hennes617/meshtastic-map"><img src="https://img.shields.io/badge/GitHub-Hennes617%2Fmeshtastic--map-181717?style=flat&logo=github" alt="github"/></a>
</p>

A map of all Meshtastic nodes heard via MQTT.
This fork is maintained by Hennes Bolte for self-hosted deployments.

<img src="./screenshot.png">

## How does it work?

- An [mqtt client](./src/mqtt.js) is persistently connected to `mqtt.meshtastic.org` and, by default, subscribed to the public broker topic pattern `msh/+/2/e/#`.
- The collector now generates a default MQTT client ID automatically, because the public broker resets connections when `clientId` is sent as `null`.
- All messages received are attempted to be decoded as [ServiceEnvelope](https://buf.build/meshtastic/protobufs/docs/main:meshtastic#meshtastic.ServiceEnvelope) packets.
- If a packet is encrypted, it attempts to decrypt it with the default `AQ==` key.
- If a packet can't be decoded as a `ServiceEnvelope`, it is ignored.
- `NODEINFO_APP` packets add a node to the database.
- `POSITION_APP` packets update the position of a node in the database.
- `NEIGHBORINFO_APP` packets log neighbours heard by a node to the database.
- `TELEMETRY_APP` packets update battery and voltage metrics for a node in the database.
- `TRACEROUTE_APP` packets log all trace routes performed by a node to the database.
- `MAP_REPORT_APP` packets are stored in the database, but are not widely adopted, so are not used yet.
- The database is a MySQL server, and a nodejs express server is running an API to serve data to the map interface.

## Features

- [x] Connects to mqtt.meshtastic.org to collect nodes and metrics.
- [x] Shows nodes on the map if they have reported a valid position.
- [x] Search bar to find nodes by ID, Hex ID, Short Name and Long Name.
- [x] Hover over nodes on the map to see basic information and a preview image.
- [x] Click nodes on the map to show a sidebar with more info such as telemetry graphs and traceroutes.
- [x] Ability to share a direct link to a node. The map will auto navigate to it.
- [x] Device list. To see which hardware models are most popular.
- [x] Mobile optimised layout.
- [x] Settings available to hide nodes from the map if they haven't been updated in a while.
- [x] Real-Time message UI to view `TEXT_MESSAGE_APP` packets as they come in.
- [x] View position history of a node between a selectable time range.
- [x] "Neighbours" map layer. Shows blue connection lines between nodes that heard the other node.
  - This information is taken from the `NEIGHBORINFO_APP`.
  - Some neighbour lines are clearly wrong.
  - Meshtastic firmware older than [v2.3.2](https://github.com/meshtastic/firmware/releases/tag/v2.3.2.63df972) reports MQTT nodes as Neighbours.
  - This was fixed in [meshtastic/firmware/#3457](https://github.com/meshtastic/firmware/pull/3457), but adoption will likely be slow...

## TODO

- use vuejs build process to make managing code easier
- don't use cdn hosted javascript deps so we can run fully offline
  - offline map tiles?
- dedupe packets to prevent spamming database

## Quick start on macOS

The easiest local setup uses Docker Desktop and includes MariaDB, schema setup, the MQTT collector and the map UI.

Requirements:

- Docker Desktop for Mac
- Git

```sh
git clone https://github.com/Hennes617/meshtastic-map
cd meshtastic-map
cp .env.example .env
```

Change `MARIADB_ROOT_PASSWORD` in `.env` to a strong value containing URL-safe characters (letters, digits, `_`, `-`), then start the stack:

```sh
docker compose up --build -d
docker compose ps
```

Open [http://127.0.0.1:8081](http://127.0.0.1:8081). Follow logs with `docker compose logs -f meshtastic-map meshtastic-mqtt` and stop everything with `docker compose down`. Database data remains in the named Docker volume.

The published ports bind to `127.0.0.1` by default. Put an authenticated, TLS-enabled reverse proxy in front of the service before exposing it publicly.

## Manual install

Use Node.js 20 or newer and a MySQL/MariaDB database. Some API queries are MySQL-specific; other database providers are not supported.

```sh
git clone https://github.com/Hennes617/meshtastic-map
cd meshtastic-map
npm ci
cp .env.example .env
```

Set `DATABASE_URL` in `.env`, apply the schema and start the web UI:

```sh
npx prisma migrate deploy
npm start
# Server running at http://127.0.0.1:8080
```

Use `npm start -- --port 8123` for a custom port. The collector additionally needs the Meshtastic protobuf checkout described below:

```sh
npm run start:mqtt
```

## Upgrading

For the Docker setup, update the checkout and rebuild the services. Container startup synchronizes the Prisma schema with the Compose-managed database:

```sh
git pull --ff-only
docker compose up --build -d
docker compose ps
```

For a manual installation created with Prisma migrations, use the migration workflow instead:

```sh
git pull --ff-only
npm ci
npx prisma generate
npx prisma migrate deploy
```

Do not run `migrate deploy` against a Docker database originally created by this project's `db push` startup flow unless you have explicitly [baselined that database](https://www.prisma.io/docs/orm/prisma-migrate/workflows/baselining).

## MQTT Collector

> Please note, due to the Meshtastic protobuf schema files being locked under a GPLv3 license, these are not provided in this MIT licensed project.
You will need to obtain these files yourself to be able to use the MQTT Collector.

Clone the schemas into the default local path before a manual collector start:

```sh
git clone https://github.com/meshtastic/protobufs src/external/protobufs
npm run start:mqtt
```

By default, the [MQTT Collector](./src/mqtt.js) connects to the public Meshtastic broker, generates a unique client ID, bounds its in-memory queue and accepts the default channel key. View the always-current options for custom brokers, collection types, identity sources, filters, retention, concurrency and queue limits with:

```sh
npm run start:mqtt -- --help
```

To connect to your own MQTT server, you could do something like the following;

```
node src/mqtt.js --mqtt-broker-url mqtt://mqtt.example.com --mqtt-username username --mqtt-password password --decryption-keys 1PG7OiApB1nwvP+rz05pAQ==
```

## MQTT Connection Status

Marker colour reflects when a node most recently acted as an MQTT gateway, rather than a durable broker session:

- `Green`: recently uplinked a packet to MQTT.
- `Blue`: no recent MQTT uplink within the configured threshold.
- `Red`: the node itself has not been updated within the optional offline threshold.

This is an activity indicator, not proof that a radio is currently reachable.

## Docker Compose

A [docker-compose.yml](./docker-compose.yml) is available. You can run the following command to launch everything:

```sh
docker compose up --build -d
```

This will:

- Start a MariaDB database server.
- Synchronize the Prisma schema.
- Start the MQTT collector.
- Start the Map UI.
- Expose the map on host port `8081` by default (override with `MAP_PORT`).

On container start, the MQTT service will automatically clone the Meshtastic protobuf repository into `src/external/protobufs` if it is missing.
You can disable that with `AUTO_FETCH_PROTOBUFS=false` or pin a specific ref with `PROTOBUFS_GIT_REF`; pinning is recommended for reproducible production deployments.

## Testing and health

```sh
npm run check
# Manual Node.js server (default)
curl --fail http://127.0.0.1:8080/api/v1/health
# Docker Compose (default MAP_PORT)
curl --fail http://127.0.0.1:8081/api/v1/health
```

`npm run check` runs syntax validation and all unit tests. The health endpoint checks that the HTTP process is alive and its database connection is usable.

## Contributing

If you have a feature request, or find a bug, please [open an issue](https://github.com/Hennes617/meshtastic-map/issues) here on GitHub.

## License

MIT

## Legal

This project is not affiliated with or endorsed by the Meshtastic project.

The Meshtastic logo is the trademark of Meshtastic LLC.

## References

- https://meshtastic.org/docs/software/integrations/mqtt/
- https://buf.build/meshtastic/protobufs/docs/main:meshtastic

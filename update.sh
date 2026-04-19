# pull changes from git
git fetch && git pull

# update node deps
npm install

# sync prisma schema
sh ./docker/prisma.sh apply

# restart services
service meshtastic-map restart
service meshtastic-map-mqtt restart

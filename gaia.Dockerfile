FROM gaia.server:1.0

USER root

WORKDIR /gaia

COPY style/ style/
COPY script/ script/
COPY library/ library/
COPY image/ image/
COPY fonts/ fonts/

COPY index.html /gaia

COPY package.json /gaia/package.json

WORKDIR /gaia

RUN npm install express node-fetch cheerio

COPY start.js /gaia

EXPOSE 6678

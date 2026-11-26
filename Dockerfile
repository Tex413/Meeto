FROM node:20-slim

WORKDIR /app

# Install dependencies first (cache layer)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app source
COPY *.js *.html *.vbs .gitignore ./
COPY lib ./lib

# LM Studio on the Docker host. data/.env or the container environment overrides it.
ENV LMSTUDIO_URL=http://host.docker.internal:1234/v1

# Persistent data lives in a mounted volume
ENV DATA_DIR=/app/data
ENV NODE_ENV=production
RUN mkdir -p /app/data

EXPOSE 7432

CMD ["node", "server.js"]

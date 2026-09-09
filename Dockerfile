FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code and frontend
COPY . .

# Expose TCP Port (GPS Trackers) and HTTP Port (Web Dashboard & API)
EXPOSE 5023 3001

ENV NODE_ENV=production
ENV TCP_PORT=5023
ENV HTTP_PORT=3001

CMD ["node", "src/index.js"]

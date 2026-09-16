FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm i -D typescript
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p . && npm uninstall typescript
VOLUME ["/app/data"]
CMD ["node", "dist/index.js", "--slack", "--quiet"]
